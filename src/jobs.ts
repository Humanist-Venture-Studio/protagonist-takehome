import { withStudentLock } from './lifecycle.ts';
import type { Store, Job, Outcome } from './store.ts';
import { CANCEL } from './store.ts';
import { Docker, containerName } from './docker.ts';
import { allowed, type Config } from './config.ts';
import { approveReply } from './replies.ts';
import { replyRewriter } from './reply-provider.ts';
// A request may run this long before it is stopped; a reply that cannot reach the worker is given up after these.
export const LIMITS={run:30*60_000,reach:6*60*60_000,deliver:24*60*60_000};
export const MESSAGES={
  stopped:'Stopped. What would you like to do instead?',
  tooLong:'That took too long, so I stopped it. Try asking for a smaller piece, or send it again.',
  failed:'I couldn’t finish that request. Please try again.',
  unreachable:'Your assistant was unavailable for a while, so I couldn’t answer that. Please send it again.',
};
class Rejected extends Error {}
async function worker(send:typeof fetch,student:{id:string;token:string},path:string,body?:unknown) {
  const form=body instanceof FormData;
  const res=await send(`http://${containerName(student.id)}:3000${path}`,{method:'POST',headers:{authorization:`Bearer ${student.token}`,...(form?{}:{'Content-Type':'application/json'})},
    body:form?body:JSON.stringify(body??{}),signal:AbortSignal.timeout(form?60_000:10_000)});
  if(res.status>=400&&res.status<500)throw new Rejected(`Student runtime rejected ${path} (${res.status})`);
  if(!res.ok)throw new Error('Student runtime unavailable');
  return res;
}
// Ask the worker for the job's answer (submitting is idempotent by request ID), stopping it on request or when it runs too long.
async function answer(store:Store,config:Config,docker:Pick<Docker,'ensure'>,job:Job,send:typeof fetch):Promise<{text:string;outcome:Outcome}|undefined> {
  const student=store.student(job.student)!,now=store.now();
  if(job.cancel&&!job.submitted)return {text:MESSAGES.stopped,outcome:'cancelled'};
  if(!job.submitted&&job.attempts>0&&now-job.created>LIMITS.reach)return {text:MESSAGES.unreachable,outcome:'failed'};
  const overdue=job.submitted>0&&now-job.submitted>LIMITS.run;
  if((job.cancel===CANCEL.requested||overdue)&&job.cancel!==CANCEL.sent) {
    // Workers without /abort keep running in the background; their answer is discarded.
    try {await worker(send,student,'/abort',{requestId:job.request});store.cancelSent(job.id);}
    catch(error) {if(!(error instanceof Rejected))throw error;return {text:overdue?MESSAGES.tooLong:MESSAGES.stopped,outcome:overdue?'failed':'cancelled'};}
  }
  if(overdue)return {text:MESSAGES.tooLong,outcome:'failed'};
  if(store.student(student.id)?.deleting)return;
  await docker.ensure(student,config);
  if(store.student(student.id)?.deleting)return;
  const result=await (await worker(send,student,'/messages',{requestId:job.request,text:job.text})).json() as {status:string;text?:string;outcome?:Outcome};
  store.submitted(job.id);
  if(result.status==='pending') {
    store.wait(job.id,2000);
    return;
  }
  if(result.status!=='done'||typeof result.text!=='string')throw new Error('Invalid runtime response');
  return {text:result.text,outcome:['success','failed','cancelled'].includes(result.outcome||'')?result.outcome!:job.cancel?'cancelled':'unknown'};
}
export async function processJob(store:Store,docker:Pick<Docker,'ensure'|'stop'>,config:Config,job:Job,send:typeof fetch=fetch) {
  return withStudentLock(job.student,()=>processLocked(store,docker,config,job,send));
}
async function processLocked(store:Store,docker:Pick<Docker,'ensure'|'stop'>,config:Config,job:Job,send:typeof fetch) {
  const student=store.student(job.student);
  if(!student||student.deleting||store.current(student.id)?.id!==job.id)return;
  if(job.kind==='ideas') {
    try {
      if(student.disconnected||job.cancel||store.hasForeground(student.id)||store.now()-job.created>120_000) {
        if(job.submitted)await worker(send,student,'/ideas/cancel',{requestId:job.request}).catch(()=>{});
        store.finishIdeas(job,job.cancel||student.disconnected||store.hasForeground(student.id)?'cancelled':'failed');return;
      }
      await docker.ensure(student,config);
      if(store.student(student.id)?.deleting)return;
      const result=await (await worker(send,student,'/ideas/refresh',{requestId:job.request,research:false,reminders:allowed(config,'reminders',student),profile:store.onboarding(student.id).profile})).json();
      store.submitted(job.id);
      if(result.status==='pending'){store.wait(job.id,2000);return;}
      if(result.status!=='done'||!['success','failed','cancelled'].includes(result.outcome))throw Error('Invalid ideas response');
      store.finishIdeas(job,result.outcome);
    }catch(error){
      if(error instanceof Rejected||store.now()-job.created>120_000)store.finishIdeas(job,'failed');
      else {store.jobError(job.id,'worker_unavailable');store.retry(job);store.wait(job.id,5000);}
    }
    return;
  }
  if(job.kind==='ideas-invite'&&(student.disconnected||store.now()-job.created>3600_000)){store.done(job.id,'skipped');return;}
  try {
    let reply=job.reply;let outcome:Outcome=job.outcome||'unknown';
    if(reply===null) {
      outcome='success';
      try {const result=await answer(store,config,docker,job,send);reply=result?.text??null;outcome=result?.outcome||'unknown';}
      catch(error) {if(!(error instanceof Rejected))throw error;console.error(`Student runtime rejected a job: ${student.id}`);reply=MESSAGES.failed;outcome='failed';}
      if(reply===null)return;
    }
    // A reminder whose step is already done stays silent.
    if(job.kind==='reminder'&&/^\s*SKIP[.!]?\s*$/i.test(reply)){store.done(job.id,'skipped');return;}
    const ready=await approveReply(reply.includes(student.token)?'':reply,'final',reply.includes(student.token)?async()=>{throw Error('Unsafe reply');}:replyRewriter(store,config,student,send),{prepared:job.reply!==null});
    if(store.student(student.id)?.deleting)return;
    store.deliver(job,ready.text,ready.fallback?'failed':outcome);
  } catch {
    if(store.now()-job.created>LIMITS.deliver)store.deliver(job,MESSAGES.unreachable,'failed');
    else {store.jobError(job.id,'worker_unavailable');store.retry(job);}
  }
}

export function delay(ms:number,signal:AbortSignal) {
  return new Promise<void>(resolve=>{
    if(signal.aborted)return resolve();
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});
  });
}
