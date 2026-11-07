import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareInput, type AdmittedInput, type InputContent } from '../src/admission.ts';
import { ContextPersistence } from '../src/persistence.ts';
import { ensureNotes, readNote, writeNote } from '../src/dashboard.ts';

const signal=()=>new AbortController().signal;
const input=():AdmittedInput=>({
  requestId:'simulator-32',input:'I live in Exampleville.',content:'I live in Exampleville.',
});
const immediate=async()=>{};
async function manifest(run:(file:string,save:(value:AdmittedInput)=>Promise<void>,load:()=>Promise<AdmittedInput>)=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),'pv2-admission-')),file=join(directory,'pending-input.json');
  try {
    await run(file,value=>writeFile(file,JSON.stringify(value),{mode:0o600}),async()=>JSON.parse(await readFile(file,'utf8')));
  } finally {await rm(directory,{recursive:true,force:true});}
}

test('temporary capture failures retry before submitting the original request once',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted=input(),submitted:{requestId:string;content:InputContent}[]=[],reported:{stage:string;attempt:number}[]=[];
    let captures=0,failed=0;
    await save(admitted);
    const result=await prepareInput(admitted,{
      save,wait:immediate,
      capture:async(requestId,message)=>{
        captures++;
        assert.equal(requestId,admitted.requestId);assert.equal(message,admitted.input);
        assert.equal((await load()).captureAttempts,captures,'persist the attempt before calling the provider');
        if(captures<3)throw Error('Synthetic extraction failure');
        return {cancelled:false,notice:'Durable facts were saved to MEMORY.md.'};
      },
      fail:async()=>{failed++;},
      submit:async(requestId,content)=>{
        assert.deepEqual((await load()).capture,{notice:'Durable facts were saved to MEMORY.md.',failed:false});
        submitted.push({requestId,content});
      },
      report:(stage,attempt)=>reported.push({stage,attempt}),
    },signal());
    assert.equal(result,'submitted');assert.equal(captures,3);assert.equal(failed,0);
    assert.equal(submitted.length,1);assert.equal(submitted[0].requestId,'simulator-32');
    assert.match(String(submitted[0].content),/^I live in Exampleville\./);
    assert.match(String(submitted[0].content),/\[Application persistence status\]/);
    assert.match(String(submitted[0].content),/Durable facts were saved/);
    assert.deepEqual(reported,[{stage:'capture',attempt:1},{stage:'capture',attempt:2}]);
  });
});

test('a failed Pi submission preserves verified capture and attachment content across restart',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted:AdmittedInput={
      requestId:'simulator-33',input:'Please read this letter.',
      recent:[{role:'assistant',text:'What would you like to study?'}],
      content:[{type:'text',text:'Please read this letter.\nExtracted letter: ATTACHMENT_MARKER'},
        {type:'image',data:'synthetic-base64-image',mimeType:'image/png'}],
    };
    let captures=0,failed=0,submissions=0;
    const delivered:InputContent[]=[];
    const deps={
      save,wait:immediate,
      capture:async()=>{
        captures++;return {cancelled:false,notice:'No new durable facts were recorded.'};
      },
      fail:async()=>{failed++;},
      submit:async(_requestId:string,content:InputContent)=>{
        submissions++;
        assert.equal((await load()).capture?.failed,false);
        if(submissions===1)throw Error('Synthetic Pi storage interruption');
        delivered.push(content);
      },
      report:()=>{},
    };
    await save(admitted);
    await assert.rejects(prepareInput(admitted,deps,signal()),/Synthetic Pi storage interruption/);
    assert.equal(captures,1);assert.equal(failed,0,'Pi admission failure must not invalidate verified file saves');
    const reopened=await load();
    assert.deepEqual(reopened.content,admitted.content,'the manifest retains the upload-bearing original');
    assert.deepEqual(reopened.recent,admitted.recent,'the pending request retains its original clarification context');
    assert.equal(await prepareInput(reopened,deps,signal()),'submitted');
    assert.equal(captures,1,'restart reuses completed capture instead of calling the provider again');
    assert.equal(failed,0);assert.equal(delivered.length,1);
    const parts=delivered[0];
    assert.ok(Array.isArray(parts));assert.equal(parts.length,2);
    assert.deepEqual(parts[1],{type:'image',data:'synthetic-base64-image',mimeType:'image/png'});
    assert.equal(parts[0].type,'text');
    assert.equal((parts[0] as {text:string}).text.match(/ATTACHMENT_MARKER/g)?.length,1);
    assert.equal((parts[0] as {text:string}).text.match(/\[Application persistence status\]/g)?.length,1);
  });
});

test('exhausted capture retries preserve the original message for assistant verification',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted=input();let captures=0,failed=0,submissions=0;
    await save(admitted);
    const result=await prepareInput(admitted,{
      save,wait:immediate,
      capture:async()=>{captures++;throw Error('Synthetic persistent extraction failure');},
      fail:async requestId=>{assert.equal(requestId,'simulator-32');assert.equal(captures,3);failed++;},
      submit:async(requestId,content)=>{
        submissions++;assert.equal(requestId,'simulator-32');
        const persisted=await load();
        assert.equal(persisted.capture?.failed,true);
        assert.ok(persisted.capture?.notice);
        assert.ok(typeof content==='string'&&content.startsWith(admitted.input));
        assert.ok(typeof content==='string'&&content.includes(persisted.capture!.notice));
        assert.match(persisted.capture!.notice,/couldn.t|could not|unable|failed|unavailable/i);
        assert.match(persisted.capture!.notice,/verif|read|check/i,'the main assistant must verify files before claiming a save');
      },
      report:()=>{},
    },signal());
    assert.equal(result,'submitted');assert.equal(captures,3);assert.equal(failed,1);assert.equal(submissions,1);
    const reopened=await load();
    await prepareInput(reopened,{
      save,wait:immediate,
      capture:async()=>{throw Error('A persisted capture decision must not be recomputed');},
      fail:async()=>{throw Error('A persisted failure receipt must not be recreated');},
      submit:async()=>{submissions++;},report:()=>{},
    },signal());
    assert.equal(submissions,2,'Pi request IDs handle retries of the same preserved input');
  });
});

test('a restart retains the bounded capture budget instead of starting three new attempts',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted={...input(),captureAttempts:2};let captures=0,failed=0;
    await save(admitted);
    assert.equal(await prepareInput(await load(),{
      save,wait:immediate,
      capture:async()=>{captures++;throw Error('Synthetic final capture failure');},
      fail:async()=>{failed++;},submit:async()=>{},report:()=>{},
    },signal()),'submitted');
    assert.equal(captures,1);assert.equal(failed,1);
    assert.equal((await load()).captureAttempts,3);
  });
});

test('an unsuccessful failure receipt prevents admission until it can be persisted',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted={...input(),captureAttempts:3};let submissions=0,captures=0;
    await save(admitted);
    await assert.rejects(prepareInput(admitted,{
      save,wait:immediate,
      capture:async()=>{captures++;return {cancelled:false,notice:''};},
      fail:async()=>{throw Error('Synthetic journal write failure');},
      submit:async()=>{submissions++;},report:()=>{},
    },signal()),/Synthetic journal write failure/);
    assert.equal(captures,0);assert.equal(submissions,0);
    assert.equal((await load()).capture,undefined);
    assert.equal(await prepareInput(await load(),{
      save,wait:immediate,
      capture:async()=>{captures++;return {cancelled:false,notice:''};},
      fail:async()=>{},submit:async()=>{submissions++;},report:()=>{},
    },signal()),'submitted');
    assert.equal(captures,0);assert.equal(submissions,1);
  });
});

test('failure to persist an attempt leaves the durable input available without calling capture or Pi',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted=input();let captures=0,submissions=0;
    await save(admitted);
    await assert.rejects(prepareInput(admitted,{
      save:async()=>{throw Error('Synthetic manifest write failure');},wait:immediate,
      capture:async()=>{captures++;return {cancelled:false,notice:''};},
      fail:async()=>{throw Error('No capture attempt was made');},
      submit:async()=>{submissions++;},report:()=>{},
    },signal()),/Synthetic manifest write failure/);
    assert.equal(captures,0);assert.equal(submissions,0);
    assert.deepEqual(await load(),input());
  });
});

test('a cancelled capture is never submitted or converted into a capture failure',async()=>{
  const admitted=input();let submitted=0,failed=0;
  const result=await prepareInput(admitted,{
    save:async()=>{},wait:immediate,
    capture:async()=>({cancelled:true,notice:''}),
    fail:async()=>{failed++;},submit:async()=>{submitted++;},report:()=>{},
  },signal());
  assert.equal(result,'cancelled');assert.equal(submitted,0);assert.equal(failed,0);
  assert.equal(admitted.capture,undefined);
});

test('an abort between capture attempts prevents a retry and assistant submission',async()=>{
  const admitted=input(),controller=new AbortController();let captures=0,failed=0,submitted=0;
  const result=prepareInput(admitted,{
    save:async()=>{},
    wait:async()=>{controller.abort();},
    capture:async()=>{captures++;throw Error('Synthetic temporary failure');},
    fail:async()=>{failed++;},submit:async()=>{submitted++;},report:()=>{},
  },controller.signal);
  await result.catch(error=>{assert.equal(error.name,'AbortError');});
  assert.equal(captures,1);assert.equal(failed,0);assert.equal(submitted,0);
});

test('capture and submission diagnostics expose only fixed categories, never error contents',async()=>{
  const admitted=input(),reports:unknown[][]=[];
  const privateDetail='synthetic-private-student-text synthetic-provider-key /data/private-file';
  let captures=0;
  await assert.rejects(prepareInput(admitted,{
    save:async()=>{},wait:immediate,
    capture:async()=>{
      if(++captures===1)throw Error(privateDetail);
      return {cancelled:false,notice:''};
    },
    fail:async()=>{},
    submit:async()=>{throw Error(privateDetail);},
    report:(...fields)=>reports.push(fields),
  },signal()),error=>error instanceof Error&&error.message===privateDetail);
  assert.deepEqual(reports,[
    ['capture',1,'capture_validation_or_storage'],
    ['submission',0,'admission_unavailable'],
  ]);
  for(const value of ['synthetic-private-student-text','synthetic-provider-key','/data/private-file',admitted.input])
    assert.ok(!JSON.stringify(reports).includes(value));
});

for(const change of ['dashboard edit','cancellation'] as const)test(`cached capture respects ${change} before retrying Pi admission`,async()=>{
  await manifest(async(file,save,load)=>{
    const workspace=`${file}.workspace`;await mkdir(workspace);await ensureNotes(workspace);
    const admitted=input();let extracts=0,submissions=0;
    const persistence=new ContextPersistence(workspace,async()=>{
      extracts++;
      return {facts:[{key:'location',value:'Exampleville',evidence:admitted.input,source:'message',replaces:[],keep:[]}],goals:[]};
    },'fixture-only-credential',()=>new Date('2026-10-20T15:00:00Z'));
    const deps={
      save,wait:immediate,
      capture:persistence.capture.bind(persistence),
      verify:persistence.verify.bind(persistence),
      fail:persistence.fail.bind(persistence),
      submit:async(_requestId:string,_content:InputContent)=>{submissions++;throw Error('Synthetic Pi interruption');},
      report:()=>{},
    };
    await save(admitted);
    await assert.rejects(prepareInput(admitted,deps,signal()),/Synthetic Pi interruption/);
    assert.equal(extracts,1);assert.equal(submissions,1);
    assert.match(await readNote(workspace,'memory'),/Exampleville/);
    assert.equal((await load()).capture?.failed,false);
    const corrected='# MEMORY.md\n\n- Location removed by the student.\n';
    if(change==='dashboard edit')await writeNote(workspace,'memory',corrected,'fixture-only-credential');
    else await persistence.cancel(admitted.requestId);
    const recovered=new ContextPersistence(workspace,async()=>{
      throw Error('A cached decision must never re-extract the original message');
    },'fixture-only-credential');
    let delivered:InputContent|undefined;
    const result=await prepareInput(await load(),{
      ...deps,
      capture:recovered.capture.bind(recovered),
      verify:recovered.verify.bind(recovered),
      submit:async(_requestId,content)=>{submissions++;delivered=content;},
    },signal());
    assert.equal(extracts,1);
    if(change==='dashboard edit') {
      assert.equal(result,'submitted');assert.equal(submissions,2);
      assert.equal(await readNote(workspace,'memory'),corrected);
      assert.match(String(delivered),/newer workspace edit/i);
      assert.doesNotMatch(String(delivered),/Durable facts were saved/);
      assert.ok(String(delivered).startsWith(admitted.input),'preserve the input while replacing only its stale status');
    } else {
      assert.equal(result,'cancelled');assert.equal(submissions,1);assert.equal(delivered,undefined);
    }
  });
});

test('failed verification of a cached capture keeps the original input pending',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted={...input(),captureAttempts:1,capture:{notice:'Saved earlier.',failed:false}};
    let submissions=0;
    await save(admitted);
    await assert.rejects(prepareInput(await load(),{
      save,wait:immediate,
      capture:async()=>{throw Error('A cached decision must not be re-extracted');},
      verify:async()=>{throw Error('Synthetic verification read failure');},
      fail:async()=>{throw Error('A verification failure cannot invalidate the saved capture');},
      submit:async()=>{submissions++;},report:()=>{},
    },signal()),/Synthetic verification read failure/);
    assert.equal(submissions,0);assert.deepEqual(await load(),admitted);
  });
});

test('a durable cancellation blocks a cached failed capture before saving or admitting anything',async()=>{
  await manifest(async(file,save,load)=>{
    const workspace=`${file}.workspace`;await mkdir(workspace);await ensureNotes(workspace);
    const admitted={...input(),captureAttempts:3,capture:{notice:'Automatic capture could not be verified.',failed:true}};
    await save(admitted);
    const persistence=new ContextPersistence(workspace,async()=>{throw Error('Cancelled input must not be extracted');});
    await persistence.fail(admitted.requestId);
    assert.equal(await persistence.isCancelled(admitted.requestId),false);
    await persistence.cancel(admitted.requestId);
    const reopened=new ContextPersistence(workspace,async()=>{throw Error('Cancelled input must not be extracted after restart');});
    const unexpected: string[]=[];
    const called=async(name:string)=>{unexpected.push(name);throw Error(`Unexpected ${name}`);};
    assert.equal(await prepareInput(await load(),{
      cancelled:reopened.isCancelled.bind(reopened),
      save:async()=>called('save'),capture:async()=>called('capture'),verify:async()=>called('verify'),
      fail:async()=>called('fail'),submit:async()=>called('submit'),
      report:()=>{unexpected.push('report');},
    },signal()),'cancelled');
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(await load(),admitted,'the worker owns cleanup after observing cancellation');
  });
});

test('a cancellation receipt read failure prevents saving, capture, and Pi admission',async()=>{
  await manifest(async(_file,save,load)=>{
    const admitted={...input(),captureAttempts:3,capture:{notice:'Automatic capture could not be verified.',failed:true}};
    await save(admitted);
    const unexpected:string[]=[];
    const called=async(name:string)=>{unexpected.push(name);throw Error(`Unexpected ${name}`);};
    await assert.rejects(prepareInput(await load(),{
      cancelled:async()=>{throw Error('Synthetic cancellation receipt read failure');},
      save:async()=>called('save'),capture:async()=>called('capture'),verify:async()=>called('verify'),
      fail:async()=>called('fail'),submit:async()=>called('submit'),
      report:()=>{unexpected.push('report');},
    },signal()),/Synthetic cancellation receipt read failure/);
    assert.deepEqual(unexpected,[]);assert.deepEqual(await load(),admitted);
  });
});
