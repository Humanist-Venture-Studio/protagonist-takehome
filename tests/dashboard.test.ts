import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store, LOGIN_TTL } from '../src/store.ts';
import { readConfig } from '../src/config.ts';
import { publicApp } from '../src/web.ts';
import { brokerApp } from '../src/broker.ts';
import { ensureNotes, readNote, writeNote, recordDelivery, deliveredFiles, goals, studentActivity, DEFAULT_SOUL } from '../src/dashboard.ts';

test('worker side: notes, delivered files, goal summaries and a plain activity feed',async()=>{
  const ws=await mkdtemp(join(tmpdir(),'pv2-dash-'));
  try {
    await ensureNotes(ws);assert.equal(await readNote(ws,'soul'),DEFAULT_SOUL);
    await writeNote(ws,'soul','# Call me Profe\r\nShort answers.','secret-token');await ensureNotes(ws);
    assert.equal(await readFile(join(ws,'SOUL.md'),'utf8'),'# Call me Profe\nShort answers.','edits survive and are never overwritten by defaults');
    await assert.rejects(writeNote(ws,'memory','x'.repeat(8001),'secret-token'),/under 8000/);await assert.rejects(writeNote(ws,'memory','my secret-token','secret-token'));
    await mkdir(join(ws,'documents'));await writeFile(join(ws,'documents/plan.html'),'<h1>x</h1>');
    await recordDelivery(ws,{name:'plan.html',path:join(ws,'documents/plan.html')});await recordDelivery(ws,{name:'gone.pdf',path:join(ws,'gone.pdf')});await recordDelivery(ws,{name:'plan.html',path:join(ws,'documents/plan.html'),caption:'v2'});
    const files=await deliveredFiles(ws);assert.equal(files.length,1);assert.equal(files[0].caption,'v2');assert.equal(files[0].size,10);
    await mkdir(join(ws,'goals'));
    await writeFile(join(ws,'goals/ecc.md'),`---\ngoal: Apply to ECC nursing for fall 2027\nstatus: active\ndeadlines:\n  - what: RN application\n    date: 2027-03-31\n    time: null\n---\n\n## Steps\n\n| # | Step | Owner | Depends on | Effort / wait | Target | Status | Reminder | Done when |\n|---|---|---|---|---|---|---|---|---|\n| 1 | Confirm requirements | Student | – | 1 h | 2026-10-24 | completed | – | x |\n| 2 | Request transcript | Student | 1 | 30 min | 2026-11-15 | ready | #1 | y |\n`);
    const [g]=await goals(ws);assert.equal(g.goal,'Apply to ECC nursing for fall 2027');assert.deepEqual(g.deadlines,[{what:'RN application',date:'2027-03-31'}]);
    assert.deepEqual(g.steps,{total:2,done:1});assert.equal(g.next!.step,'Request transcript');assert.equal(g.next!.target,'2026-11-15');
    const feed=studentActivity([
      {model:[{role:'user',content:'find schools secret-token',timestamp:1}]},
      {model:[{role:'assistant',content:[{type:'toolCall',id:'1',name:'bash',arguments:{command:'cat secret'}},{type:'toolCall',id:'2',name:'send_file',arguments:{path:'plan.txt'}}]}]},
      {model:[{role:'toolResult',toolCallId:'2',content:[{type:'text',text:'RAW TOOL OUTPUT'}]}]},
      {model:[{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE'},{type:'text',text:'Here are three options.'}]}]},
      {model:[{role:'user',content:'[Scheduled reminder #1, set by you for x (UTC)]\nRequest transcript'}]},
      {model:[{role:'assistant',content:[{type:'text',text:'SKIP'}]}]},
    ] as any,'secret-token');
    assert.deepEqual(feed.map(i=>[i.who,i.text]),[['student','find schools [hidden]'],['action','Worked on your files'],['action','Sent you plan.txt'],['assistant','Here are three options.'],['reminder','Request transcript']]);
    assert.ok(!JSON.stringify(feed).includes('RAW TOOL OUTPUT')&&!JSON.stringify(feed).includes('PRIVATE'));
  } finally {await rm(ws,{recursive:true,force:true});}
});
