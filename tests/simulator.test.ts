import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { readConfig } from '../src/config.ts';
import { publicApp } from '../src/web.ts';
import { brokerApp } from '../src/broker.ts';
import { processJob, LIMITS } from '../src/jobs.ts';
import { containerSpec, containerName } from '../src/docker.ts';

const config=()=>({...readConfig(),openrouterKey:'synthetic-test-key'});
const headers={'content-type':'application/json','x-protagonist':'1',origin:'http://localhost'};
const docker={list:async()=>[],ensure:async()=>({Image:'fixture',Config:{Image:'fixture'},State:{Running:true}}),stop:async()=>{}};
const post=(app:ReturnType<typeof publicApp>,path:string,body:unknown)=>app.request(path,{method:'POST',headers,body:JSON.stringify(body)});

test('simulator creates isolated students, validates input and never exposes worker credentials',async()=>{
  const store=new Store(':memory:');try{
    const app=publicApp(store,docker,config());
    assert.equal((await post(app,'/simulator/api/students',{name:''})).status,400);
    const a=await (await post(app,'/simulator/api/students',{name:'Ada'})).json();
    const b=await (await post(app,'/simulator/api/students',{name:'Bea'})).json();
    assert.notEqual(a.id,b.id);
    assert.equal((await post(app,`/simulator/api/students/${a.id}/messages`,{text:'My goal',requestId:'fixture-1'})).status,202);
    assert.equal((await post(app,`/simulator/api/students/${a.id}/messages`,{text:'My goal',requestId:'fixture-1'})).status,202);
    assert.equal(store.jobCounts().pending,1);
    assert.equal((await post(app,`/simulator/api/students/${a.id}/messages`,{text:'/stop',requestId:'stop-fixture'})).status,202);
    assert.equal(store.current(a.id)!.cancel,1);
    assert.equal((await post(app,`/simulator/api/students/${a.id}/messages`,{text:'Different',requestId:'fixture-1'})).status,409);
    const transcript=await (await app.request(`/simulator/api/students/${b.id}/messages`)).text();
    assert.ok(!transcript.includes('My goal'));
    for(const path of ['/simulator/api/students',`/simulator/api/students/${a.id}/messages`]){
      const response=await (await app.request(path)).text();
      for(const s of store.students())assert.ok(!response.includes(s.token));
    }
    assert.equal((await post(app,'/simulator/api/students/missing/messages',{text:'hi',requestId:'fixture-2'})).status,404);
  }finally{store.close();}
});

test('local console rejects cross-origin mutations, cross-site reads, and DNS rebinding hosts',async()=>{
  const store=new Store(':memory:');try{
    const app=publicApp(store,docker,config());
    assert.equal((await app.request('/simulator/api/students',{method:'POST',body:'{}'})).status,403);
    assert.equal((await app.request('/simulator/api/students',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    assert.equal((await app.request('/simulator/api/students',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:'{}'})).status,403);
    assert.equal((await app.request('http://attacker.example/simulator/api/students')).status,403);
    assert.equal((await app.request('/simulator')).status,200);
    assert.equal((await app.request('/admin/')).status,200);
  }finally{store.close();}
});

test('missing model key is explicit and cannot silently queue a fake reply',async()=>{
  const store=new Store(':memory:');try{
    const app=publicApp(store,docker,{...readConfig(),openrouterKey:''}),s=store.createStudent('Ada');
    assert.equal((await post(app,`/simulator/api/students/${s.id}/messages`,{text:'Hi',requestId:'fixture-1'})).status,503);
    assert.equal(store.pending().length,0);
    assert.equal((await (await app.request('/simulator/api/status')).json()).modelConfigured,false);
  }finally{store.close();}
});

test('dashboard sessions switch explicitly and forward only the session owner’s credential',async()=>{
  const store=new Store(':memory:');try{
    const a=store.createStudent('Ada'),b=store.createStudent('Bea');let token='';
    const app=publicApp(store,docker,config(),async(url,init)=>{assert.equal(String(url),`http://${containerName(b.id)}:3000/dashboard`);token=(init!.headers as Record<string,string>).authorization;return Response.json({goals:[],files:[],memory:'Bea memory'});});
    await post(app,`/simulator/api/students/${a.id}/dashboard`,{});
    const login=await post(app,`/simulator/api/students/${b.id}/dashboard`,{}),cookie=login.headers.get('set-cookie')!;
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\/me/);
    assert.equal((await app.request('/me/api/overview')).status,401);
    const overview=await (await app.request('/me/api/overview',{headers:{cookie:cookie.split(';')[0]}})).json();
    assert.equal(overview.account.name,'Bea');assert.equal(token,`Bearer ${b.token}`);assert.equal(overview.memory,'Bea memory');
  }finally{store.close();}
});

test('queue ordering, admission deduplication and local reply delivery survive restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'takehome-queue-'));let store=new Store(join(dir,'app.sqlite'));
  try{
    const a=store.createStudent('Ada'),b=store.createStudent('Bea');
    store.receiveMessage(a.id,'fixture-1','First');store.receiveMessage(a.id,'fixture-2','Second');store.receiveMessage(b.id,'fixture-3','Other');
    assert.equal(store.pending().length,2);
    const job=store.current(a.id)!;
    await processJob(store,docker,config(),job,async()=>Response.json({status:'done',text:'First answer.',outcome:'success'}));
    store.close();store=new Store(join(dir,'app.sqlite'));
    assert.equal(store.receiveMessage(a.id,'fixture-1','First'),job.id);
    assert.equal(store.current(a.id)!.text,'Second');
    await processJob(store,docker,config(),job,async()=>{throw Error('Should not call model for prepared reply');});
    assert.equal(store.messages(a.id).filter(m=>m.text==='First answer.').length,1);
    assert.ok(!store.messages(b.id).some(m=>m.text==='First answer.'));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('cancel queued and running jobs, recover from unavailable workers, and bound retry duration',async()=>{
  let clock=Date.now();const store=new Store(':memory:',()=>clock);try{
    const s=store.createStudent('Ada');store.receiveMessage(s.id,'fixture-1','Queued');let job=store.current(s.id)!;
    assert.ok(store.requestStop(s.id,job.id));await processJob(store,docker,config(),store.current(s.id)!,async()=>{throw Error('Must not submit cancelled input');});
    assert.equal(store.jobHistory(s.id)[0].outcome,'cancelled');
    store.receiveMessage(s.id,'fixture-2','Running');job=store.current(s.id)!;
    await processJob(store,docker,config(),job,async()=>Response.json({status:'pending'}));
    assert.ok(store.current(s.id)!.submitted);assert.ok(store.requestStop(s.id,job.id));let aborted=false;
    await processJob(store,docker,config(),store.current(s.id)!,async url=>{if(String(url).endsWith('/abort')){aborted=true;return Response.json({status:'aborting'});}return Response.json({status:'done',text:'Stopped.',outcome:'cancelled'});});
    assert.ok(aborted);assert.equal(store.jobCounts().pending,0);
    store.receiveMessage(s.id,'fixture-3','Retry');await processJob(store,docker,config(),store.current(s.id)!,async()=>{throw Error('offline');});
    assert.equal(store.jobCounts(s.id).retrying,1);clock+=LIMITS.reach+1;
    await processJob(store,docker,config(),store.current(s.id)!,async()=>{throw Error('offline');});
    assert.equal(store.jobHistory(s.id)[0].outcome,'failed');assert.equal(store.jobCounts().pending,0);
  }finally{store.close();}
});

test('broker saves progress and files once, scoped by worker identity, with no external delivery',async()=>{
  const store=new Store(':memory:');try{
    const a=store.createStudent('Ada'),b=store.createStudent('Bea');const app=brokerApp(store,config(),async()=>{throw Error('Unexpected external call');});
    const notify=()=>app.request('/notify',{method:'POST',headers:{authorization:`Bearer ${a.token}`,'content-type':'application/json'},body:JSON.stringify({requestId:'tool-1',text:'Working. Send /stop to cancel.'})});
    assert.equal((await notify()).status,200);assert.equal((await notify()).status,200);
    assert.equal(store.messages(a.id).filter(m=>m.role==='progress').length,1);
    const upload=()=>{const form=new FormData();form.set('requestId','tool-file');form.set('document',new File(['hello'],'notes.txt'));return app.request('/documents',{method:'POST',headers:{authorization:`Bearer ${a.token}`},body:form});};
    const [first,second]=await Promise.all([upload(),upload()]);assert.equal(first.status,200);assert.equal(second.status,200);
    const id=(await first.json()).messageId;assert.equal(Buffer.from(store.attachment(a.id,id)!.bytes).toString(),'hello');assert.equal(store.attachment(b.id,id),undefined);
    const local=publicApp(store,docker,config());assert.equal((await local.request(`/simulator/api/students/${b.id}/files/${id}`)).status,404);
    assert.equal((await local.request(`/simulator/api/students/${a.id}/files/${id}`)).headers.get('content-type'),'application/octet-stream');
    for(const route of ['/search','/fetch'])assert.equal((await app.request(route,{method:'POST',headers:{authorization:`Bearer ${a.token}`}})).status,404);
    assert.equal((await app.request('/reminders')).status,401);
  }finally{store.close();}
});

test('local reminders fire once and deleting one student removes only their local data',()=>{
  let clock=Date.now();const store=new Store(':memory:',()=>clock);try{
    const a=store.createStudent('Ada'),b=store.createStudent('Bea');
    store.addReminder(a.id,'reminder-one',clock+1000,'UTC','Study',null);
    clock+=1001;store.fireReminders();store.fireReminders();assert.equal(store.pending().length,1);
    const session=store.redeemLogin(store.newLogin(a.id))!;store.beginDelete(a.id);assert.equal(store.sessionStudent(session),undefined);
    store.finishDelete(a.id);assert.equal(store.messages(a.id).length,0);assert.equal(store.pending().length,0);assert.ok(store.student(b.id));assert.equal(store.messages(b.id).length,1);
  }finally{store.close();}
});

test('worker containers use isolated volumes and internal networking without the provider key',()=>{
  const store=new Store(':memory:');try{
    const a=containerSpec(store.createStudent('Ada'),config()),b=containerSpec(store.createStudent('Bea'),config());
    assert.notDeepEqual(a.HostConfig.Mounts,b.HostConfig.Mounts);assert.equal(a.HostConfig.ReadonlyRootfs,true);
    assert.equal(a.HostConfig.NetworkMode,'protagonist-takehome-students');assert.ok(!JSON.stringify(a).includes('synthetic-test-key'));
    assert.equal(a.Labels.app,'protagonist-takehome');assert.deepEqual(a.HostConfig.CapDrop,['ALL']);
  }finally{store.close();}
});
