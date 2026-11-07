import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,truncate,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.ts';
import {readConfig} from '../src/config.ts';
import {brokerApp} from '../src/broker.ts';
import {MAX_FILE_BYTES,workspaceFile,sendWorkspaceFile} from '../src/files.ts';

const admit=(store:Store,_id:number)=>store.createStudent('Fixture');
const upload=(request='tool-1',content='downloadable content',name='report.txt')=>{const form=new FormData();form.set('requestId',request);form.set('caption','Your file');form.set('document',new Blob([content]),name);form.set('chat_id','999');return form;};

test('workspace attachments preserve binary bytes and reject escapes, symlinks, credentials and oversized files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pv2-files-')),workspace=join(dir,'workspace');await mkdir(workspace);
  try {
    const bytes=Buffer.from([0,1,255,32,128]);await writeFile(join(workspace,'report.bin'),bytes);
    assert.deepEqual((await workspaceFile('report.bin',workspace,'secret')).content,bytes);
    await writeFile(join(dir,'outside.txt'),'private');
    await symlink(join(dir,'outside.txt'),join(workspace,'link'));
    await symlink(dir,join(workspace,'parent'));
    for(const path of ['../outside.txt','link','parent/outside.txt',workspace])await assert.rejects(workspaceFile(path,workspace,'secret'));
    await writeFile(join(workspace,'secret.txt'),'the runtime secret');await assert.rejects(workspaceFile('secret.txt',workspace,'secret'),/credentials/);
    await writeFile(join(workspace,'empty'),'');await assert.rejects(workspaceFile('empty',workspace,'secret'),/nonempty/);
    await truncate(join(workspace,'empty'),MAX_FILE_BYTES+1);await assert.rejects(workspaceFile('empty',workspace,'secret'),/20 MiB/);
    const delivered=await sendWorkspaceFile({path:'report.bin',workspace,token:'secret',broker:'http://fixture',requestId:'tool-1'},async(url,init)=>{
      assert.equal(url,'http://fixture/documents');const form=init!.body as FormData;
      assert.equal(form.get('requestId'),'tool-1');assert.deepEqual(Buffer.from(await (form.get('document') as File).arrayBuffer()),bytes);
      return Response.json({messageId:7});
    });assert.equal(delivered.messageId,7);
    await assert.rejects(sendWorkspaceFile({path:'report.bin',workspace,token:'secret',broker:'http://fixture',requestId:'tool-2'},async()=>Response.json({error:'Unavailable'},{status:503})),/delivery failed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

