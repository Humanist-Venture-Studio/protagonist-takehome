import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Config } from './config.ts';
import { LOGIN_TTL, type Store, type Student } from './store.ts';
import { createHash } from 'node:crypto';
import { MAX_FILE_BYTES, validFilename } from './files.ts';
import { documentProblem } from './html.ts';
import { formatLocal, validZone, zonedToUtc } from './time.ts';
import type { Reminder } from './store.ts';
import { approveReply } from './replies.ts';
import { replyRewriter } from './reply-provider.ts';
import { allowed, MAX_OUTPUT_TOKENS } from './config.ts';
import { modelMessages, modelProvider, modelReasoning, selectedModel } from './models.ts';
import { fetchModel } from './model-usage.ts';

export function brokerApp(store:Store,config:Config,send:typeof fetch=fetch) {
  const app=new Hono<{Variables:{student:Student}}>();
  const delivering=new Map<string,{digest:string;promise:Promise<number|string>}>();
  // Progress messages: a few per minute per student, on top of the daily quota.
  const recent=new Map<string,number[]>();
  const burst=(id:string)=>{const now=Date.now(),times=(recent.get(id)||[]).filter(t=>now-t<60_000);if(times.length>=5)return false;times.push(now);recent.set(id,times);return true;};
  app.use('*',async(c,next)=>{
    const token=c.req.header('authorization')?.replace(/^Bearer /,'')||'';
    const student=token.length===64?store.byToken(token):undefined;
    if(!student)return c.json({error:'Unauthorized'},401);
    c.set('student',student);return next();
  });
  // Model requests carry the whole conversation; the worker compacts well before this.
  app.use('*',async(c,next)=>bodyLimit({maxSize:c.req.path==='/documents'?MAX_FILE_BYTES+8192:c.req.path.startsWith('/model/')?4*1024*1024:64*1024})(c,next));
  // The model can request a link only for its authenticated student, never choose the account or destination.
  app.post('/dashboard-link',async c=>{
    store.publicUrl=config.publicUrl.replace(/\/$/,'');
    c.header('Cache-Control','no-store');
    const body=await c.req.json().catch(()=>({})),section=body.section==='ideas'?'ideas':'goals';
    if(section==='ideas')store.enableIdeas(c.get('student').id);
    return c.json({url:store.dashboardLink(c.get('student').id,section),expiresInDays:LOGIN_TTL/86400_000,staysSignedIn:true});
  });
  app.post('/documents',async c=>{
    const student=c.get('student');
    const form=await c.req.formData(),file=form.get('document'),request=form.get('requestId'),caption=form.get('caption')||'';
    if(!(file instanceof File)||!validFilename(file.name)||file.size<1||file.size>MAX_FILE_BYTES||typeof request!=='string'||!/^[-a-zA-Z0-9_:]{1,120}$/.test(request)||typeof caption!=='string'||caption.length>1024)return c.json({error:'Invalid file upload'},400);
    const bytes=Buffer.from(await file.arrayBuffer());
    if(bytes.includes(student.token)||caption.includes(student.token)||file.name.includes(student.token))return c.json({error:'Cannot send runtime credentials'},400);
    const unsafe=documentProblem(file.name,bytes);
    if(unsafe)return c.json({error:unsafe},400);
    const digest=createHash('sha256').update(JSON.stringify([file.name,caption])).update(bytes).digest('hex');
    const receipt=store.documentReceipt(student.id,request);
    if(receipt)return receipt.digest===digest?c.json({messageId:receipt.message}):c.json({error:'Delivery ID already used for different content'},409);
    const key=`${student.id}:${request}`,existing=delivering.get(key);
    if(existing)return existing.digest===digest?c.json({messageId:await existing.promise}):c.json({error:'Delivery ID already in use'},409);
    if([...delivering.keys()].some(k=>k.startsWith(student.id+':')))return c.json({error:'Another file is being delivered; retry shortly'},429);
    if(!store.take(`documents:${student.id}`,config.limits.documents))return c.json({error:'Daily file delivery limit reached'},429);
    const promise=(async()=>{
      return store.transaction(()=>{const messageId=store.appendMessage(student.id,request,'file',caption,file.name,bytes);store.documentSent(student.id,request,digest,messageId);return messageId;});
    })();
    delivering.set(key,{digest,promise});
    try{return c.json({messageId:await promise});}finally{delivering.delete(key);}
  });
  app.post('/notify',async c=>{
    const student=c.get('student');
    const {requestId:request,text}=await c.req.json();
    if(typeof request!=='string'||!/^[-a-zA-Z0-9_:]{1,120}$/.test(request)||typeof text!=='string'||!text.trim()||text.length>4000)return c.json({error:'Invalid message'},400);
    if(text.includes(student.token))return c.json({error:'Cannot send runtime credentials'},400);
    const digest=createHash('sha256').update('notify:'+text).digest('hex'),receipt=store.documentReceipt(student.id,request);
    if(receipt)return receipt.digest===digest?c.json({messageId:receipt.message}):c.json({error:'Delivery ID already used for different content'},409);
    const key=`${student.id}:${request}`,existing=delivering.get(key);
    if(existing)return existing.digest===digest?c.json({messageId:await existing.promise}):c.json({error:'Delivery ID already in use'},409);
    const draft=store.notificationDraft(student.id,request);
    if(draft&&draft.digest!==digest)return c.json({error:'Delivery ID already used for different content'},409);
    if(!draft) {
      if(!burst(student.id))return c.json({error:'Too many messages; wait a minute'},429);
      if(!store.take(`notify:${student.id}`,config.limits.notify))return c.json({error:'Daily message limit reached'},429);
    }
    const promise=(async()=>{
      const approved=draft||await approveReply(text,'progress',replyRewriter(store,config,student,send));
      if(!draft)store.saveNotificationDraft(student.id,request,digest,approved.text);
      return store.transaction(()=>{const messageId=store.appendMessage(student.id,request,'progress',approved.text);store.documentSent(student.id,request,digest,messageId);store.clearNotificationDraft(student.id,request);return messageId;});
    })();
    delivering.set(key,{digest,promise});
    try{return c.json({messageId:await promise});}finally{delivering.delete(key);}
  });
  // Reminders: the destination is always the authenticated student; the time is their local time in their zone.
  const shown=(r:Reminder)=>({id:r.id,at:new Date(r.at).toISOString(),local:formatLocal(r.at,r.zone),zone:r.zone,note:r.note,goal:r.goal});
  app.use('/reminders/*',async(c,next)=>allowed(config,'reminders',c.get('student'))?next():c.json({error:'Reminders are not enabled for this student'},403));
  app.use('/reminders',async(c,next)=>allowed(config,'reminders',c.get('student'))?next():c.json({error:'Reminders are not enabled for this student'},403));
  app.post('/reminders',async c=>{
    const student=c.get('student'),{requestId:request,local,zone,note,goal}=await c.req.json();
    if(typeof request!=='string'||!/^[-a-zA-Z0-9_:]{1,120}$/.test(request)||typeof note!=='string'||!note.trim()||note.length>1000||(goal!==undefined&&goal!==null&&(typeof goal!=='string'||!/^[a-z0-9-]{1,80}$/.test(goal))))return c.json({error:'Invalid reminder'},400);
    if(typeof zone!=='string'||!validZone(zone))return c.json({error:'Unknown time zone; use an IANA name such as America/New_York'},400);
    const at=typeof local==='string'?zonedToUtc(local,zone):undefined;
    if(at===undefined)return c.json({error:'Give the local time as YYYY-MM-DDTHH:MM'},400);
    if(note.includes(student.token))return c.json({error:'Cannot store runtime credentials'},400);
    const now=store.now();
    if(at<now+60_000||at>now+366*24*60*60_000)return c.json({error:'Reminders must be at least a minute ahead and within a year'},400);
    const result=store.addReminder(student.id,request,at,zone,note.trim(),goal||null,config.limits.reminders);
    return typeof result==='string'?c.json({error:result},429):c.json(shown(result));
  });
  app.get('/reminders',c=>c.json({reminders:store.reminders(c.get('student').id).map(shown)}));
  app.delete('/reminders/:id',c=>store.cancelReminder(c.get('student').id,Number(c.req.param('id')))?c.json({cancelled:true}):c.json({error:'No such scheduled reminder'},404));
  app.post('/model/v1/chat/completions',async c=>{
    if(!config.openrouterKey)return c.json({error:'Model is not configured'},503);
    if(!store.take(`model:${c.get('student').id}`,config.limits.model))return c.json({error:'Daily model limit reached'},429);
    const body=await c.req.json();
    const model=selectedModel(store,config);
    // The client cannot select an arbitrary model, destination, provider key, or unbounded output.
    const payload={model,messages:modelMessages(model,body.messages),tools:body.tools,tool_choice:body.tool_choice,
      stream:body.stream===true,stream_options:body.stream===true?{include_usage:true}:undefined,
      max_tokens:Math.min(MAX_OUTPUT_TOKENS,Math.max(1,Number(body.max_tokens||body.max_completion_tokens)||MAX_OUTPUT_TOKENS)),provider:modelProvider(model),...modelReasoning(model)};
    const kind=Array.isArray(body.tools)&&body.tools.some((tool:unknown)=>typeof tool==='object'&&tool!==null&&'function' in tool&&(tool as {function?:{name?:unknown}}).function?.name==='record_student_context')?'capture':'assistant';
    const res=await fetchModel(store,c.get('student').id,model,kind,'https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${config.openrouterKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.any([c.req.raw.signal,AbortSignal.timeout(120_000)])},send);
    if(res.ok)return new Response(res.body,{status:200,headers:{'Content-Type':res.headers.get('content-type')||'application/json','Cache-Control':'no-store'}});
    // Pass the provider's reason through (bounded, credential-free) with a status the runtime understands:
    // an over-long or oversized request compacts, a rate limit backs off, anything else is retried.
    const {reason,provider}=providerError(await errorBody(res),config.openrouterKey);
    console.warn(`Model provider error ${res.status} for ${model}${provider?` via ${provider}`:''}: ${reason.replace(/'[^']*'|"[^"]*"/g,'…').slice(0,200)}`);
    if(res.status===400)return c.json({error:{message:reason,type:'invalid_request_error'}},400);
    if(res.status===413)return c.json({error:{message:`Request too large for the model provider (request_too_large): ${reason}`,type:'invalid_request_error'}},413);
    if(res.status===429) {
      const after=res.headers.get('retry-after');if(after&&/^\d{1,4}$/.test(after))c.header('Retry-After',after);
      return c.json({error:{message:`Model provider rate limit: ${reason}`,type:'rate_limit_error'}},429);
    }
    return c.json({error:{message:`Model provider unavailable (HTTP ${res.status}): ${reason}`,type:'upstream_error'}},502);
  });
  app.onError((err,c)=>err instanceof HTTPException&&err.status===413?c.json({error:'Request too large'},413):c.json({error:'Service unavailable'},503));
  return app;
}

// Error bodies are small JSON; read at most 16 KiB and discard the rest.
async function errorBody(res:Response):Promise<unknown> {
  const reader=res.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    while(reader&&size<16384){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length;}
    return JSON.parse(Buffer.concat(chunks).subarray(0,16384).toString('utf8'));
  } catch {return {};} finally {await reader?.cancel().catch(()=>{});}
}

// OpenRouter wraps an upstream refusal as "Provider returned error" and keeps the provider's
// own message (for example a Cerebras context or image limit) in metadata.raw. Use that message
// alone: the runtime retries anything worded "provider returned error", even a permanent refusal.
export function providerError(body:unknown,key:string):{reason:string;provider?:string} {
  const error=(body as {error?:{message?:unknown;metadata?:{provider_name?:unknown;raw?:unknown}}})?.error;
  let reason=typeof error?.message==='string'&&error.message?error.message:'No reason given';
  const raw=error?.metadata?.raw;
  if(typeof raw==='string'&&raw.trim()) {
    let inner:unknown=raw;try{inner=JSON.parse(raw);}catch{}
    const message=typeof inner==='string'?inner:(inner as {message?:unknown;error?:{message?:unknown}})?.message??(inner as {error?:{message?:unknown}})?.error?.message;
    if(typeof message==='string'&&message.trim())reason=message;
  }
  const provider=typeof error?.metadata?.provider_name==='string'?error.metadata.provider_name:undefined;
  return {reason:(key?reason.replaceAll(key,''):reason).slice(0,500),provider};
}
