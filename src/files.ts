import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';

export const MAX_FILE_BYTES=20*1024*1024;
export function validFilename(name:string){return name.length>0&&name.length<=180&&!/[\x00-\x1f\x7f/\\]/.test(name)&&name!=='.'&&name!=='..';}

export async function workspaceFile(path:string,workspace:string,token:string) {
  const root=resolve(workspace),target=resolve(root,path);
  if(!target.startsWith(root+sep))throw Error('Only files inside your workspace can be sent.');
  const filename=basename(target);
  if(!validFilename(filename))throw Error('Choose a filename without control characters, up to 180 characters.');
  // Check the opened descriptor, not just the path: parent symlinks and renames cannot escape the workspace.
  const handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    if(!(await realpath(`/proc/self/fd/${handle.fd}`)).startsWith(root+sep))throw Error('File must be inside your workspace.');
    const stat=await handle.stat();
    if(!stat.isFile())throw Error('Only regular files can be sent.');
    if(stat.size<1||stat.size>MAX_FILE_BYTES)throw Error('Files must be nonempty and no larger than 20 MiB.');
    const bytes=Buffer.alloc(stat.size+1);let used=0;
    while(used<bytes.length){const {bytesRead}=await handle.read(bytes,used,bytes.length-used,null);if(!bytesRead)break;used+=bytesRead;}
    if(used!==stat.size)throw Error('File changed while reading. Finish writing it and retry.');
    const content=bytes.subarray(0,used);
    if(token&&content.includes(token))throw Error('Cannot send a file containing runtime credentials.');
    return {filename,content};
  }finally{await handle.close();}
}

// The broker's own reason (for example why an HTML file was refused), bounded, or the HTTP status.
export async function brokerError(response:Response) {
  const body=await response.json().catch(()=>undefined) as {error?:unknown}|undefined;
  return typeof body?.error==='string'?`${body.error.slice(0,500)} (${response.status})`:`HTTP ${response.status}`;
}
export async function sendWorkspaceFile(options:{path:string;caption?:string;requestId:string;workspace:string;token:string;broker:string},send:typeof fetch=fetch) {
  const {filename,content}=await workspaceFile(options.path,options.workspace,options.token);
  const form=new FormData();form.set('requestId',options.requestId);form.set('caption',options.caption||'');
  form.set('document',new Blob([content],{type:'application/octet-stream'}),filename);
  const response=await send(`${options.broker}/documents`,{method:'POST',headers:{authorization:`Bearer ${options.token}`},body:form,signal:AbortSignal.timeout(70_000)});
  if(!response.ok)throw Error(`File delivery failed: ${await brokerError(response)}. Do not claim it was sent; fix the problem and retry, or explain the failure.`);
  const result=await response.json() as {messageId:number|string};
  if(!Number.isSafeInteger(result.messageId)&&!(typeof result.messageId==='string'&&result.messageId))throw Error('File delivery was not confirmed.');
  return {filename,messageId:result.messageId};
}
