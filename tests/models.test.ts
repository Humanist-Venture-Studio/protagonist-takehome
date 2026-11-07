import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {CONTEXT_WINDOW,MAX_OUTPUT_TOKENS,readConfig} from '../src/config.ts';
import {ASSISTANT_MODELS,MODEL_SETTING,QWEN_MODEL,MERCURY_MODEL,allowedModel,modelMessages,modelProvider,selectedModel} from '../src/models.ts';

test('only the seven approved models are selectable and invalid defaults safely resolve to Spark',()=>{
  const store=new Store(':memory:'),config=readConfig();
  try {
    assert.deepEqual(ASSISTANT_MODELS,[
      {id:'meta/muse-spark-1.3',name:'Muse Spark'},{id:'meta/muse-wonder',name:'Muse Wonder'},
      {id:QWEN_MODEL,name:'Qwen3.8 27B (nitro) — Cerebras'},
      {id:MERCURY_MODEL,name:'Mercury 3 (text only)'},
  {id:'minimax/minimax-m3.1-flash',name:'MiniMax M3.1 Flash'},
  {id:'nvidia/nemotron-3.5-super-vl',name:'Nemotron 3.5 Super VL'},
  {id:'deepseek/deepseek-v4.1-flash-1017',name:'DeepSeek V4.1 Flash 1017 (max)'},
    ]);
    for(const model of ASSISTANT_MODELS){
      assert.equal(allowedModel(model.id),true);
      assert.equal(selectedModel(store,{...config,model:model.id}),model.id);
    }
    for(const value of [undefined,null,0,{},[],['meta/muse-wonder'],'','Muse Wonder','meta/muse-spark','meta/muse-wonder ','META/MUSE-WONDER','openai/other']){
      assert.equal(allowedModel(value),false,JSON.stringify(value));
    }
    assert.equal(selectedModel(store,{...config,model:'retired/model'}),'meta/muse-spark-1.3');
    store.set(MODEL_SETTING,'retired/model');
    assert.equal(selectedModel(store,{...config,model:'meta/muse-wonder'}),'meta/muse-wonder','an invalid saved value does not enable another model');
    assert.equal(selectedModel(store,{...config,model:'retired/model'}),'meta/muse-spark-1.3');
  } finally {store.close();}
});

test('the global saved selection overrides the runtime default immediately and survives restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'pv2-model-setting-')),file=join(dir,'app.sqlite');
  let store=new Store(file);const config={...readConfig(),model:'meta/muse-spark-1.3'};
  try {
    assert.equal(selectedModel(store,config),'meta/muse-spark-1.3');
    store.set(MODEL_SETTING,'meta/muse-wonder');
    assert.equal(selectedModel(store,config),'meta/muse-wonder');
    store.close();store=new Store(file);
    assert.equal(selectedModel(store,config),'meta/muse-wonder');
    store.set(MODEL_SETTING,QWEN_MODEL);
    assert.equal(selectedModel(store,config),QWEN_MODEL);
    store.close();store=new Store(file);
    assert.equal(selectedModel(store,config),QWEN_MODEL);
    store.set(MODEL_SETTING,MERCURY_MODEL);
    assert.equal(selectedModel(store,config),MERCURY_MODEL);
    store.close();store=new Store(file);
    assert.equal(selectedModel(store,config),MERCURY_MODEL);
    store.set(MODEL_SETTING,'meta/muse-spark-1.3');
    assert.equal(selectedModel(store,{...config,model:'meta/muse-wonder'}),'meta/muse-spark-1.3');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('Cerebras routing fails closed and image limits keep the newest two without mutating history',()=>{
  assert.equal(CONTEXT_WINDOW,65_536,'shared worker context fits the Cerebras OpenRouter endpoint');
  assert.ok(MAX_OUTPUT_TOKENS<=32_768);
  assert.deepEqual(modelProvider(QWEN_MODEL),{data_collection:'deny',only:['cerebras/fp16'],allow_fallbacks:false});
  assert.deepEqual(modelProvider('meta/muse-wonder'),{data_collection:'deny'});
  const image=(id:string)=>({type:'image_url',image_url:{url:`data:image/jpeg;base64,${id}`}});
  const messages=[{role:'user',content:[image('old')]},{role:'assistant',content:'What else?'},
    {role:'user',content:[{type:'text',text:'Compare these'},image('new'),image('newest')]}];
  const original=structuredClone(messages);
  assert.equal(modelMessages('meta/muse-wonder',messages),messages);
  const limited=modelMessages(QWEN_MODEL,messages) as typeof messages;
  assert.match((limited[0].content as {text:string}[])[0].text,/Ask the student.*do not guess/);
  assert.deepEqual(limited.slice(1),messages.slice(1));
  assert.deepEqual(messages,original);
});

test('Mercury omits all images with an honest notice while retaining text, tool results and vision history',()=>{
  assert.deepEqual(modelProvider(MERCURY_MODEL),{data_collection:'deny'});
  const image={type:'image_url',image_url:{url:'data:image/jpeg;base64,fixture'}};
  const messages=[{role:'system',content:'Help the student.'},
    {role:'user',content:[image,{type:'text',text:'What does this letter say?'}]},
    {role:'assistant',content:null,tool_calls:[{id:'read-photo',type:'function',function:{name:'read',arguments:'{}'}}]},
    {role:'tool',tool_call_id:'read-photo',content:[{type:'text',text:'Saved photo'},image]},
    {role:'user',content:'Please help.'}];
  const original=structuredClone(messages),limited=modelMessages(MERCURY_MODEL,messages) as typeof messages;
  assert.deepEqual(limited.map(message=>message.role),messages.map(message=>message.role));
  for(const index of [0,2,4])assert.deepEqual(limited[index],messages[index]);
  for(const index of [1,3]){
    const content=limited[index].content as {type:string;text:string}[];
    assert.equal(content.filter(part=>part.type==='image_url').length,0);
    assert.ok(content.some(part=>/cannot see photos.*Ask the student.*do not guess/.test(part.text)));
    assert.ok(content.some(part=>part.text===(index===1?'What does this letter say?':'Saved photo')));
  }
  assert.equal(limited[3].tool_call_id,'read-photo');
  assert.deepEqual(messages,original);
  assert.deepEqual(modelMessages('meta/muse-wonder',messages),original,'switching back retains the original images');
});
