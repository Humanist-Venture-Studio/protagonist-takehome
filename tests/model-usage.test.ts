import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchModel, type ModelCallKind } from '../src/model-usage.ts';
import { Store } from '../src/store.ts';
import { brokerApp } from '../src/broker.ts';
import { replyRewriter } from '../src/reply-provider.ts';
import { readConfig } from '../src/config.ts';
import { MODEL_SETTING } from '../src/models.ts';

const model='meta/muse-spark-1.3',url='https://openrouter.ai/api/v1/chat/completions';
type Usage={cost?:number|null;promptTokens?:number|null;completionTokens?:number|null;cachedTokens?:number|null;responseModel?:string;providerId?:string};
function ledger() {
  const calls:{id:string;student:string;model:string;kind:ModelCallKind;usage:Usage}[]=[],updates:Usage[]=[];
  return {calls,updates,
    startModelCall(student:string,model:string,kind:ModelCallKind) {
      const id=String(calls.length+1);calls.push({id,student,model,kind,usage:{}});return id;
    },
    recordModelUsage(id:string,usage:Usage) {
      updates.push(usage);Object.assign(calls.find(c=>c.id===id)!.usage,usage);
    },
  };
}
function chunks(bytes:Uint8Array,size=7,type='text/event-stream') {
  let offset=0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.subarray(offset,offset+size));offset+=size;},
  },{highWaterMark:0}),{headers:{'Content-Type':type}});
}
const bytes=(text:string)=>new TextEncoder().encode(text);

test('JSON accounting records provider charge and validated metadata, never response content',async()=>{
  const store=ledger(),payload={id:'gen-example',model:'meta/muse-wonder',choices:[{message:{content:'Private fixture content'}}],
    usage:{cost:0.0031,prompt_tokens:120,completion_tokens:30,prompt_tokens_details:{cached_tokens:90},cost_details:{upstream_inference_cost:999}}};
  const wire=JSON.stringify(payload);
  const response=await fetchModel(store,'student-a',model,'assistant',url,{method:'POST'},async()=>{
    assert.equal(store.calls.length,1,'attempt exists before provider request');
    return chunks(bytes(wire),5,'application/json');
  });
  assert.equal(await response.text(),wire);
  assert.deepEqual(store.calls[0],{id:'1',student:'student-a',model,kind:'assistant',
    usage:{cost:0.0031,promptTokens:120,completionTokens:30,cachedTokens:90,responseModel:'meta/muse-wonder',providerId:'gen-example'}});
  assert.ok(!JSON.stringify(store).includes('Private fixture content'));
});

test('SSE accounting survives byte-sized fragments, CRLF, comments, multiline data and repeated usage',async()=>{
  const store=ledger(),wire=': OPENROUTER PROCESSING\r\n\r\n'+
    'data: {"id":"gen-stream","choices":[{"delta":{"content":"Café 🙂"}}]}\r\n\r\n'+
    'event: message\r\ndata: {"id":"gen-stream","model":"meta/muse-wonder",\r\ndata: "usage":{"cost":0.012,"prompt_tokens":40,"completion_tokens":10}}\r\n\r\n'+
    'data: {"id":"gen-stream","usage":{"cost":0.012}}\r\n\r\n'+
    'data: {"id":"gen-stream","usage":{"prompt_tokens":40}}\r\n\r\ndata: [DONE]\r\n\r\n';
  const response=await fetchModel(store,'student-a',model,'assistant',url,{},async()=>chunks(bytes(wire),1));
  assert.equal(await response.text(),wire,'stream bytes are unchanged');
  assert.equal(store.calls.length,1);assert.equal(store.calls[0].usage.cost,0.012);
  assert.equal(store.calls[0].usage.responseModel,'meta/muse-wonder');
  assert.equal(store.calls[0].usage.promptTokens,40);assert.equal(store.calls[0].usage.completionTokens,10);
  assert.equal(store.updates.length,2,'duplicate and missing usage cause no redundant database writes');
});

test('accounting preserves HTTP errors and records billing when the error body supplies it',async()=>{
  const store=ledger(),response=await fetchModel(store,'student-a',model,'assistant',url,{},async()=>Response.json(
    {error:{message:'Fixture refusal'},usage:{cost:0}},{status:400,headers:{'X-Fixture':'kept'}}));
  assert.equal(response.status,400);assert.equal(response.headers.get('X-Fixture'),'kept');
  assert.equal((await response.json()).error.message,'Fixture refusal');assert.equal(store.calls[0].usage.cost,0);
});

test('stream failure preserves an observed cost and propagates the read error',async()=>{
  const store=ledger(),failure=new Error('Fixture stream interruption');let reads=0;
  const response=await fetchModel(store,'student-a',model,'assistant',url,{},async()=>new Response(new ReadableStream<Uint8Array>({
    pull(controller){if(reads++)throw failure;controller.enqueue(bytes('data: {"usage":{"cost":0.01}}\n\n'));},
  },{highWaterMark:0}),{headers:{'Content-Type':'text/event-stream'}}));
  await assert.rejects(response.text(),failure);assert.equal(store.calls[0].usage.cost,0.01);
});

for(const nextModel of ['meta/muse-wonder','qwen/qwen3.8-27b:nitro','inception/mercury-3','minimax/minimax-m3.1-flash','nvidia/nemotron-3.5-super-vl','deepseek/deepseek-v4.1-flash-1017'])test(`global switching to ${nextModel} routes both students and all assistant operations, while active calls keep their snapshot`,async()=>{
  const store=new Store(':memory:'),config={...readConfig(),openrouterKey:'synthetic-provider-key'};
  const admit=(_chat:number,_id:number)=>store.createStudent('Fixture');
  admit(101,1);admit(202,2);store.db.exec('DELETE FROM onboarding'); // Established accounts for these regression checks.

  const [a,b]=store.students();
  let started!:()=>void,release!:()=>void;
  const firstStarted=new Promise<void>(resolve=>{started=resolve;}),firstReleased=new Promise<void>(resolve=>{release=resolve;});
  const forwarded:{model:string;kind:string}[]=[];
  const send:typeof fetch=async(input,init)=>{
    const target=String(input);
    const body=JSON.parse(String(init?.body));
    const kind=body.tools?.some((t:any)=>t.function?.name==='record_student_context')?'capture':
      String(body.messages?.[0]?.content).startsWith('Rewrite the supplied')?'rewrite':'assistant';
    forwarded.push({model:body.model,kind});
    assert.deepEqual(body.reasoning,body.model==='deepseek/deepseek-v4.1-flash-1017'?{effort:'max'}:undefined);
    assert.deepEqual(body.provider,body.model==='qwen/qwen3.8-27b:nitro'
      ?{data_collection:'deny',only:['cerebras/fp16'],allow_fallbacks:false}:{data_collection:'deny'});
    if(body.messages?.[0]?.content?.[0]?.text==='Image limit fixture'){
      const parts=body.messages[0].content;
      assert.equal(parts.filter((part:any)=>part.type==='image_url').length,body.model==='inception/mercury-3'?0:body.model==='qwen/qwen3.8-27b:nitro'?2:3);
      if(body.model==='inception/mercury-3')assert.equal(parts.filter((part:any)=>/cannot see photos/.test(part.text)).length,3);
      assert.equal(body.max_tokens,8192);
    }
    if(forwarded.length===1){started();await firstReleased;}
    const cost=kind==='capture'?0.02:kind==='rewrite'?0.003:0.01;
    const result={id:`gen-fixture-${forwarded.length}`,model:body.model,usage:{cost,prompt_tokens:20,completion_tokens:5},
      choices:[{finish_reason:'stop',message:{content:'A short response.'}}]};
    return body.stream?chunks(bytes(`data: ${JSON.stringify(result)}\n\ndata: [DONE]\n\n`),3):Response.json(result);
  };
  const app=brokerApp(store,config,send);
  const call=(token:string,body:unknown)=>app.request('/model/v1/chat/completions',{method:'POST',
    headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const first=call(a.token,{model:'unapproved/model',messages:[],stream:true});
    await firstStarted;store.set(MODEL_SETTING,nextModel);
    const capture=await call(b.token,{messages:[],tools:[{type:'function',function:{name:'record_student_context'}}]});
    assert.equal(capture.status,200);await capture.json();
    const later=await call(a.token,{model:model,messages:[{role:'user',content:[{type:'text',text:'Image limit fixture'},
      ...['a','b','c'].map(id=>({type:'image_url',image_url:{url:`data:image/jpeg;base64,${id}`}}))]}],
      max_tokens:100_000,stream:true,provider:{only:['other-provider'],allow_fallbacks:true}});await later.text();
    const ideas=await call(b.token,{messages:[],tools:[{type:'function',function:{name:'propose_ideas'}}]});await ideas.json();
    release();const original=await first;assert.equal(original.status,200);await original.text();
    assert.equal(await replyRewriter(store,config,b,send)('A draft needing rewrite.','final'),'A short response.');

    assert.deepEqual(forwarded,[
      {model,kind:'assistant'},{model:nextModel,kind:'capture'},{model:nextModel,kind:'assistant'},
      {model:nextModel,kind:'assistant'},{model:nextModel,kind:'rewrite'},
    ]);
    const rows=store.db.prepare('SELECT student,model,kind,cost FROM model_calls').all();
    assert.equal(rows.length,5);assert.equal(new Set(rows.map(r=>r.student)).size,2);
    assert.equal(rows.find(r=>r.model===model)!.cost,0.01);
    assert.equal(store.costSummary().total.unpriced,0);
    assert.ok(Math.abs(store.costSummary().total.cost-0.053)<1e-12);
    assert.equal(config.model,model,'runtime configuration was not mutated');
  } finally {release();store.close();}
});
