import { withStudentLock } from './lifecycle.ts';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Store, Student } from './store.ts';
import type { Config } from './config.ts';
import { containerName, type Docker } from './docker.ts';
import { ASSISTANT_MODELS, MODEL_SETTING, allowedModel, selectedModel } from './models.ts';

export type AdminDocker=Pick<Docker,'list'>&Partial<Pick<Docker,'system'|'removeStudent'>>;
// Local evaluator dashboard, protected by loopback host/origin checks in web.ts. No worker credential or raw job body crosses this boundary.
export function adminApp(store:Store,docker:AdminDocker,config:Config,send:typeof fetch) {
  const app=new Hono<{Variables:{student:Student}}>();
  const worker=(s:Student,path:string)=>send(`http://${containerName(s.id)}:3000${path}`,{
    headers:{authorization:`Bearer ${s.token}`},signal:AbortSignal.timeout(8000),redirect:'error'});
  const clean=async(r:Response,s:Student)=>JSON.parse((await r.text()).replaceAll(s.token,'[credential redacted]'));
  app.get('/students',async c=>{
    let containers:Awaited<ReturnType<Docker['list']>>=[],available=true;
    try{containers=await docker.list();}catch{available=false;}
    return c.json({available,students:store.students().map(s=>{
      const container=containers.find(x=>x.Labels.student===s.id);
      return {id:s.id,name:s.name,username:s.username,channels:['Simulator'],created:s.created,disconnected:!!s.disconnected,deleting:!!s.deleting,container:containerName(s.id),
        state:available?(container?.State||'provisioning'):'unknown',status:available?(container?.Status||'Waiting for container'):'Docker unavailable',...store.jobCounts(s.id)};
    })});
  });
  app.get('/system',async c=>{
    let containers:Awaited<ReturnType<Docker['list']>>=[],available=true;
    try{containers=await docker.list();}catch{available=false;}
    const versions=await docker.system?.(config).catch(()=>null);
    return c.json({observedAt:new Date(store.now()).toISOString(),controller:'responding',uptime:Math.floor(process.uptime()),docker:available?'available':'unavailable',
      simulator:true,modelConfigured:!!config.openrouterKey,...store.jobCounts(),
      controllerImage:versions?.controllerImage||null,startedAt:versions?.startedAt||null,workerImage:versions?.workerImage||null,
      model:{selected:selectedModel(store,config),options:ASSISTANT_MODELS},costs:store.costSummary(),
      students:store.students().map(s=>{
        const container=containers.find(x=>x.Labels.student===s.id);
        return {id:s.id,name:s.name,disconnected:!!s.disconnected,state:available?(container?.State||'missing'):'unknown',
          image:container?.ImageID||null,current:versions?.workerImage&&container?.ImageID?versions.workerImage===container.ImageID:null,...store.jobCounts(s.id)};
      })});
  });
  app.post('/model',bodyLimit({maxSize:1024,onError:c=>c.json({error:'Request too large.'},413)}),async c=>{
    const site=c.req.header('sec-fetch-site'),origin=c.req.header('origin');
    if(c.req.header('x-protagonist')!=='1'||(site?site!=='same-origin':!origin||![new URL(config.publicUrl).origin,new URL(c.req.url).origin].includes(origin)))return c.json({error:'Forbidden'},403);
    const body=await c.req.json().catch(()=>null);
    if(!allowedModel(body?.model))return c.json({error:`Choose ${ASSISTANT_MODELS.map(model=>model.name).join(', ')}.`},400);
    store.set(MODEL_SETTING,body.model);
    return c.json({selected:body.model});
  });
  app.use('/students/:id/*',async(c,next)=>{
    const s=store.student(c.req.param('id')!);if(!s)return c.json({error:'Student not found.'},404);
    c.set('student',s);return next();
  });
  app.get('/students/:id/terminal',c=>c.redirect(`/admin/#student=${encodeURIComponent(c.get('student').id)}&tab=terminal`));
  app.get('/students/:id/overview',async c=>{
    const s=c.get('student'),usage=store.usage(s.id),current=store.current(s.id);
    let assistant:Record<string,unknown>={unavailable:true};
    if(!s.disconnected&&c.req.query('runtime')!=='0')try{const r=await worker(s,'/dashboard');if(r.ok){
      const data=await clean(r,s);
      assistant={state:data.state||'Unknown',goals:data.goals||[],files:data.files||[],uploads:data.uploads||[],memory:data.memory||'',soul:data.soul||'',activity:data.activity||[]};
    }}catch{}
    return c.json({student:{id:s.id,name:s.name,username:s.username,disconnected:!!s.disconnected},observedAt:new Date(store.now()).toISOString(),
      ...assistant,...store.jobCounts(s.id),jobs:store.jobHistory(s.id),
      current:current?{id:current.id,submitted:current.submitted,responding:current.reply!==null,cancel:current.cancel,error_code:current.error_code}:null,
      usage:Object.fromEntries(Object.entries(config.limits).map(([k,limit])=>[k,{used:usage[k]||0,limit}])),
      reminders:store.reminders(s.id).map(({id,at,zone,note,goal})=>({id,at,zone,note,goal}))});
  });
  app.get('/students/:id/activity',async c=>{
    const s=c.get('student');
    const container=(await docker.list()).find(x=>x.Labels.student===s.id);
    const info={name:s.name,container:containerName(s.id),containerState:container?.State||'provisioning'};
    if(s.disconnected||container?.State!=='running')return c.json({...info,error:'Container is not running.'},503);
    try{const r=await worker(s,'/activity');if(r.ok)return c.json({...await clean(r,s),...info});}catch{}
    return c.json({...info,error:'Runtime is unavailable. Reconnecting…'},503);
  });
  app.get('/students/:id/files',async c=>{
    const s=c.get('student');
    if(s.disconnected)return c.json({error:'Student is disconnected.'},409);
    let r:Response;try{r=await worker(s,`/files?path=${encodeURIComponent(c.req.query('path')||'')}`);}catch{return c.json({error:'Runtime unavailable.'},503);}
    if(!r.ok)return c.json({error:'File not found.'},404);
    const name=decodeURIComponent(r.headers.get('x-filename')||'file').replace(/[\x00-\x1f\x7f"]/g,'');
    return new Response(r.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${name.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  });
  app.post('/students/:id/delete',bodyLimit({maxSize:1024,onError:c=>c.json({error:'Request too large.'},413)}),async c=>{
    const site=c.req.header('sec-fetch-site'),origin=c.req.header('origin');
    if(c.req.header('x-protagonist')!=='1'||(site?site!=='same-origin':!origin||![new URL(config.publicUrl).origin,new URL(c.req.url).origin].includes(origin)))return c.json({error:'Forbidden'},403);
    const body=await c.req.json().catch(()=>null),s=c.get('student');
    if(body?.confirm!==s.id)return c.json({error:'Confirm the selected account before deleting it.'},400);
    if(!docker.removeStudent)return c.json({error:'Account deletion is unavailable.'},503);
    store.beginDelete(s.id);
    try {
      await withStudentLock(s.id,async()=>{
        if(!store.student(s.id))return; // A second confirmed request can safely share the result.
        await docker.removeStudent!(s);
        store.finishDelete(s.id);
      });
      return c.json({deleted:true});
    }catch{return c.json({error:'Deletion is incomplete. Access is revoked and the account is paused. Retry Delete user to finish removing it.'},503);}
  });
  app.post('/students/:id/stop',async c=>{
    const site=c.req.header('sec-fetch-site'),origin=c.req.header('origin');
    if(c.req.header('x-protagonist')!=='1'||(site?site!=='same-origin':!origin||![new URL(config.publicUrl).origin,new URL(c.req.url).origin].includes(origin)))return c.json({error:'Forbidden'},403);
    const body=await c.req.json().catch(()=>null),s=c.get('student');
    if(!Number.isSafeInteger(body?.id))return c.json({error:'A current job ID is required.'},400);
    if(s.disconnected||!store.requestStop(s.id,body.id))return c.json({error:'That request is no longer running. Refresh and try again.'},409);
    return c.json({stopping:true});
  });
  return app;
}
