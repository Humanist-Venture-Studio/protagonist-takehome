import type { Store } from './store.ts';

export type ModelCallKind='assistant'|'capture'|'rewrite';
type Accounting=Pick<Store,'startModelCall'|'recordModelUsage'>;
const MAX_EVENT=256*1024, MAX_JSON=2*1024*1024;
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
const identifier=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,199}$/.test(value)?value:undefined;

// Read only billing metadata. Response text, tool arguments and credentials are
// never retained; absent costs remain unknown rather than being treated as free.
function record(store:Accounting,id:string,value:unknown,seen:Record<string,unknown>) {
  const body=object(value);if(!body)return;
  const usage=object(body.usage),details=object(usage?.prompt_tokens_details);
  const cost=usage?.cost;
  const fields={
    cost:typeof cost==='number'&&Number.isFinite(cost)&&cost>=0?cost:undefined,
    promptTokens:count(usage?.prompt_tokens),completionTokens:count(usage?.completion_tokens),
    cachedTokens:count(details?.cached_tokens),responseModel:identifier(body.model),providerId:identifier(body.id),
  };
  const changed=Object.fromEntries(Object.entries(fields).filter(([key,value])=>value!==undefined&&value!==seen[key]));
  if(Object.keys(changed).length){store.recordModelUsage(id,changed);Object.assign(seen,changed);}
}

// Observe SSE without changing its bytes or waiting for the whole response.
// Limits apply to individual accounting frames; an oversized content frame is
// skipped, so a later ordinary usage frame can still be recorded.
function observer(store:Accounting,id:string,stream:boolean) {
  const decoder=new TextDecoder();
  const seen:Record<string,unknown>={};
  let pending='',event='',discard=false,json='',bytes=0,tooLarge=false;
  const parse=(text:string)=>{try{record(store,id,JSON.parse(text),seen);}catch{/* Invalid provider metadata leaves the attempt unpriced. */}};
  const line=(text:string)=>{
    if(!text){if(!discard&&event)parse(event);event='';discard=false;return;}
    if(discard||text.startsWith(':'))return;
    const colon=text.indexOf(':'),field=colon<0?text:text.slice(0,colon);
    if(field!=='data')return;
    let data=colon<0?'':text.slice(colon+1);if(data.startsWith(' '))data=data.slice(1);
    if(event.length+data.length+1>MAX_EVENT){event='';discard=true;return;}
    event+=(event?'\n':'')+data;
  };
  const feed=(text:string,finish=false)=>{
    pending+=text;
    let index:number;
    while((index=pending.search(/[\r\n]/))>=0) {
      if(!finish&&pending[index]==='\r'&&index===pending.length-1)break;
      const width=pending[index]==='\r'&&pending[index+1]==='\n'?2:1;
      line(pending.slice(0,index));pending=pending.slice(index+width);
    }
    if(pending.length>MAX_EVENT){pending='';event='';discard=true;}
    if(finish&&pending){line(pending);pending='';}
  };
  return {
    chunk(chunk:Uint8Array) {
      if(!stream) {
        bytes+=chunk.byteLength;if(bytes>MAX_JSON){tooLarge=true;json='';return;}
        if(!tooLarge)json+=decoder.decode(chunk,{stream:true});
        return;
      }
      // A provider may put a whole response in one network chunk. Decode in
      // bounded pieces so an unusually large event cannot grow our parser state.
      for(let i=0;i<chunk.length;i+=16384)feed(decoder.decode(chunk.subarray(i,i+16384),{stream:true}));
    },
    finish() {
      if(stream){feed(decoder.decode(),true);if(!discard&&event)parse(event);}
      else if(!tooLarge)parse(json+decoder.decode());
    },
  };
}

// One durable ledger row represents one outbound attempt, including failures.
// Retries call this again and get their own row. Repeated SSE accounting frames
// update the same row instead of adding the same charge more than once.
export async function fetchModel(store:Accounting,student:string,model:string,kind:ModelCallKind,
  url:string,init:RequestInit,send:typeof fetch=fetch):Promise<Response> {
  const id=store.startModelCall(student,model,kind);
  const response=await send(url,init);
  if(!response.body)return response;
  const reader=response.body.getReader(),watch=observer(store,id,(response.headers.get('content-type')||'').toLowerCase().includes('text/event-stream'));
  const body=new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result=await reader.read();
        if(result.done){watch.finish();controller.close();reader.releaseLock();return;}
        watch.chunk(result.value);controller.enqueue(result.value);
      } catch(error) {controller.error(error);reader.releaseLock();}
    },
    async cancel(reason) {try{await reader.cancel(reason);}finally{reader.releaseLock();}},
  },{highWaterMark:0});
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
