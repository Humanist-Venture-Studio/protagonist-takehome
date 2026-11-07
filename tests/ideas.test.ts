import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Ideas,ideaContext,ideaCapabilities,ideasGenerator,validateIdeas,IDEAS_PROMPT} from '../src/ideas.ts';
import {atomicWorkspaceText} from '../src/workspace.ts';
import {Store} from '../src/store.ts';
import {readConfig} from '../src/config.ts';
import {publicApp} from '../src/web.ts';
import {brokerApp} from '../src/broker.ts';
import {DEFAULT_MEMORY,ensureNotes,writeNote} from '../src/dashboard.ts';
import {prepareIdeasProfile} from '../src/onboarding-workspace.ts';

const flags={research:true,reminders:true},skills=[{name:'research',description:'Research current official sources',path:'research'},{name:'goal-planning',description:'Plan a goal',path:'planning'}];
const idea={skill:'research',title:'Find evening nursing options',why:'You work afternoons and want to study nursing.',prompt:'Help me compare nursing programs with evening classes.',source:'memory',evidence:'I want to study nursing in the evenings.'};
const message=(id:number,text:string,chat=1)=>({update_id:id,message:{text,chat:{id:chat,type:'private'},from:{id:chat,first_name:'Ana'}}});
const profile={name:'Ana',location:'Newark, NJ',zone:'America/New_York',goal:'school' as const,outcome:'Study nursing',startingPoint:'High school diploma',target:'Next year',hours:'3–5 hours',constraints:'Evenings'};
async function workspace(){const dir=await mkdtemp(join(tmpdir(),'pv2-ideas-'));await atomicWorkspaceText(dir,'MEMORY.md',idea.evidence);return dir;}

test('ideas use current context, grounded evidence and installed enabled capabilities, preserving ranking',async()=>{
  const dir=await workspace();try{
    await atomicWorkspaceText(dir,'goals/old.md','---\ngoal: Apply to nursing\nstatus: completed\n---\nDone.');
    await atomicWorkspaceText(dir,'goals/current.md','---\ngoal: Choose a program\nstatus: active\n---\nCompare schedules.');
    let seen:any,calls=0;
    const ideas=new Ideas(dir,skills,async input=>{seen=input;calls++;return {ideas:[idea,{...idea,skill:'goal-planning',title:'Plan a manageable first week'}]};});
    assert.deepEqual(await ideas.poll('request-1',flags),{status:'pending'});await ideas.active!.done;
    assert.equal((await ideas.poll('request-1',flags)).outcome,'success');assert.equal(calls,1);
    assert.equal(seen.context.memory,idea.evidence);assert.equal(seen.context.goals['goals/old.md'],undefined);
    assert.match(seen.context.inactiveGoals['goals/old.md'],/completed/);
    assert.deepEqual((await ideas.view(flags)).snapshot?.ideas.map(i=>i.title),[idea.title,'Plan a manageable first week']);
    assert.throws(()=>validateIdeas({ideas:[{...idea,skill:'send-email'}]},seen));
    assert.throws(()=>validateIdeas({ideas:[{...idea,evidence:'Invented preference'}]},seen));
    assert.deepEqual(validateIdeas({ideas:[idea,idea]},seen),[idea],'a duplicate is dropped, not the list');
    assert.throws(()=>validateIdeas({ideas:[]},seen));
    assert.deepEqual(ideaCapabilities(skills,{research:false,reminders:false}).map(s=>s.name),['goal-planning']);
    assert.match(IDEAS_PROMPT,/no goals, reminders, documents or actions/);
    await atomicWorkspaceText(dir,'MEMORY.md','I want to study accounting.');
    assert.equal((await ideas.view(flags)).snapshot?.kind,'starter','old model facts disappear when memory is corrected');
    assert.ok(!(await ideas.view(flags)).snapshot?.ideas.some(i=>i.title===idea.title));
    assert.equal((await ideas.view(flags)).contextChanged,true);
    const next=new Ideas(dir,skills,async input=>{assert.equal(input.context.memory,'I want to study accounting.');throw Error('offline');});
    await next.poll('request-2',flags);await next.active!.done;assert.equal((await next.poll('request-2',flags)).outcome,'failed');
    assert.equal(JSON.parse(await readFile(join(dir,'.protagonist/ideas.json'),'utf8')).request,'request-1','failure retains last successful file');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('refresh failure retains a readable snapshot; replay after restart is free; invalid cache can recover',async()=>{
  const dir=await workspace();try{
    const first=new Ideas(dir,skills,async()=>({ideas:[idea]}));await first.poll('first',flags);await first.active!.done;
    let calls=0;const restarted=new Ideas(dir,skills,async()=>{calls++;throw Error('offline');});
    assert.equal((await restarted.poll('first',flags)).outcome,'success');assert.equal(calls,0);
    await restarted.poll('second',flags);await restarted.active!.done;
    assert.equal((await restarted.view(flags)).snapshot?.request,'first');assert.equal((await restarted.poll('second',flags)).outcome,'failed');assert.equal(calls,2,'one retry, then failure');
    await atomicWorkspaceText(dir,'.protagonist/ideas.json','{broken');
    const recovered=new Ideas(dir,skills,async()=>({ideas:[idea]}));await recovered.poll('third',flags);await recovered.active!.done;
    assert.equal((await recovered.view(flags)).snapshot?.request,'third');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('changed context and cancellation cannot publish an in-flight result',async()=>{
  const dir=await workspace();try{
    let release!:(v:unknown)=>void;
    const ideas=new Ideas(dir,skills,async()=>new Promise(resolve=>release=resolve));
    await ideas.poll('changing',flags);while(!release)await new Promise(resolve=>setImmediate(resolve));
    await atomicWorkspaceText(dir,'MEMORY.md','I changed my mind.');release({ideas:[idea]});await ideas.active!.done;
    assert.equal((await ideas.poll('changing',flags)).outcome,'failed');assert.equal((await ideas.view(flags)).snapshot?.kind,'starter');
    const cancelled=new Ideas(dir,skills,async(_input,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
    await cancelled.poll('cancelled',flags);await new Promise(resolve=>setTimeout(resolve,20));await cancelled.cancel('cancelled');
    const restarted=new Ideas(dir,skills,async()=>{throw Error('must not call');});assert.equal((await restarted.poll('cancelled',flags)).outcome,'cancelled');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('full multilingual idea lists survive persistence and polling',async()=>{
  const dir=await workspace();try{
    const evidence='学'.repeat(300);await atomicWorkspaceText(dir,'MEMORY.md',evidence);
    const list=Array.from({length:5},(_,i)=>({...idea,title:String(i)+'学'.repeat(99),why:'学'.repeat(300),prompt:'学'.repeat(600),evidence}));
    const ideas=new Ideas(dir,skills,async()=>({ideas:list}));await ideas.poll('large',flags);await ideas.active!.done;
    assert.equal((await ideas.poll('large',flags)).outcome,'success');assert.equal((await ideas.view(flags)).snapshot?.ideas.length,5);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('real model quoting and partial lists still produce grounded ideas',()=>{
  const input={context:{memory:'# MEMORY.md\n\n## Your starting point\n- Goal: Become a **registered nurse**\n- Constraints: I can’t study before 6 pm — evenings only',
    goals:{'goals/first-goal.md':'---\ngoal: Become a registered nurse\nstatus: draft\n---\n| 1 | Compare three realistic programs | Student + Protagonist |'},inactiveGoals:{}},capabilities:ideaCapabilities(skills,flags),today:'2026-10-21'};
  const base={...idea,source:'MEMORY.md',evidence:'"Constraints: I can\'t study before 6 pm - evenings only."'};
  const result=validateIdeas({ideas:[
    {...base,why:'x'.repeat(301)},
    {...base,evidence:'I love chemistry'},
    {...base,skill:'Research'},
    {...base,title:'Plan it',skill:'goal-planning',source:'first-goal.md',evidence:'Compare   three realistic programs | Student'},
    {...base,title:'Both facts',evidence:'Goal: Become a registered nurse … evenings only'},
    {...base,title:'Not grounded',evidence:'Goal: Become a registered nurse … weekends only'},
    {...base,title:'Empty quote',evidence:'"…"'},
    {...base,title:'Extra 1'},{...base,title:'Extra 2'},{...base,title:'Extra 3'},
  ]},input);
  assert.deepEqual(result.map(i=>[i.title,i.skill,i.source]),[[idea.title,'research','memory'],['Plan it','goal-planning','goals/first-goal.md'],['Both facts','research','memory'],['Extra 1','research','memory'],['Extra 2','research','memory']]);
  assert.throws(()=>validateIdeas({ideas:[{...base,evidence:'I love chemistry'}]},input),/No valid ideas/);
});

test('an unusable first answer is retried once inside the time budget; a quota refusal is not',async()=>{
  const dir=await workspace();try{
    let calls=0;const ideas=new Ideas(dir,skills,async()=>++calls===1?{ideas:[{...idea,evidence:'Invented'}]}:{ideas:[idea]});
    await ideas.poll('retry',flags);await ideas.active!.done;
    assert.equal((await ideas.poll('retry',flags)).outcome,'success');assert.equal(calls,2);
    let limited=0;const quota=new Ideas(dir,skills,async()=>{limited++;throw Error('Ideas unavailable (HTTP 429)');});
    await quota.poll('quota',flags);await quota.active!.done;assert.equal((await quota.poll('quota',flags)).outcome,'failed');assert.equal(limited,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('the generator accepts split tool calls and JSON text, and rejects truncated output',async()=>{
  const input={context:{memory:idea.evidence,goals:{},inactiveGoals:{}},capabilities:ideaCapabilities(skills,flags),today:'2026-10-21'};
  const reply=(message:object,finish_reason='stop')=>ideasGenerator('http://broker','synthetic-token',async()=>Response.json({choices:[{finish_reason,message}]}))(input,new AbortController().signal);
  const call=(ideas:unknown)=>({function:{name:'propose_ideas',arguments:JSON.stringify({ideas})}});
  assert.deepEqual(await reply({tool_calls:[call([idea]),call([{...idea,title:'Second'}])]},'tool_calls'),{ideas:[idea,{...idea,title:'Second'}]});
  assert.deepEqual(await reply({content:'Here you go:\n```json\n'+JSON.stringify({ideas:[idea]})+'\n```'}),{ideas:[idea]});
  await assert.rejects(reply({content:'I can suggest a few things.'}),/Ideas missing/);
  await assert.rejects(reply({tool_calls:[call([idea])]},'length'),/Ideas incomplete/);
  await assert.rejects(ideasGenerator('http://broker','t',async()=>new Response('{}',{status:502}))(input,new AbortController().signal),/HTTP 502/);
});

test('the bounded generator returns a proposal without invoking agent tools',async()=>{
  let payload:any;
  const generate=ideasGenerator('http://broker','synthetic-token',async(_url,init)=>{payload=JSON.parse(String(init?.body));return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'propose_ideas',arguments:JSON.stringify({ideas:[idea]})}}]}}]});});
  const result=await generate({context:{memory:idea.evidence,goals:{},inactiveGoals:{}},capabilities:ideaCapabilities(skills,flags),today:'2026-10-20'},new AbortController().signal);
  assert.deepEqual(result,{ideas:[idea]});assert.deepEqual(payload.tools.map((t:any)=>t.function.name),['propose_ideas']);assert.equal(payload.stream,false);
  assert.equal(payload.max_tokens,8192,'reasoning models need room before the tool call');assert.doesNotMatch(JSON.stringify(payload.tools),/minItems|maxItems/);
});

test('initial Ideas profile sync preserves corrections, deletions and completed onboarding',async()=>{
  for(const condition of ['corrected','deleted','onboarded']){
    const dir=await mkdtemp(join(tmpdir(),'pv2-ideas-profile-'));try{
      await ensureNotes(dir);
      if(condition==='corrected')await atomicWorkspaceText(dir,'MEMORY.md','I now want to study accounting.');
      if(condition==='deleted')await writeNote(dir,'memory',DEFAULT_MEMORY,'synthetic-token');
      if(condition==='onboarded')await atomicWorkspaceText(dir,'.protagonist/onboarded','done');
      const before=await readFile(join(dir,'MEMORY.md'),'utf8');await prepareIdeasProfile(dir,profile);
      assert.equal(await readFile(join(dir,'MEMORY.md'),'utf8'),before);
      await atomicWorkspaceText(dir,'MEMORY.md',DEFAULT_MEMORY);await prepareIdeasProfile(dir,profile);
      assert.equal(await readFile(join(dir,'MEMORY.md'),'utf8'),DEFAULT_MEMORY);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
});
