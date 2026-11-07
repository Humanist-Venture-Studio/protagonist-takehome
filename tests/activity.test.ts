import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activitySnapshot } from '../src/activity.ts';
import { publicApp } from '../src/web.ts';
import { Store } from '../src/store.ts';
import { readConfig } from '../src/config.ts';

test('activity shows running output, bounds history, and excludes reasoning and credentials',()=>{
  const entries:any=[{id:'1',model:[{role:'assistant',content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'toolCall',id:'call',name:'bash',arguments:{command:'echo secret-token'}}]}]}];
  const snapshot=activitySnapshot(entries,{run:{taskId:'1' as any,inputs:[]},tools:[{callId:'call',name:'bash',status:'running',output:'hello secret-token'}]},'secret-token');
  assert.equal(snapshot.state,'Running tools');assert.equal(snapshot.items[0].state,'running');assert.match(snapshot.items[0].output!,/hello/);
  assert.ok(!JSON.stringify(snapshot).includes('secret-token'));assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_REASONING'));
  entries.push({id:'2',model:[{role:'toolResult',toolCallId:'call',toolName:'bash',isError:true,content:[{type:'text',text:'x'.repeat(20000)}]}]});
  const done=activitySnapshot(entries,{},'secret-token',true);assert.equal(done.state,'Idle');assert.equal(done.items[0].state,'error');assert.ok(done.items[0].output!.length<12100);assert.equal(done.truncated,true);
});

