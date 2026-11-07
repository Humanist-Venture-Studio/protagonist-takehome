import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ideas, type IdeasSnapshot } from '../src/ideas.ts';
import { atomicWorkspaceText } from '../src/workspace.ts';
import { Store } from '../src/store.ts';
import { readConfig } from '../src/config.ts';
import { publicApp } from '../src/web.ts';
import { processJob } from '../src/jobs.ts';

const flags={research:false,reminders:true};
const skills=[{name:'goal-planning',description:'Plan goals',path:'goals'},{name:'html-document',description:'Create documents',path:'documents'}];
const goal='---\ngoal: Learn Spanish\nstatus: active\n---\nPractice daily.';
const config={...readConfig(),openrouterKey:'synthetic-test-key'};
const docker={list:async()=>[],ensure:async()=>({Image:'fixture',Config:{Image:'fixture'},State:{Running:true}}),stop:async()=>{}};
const make=async()=>{const path=await mkdtemp(join(tmpdir(),'ideas-loading-'));await atomicWorkspaceText(path,'goals/spanish.md',goal);return path;};

test('a cold visit gives usable goal suggestions without waiting for or invoking a model',async()=>{
  const path=await make();try{
    let calls=0;const ideas=new Ideas(path,skills,async()=>{calls++;throw Error('offline');});
    const first=await ideas.view(flags),second=await ideas.view(flags);
    assert.equal(calls,0);assert.equal(first.snapshot?.kind,'starter');assert.match(first.snapshot!.ideas[0].title,/Learn Spanish/);
    assert.equal(first.snapshot?.request,second.snapshot?.request);assert.equal(first.snapshot!.ideas.length,2);
    const restarted=new Ideas(path,skills,async()=>{throw Error('offline');});
    assert.equal((await restarted.view(flags)).starter?.request,first.snapshot?.request);
  }finally{await rm(path,{recursive:true,force:true});}
});

test('slow refinement leaves starters available, and completion preserves their selection ID',async()=>{
  const path=await make();try{
    let release!:(value:unknown)=>void;
    const ideas=new Ideas(path,skills,async()=>new Promise(resolve=>release=resolve));
    const starter=(await ideas.view(flags)).snapshot!;
    await ideas.poll('model-result',flags);while(!release)await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await ideas.view(flags)).snapshot!.request,starter.request);
    release({ideas:[{...starter.ideas[0],title:'Practice a short travel conversation'}]});await ideas.active!.done;
    const refined=await ideas.view(flags);
    assert.equal(refined.snapshot!.request,'model-result');assert.equal(refined.starter!.request,starter.request);
  }finally{await rm(path,{recursive:true,force:true});}
});

test('unavailable models and sparse context still show starters; removed goals cannot reappear',async()=>{
  const path=await make();try{
    const ideas=new Ideas(path,skills,async()=>{throw Error('offline');});
    const before=(await ideas.view(flags)).snapshot!;
    await ideas.poll('failed',flags);await ideas.active!.done;
    assert.equal((await ideas.view(flags)).snapshot!.request,before.request);
    await atomicWorkspaceText(path,'goals/spanish.md',goal.replace('active','paused'));
    await atomicWorkspaceText(path,'MEMORY.md','Old intention: learn Spanish.');
    const after=(await ideas.view(flags)).snapshot!;
    assert.notEqual(after.request,before.request);assert.ok(!JSON.stringify(after.ideas).includes('Spanish'));
    assert.equal(after.ideas[0].title,'Find one thing to work toward');
  }finally{await rm(path,{recursive:true,force:true});}
});

test('local starters honor available skills and redact a worker credential in goal text',async()=>{
  const path=await make();try{
    const noSkills=new Ideas(path,[],async()=>{throw Error('offline');});assert.equal((await noSkills.view(flags)).snapshot,null);
    await atomicWorkspaceText(path,'goals/spanish.md',goal.replace('Learn Spanish','Secret credential-123'));
    const privateIdeas=new Ideas(path,skills,async()=>{throw Error('offline');},'credential-123');
    assert.ok(!JSON.stringify((await privateIdeas.view(flags)).snapshot).includes('credential-123'));
  }finally{await rm(path,{recursive:true,force:true});}
});

test('reading Ideas schedules refinement immediately and a displayed starter still starts after refinement',async()=>{
  const path=await make(),store=new Store(':memory:');try{
    const s=store.createStudent('Fixture'),ideas=new Ideas(path,skills,async()=>{throw Error('offline');});
    let view=await ideas.view(flags);
    const app=publicApp(store,docker,config,async()=>Response.json(view));
    const cookie=`pv2_session=${store.redeemLogin(store.newLogin(s.id))}`;
    const first=await app.request('/me/api/ideas',{headers:{cookie}});assert.equal(first.status,200);
    const starter=(await first.json()).snapshot as IdeasSnapshot;
    assert.equal(store.current(s.id)!.kind,'ideas');assert.equal(store.ideasStatus(s.id).refreshing,true);
    view={...view,snapshot:{...starter,request:'model-finished',kind:undefined}};
    const start=()=>app.request('/me/api/ideas/start',{method:'POST',headers:{cookie,'x-protagonist':'1','content-type':'application/json'},body:JSON.stringify({request:starter.request,index:0})});
    assert.equal((await start()).status,200);assert.equal((await start()).status,200);
    assert.equal(store.jobCounts(s.id).pending,2,'one refresh and exactly one chosen action');
    assert.equal(store.hasForeground(s.id),true);
    view={...view,starter:{...starter,request:'different-context'}};
    assert.equal((await start()).status,409,'a changed goal is never silently acted on');
  }finally{store.close();await rm(path,{recursive:true,force:true});}
});

test('foreground chat cancels background refinement and becomes runnable on the next tick',async()=>{
  const store=new Store(':memory:');try{
    const s=store.createStudent('Fixture');store.enableIdeas(s.id);store.fireIdeas(s.id);
    const job=store.current(s.id)!;store.submitted(job.id);
    store.receiveMessage(s.id,'foreground-1','Help me now');let cancelled=false;
    await processJob(store,docker,config,store.current(s.id)!,async(url)=>{
      assert.ok(String(url).endsWith('/ideas/cancel'));cancelled=true;return Response.json({cancelled:true});
    });
    assert.equal(cancelled,true);assert.equal(store.current(s.id)!.text,'Help me now');
    assert.equal(store.ideasStatus(s.id).failed,false);assert.equal(store.pending()[0].kind,'message');
  }finally{store.close();}
});
