import { withStudentLock } from './lifecycle.ts';
import { request } from 'node:http';
import type { Config } from './config.ts';
import type { Store, Student } from './store.ts';

export type Container = { Id:string; Names:string[]; State:string; Status:string; Labels:Record<string,string>; ImageID?:string };
export type Inspect = { Image:string; Config:{Image:string;Labels?:Record<string,string>}; State:{Running:boolean} };
export const containerName=(id:string)=>`takehome-student-${id}`;
export class Docker {
  socket:string;
  constructor(socket='/var/run/docker.sock') { this.socket=socket; }
  call<T=any>(method:string,path:string,body?:unknown,timeout=30_000):Promise<T> {
    return new Promise((resolve,reject)=>{
      const req=request({socketPath:this.socket,path:`/v1.47${path}`,method,headers:{'Content-Type':'application/json'}},res=>{
        const chunks:Buffer[]=[]; let size=0;
        res.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024)req.destroy(new Error('Docker response too large'));else chunks.push(chunk);});
        res.on('end',()=>{const text=Buffer.concat(chunks).toString(); if(res.statusCode!>=400)reject(Object.assign(new Error(`Docker HTTP ${res.statusCode}`),{status:res.statusCode}));
          else {try{resolve(text?JSON.parse(text):undefined);}catch(error){reject(error);}}});
      });
      req.setTimeout(timeout,()=>req.destroy(new Error('Docker timed out'))); req.on('error',reject);
      req.end(body===undefined?undefined:JSON.stringify(body));
    });
  }
  list() { return this.call<Container[]>('GET','/containers/json?all=true&filters='+encodeURIComponent(JSON.stringify({label:['app=protagonist-takehome','role=student']}))); }
  inspect(s:Student) { return this.call<Inspect>('GET',`/containers/${containerName(s.id)}/json`).catch(e=>{if(e.status===404)return undefined;throw e;}); }
  // The image ID the configured tag points to now; a rebuilt tag keeps its name but changes this.
  imageId(c:Config) { return this.call<{Id:string}>('GET',`/images/${encodeURIComponent(c.workerImage)}/json`).then(image=>image.Id); }
  async system(c:Config) {
    const workerImage=await this.imageId(c).catch(()=>null);
    // Docker sets HOSTNAME to this container's ID. Return only observed version metadata, never Config.Env.
    const self=process.env.HOSTNAME||'';
    const controller=/^[a-f0-9]{12,64}$/.test(self)?await this.call<Inspect&{State:{Running:boolean;StartedAt?:string}}>('GET',`/containers/${self}/json`).catch(()=>null):null;
    return {workerImage,controllerImage:controller?.Image||null,startedAt:controller?.State.StartedAt||null};
  }
  async ensure(s:Student,c:Config):Promise<Inspect> {
    const name=containerName(s.id);
    let found=await this.inspect(s);
    if (!found) {
      await this.call('POST',`/containers/create?name=${name}`,containerSpec(s,c)).catch(e=>{if(e.status!==409)throw e;});
      found=(await this.inspect(s))!;
    }
    if(found.Config.Labels?.app!=='protagonist-takehome'||found.Config.Labels?.student!==s.id||found.Config.Image!==c.workerImage)
      throw new Error('Unexpected student container identity');
    if(!found.State.Running) await this.call('POST',`/containers/${name}/start`);
    return found;
  }
  async stop(s:Student) { await this.call('POST',`/containers/${containerName(s.id)}/stop?t=20`,undefined,40_000).catch(e=>{if(e.status!==304&&e.status!==404)throw e;}); }
  async removeStudent(s:Student) {
    const found=await this.inspect(s);
    if(found&&(found.Config.Labels?.app!=='protagonist-takehome'||found.Config.Labels?.student!==s.id))throw Error('Unexpected student container identity');
    if(found){await this.stop(s);await this.call('DELETE',`/containers/${containerName(s.id)}`).catch(e=>{if(e.status!==404)throw e;});}
    // Delete only the volume named for this UUID. A volume still in use is refused by Docker; never force it.
    await this.call('DELETE',`/volumes/takehome-data-${s.id}`).catch(e=>{if(e.status!==404)throw e;});
  }
  // Replace the container with one from the current image, keeping the student's volume and token.
  async recreate(s:Student,c:Config) {
    const found=await this.inspect(s);
    if(found&&(found.Config.Labels?.app!=='protagonist-takehome'||found.Config.Labels?.student!==s.id))throw new Error('Unexpected student container identity');
    if(found){await this.stop(s);await this.call('DELETE',`/containers/${containerName(s.id)}`);}
    return this.ensure(s,c);
  }
}
// Start every connected student's container. Containers left on an older image are replaced only while the student has
// nothing queued and the worker reports idle, a few per pass, so a deployment never interrupts a conversation.
export async function reconcile(store:Store,docker:Pick<Docker,'ensure'|'imageId'|'recreate'>,c:Config,send:typeof fetch=fetch,perPass=2) {
  const current=c.features.autoRollout?await docker.imageId(c).catch(()=>undefined):undefined;
  let replaced=0;
  for(const student of store.connected()) await withStudentLock(student.id,async()=>{
    if(!store.student(student.id)||store.student(student.id)?.disconnected||store.student(student.id)?.deleting)return;
    try {
      const found=await docker.ensure(student,c);
      if(!current||found.Image===current||replaced>=perPass||!store.idle(student.id))return;
      const activity=await send(`http://${containerName(student.id)}:3000/activity`,{headers:{authorization:`Bearer ${student.token}`},signal:AbortSignal.timeout(3000)})
        .then(r=>r.ok?r.json() as Promise<{state?:string}>:undefined).catch(()=>undefined);
      if(store.student(student.id)?.deleting||found.State.Running&&activity?.state!=='Idle')return;
      replaced++;await docker.recreate(student,c);console.log(`Student container updated: ${student.id}`);
    } catch {console.error(`Container unavailable: ${student.id}`);}
  });
  return replaced;
}
export function containerSpec(s:Student,c:Config) {
  return {Image:c.workerImage,User:'1000:1000',WorkingDir:'/data/workspace',
    Labels:{app:'protagonist-takehome',role:'student',student:s.id},
    Env:[`WORKER_TOKEN=${s.token}`,`BROKER_URL=${c.brokerUrl}`,`MODEL=${c.model}`,'HOME=/data','NODE_ENV=production'],
    HostConfig:{NetworkMode:c.workerNetwork,ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],
      Memory:512*1024*1024,MemorySwap:512*1024*1024,NanoCpus:500_000_000,PidsLimit:64,Init:true,
      RestartPolicy:{Name:'unless-stopped'},Tmpfs:{'/tmp':'rw,noexec,nosuid,size=64m,mode=1777'},
      Mounts:[{Type:'volume',Source:`takehome-data-${s.id}`,Target:'/data'}],
      LogConfig:{Type:'json-file',Config:{'max-size':'5m','max-file':'2'}}},
    NetworkingConfig:{EndpointsConfig:{[c.workerNetwork]:{Aliases:[containerName(s.id)]}}}};
}
