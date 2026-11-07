import { setTimeout } from 'node:timers/promises';
import type { CaptureMessage } from './persistence.ts';

export type InputContent=string|({type:'text';text:string}|{type:'image';data:string;mimeType:string})[];
export type AdmittedInput={requestId:string;input:string;content:InputContent;recent?:CaptureMessage[];captureAttempts?:number;capture?:{notice:string;failed:boolean}};
type Preparation={
  save:(input:AdmittedInput)=>Promise<void>;
  capture:(request:string,input:string,signal:AbortSignal)=>Promise<{cancelled:boolean;notice:string}>;
  cancelled?:(request:string)=>Promise<boolean>;
  verify?:(request:string)=>Promise<{cancelled:boolean;notice:string}>;
  fail:(request:string)=>Promise<void>;
  submit:(request:string,content:InputContent)=>Promise<void>;
  report:(stage:'capture'|'submission',attempt:number,reason:string)=>void;
  wait?:(attempt:number,signal:AbortSignal)=>Promise<void>;
};
const unverified='Automatic context capture could not be verified. This message was accepted and is available in this conversation; do not ask the student to resend it. Read the current MEMORY.md and goal files. Use your normal file tools to save and verify any explicit goal or durable fact before claiming it is saved. Preserve newer edits and corrections. If saving still fails, explain that durable memory or goals could not be updated, while continuing to help with the accepted message.';
// Diagnostics are categories only: never put provider bodies, paths, student text
// or credentials in the controller's Docker logs.
function reason(error:unknown) {
  const code=(error as {code?:unknown})?.code;
  if(['EACCES','EIO','ENOSPC','EROFS','ENOENT'].includes(String(code)))return 'workspace_io';
  const message=error instanceof Error?error.message:'';
  if(message==='Context capture is unavailable')return 'provider_unavailable';
  if(message==='Context capture did not complete'||error instanceof SyntaxError)return 'provider_output';
  if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))return 'timeout';
  return 'capture_validation_or_storage';
}
// The caller keeps the admitted manifest until Pi acknowledges this exact request.
// Persist both the retry budget and verified capture result so a restart cannot
// recapture an older input after a newer correction or exhaust the model quota.
export async function prepareInput(input:AdmittedInput,deps:Preparation,signal:AbortSignal):Promise<'submitted'|'cancelled'> {
  signal.throwIfAborted();
  // Check even a cached failed capture: /abort may have persisted its tombstone
  // but failed to remove the input manifest before a restart.
  if(await deps.cancelled?.(input.requestId))return 'cancelled';
  while(!input.capture&&(input.captureAttempts||0)<3) {
    if(input.captureAttempts)await (deps.wait||((attempt,signal)=>setTimeout(attempt*500,undefined,{signal})))(input.captureAttempts,signal);
    signal.throwIfAborted();
    input.captureAttempts=(input.captureAttempts||0)+1;
    await deps.save(input);
    try {
      const result=await deps.capture(input.requestId,input.input,signal);
      if(result.cancelled)return 'cancelled';
      signal.throwIfAborted();
      input.capture={notice:result.notice,failed:false};
    }catch(error) {
      signal.throwIfAborted();
      deps.report('capture',input.captureAttempts,reason(error));
    }
  }
  signal.throwIfAborted();
  if(!input.capture) {
    // Fence any unfinished old patch before letting subsequent requests proceed.
    // If this durable write fails, keep the original manifest and retry later.
    await deps.fail(input.requestId);
    signal.throwIfAborted();
    input.capture={notice:unverified,failed:true};
  }
  await deps.save(input);
  signal.throwIfAborted();
  // Recheck a cached successful receipt after admission retries: a later dashboard
  // edit must replace the earlier success notice without re-extracting old input.
  const verified=!input.capture.failed&&deps.verify?await deps.verify(input.requestId):{cancelled:false,notice:input.capture.notice};
  if(verified.cancelled)return 'cancelled';
  signal.throwIfAborted();
  const note=verified.notice?`\n\n[Application persistence status]\n${verified.notice}`:'';
  const content=typeof input.content==='string'?input.content+note:
    input.content.map((part,index)=>index===0&&part.type==='text'?{...part,text:part.text+note}:part);
  try {
    await deps.submit(input.requestId,content);
    return 'submitted';
  }catch(error) {
    deps.report('submission',0,'admission_unavailable');
    throw error;
  }
}
