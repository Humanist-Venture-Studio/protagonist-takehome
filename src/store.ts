import { onboardingProfile, type OnboardingProfile } from './onboarding.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type Student = { id:string; name:string; username:string; token:string; created:string; disconnected:number; deleting:number };
export type ChatMessage = {id:number; student:string; request:string; role:'student'|'assistant'|'progress'|'file'; text:string; filename:string|null; created:number};
export const CANCEL={none:0,requested:1,sent:2};
export type JobKind = 'message' | 'reminder' | 'onboarding' | 'ideas' | 'ideas-invite';
export type Outcome = 'success' | 'failed' | 'cancelled' | 'skipped' | 'unknown';
export type ModelCallKind = 'assistant' | 'capture' | 'rewrite';
export type ModelUsage = {cost?:number|null;promptTokens?:number|null;completionTokens?:number|null;cachedTokens?:number|null;responseModel?:string;providerId?:string};
export type CostTotal = {cost:number;requests:number;unpriced:number};
export type CostSummary = {since:string;currency:'USD';today:CostTotal;month:CostTotal;total:CostTotal;models:(CostTotal&{model:string})[]};
export type Reminder = { id: number; student: string; request: string; at: number; zone: string; note: string; goal: string | null; created: number; fired: number | null; cancelled: number | null; result: string | null };
// A reminder is sent only if it can go out within this long of its time; older ones are skipped, never sent late.
export const REMINDER_GRACE=6*60*60_000, MAX_ACTIVE_REMINDERS=20;
export type Job = { id: number; student: string; source: string; request: string; kind: JobKind; text: string; reply: string | null; sent: number;
  attempts: number; retry: number; cancel: number; submitted: number; created: number; files: string | null;
  outcome: Outcome | null; completed: number | null; delivered: number | null; error_code: string | null };
const SCHEMA=`
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',token TEXT UNIQUE NOT NULL,created TEXT NOT NULL,disconnected INTEGER NOT NULL DEFAULT 0,deleting INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,student TEXT NOT NULL REFERENCES students(id),source TEXT UNIQUE NOT NULL,request TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'message',text TEXT NOT NULL,reply TEXT,sent INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,retry INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,cancel INTEGER NOT NULL DEFAULT 0,submitted INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,files TEXT,outcome TEXT,completed INTEGER,delivered INTEGER,error_code TEXT);
CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(done,retry,id);
CREATE INDEX IF NOT EXISTS student_jobs ON jobs(student,done,id);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,student TEXT NOT NULL REFERENCES students(id),request TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,filename TEXT,bytes BLOB,created INTEGER NOT NULL,UNIQUE(student,request,role));
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,day TEXT NOT NULL,count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS document_receipts(student TEXT NOT NULL REFERENCES students(id),request TEXT NOT NULL,digest TEXT NOT NULL,message INTEGER NOT NULL,PRIMARY KEY(student,request));
CREATE TABLE IF NOT EXISTS reminders(id INTEGER PRIMARY KEY,student TEXT NOT NULL REFERENCES students(id),request TEXT NOT NULL,at INTEGER NOT NULL,zone TEXT NOT NULL,note TEXT NOT NULL,goal TEXT,created INTEGER NOT NULL,fired INTEGER,cancelled INTEGER,result TEXT,UNIQUE(student,request));
CREATE TABLE IF NOT EXISTS logins(hash TEXT PRIMARY KEY,student TEXT NOT NULL REFERENCES students(id),expires INTEGER NOT NULL,used INTEGER);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,student TEXT NOT NULL REFERENCES students(id),created INTEGER NOT NULL,expires INTEGER NOT NULL,seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY,student TEXT NOT NULL REFERENCES students(id),model TEXT NOT NULL,kind TEXT NOT NULL,created INTEGER NOT NULL,cost REAL,prompt_tokens INTEGER,completion_tokens INTEGER,cached_tokens INTEGER,response_model TEXT,provider_id TEXT);
CREATE TABLE IF NOT EXISTS onboarding(student TEXT PRIMARY KEY REFERENCES students(id),profile TEXT,submitted INTEGER,job INTEGER);
CREATE TABLE IF NOT EXISTS idea_schedule(student TEXT PRIMARY KEY REFERENCES students(id),next_at INTEGER NOT NULL,job INTEGER,last_success INTEGER,failed INTEGER NOT NULL DEFAULT 0,invite_until INTEGER);
`;
export const LOGIN_TTL=7*24*60*60_000, SESSION_TTL=180*24*60*60_000;
const digest=(secret:string)=>createHash('sha256').update(secret).digest('hex');
export class Store {
  db: DatabaseSync;
  now: () => number;
  publicUrl = 'http://localhost:3210';
  constructor(file: string, now = () => Date.now()) {
    this.db = new DatabaseSync(file);this.now = now;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; ${SCHEMA}`);
    this.db.prepare("INSERT OR IGNORE INTO meta VALUES('model-cost-started',?)").run(new Date(this.now()).toISOString());
  }
  transaction<T>(work:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=work();this.db.exec('COMMIT');return result;} catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  students(): Student[] { return this.db.prepare('SELECT * FROM students ORDER BY created DESC').all() as Student[]; }
  connected(): Student[] { return this.students().filter(s=>!s.disconnected&&!s.deleting); }
  student(id: string) { return this.db.prepare('SELECT * FROM students WHERE id=?').get(id) as Student | undefined; }
  byToken(token: string) { return this.db.prepare('SELECT * FROM students WHERE token=? AND disconnected=0 AND deleting=0').get(token) as Student | undefined; }
  documentReceipt(student:string,request:string) { return this.db.prepare('SELECT digest,message FROM document_receipts WHERE student=? AND request=?').get(student,request) as {digest:string;message:number|string}|undefined; }
  documentSent(student:string,request:string,digest:string,message:number|string) { this.db.prepare('INSERT INTO document_receipts VALUES(?,?,?,?)').run(student,request,digest,message); }
  expireNotificationDrafts() {
    this.db.prepare("DELETE FROM meta WHERE key LIKE 'notify-draft:%' AND CAST(json_extract(value,'$.at') AS INTEGER)<?").run(this.now()-24*60*60_000);
  }
  notificationDraft(student:string,request:string) {
    this.expireNotificationDrafts();
    const raw=this.get(`notify-draft:${digest(student+':'+request)}`);
    return raw?JSON.parse(raw) as {digest:string;text:string;at:number}:undefined;
  }
  saveNotificationDraft(student:string,request:string,hash:string,text:string) {
    this.set(`notify-draft:${digest(student+':'+request)}`,JSON.stringify({student,digest:hash,text,at:this.now()}));
  }
  clearNotificationDraft(student:string,request:string) {
    this.db.prepare('DELETE FROM meta WHERE key=?').run(`notify-draft:${digest(student+':'+request)}`);
  }
  get(key: string) { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value; }
  set(key: string, value: string) { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key, value); }
  startModelCall(student:string,model:string,kind:ModelCallKind):string {
    const id=randomUUID();
    this.db.prepare('INSERT INTO model_calls(id,student,model,kind,created) VALUES(?,?,?,?,?)').run(id,student,model,kind,this.now());
    return id;
  }
  recordModelUsage(id:string,usage:ModelUsage) {
    const cost=typeof usage.cost==='number'&&Number.isFinite(usage.cost)&&usage.cost>=0?usage.cost:null;
    const tokens=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
    const identifier=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9._:/-]{1,200}$/.test(value)?value:null;
    // Repeated streaming usage is a snapshot, never another charge. Absent values cannot erase known ones.
    this.db.prepare(`UPDATE model_calls SET cost=COALESCE(?,cost),prompt_tokens=COALESCE(?,prompt_tokens),
      completion_tokens=COALESCE(?,completion_tokens),cached_tokens=COALESCE(?,cached_tokens),
      response_model=COALESCE(?,response_model),provider_id=COALESCE(?,provider_id) WHERE id=?`)
      .run(cost,tokens(usage.promptTokens),tokens(usage.completionTokens),tokens(usage.cachedTokens),identifier(usage.responseModel),identifier(usage.providerId),id);
  }
  costSummary():CostSummary {
    const now=new Date(this.now()),day=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),month=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1);
    const columns='COALESCE(SUM(cost),0) cost,COUNT(*) requests,COUNT(*)-COUNT(cost) unpriced';
    const total=(since:number)=>this.db.prepare(`SELECT ${columns} FROM model_calls WHERE created>=?`).get(since) as CostTotal;
    return {since:this.get('model-cost-started')!,currency:'USD',today:total(day),month:total(month),total:total(0),
      models:this.db.prepare(`SELECT model,${columns} FROM model_calls GROUP BY model ORDER BY cost DESC,model`).all() as CostSummary['models']};
  }
  take(key: string, limit: number): boolean {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    this.db.prepare(`INSERT INTO limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET day=excluded.day,
      count=CASE WHEN limits.day=excluded.day THEN limits.count+1 ELSE 1 END`).run(key,day);
    return Number(this.db.prepare('SELECT count FROM limits WHERE key=?').get(key)!.count) <= limit;
  }
  // The student's oldest unfinished job is the one being worked on.
  current(student:string) { return this.db.prepare('SELECT * FROM jobs WHERE student=? AND done=0 ORDER BY id LIMIT 1').get(student) as Job | undefined; }
  hasForeground(student:string) {return !!this.db.prepare("SELECT 1 FROM jobs WHERE student=? AND done=0 AND kind IN ('message','onboarding') LIMIT 1").get(student);}
  idle(student:string) { return !this.current(student); }
  createStudent(name:string,maxStudents=50) {
    return this.transaction(()=>{
      if(this.students().length>=maxStudents)throw Error('Student limit reached. Delete a test student first.');
      const id=randomUUID(),token=randomBytes(32).toString('hex');
      this.db.prepare('INSERT INTO students(id,name,token,created) VALUES(?,?,?,?)').run(id,name,token,new Date(this.now()).toISOString());
      this.appendMessage(id,'welcome','assistant',`Hi ${name}! I’m Protagonist. What’s one thing you’d like to work toward?`);
      return this.student(id)!;
    });
  }
  appendMessage(student:string,request:string,role:ChatMessage['role'],text:string,filename:string|null=null,bytes:Uint8Array|null=null) {
    this.db.prepare('INSERT OR IGNORE INTO messages(student,request,role,text,filename,bytes,created) VALUES(?,?,?,?,?,?,?)').run(student,request,role,text,filename,bytes,this.now());
    return Number(this.db.prepare('SELECT id FROM messages WHERE student=? AND request=? AND role=?').get(student,request,role)!.id);
  }
  messages(student:string) { return this.db.prepare('SELECT id,student,request,role,text,filename,created FROM (SELECT * FROM messages WHERE student=? ORDER BY id DESC LIMIT 300) ORDER BY id').all(student) as ChatMessage[]; }
  attachment(student:string,id:number) {return this.db.prepare("SELECT filename,bytes FROM messages WHERE student=? AND id=? AND role='file'").get(student,id) as {filename:string;bytes:Uint8Array}|undefined;}
  receiveMessage(student:string,request:string,text:string,limit=100):number {
    return this.transaction(()=>{
      const s=this.student(student);if(!s||s.disconnected||s.deleting)throw Error('Student unavailable.');
      const source=`simulator:${student}:${request}`,existing=this.db.prepare('SELECT id,text FROM jobs WHERE source=?').get(source);
      if(existing){
        const prior=this.db.prepare("SELECT text FROM messages WHERE student=? AND request=? AND role='student'").get(student,request);
        if(prior?.text!==text)throw Error('Request ID was already used for a different message.');
        return Number(existing.id);
      }
      if(!this.take(`messages:${student}`,limit))throw Error('Daily message limit reached.');
      this.db.prepare('INSERT INTO jobs(student,source,request,text,created) VALUES(?,?,?,?,?)').run(student,source,'pending',text,this.now());
      const id=Number(this.db.prepare('SELECT last_insert_rowid() id').get()!.id);
      this.db.prepare('UPDATE jobs SET request=? WHERE id=?').run(`simulator-${id}`,id);
      this.appendMessage(student,request,'student',text);
      return id;
    });
  }
  deliver(job:Job,text:string,outcome:Outcome) {
    this.transaction(()=>{
      this.appendMessage(job.student,job.request,'assistant',text);
      this.reply(job.id,text,outcome);this.sent(job.id,1);this.done(job.id,outcome,true);
    });
  }
  pending(): Job[] { return this.db.prepare(`SELECT * FROM jobs j WHERE done=0 AND retry<=? AND student IN (SELECT id FROM students WHERE deleting=0) AND NOT EXISTS
    (SELECT 1 FROM jobs earlier WHERE earlier.student=j.student AND earlier.done=0 AND earlier.id<j.id) ORDER BY id LIMIT 10`).all(this.now()) as Job[]; }
  // Store the prepared delivery payload; retries must preserve it byte for byte.
  reply(id:number, text:string, outcome:Outcome='success') { this.db.prepare('UPDATE jobs SET reply=?,outcome=?,error_code=NULL WHERE id=?').run(text,outcome,id); }
  replaceInterruptedReply(id:number,text:string) { this.db.prepare("UPDATE jobs SET reply=?,sent=0,outcome='failed' WHERE id=?").run(text,id); }
  sent(id:number, count:number) { this.db.prepare('UPDATE jobs SET sent=? WHERE id=?').run(count,id); }
  submitted(id:number) { this.db.prepare('UPDATE jobs SET submitted=CASE WHEN submitted=0 THEN ? ELSE submitted END,error_code=NULL WHERE id=?').run(this.now(),id); }
  cancelSent(id:number) { this.db.prepare('UPDATE jobs SET cancel=? WHERE id=?').run(CANCEL.sent,id); }
  // Idempotent by the tool call's request ID, so a replayed call returns the reminder it already made.
  addReminder(student:string,request:string,at:number,zone:string,note:string,goal:string|null,daily=40):Reminder|string {
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM reminders WHERE student=? AND request=?').get(student,request) as Reminder|undefined;
      if(existing)return existing;
      if(this.reminders(student).length>=MAX_ACTIVE_REMINDERS)return `At most ${MAX_ACTIVE_REMINDERS} reminders can be scheduled at once; cancel some first`;
      if(!this.take(`reminders:${student}`,daily))return 'Daily limit for new reminders reached';
      this.db.prepare('INSERT INTO reminders(student,request,at,zone,note,goal,created) VALUES(?,?,?,?,?,?,?)').run(student,request,at,zone,note,goal,this.now());
      return this.db.prepare('SELECT * FROM reminders WHERE student=? AND request=?').get(student,request) as Reminder;
    });
  }
  reminders(student:string) { return this.db.prepare('SELECT * FROM reminders WHERE student=? AND fired IS NULL AND cancelled IS NULL ORDER BY at').all(student) as Reminder[]; }
  cancelReminder(student:string,id:number) { return this.db.prepare('UPDATE reminders SET cancelled=? WHERE id=? AND student=? AND fired IS NULL AND cancelled IS NULL').run(this.now(),id,student).changes>0; }
  // Turn due reminders into jobs, exactly once each: marking a reminder fired and queueing its job commit together.
  fireReminders() {
    const now=this.now(),due=this.db.prepare('SELECT r.*,s.disconnected FROM reminders r JOIN students s ON s.id=r.student WHERE r.fired IS NULL AND r.cancelled IS NULL AND r.at<=? ORDER BY r.at LIMIT 50').all(now) as (Reminder&{disconnected:number})[];
    for(const r of due)this.transaction(()=>{
      const result=r.disconnected?'disconnected':now-r.at>REMINDER_GRACE?'missed':'queued';
      if(!this.db.prepare('UPDATE reminders SET fired=?,result=? WHERE id=? AND fired IS NULL AND cancelled IS NULL').run(now,result,r.id).changes||result!=='queued')return;
      const text=`[Scheduled reminder #${r.id}${r.goal?` for goal ${r.goal}`:''}, set by you for ${new Date(r.at).toISOString()} (${r.zone})]\n${r.note}`;
      this.db.prepare('INSERT OR IGNORE INTO jobs(student,source,request,kind,text,reply,created) VALUES(?,?,?,?,?,?,?)').run(r.student,`reminder:${r.id}`,`reminder-${r.id}`,'reminder',text.slice(0,8000),null,now);
    });
    return due.length;
  }
  onboarding(student:string) {
    const row=this.db.prepare('SELECT profile,submitted,job FROM onboarding WHERE student=?').get(student) as {profile:string|null;submitted:number|null;job:number|null}|undefined;
    if(!row)return {required:false,profile:null,status:'existing'};
    const job=row.job?this.db.prepare('SELECT done,outcome FROM jobs WHERE id=?').get(row.job) as {done:number;outcome:string}|undefined:undefined;
    return {required:row.submitted===null,profile:row.profile?JSON.parse(row.profile) as OnboardingProfile:null,
      status:row.submitted===null?'new':job?.done?(job.outcome==='success'?'ready':'interrupted'):'preparing'};
  }
  needsOnboarding(student:string) {return this.onboarding(student).required;}
  enableIdeas(student:string,invite=false) {
    if(this.needsOnboarding(student))return;
    this.db.prepare('INSERT OR IGNORE INTO idea_schedule(student,next_at,invite_until) VALUES(?,?,?)').run(student,this.now(),invite?this.now()+86400_000:null);
  }
  ideasStatus(student:string) {
    const row=this.db.prepare('SELECT next_at,job,last_success,failed FROM idea_schedule WHERE student=?').get(student) as {next_at:number;job:number|null;last_success:number|null;failed:number}|undefined;
    const pending=row?.job?this.db.prepare('SELECT done FROM jobs WHERE id=?').get(row.job)?.done===0:false;
    return {refreshing:pending,lastSuccess:row?.last_success??null,failed:!!row?.failed,nextRefresh:row?.next_at??null};
  }
  invalidateIdeas(student:string) {
    // A failed attempt keeps its hourly backoff even if a page continues polling.
    this.db.prepare('UPDATE idea_schedule SET next_at=MIN(next_at,?) WHERE student=? AND failed=0').run(this.now(),student);
  }
  startIdea(student:string,request:string,index:number,prompt:string,limit:number):number|string {
    return this.transaction(()=>{
      const s=this.student(student);if(!s||s.disconnected||s.deleting)return 'Account unavailable.';
      const source=`idea-choice:${student}:${request}:${index}`;
      const existing=this.db.prepare('SELECT id FROM jobs WHERE source=?').get(source);
      if(existing)return Number(existing.id);
      if(!this.take(`messages:${student}`,limit))return 'You’ve reached today’s message limit. Please try tomorrow.';
      this.db.prepare("INSERT INTO jobs(student,source,request,kind,text,created) VALUES(?,?,?,'message',?,?)").run(student,source,source,prompt,this.now());
      const id=Number(this.db.prepare('SELECT last_insert_rowid() id').get()!.id);
      this.db.prepare('UPDATE jobs SET request=? WHERE id=?').run(`idea-${id}`,id);return id;
    });
  }
  fireIdeas(student?:string) {
    for(const s of this.connected().filter(s=>!student||s.id===student)) {
      const row=this.db.prepare('SELECT next_at FROM idea_schedule WHERE student=?').get(s.id);
      if(!row||Number(row.next_at)>this.now()||!this.idle(s.id)||this.needsOnboarding(s.id))continue;
      this.transaction(()=>{
        const request=`ideas-${randomUUID()}`;
        this.db.prepare("INSERT INTO jobs(student,source,request,kind,text,created) VALUES(?,?,?,'ideas','',?)").run(s.id,request,request,this.now());
        const job=Number(this.db.prepare('SELECT last_insert_rowid() id').get()!.id);
        this.db.prepare('UPDATE idea_schedule SET job=?,next_at=? WHERE student=?').run(job,this.now()+86400_000,s.id);
      });
    }
  }
  finishIdeas(job:Job,outcome:Outcome) {
    this.transaction(()=>{
      this.done(job.id,outcome);
      this.db.prepare('UPDATE idea_schedule SET next_at=?,last_success=CASE WHEN ? THEN ? ELSE last_success END,failed=? WHERE student=? AND job=?')
        .run(this.now()+(outcome==='success'?86400_000:outcome==='cancelled'?30_000:3600_000),outcome==='success'?1:0,this.now(),outcome==='failed'?1:0,job.student,job.id);
      const row=this.db.prepare('SELECT invite_until FROM idea_schedule WHERE student=?').get(job.student);
      const s=this.student(job.student);
      if(outcome!=='success'||!s||s.disconnected||s.deleting||!row?.invite_until)return;
      if(Number(row.invite_until)>this.now()) {
        const link=this.dashboardLink(s.id,'ideas');
        const reply=`I’ve put together a few ideas for what we could work on next, ranked around what you’ve told me.\n${link}\n\nThey refresh daily as I learn more about you. You can also send /ideas any time.`;
        this.db.prepare("INSERT OR IGNORE INTO jobs(student,source,request,kind,text,reply,created) VALUES(?,?,?,'ideas-invite','/ideas',?,?)")
          .run(s.id,`ideas-invite:${s.id}`,`ideas-invite-${s.id}`,reply,this.now());
      }
      this.db.prepare('UPDATE idea_schedule SET invite_until=NULL WHERE student=?').run(s.id);
    });
  }
  completeOnboarding(student:string,profile:OnboardingProfile) {
    return this.transaction(()=>this.submitOnboarding(student,onboardingProfile(profile)));
  }
  private submitOnboarding(student:string,profile:OnboardingProfile) {
    const s=this.student(student);if(!s||s.disconnected||s.deleting)throw Error('Account unavailable.');
    if(!this.needsOnboarding(student))return this.onboarding(student);
    // A stable request ID and one transaction make repeated clicks and network retries exactly one queued plan.
    this.db.prepare('INSERT INTO jobs(student,source,request,kind,text,created) VALUES(?,?,?,?,?,?)')
      .run(student,`onboarding:${student}`,'onboarding-'+this.now(),'onboarding',JSON.stringify(profile),this.now());
    const job=Number(this.db.prepare('SELECT last_insert_rowid() id').get()!.id);
    this.db.prepare('UPDATE onboarding SET profile=?,submitted=?,job=? WHERE student=?').run(JSON.stringify(profile),this.now(),job,student);
    this.db.prepare('UPDATE students SET name=? WHERE id=?').run(profile.name,student);
    this.enableIdeas(student,true);
    return this.onboarding(student);
  }
  dashboardLink(student:string,section='') {
    const suffix=['goals','files','account','ideas'].includes(section)?section:'';
    // A fragment stays out of HTTP logs and referrers. Only the page's same-origin POST exchanges it.
    return `${this.publicUrl}/me/login#t=${this.newLogin(student)}${suffix?`&section=${suffix}`:''}`;
  }
  beginDelete(student:string) {
    this.transaction(()=>{
      this.db.prepare('UPDATE students SET deleting=1,disconnected=1 WHERE id=?').run(student);
      for(const table of ['sessions','logins'])this.db.prepare(`DELETE FROM ${table} WHERE student=?`).run(student);
    });
  }
  finishDelete(student:string) {
    this.transaction(()=>{
      if(!this.student(student)?.deleting)throw Error('Deletion was not started.');
      for(const table of ['messages','jobs','document_receipts','reminders','logins','sessions','model_calls','onboarding','idea_schedule'])
        this.db.prepare(`DELETE FROM ${table} WHERE student=?`).run(student);
      this.db.prepare('DELETE FROM limits WHERE key LIKE ?').run(`%:${student}`);
      this.db.prepare("DELETE FROM meta WHERE key LIKE 'notify-draft:%' AND json_extract(value,'$.student')=?").run(student);
      this.db.prepare('DELETE FROM students WHERE id=?').run(student);
    });
  }
  newLogin(student:string) {
    const secret=randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO logins VALUES(?,?,?,NULL)').run(digest(secret),student,this.now()+LOGIN_TTL);
    return secret;
  }
  loginStudent(secret:string) {
    if(!secret||secret.length>64)return undefined;
    return (this.db.prepare('SELECT student FROM logins WHERE hash=?').get(digest(secret)) as {student:string}|undefined)?.student;
  }
  // A link works once, before it expires, for a connected student; using it starts a session.
  redeemLogin(secret:string) {
    if(typeof secret!=='string'||secret.length>64)return undefined;
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT l.student FROM logins l JOIN students s ON s.id=l.student WHERE l.hash=? AND l.used IS NULL AND l.expires>? AND s.disconnected=0 AND s.deleting=0').get(digest(secret),this.now()) as {student:string}|undefined;
      if(!row)return undefined;
      this.db.prepare('UPDATE logins SET used=? WHERE hash=?').run(this.now(),digest(secret));
      const session=randomBytes(32).toString('base64url');
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(digest(session),row.student,this.now(),this.now()+SESSION_TTL,this.now());
      this.db.prepare('DELETE FROM logins WHERE expires<?').run(this.now()-LOGIN_TTL);
      this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now());
      return session;
    });
  }
  sessionStudent(session:string|undefined) {
    if(!session||session.length>64)return undefined;
    const row=this.db.prepare('SELECT s.* FROM sessions x JOIN students s ON s.id=x.student WHERE x.hash=? AND x.expires>? AND s.disconnected=0 AND s.deleting=0').get(digest(session),this.now()) as Student|undefined;
    if(row)this.db.prepare('UPDATE sessions SET seen=?,expires=? WHERE hash=?').run(this.now(),this.now()+SESSION_TTL,digest(session));
    return row;
  }
  endSession(session:string) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(session)); }
  usage(student:string) {
    const day=new Date(this.now()).toISOString().slice(0,10);
    return Object.fromEntries((this.db.prepare('SELECT key,count FROM limits WHERE key LIKE ? AND day=?').all(`%:${student}`,day) as {key:string;count:number}[]).map(r=>[r.key.split(':')[0],r.count]));
  }
  rescheduleReminder(student:string,id:number,at:number,zone:string) {
    return this.db.prepare('UPDATE reminders SET at=?,zone=? WHERE id=? AND student=? AND fired IS NULL AND cancelled IS NULL').run(at,zone,id,student).changes>0;
  }
  wait(id:number, ms:number) { this.db.prepare('UPDATE jobs SET retry=? WHERE id=?').run(this.now()+ms,id); }
  done(id:number, outcome?:Outcome, delivered=false) {
    this.db.prepare('UPDATE jobs SET done=1,text=\'\',reply=NULL,outcome=COALESCE(?,outcome,\'unknown\'),completed=?,delivered=?,error_code=CASE WHEN ? THEN NULL ELSE error_code END WHERE id=?')
      .run(outcome??null,this.now(),delivered?this.now():null,delivered?1:0,id);
  }
  jobError(id:number, code:'worker_unavailable'|'delivery_abandoned') {
    this.db.prepare('UPDATE jobs SET error_code=? WHERE id=?').run(code,id);
  }
  requestStop(student:string,id:number) {
    return this.db.prepare(`UPDATE jobs SET cancel=MAX(cancel,1),retry=0 WHERE id=? AND student=? AND done=0 AND reply IS NULL
      AND id=(SELECT MIN(id) FROM jobs WHERE student=? AND done=0)`).run(id,student,student).changes>0;
  }
  jobHistory(student:string) {
    return this.db.prepare(`SELECT id,kind,created,submitted,completed,delivered,outcome,error_code,attempts,retry,sent,cancel,done,
      reply IS NOT NULL AS responding FROM jobs WHERE student=? ORDER BY id DESC LIMIT 30`).all(student) as unknown as
      (Pick<Job,'id'|'kind'|'created'|'submitted'|'completed'|'delivered'|'outcome'|'error_code'|'attempts'|'retry'|'sent'|'cancel'> & {done:number;responding:number})[];
  }
  jobCounts(student?:string) {
    return this.db.prepare(`SELECT COUNT(CASE WHEN done=0 THEN 1 END) AS pending,
      COUNT(CASE WHEN done=0 AND error_code IS NOT NULL THEN 1 END) AS retrying,
      COUNT(CASE WHEN outcome='failed' AND completed>=? THEN 1 END) AS failed,
      MAX(created) AS lastActivity FROM jobs ${student?'WHERE student=?':''}`)
      .get(this.now()-86400_000,...(student?[student]:[])) as {pending:number;retrying:number;failed:number;lastActivity:number|null};
  }
  retry(job:Job) { this.db.prepare('UPDATE jobs SET attempts=attempts+1,retry=? WHERE id=?').run(this.now()+Math.min(300_000,2000*2**Math.min(job.attempts,8)),job.id); }
  close() { this.db.close(); }
}
