import { bodyLimit } from 'hono/body-limit';
import { HTML_FILE, htmlProblems, MAX_HTML_BYTES } from './html.ts';
import { readFile } from 'node:fs/promises';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Store, Student } from './store.ts';
import { SESSION_TTL } from './store.ts';
import type { Config } from './config.ts';
import { containerName } from './docker.ts';
import { formatLocal, validZone, zonedToUtc } from './time.ts';
import { escapeHtml, policy } from './web.ts';
import { allowed } from './config.ts';
import type { IdeasSnapshot } from './ideas.ts';

// Dashboard sessions are established by the local simulator.
const COOKIE='pv2_session';
const asset=async(file:string)=>readFile(new URL(`../web/${file}`,import.meta.url),'utf8');
const page=async(name:string)=>asset(`${name}.html`);
// Today, Ideas and the reader share one stylesheet, shell (header, tabs/sidebar) and script (web/student.*). They are inlined, so the hash-based CSP covers them.
// The chat button opens wherever the student last wrote: the Simulator bot, or Messages with our number.
type Chat={url:string;name:'Simulator'};
async function studentPage(name:string,s:Student,current:'today'|'ideas'|'files',chat:Chat) {
  const [body,css,header,js]=await Promise.all([page(name),asset('student.css'),page('student-header'),asset('student.js')]);
  const bar=header.replaceAll('href="/chat"',()=>`href="${escapeHtml(chat.url)}"`).replaceAll('aria-label="Open Simulator"',()=>`aria-label="Open ${chat.name}" data-chat="${chat.name}"`).replace(`data-nav="${current}"`,()=>`data-nav="${current}" aria-current="page"`)
    .replace('{{CHAT}}',chat.name).replace('{{CHAT_ICON}}','chat').replace('{{INITIAL}}',()=>escapeHtml(([...s.name.trim()][0]||'?').toUpperCase())).replace('{{NAME}}',()=>escapeHtml(s.name)).replace('{{HANDLE}}',()=>s.username?escapeHtml('@'+s.username):'');
  return body.replaceAll('href="/chat"',()=>`href="${escapeHtml(chat.url)}"`).replaceAll('aria-label="Continue in Simulator"',()=>`aria-label="Continue in ${chat.name}"`).replace('/*{{STUDENT_CSS}}*/',()=>css).replace('<!--{{STUDENT_HEADER}}-->',()=>bar).replace('/*{{STUDENT_JS}}*/',()=>js);
}
const html=(c:Context,body:string,status=200)=>{c.header('Content-Security-Policy',policy(body).replace("form-action 'none'","form-action 'self'"));return c.html(body,status as 200);};
async function message(title:string,text:string,form='') {
  return (await page('student-message')).replaceAll('{{TITLE}}',escapeHtml(title)).replace('{{TEXT}}',escapeHtml(text)).replace('{{FORM}}',form);
}
export function studentApp(store:Store,config:Config,workerFetch:typeof fetch=fetch) {
  const app=new Hono<{Variables:{student:Student}}>();
  const origin=new URL(config.publicUrl).origin;
  // Browsers say where a request comes from in Sec-Fetch-Site, which pages cannot forge; with no-referrer they send
  // Origin: null on form posts, so Origin is only the fallback for browsers without Sec-Fetch-Site.
  const sameSite=(c:Context)=>{
    const site=c.req.header('sec-fetch-site');if(site)return site==='same-origin';
    const o=c.req.header('origin');return !o||o===origin||o===new URL(c.req.url).origin;
  };
  const chats=()=>'<a class="button" href="/simulator">Open student simulator</a>';
  const chat=(s:Student):Chat=>({url:`/simulator?student=${encodeURIComponent(s.id)}`,name:'Simulator'});
  const worker=(s:Student,path:string,init:RequestInit={})=>workerFetch(`http://${containerName(s.id)}:3000${path}`,{...init,headers:{authorization:`Bearer ${s.token}`,...init.headers},signal:AbortSignal.timeout(8000),redirect:'error'});

  const cookie=(c:Context,session:string)=>setCookie(c,COOKIE,session,{path:'/me',httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Lax',maxAge:SESSION_TTL/1000});
  app.use('*',bodyLimit({maxSize:16_384,onError:c=>c.json({error:'Please shorten your answers.'},413)}));
  app.use('*',async(c,next)=>{
    const session=getCookie(c,COOKIE),student=store.sessionStudent(session);
    if(student){c.set('student',student);cookie(c,session!);}
    return next();
  });
  const destination=(section:unknown)=>section==='ideas'?'/me/ideas':`/me${['goals','files','account'].includes(String(section))?'#'+section:''}`;
  // Fetching a link does not consume it. The browser exchanges the fragment with a same-origin POST.
  app.get('/login',async c=>html(c,await page('student-login')));
  app.post('/login',async c=>{
    if(!sameSite(c))return c.text('Forbidden',403);
    const json=(c.req.header('content-type')||'').startsWith('application/json');
    if(json&&c.req.header('x-protagonist')!=='1')return c.json({error:'Forbidden'},403);
    const body=await (json?c.req.json():c.req.parseBody()).catch(()=>({})),t=String(body.t||'');
    let student=c.get('student');
    if(student&&store.loginStudent(t)&&store.loginStudent(t)!==student.id)return c.json({error:'This link belongs to a different account. Sign out of this device before switching accounts.'},409);
    if(!student){
      const session=store.redeemLogin(t);
      if(!session)return c.json({error:'Open a new link from /dashboard in your Protagonist chat to sign in on this device.'},401);
      cookie(c,session);student=store.sessionStudent(session)!;
    }
    const url=destination(body.section);
    return json?c.json({url}):c.redirect(url,303);
  });
  app.post('/logout',async c=>{
    if(!sameSite(c))return c.text('Forbidden',403);
    const session=getCookie(c,COOKIE);if(session)store.endSession(session);
    deleteCookie(c,COOKIE,{path:'/me'});return c.redirect('/me',303);
  });
  app.get('/',async c=>{
    const student=c.get('student');
    if(!student)return html(c,await message('Sign in from your chat','Choose a test student in the simulator and open their dashboard.',chats()));
    return html(c,await studentPage('dashboard',student,'today',chat(student)));
  });

  app.get('/onboarding',async c=>{
    const s=c.get('student');if(!s)return c.redirect('/me',303);
    if(!store.needsOnboarding(s.id))return c.redirect('/me',303);
    const to=chat(s);
    return html(c,await message(`Let’s finish in ${to.name}`,`Your setup now happens in our chat. Return to ${to.name} and send /start to continue. Your answers are saved as you go.`,`<a class="button" href="${escapeHtml(to.url)}">Continue in ${to.name} →</a>`));
  });
  app.get('/plan',async c=>{
    const s=c.get('student');if(!s)return c.redirect('/me',303);
    return html(c,await studentPage('plan',s,'files',chat(s)));
  });
  app.get('/ideas',async c=>{
    const s=c.get('student');
    if(!s)return html(c,await message('Sign in from your chat','Choose a test student in the simulator and open their dashboard.',chats()));
    return html(c,await studentPage('ideas',s,'ideas',chat(s)));
  });
  app.use('/api/*',async(c,next)=>{
    const student=c.get('student');
    if(!student)return c.json({error:'Signed out. Open the dashboard from the student simulator.'},401);
    if(c.req.method!=='GET'&&(!sameSite(c)||c.req.header('x-protagonist')!=='1'))return c.json({error:'Forbidden'},403);
    c.set('student',student);return next();
  });
  // An old open form must not race the Simulator draft or create a second intake path.
  app.post('/api/onboarding',c=>c.json({error:'Setup has moved to our chat. Send /start there to continue.',chatUrl:chat(c.get('student')).url},410));
  const readIdeas=async(s:Student)=>{
    const r=await worker(s,`/ideas?research=${false}&reminders=${allowed(config,'reminders',s)}`);
    if(!r.ok)throw Error('Ideas unavailable');
    return await r.json() as {snapshot:IdeasSnapshot|null;starter?:IdeasSnapshot|null;contextChanged:boolean};
  };
  app.get('/api/ideas',async c=>{
    const s=c.get('student');
    if(store.needsOnboarding(s.id))return c.json({required:true,snapshot:null},200,{'Cache-Control':'no-store'});
    store.enableIdeas(s.id);
    try {
      const view=await readIdeas(s);
      if(view.contextChanged||!view.snapshot||view.snapshot.kind==='starter')store.invalidateIdeas(s.id);
      if(config.openrouterKey)store.fireIdeas(s.id);
      return c.json({...view,...store.ideasStatus(s.id),required:false},200,{'Cache-Control':'no-store'});
    }catch{return c.json({error:'Your assistant is unavailable right now. Please try again shortly.'},503);}
  });
  app.post('/api/ideas/start',async c=>{
    const s=c.get('student'),{request,index}=await c.req.json();
    if(store.needsOnboarding(s.id))return c.json({error:'Finish setup in Simulator first.'},409);
    if(!config.openrouterKey)return c.json({error:'Configure OpenRouter before starting an idea.'},503);
    if(typeof request!=='string'||!Number.isInteger(index)||index<0||index>4)return c.json({error:'Choose an idea from the current list.'},400);
    let view:Awaited<ReturnType<typeof readIdeas>>;
    try{view=await readIdeas(s);}catch{return c.json({error:'Your assistant is unavailable. Please try again.'},503);}
    const chosen=[view.snapshot,view.starter].find(snapshot=>snapshot?.request===request);
    if(!chosen?.ideas[index])return c.json({error:'Your ideas have changed. Reload the list and choose again.'},409);
    const result=store.startIdea(s.id,request,index,chosen.ideas[index].prompt,config.limits.messages);
    return typeof result==='string'?c.json({error:result},429):c.json({queued:true,chatUrl:chat(s).url});
  });
  app.get('/api/preview',async c=>{
    const path=c.req.query('path')||'';
    if(!HTML_FILE.test(path))return c.json({error:'Only HTML plans can be previewed.'},400);
    let r:Response;try{r=await worker(c.get('student'),`/files?path=${encodeURIComponent(path)}`);}catch{return c.json({error:'Your assistant is waking up. Please try again.'},503);}
    if(!r.ok)return c.json({error:'Plan not found.'},404);
    // Bound reads and revalidate every version. A sandboxed opaque origin cannot read the dashboard or its cookie.
    const reader=r.body?.getReader();if(!reader)return c.notFound();
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_HTML_BYTES){await reader.cancel();return c.json({error:'Plan is too large to preview.'},413);}chunks.push(value);}}finally{reader.releaseLock();}
    const body=Buffer.concat(chunks).toString('utf8');
    if(htmlProblems(body).length)return c.json({error:'This file cannot be safely previewed. Download it from Files instead.'},422);
    return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox allow-popups allow-popups-to-escape-sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"}});
  });
  app.get('/api/overview',async c=>{
    const s=c.get('student'),reminders=store.reminders(s.id);
    let assistant:Record<string,unknown>={unavailable:true};
    try {const r=await worker(s,'/dashboard');if(r.ok)assistant=await r.json();} catch {}
    const memory=typeof assistant.memory==='string'?assistant.memory:'';
    const zone=reminders.at(-1)?.zone||memory.match(/\b(America|Europe|Asia|Africa|Australia|Pacific|Atlantic)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/)?.[0]||null;
    const used=store.usage(s.id);
    return c.json({
      account:{name:s.name,username:s.username,connected:s.created,zone:store.onboarding(s.id).profile?.zone||zone,
        connect:[]},
      onboarding:{status:store.onboarding(s.id).status,required:store.needsOnboarding(s.id)},chatUrl:chat(s).url,chat:chat(s),
      usage:Object.fromEntries(Object.entries(config.limits).map(([k,limit])=>[k,{used:used[k]||0,limit}])),
      reminders:reminders.map(r=>({id:r.id,at:new Date(r.at).toISOString(),local:formatLocal(r.at,r.zone),zone:r.zone,note:r.note,goal:r.goal})),
      ...assistant,
    },200,{'Cache-Control':'no-store'});
  });
  app.get('/api/files',async c=>{
    const s=c.get('student'),path=c.req.query('path')||'';
    let r:Response;try{r=await worker(s,`/files?path=${encodeURIComponent(path)}`);}catch{return c.json({error:'Your assistant is unavailable right now.'},503);}
    if(!r.ok)return c.json({error:'File not found.'},404);
    const name=decodeURIComponent(r.headers.get('x-filename')||'file').replace(/[\r\n"]/g,'');
    // Always a download: student files never run as pages on this site.
    return new Response(r.body,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${name.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox"}});
  });
  app.put('/api/notes/:name',async c=>{
    const s=c.get('student'),name=c.req.param('name');if(name!=='soul'&&name!=='memory')return c.notFound();
    const {text}=await c.req.json();
    if(typeof text!=='string'||text.length>8000)return c.json({error:'Keep it under 8,000 characters.'},400);
    let r:Response;try{r=await worker(s,`/notes/${name}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});}catch{return c.json({error:'Your assistant is unavailable right now.'},503);}
    return c.json(await r.json(),r.status as 200);
  });
  app.post('/api/reminders/:id/cancel',c=>store.cancelReminder(c.get('student').id,Number(c.req.param('id')))?c.json({cancelled:true}):c.json({error:'That reminder is no longer scheduled.'},404));
  app.post('/api/reminders/:id/reschedule',async c=>{
    const s=c.get('student'),{local,zone}=await c.req.json();
    if(typeof zone!=='string'||!validZone(zone))return c.json({error:'Unknown time zone.'},400);
    const at=typeof local==='string'?zonedToUtc(local,zone):undefined;
    if(at===undefined||at<store.now()+60_000||at>store.now()+366*24*60*60_000)return c.json({error:'Choose a time at least a minute from now and within a year.'},400);
    return store.rescheduleReminder(s.id,Number(c.req.param('id')),at,zone)?c.json({id:Number(c.req.param('id')),at:new Date(at).toISOString(),local:formatLocal(at,zone)}):c.json({error:'That reminder is no longer scheduled.'},404);
  });
  return app;
}
