import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

// Dashboard edits and input capture share this lock; model calls run outside it.
const locks=new Map<string,Promise<unknown>>();
export async function withWorkspaceLock<T>(workspace:string,work:()=>Promise<T>):Promise<T> {
  const key=resolve(workspace),previous=locks.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(work);locks.set(key,next);
  try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}
}
export async function workspacePath(workspace:string,name:string) {
  const root=await realpath(workspace),file=resolve(root,name),dir=dirname(file);
  if(!file.startsWith(root+sep))throw Error('Invalid workspace path');
  await mkdir(dir,{recursive:true});
  if(await realpath(dir)!==dir)throw Error('Workspace directories must not be symbolic links');
  const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return;throw error;});
  if(info&&!info.isFile())throw Error('Workspace files must be regular files');
  return file;
}
export async function readWorkspaceText(workspace:string,name:string,max=128_000):Promise<string|null> {
  const file=await workspacePath(workspace,name);
  const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return;throw error;});
  if(!info)return null;
  if(info.size>max)throw Error('Workspace file is too large');
  return readFile(file,'utf8');
}
export async function atomicWorkspaceText(workspace:string,name:string,text:string) {
  const file=await workspacePath(workspace,name),temp=`${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp,text,{flag:'wx',mode:0o600});
    await rename(temp,file);
    if(await readFile(file,'utf8')!==text)throw Error('Workspace save could not be verified');
  }finally{await unlink(temp).catch(()=>{});}
}
