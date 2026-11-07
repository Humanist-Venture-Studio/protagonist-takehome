import { appendFile, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { EntryRecord } from '@earendil-works/pi-durable';
import { atomicWorkspaceText, withWorkspaceLock } from './workspace.ts';

// What a student sees of their own assistant: its personality (SOUL.md), what it remembers (MEMORY.md), their goals,
// the files it sent them, and a plain-language history. Runs in the student's worker, over their workspace only.
export const NOTES={soul:'SOUL.md',memory:'MEMORY.md'} as const;
export type Note=keyof typeof NOTES;
export const MAX_NOTE_CHARS=8000;
export const DEFAULT_SOUL=`# SOUL.md — who I am for you

I'm Protagonist, your own assistant for school and the steps around it.

- **Voice:** warm, direct and encouraging, like a friend who has already been through this. No lectures, no jargon.
- **Language:** I answer in the language you write in, and I keep Spanish and English equally natural.
- **Style:** plain text and short paragraphs. Aim for 400–600 characters when explaining; preferably at most 700 characters and 120 words. These are readability targets, never a reason to withhold a useful answer. One focused question or next action, at most three simple bullets, and no Markdown formatting. Longer plans go in a file with a short chat summary.
- **Honesty:** I say when I'm not sure, show where facts come from, and never pretend something is done when it isn't.
- **Respect:** your goals are yours. I help you decide; I don't decide for you.

You can change anything here to make me sound and act the way you like (a name, more humor, shorter answers, more Spanish).
`;
export const DEFAULT_MEMORY=`# MEMORY.md — what I remember about you

Key facts I keep so I don't ask you twice. You can correct or delete anything here.

`;
const path=(workspace:string,note:Note)=>`${workspace}/${NOTES[note]}`;
export async function ensureNotes(workspace:string) {
  for(const [note,text] of [['soul',DEFAULT_SOUL],['memory',DEFAULT_MEMORY]] as const)
    await writeFile(path(workspace,note),text,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
}
export async function readNote(workspace:string,note:Note) {
  const text=await readFile(path(workspace,note),'utf8').catch(()=>'');
  return text.length>MAX_NOTE_CHARS?text.slice(0,MAX_NOTE_CHARS)+'\n[…]':text;
}
export async function writeNote(workspace:string,note:Note,text:string,token:string) {
  if(typeof text!=='string'||text.length>MAX_NOTE_CHARS)throw new Error(`Keep ${NOTES[note]} under ${MAX_NOTE_CHARS} characters.`);
  if(text.includes(token))throw new Error('That text cannot be saved.');
  await withWorkspaceLock(workspace,async()=>{
    if(note==='memory')await atomicWorkspaceText(workspace,'.protagonist/memory-edited',new Date().toISOString());
    await atomicWorkspaceText(workspace,NOTES[note],text.replace(/\r\n/g,'\n'));
  });
}

// Files prepared for the student or delivered with send_file; retain the existing ledger for compatibility.
const ledger=(workspace:string)=>`${workspace}/.protagonist/delivered.jsonl`;
export async function recordSavedFile(workspace:string,file:{name:string;path:string;caption?:string}) {
  await mkdir(`${workspace}/.protagonist`,{recursive:true});
  await appendFile(ledger(workspace),JSON.stringify({...file,at:new Date().toISOString()})+'\n');
}
export const recordDelivery=recordSavedFile;
export async function deliveredFiles(workspace:string) {
  const lines=(await readFile(ledger(workspace),'utf8').catch(()=>'')).split('\n').filter(Boolean);
  const seen=new Set<string>(),files:{name:string;path:string;caption?:string;at:string;size:number}[]=[];
  for(const line of lines.reverse()) {
    let item:{name:string;path:string;caption?:string;at:string};try{item=JSON.parse(line);}catch{continue;}
    if(seen.has(item.path))continue;seen.add(item.path);
    const info=await stat(item.path).catch(()=>undefined);
    if(info?.isFile())files.push({...item,size:info.size});
    if(files.length>=50)break;
  }
  return files;
}

// A bounded listing of the upload folders; downloads still use workspaceFile's descriptor-based checks.
export async function uploadedFiles(workspace:string) {
  const root=resolve(workspace),dir=`${root}/uploads`;
  if(!(await realpath(dir).catch(()=>'' )).startsWith(root+sep))return [];
  const folders=(await readdir(dir,{withFileTypes:true}).catch(()=>[])).filter(d=>d.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true})).slice(0,100);
  const files:{name:string;path:string;at:string;size:number}[]=[];
  for(const folder of folders) {
    const base=`${dir}/${folder.name}`;
    if(!(await realpath(base).catch(()=>'' )).startsWith(root+sep))continue;
    for(const item of (await readdir(base,{withFileTypes:true}).catch(()=>[])).slice(0,30)) {
      if(!item.isFile())continue;
      const path=`${base}/${item.name}`,real=await realpath(path).catch(()=>'');
      if(!real.startsWith(root+sep))continue;
      const info=await stat(path).catch(()=>undefined);
      if(info?.isFile())files.push({name:item.name,path:`uploads/${folder.name}/${item.name}`,at:info.mtime.toISOString(),size:info.size});
    }
    if(files.length>=50)break;
  }
  return files.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,50);
}

// A summary of each goal file: the outcome, status, deadlines, and the first step that is not finished.
export async function goals(workspace:string) {
  const dir=`${workspace}/goals`,names=(await readdir(dir).catch(()=>[] as string[])).filter(n=>n.endsWith('.md')).sort();
  const out=[];
  for(const name of names) {
    const text=await readFile(`${dir}/${name}`,'utf8').catch(()=>'');
    const front=text.match(/^---\n([\s\S]*?)\n---/)?.[1]||'';
    const field=(key:string)=>front.match(new RegExp(`^${key}:\\s*(.+)$`,'m'))?.[1]?.trim();
    const deadlines=[...front.matchAll(/-\s*what:\s*(.+)\n\s*date:\s*(\S+)/g)].map(m=>({what:m[1].trim(),date:m[2].trim()}));
    const rows=text.split('\n').filter(l=>/^\|\s*\d+\s*\|/.test(l)).map(l=>l.split('|').slice(1,-1).map(c=>c.trim()));
    // Columns as the goal-planning skill writes them: # | Step | Owner | Depends on | Effort | Target | Status | Reminder | Done when
    const steps=rows.map(r=>({n:Number(r[0]),step:r[1]||'',owner:r[2]||'',target:r[5]||'',status:(r[6]||'').toLowerCase()}));
    const next=steps.find(s=>!['completed','skipped','done'].includes(s.status))||null;
    out.push({slug:name.replace(/\.md$/,''),goal:field('goal')||name,status:field('status')||'active',updated:field('updated')||null,target:field('target')||null,deadlines,
      steps:{total:steps.length,done:steps.filter(s=>s.status==='completed'||s.status==='done').length},next});
  }
  return out;
}

// The conversation in plain words: what the student said, what the assistant answered, and what it did, without
// commands, tool output or reasoning.
type Item={who:'student'|'assistant'|'action'|'reminder';text:string;at?:string};
const text=(content:unknown)=>typeof content==='string'?content:Array.isArray(content)?content.filter((p:{type?:string})=>p?.type==='text').map((p:{text?:string})=>p.text||'').join('\n'):'';
function describe(name:string,args:Record<string,unknown>):string {
  switch(name) {
    case 'send_file':return `Sent you ${String(args.path||'a file').split('/').pop()}`;
    case 'inspect_pdf_form':return 'Checked the fields in your PDF form';
    case 'fill_pdf_form':return 'Worked on filling your PDF form';
    case 'send_message':return 'Sent you a progress update';
    case 'get_dashboard_link':return 'Prepared your dashboard link';
    case 'schedule_reminder':return `Scheduled a reminder for ${String(args.local||'').replace('T',' at ')}`;
    case 'cancel_reminder':return `Cancelled reminder #${args.id}`;
    case 'list_reminders':return 'Checked your reminders';
    default:return 'Worked on your files';
  }
}
export function studentActivity(entries:readonly EntryRecord[],token:string) {
  const items:Item[]=[];
  const clean=(s:string)=>s.replaceAll(token,'[hidden]').slice(0,4000);
  for(const entry of entries)for(const m of entry.model||[]) {
    const at=typeof (m as {timestamp?:number}).timestamp==='number'?new Date((m as {timestamp:number}).timestamp).toISOString():undefined;
    if(m.role==='user') {
      const t=text(m.content);if(!t||t.startsWith('The conversation history before this point was compacted'))continue;
      if(t.startsWith('[Scheduled reminder'))items.push({who:'reminder',text:clean(t.split('\n').slice(1).join(' ')||'A reminder fired'),at});
      else items.push({who:'student',text:clean(t.replace(/\n\n(?:Attachments come from the student|\[Application persistence status\])[\s\S]*$/,'')),at});
    }
    if(m.role==='assistant') {
      for(const p of m.content)if(p.type==='toolCall'){const d=describe(p.name,p.arguments as Record<string,unknown>);if(items.at(-1)?.text!==d)items.push({who:'action',text:d,at});}
      const t=text(m.content);if(t&&t.trim()!=='SKIP')items.push({who:'assistant',text:clean(t),at});
    }
  }
  return items.slice(-80);
}