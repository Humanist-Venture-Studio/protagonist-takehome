import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { readConfig, MAX_OUTPUT_TOKENS } from '../src/config.ts';
import { brokerApp } from '../src/broker.ts';
import { listSkills } from '../src/skills.ts';
import { brokerError } from '../src/files.ts';
import { isContextOverflow } from '@earendil-works/pi-ai/utils/overflow';
import { isRetryableAssistantError } from '@earendil-works/pi-ai/utils/retry';

const admit=(store:Store,_id:number)=>store.createStudent('Fixture');

test('maintenance removes abandoned progress text after one day while keeping fresh drafts',()=>{
  let now=1_000_000;const store=new Store(':memory:',()=>now);
  try {
    admit(store,123);const student=store.students()[0];
    store.saveNotificationDraft(student.id,'old-update','old-hash','Private text from an abandoned update.');
    now+=24*60*60_000+1;
    store.saveNotificationDraft(student.id,'fresh-update','fresh-hash','A fresh update. Send /stop to cancel.');
    store.set('unrelated-setting','keep');
    store.expireNotificationDrafts();
    const rows=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'notify-draft:%'").all();
    assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('abandoned'));
    assert.equal(store.notificationDraft(student.id,'old-update'),undefined);
    assert.equal(store.notificationDraft(student.id,'fresh-update')?.digest,'fresh-hash');
    assert.equal(store.get('unrelated-setting'),'keep');
  } finally {store.close();}
});

test('model requests allow a larger conversation, cap output, and pass a bad request’s reason through',async()=>{
  const store=new Store(':memory:');admit(store,123);const token=store.students()[0].token;let forwarded:any,status=200;
  const app=brokerApp(store,{...readConfig(),openrouterKey:'synthetic-model-key'},async(_url,init)=>{
    forwarded=JSON.parse(String(init!.body));
    return status===400?Response.json({error:{message:'This endpoint’s maximum context length is 1000 tokens. synthetic-model-key'}},{status:400}):Response.json({choices:[]});
  });
  const call=(body:unknown)=>app.request('/model/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const big=[{role:'user',content:'x'.repeat(2*1024*1024)}];
  assert.equal((await call({messages:big,max_completion_tokens:100000})).status,200);assert.equal(forwarded.max_tokens,MAX_OUTPUT_TOKENS);
  assert.equal((await call({messages:[{role:'user',content:'x'.repeat(5*1024*1024)}]})).status,413);
  status=400;const rejected=await call({messages:[]});assert.equal(rejected.status,400);
  const reason=(await rejected.json()).error.message;assert.match(reason,/maximum context length/);assert.ok(!reason.includes('synthetic-model-key'));
  store.close();
});

test('provider refusals keep their reason and a status the runtime compacts, backs off or retries on',async()=>{
  const store=new Store(':memory:');admit(store,123);const token=store.students()[0].token;let upstream=new Response();
  const app=brokerApp(store,{...readConfig(),openrouterKey:'synthetic-model-key'},async()=>upstream);
  const wrapped=(status:number,raw:string,headers?:HeadersInit)=>Response.json({error:{message:'Provider returned error',code:status,metadata:{raw,provider_name:'Cerebras'}}},{status,headers});
  // Pi formats a failed call as "<status>: <error JSON>" and decides from that text alone.
  const outcome=async(response:Response)=>{
    upstream=response;
    const res=await app.request('/model/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[]})});
    const body=await res.json(),message={stopReason:'error',errorMessage:`${res.status}: ${JSON.stringify(body.error)}`} as any;
    return {status:res.status,reason:body.error.message as string,retryAfter:res.headers.get('retry-after'),overflow:isContextOverflow(message),retry:isRetryableAssistantError(message)};
  };
  const warn=console.warn;const logged:string[]=[];console.warn=(line:string)=>logged.push(line);
  try {
    const overflow=await outcome(wrapped(400,JSON.stringify({message:'Please reduce the length of the messages or completion. Current length is 141335 while limit is 131072',code:'context_length_exceeded'})));
    assert.deepEqual([overflow.status,overflow.overflow,overflow.retry],[400,true,false]);assert.match(overflow.reason,/Current length is 141335/);
    const refused=await outcome(wrapped(400,JSON.stringify({message:"Tool call arguments must be a valid JSON object: 'private-args'",code:'wrong_api_format'})));
    assert.deepEqual([refused.status,refused.overflow,refused.retry],[400,false,false],'a permanent refusal is not retried');
    const images=await outcome(wrapped(413,'"Number of image inputs exceeds maximum of 2"'));
    assert.deepEqual([images.status,images.overflow,images.retry],[413,true,false]);assert.match(images.reason,/Number of image inputs exceeds maximum of 2/);
    const limited=await outcome(wrapped(429,JSON.stringify({message:'Requests per minute limit exceeded'}),{'retry-after':'7'}));
    assert.deepEqual([limited.status,limited.retryAfter,limited.overflow,limited.retry],[429,'7',false,true]);
    const down=await outcome(Response.json({error:{message:'No endpoints available synthetic-model-key'}},{status:503}));
    assert.deepEqual([down.status,down.overflow,down.retry],[502,false,true]);assert.match(down.reason,/HTTP 503.*No endpoints available/);
    const bodyless=await outcome(new Response('oops',{status:500}));
    assert.deepEqual([bodyless.status,bodyless.retry],[502,true]);
    assert.ok(![overflow,refused,images,limited,down,bodyless].some(r=>r.reason.includes('synthetic-model-key')));
    assert.equal(logged.length,6);assert.match(logged[2],/413 for .* via Cerebras: Number of image inputs/);
    assert.ok(!logged.join('\n').includes('private-args')&&!logged.join('\n').includes('synthetic-model-key'),'logs omit quoted values and credentials');
  } finally {console.warn=warn;store.close();}
});

test('skills are listed from front matter; folders without a description are ignored',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pv2-skills-'));
  try {
    await mkdir(join(dir,'research'));await writeFile(join(dir,'research','SKILL.md'),'---\nname: research\ndescription: Research schools and programs with cited sources.\n---\n# Research\n');
    await mkdir(join(dir,'draft'));await writeFile(join(dir,'draft','SKILL.md'),'# no front matter\n');
    await writeFile(join(dir,'README.md'),'not a skill');
    assert.deepEqual(listSkills(dir),[{name:'research',description:'Research schools and programs with cited sources.',path:`${dir}/research/SKILL.md`}]);
    assert.deepEqual(listSkills(join(dir,'missing')),[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('broker refusals reach the agent with their reason',async()=>{
  assert.equal(await brokerError(Response.json({error:'HTML may not contain scripts'},{status:400})),'HTML may not contain scripts (400)');
  assert.equal(await brokerError(new Response('oops',{status:502})),'HTTP 502');
});
