import type { Config } from './config.ts';
import type { Store } from './store.ts';

export const ASSISTANT_MODELS=[
  {id:'meta/muse-spark-1.3',name:'Muse Spark'},
  {id:'meta/muse-wonder',name:'Muse Wonder'},
  {id:'qwen/qwen3.8-27b:nitro',name:'Qwen3.8 27B (nitro) — Cerebras'},
  {id:'inception/mercury-3',name:'Mercury 3 (text only)'},
  {id:'minimax/minimax-m3.1-flash',name:'MiniMax M3.1 Flash'},
  {id:'nvidia/nemotron-3.5-super-vl',name:'Nemotron 3.5 Super VL'},
  {id:'deepseek/deepseek-v4.1-flash-1017',name:'DeepSeek V4.1 Flash 1017 (max)'},
] as const;
export const MODEL_SETTING='assistant-model';
export const QWEN_MODEL='qwen/qwen3.8-27b:nitro';
export const MERCURY_MODEL='inception/mercury-3';
export function modelProvider(model:string) {
  return model===QWEN_MODEL
    ?{data_collection:'deny',only:['cerebras/fp16'],allow_fallbacks:false}
    :{data_collection:'deny'};
}
// Apply the selected model's image support on every call, including history after
// a switch. Preserve stored images so switching back to a vision model still works.
export function modelMessages(model:string,messages:unknown):unknown {
  if((model!==QWEN_MODEL&&model!==MERCURY_MODEL)||!Array.isArray(messages))return messages;
  let remaining=model===MERCURY_MODEL?0:2;
  const notice=model===MERCURY_MODEL
    ?'[This model cannot see photos. Ask the student to describe the image or paste its text; do not guess.]'
    :'[A photo was omitted for this model’s image limit. Ask the student what it shows; do not guess.]';
  return messages.toReversed().map(message=>{
    if(!message||!Array.isArray(message.content))return message;
    const content=message.content.toReversed().map((part:any)=>{
      if(part?.type!=='image_url')return part;
      if(remaining-->0)return part;
      return {type:'text',text:notice};
    }).reverse();
    return {...message,content};
  }).reverse();
}
export function allowedModel(value:unknown):value is typeof ASSISTANT_MODELS[number]['id'] {
  return ASSISTANT_MODELS.some(model=>model.id===value);
}
// A database setting takes effect on the next provider call, across all students.
export function selectedModel(store:Store,config:Config):string {
  const saved=store.get(MODEL_SETTING);
  return allowedModel(saved)?saved:allowedModel(config.model)?config.model:ASSISTANT_MODELS[0].id;
}

export function modelReasoning(model:string) {
  return model==='deepseek/deepseek-v4.1-flash-1017'?{reasoning:{effort:'max'}}:{};
}
