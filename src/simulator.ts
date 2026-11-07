import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import type { Config } from './config.ts';
import { SESSION_TTL, type Store, type Student } from './store.ts';
import { selectedModel } from './models.ts';

// The simulator is the local evaluator's console; it intentionally lets them switch between
// synthetic students. Student-facing dashboard APIs continue to use scoped session cookies.
export function simulatorApp(store:Store,config:Config) {
  const app=new Hono<{Variables:{student:Student}}>();
  app.use('*',bodyLimit({maxSize:16_384,onError:c=>c.json({error:'Request too large'},413)}));
  app.get('/status',c=>c.json({modelConfigured:!!config.openrouterKey,model:selectedModel(store,config)}));
  app.get('/students',c=>c.json({students:store.students().filter(s=>!s.deleting).map(s=>({id:s.id,name:s.name,created:s.created,...store.jobCounts(s.id)}))}));
  app.post('/students',async c=>{
    const body=await c.req.json().catch(()=>null),name=body?.name;
    if(typeof name!=='string'||!name.trim()||name.length>100||/[\x00-\x1f\x7f]/.test(name))return c.json({error:'Enter a name between 1 and 100 characters.'},400);
    if(store.students().length>=config.maxStudents)return c.json({error:'Student limit reached. Delete a test student in Admin.'},409);
    const s=store.createStudent(name.trim(),config.maxStudents);
    return c.json({id:s.id,name:s.name},201);
  });
  app.use('/students/:id/*',async(c,next)=>{
    const student=store.student(c.req.param('id')!);
    if(!student||student.deleting||student.disconnected)return c.json({error:'Student not found'},404);
    c.set('student',student);return next();
  });
  app.get('/students/:id/messages',c=>c.json({messages:store.messages(c.get('student').id),jobs:store.jobHistory(c.get('student').id),...store.jobCounts(c.get('student').id)}));
  app.post('/students/:id/messages',async c=>{
    if(!config.openrouterKey)return c.json({error:'Add your OpenRouter key to .local/runtime.json, then restart the app to enable replies.'},503);
    const body=await c.req.json().catch(()=>null);
    if(typeof body?.text!=='string'||!body.text.trim()||body.text.length>8000||body.text.includes('\u0000')||typeof body.requestId!=='string'||!/^[-\w]{8,100}$/.test(body.requestId))return c.json({error:'Enter a message of 1–8,000 characters and a valid request ID.'},400);
    if(body.text.trim()==='/stop') {
      const id=c.get('student').id,job=store.current(id);
      return job&&store.requestStop(id,job.id)?c.json({stopping:true},202):c.json({error:'No running request to stop.'},409);
    }
    try{return c.json({id:store.receiveMessage(c.get('student').id,body.requestId,body.text.trim(),config.limits.messages)},202);}
    catch(error){return c.json({error:(error as Error).message},409);}
  });
  app.post('/students/:id/stop',async c=>{
    const id=c.get('student').id,current=store.current(id);
    return current&&store.requestStop(id,current.id)?c.json({stopping:true}):c.json({error:'No running request to stop.'},409);
  });
  app.post('/students/:id/dashboard',c=>{
    const session=store.redeemLogin(store.newLogin(c.get('student').id))!;
    setCookie(c,'pv2_session',session,{path:'/me',httpOnly:true,sameSite:'Strict',maxAge:SESSION_TTL/1000});
    return c.json({url:'/me'});
  });
  app.get('/students/:id/files/:message',c=>{
    const file=store.attachment(c.get('student').id,Number(c.req.param('message')));
    if(!file)return c.notFound();
    return c.body(Buffer.from(file.bytes),200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Content-Security-Policy':"default-src 'none'; sandbox"});
  });
  return app;
}
