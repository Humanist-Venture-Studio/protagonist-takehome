// Coordinate deletion with jobs and reconciliation so an in-flight ensure cannot recreate a deleted volume.
const locks=new Map<string,Promise<unknown>>();
export async function withStudentLock<T>(id:string,work:()=>Promise<T>):Promise<T> {
  const next=(locks.get(id)||Promise.resolve()).catch(()=>{}).then(work);locks.set(id,next);
  try{return await next;}finally{if(locks.get(id)===next)locks.delete(id);}
}
