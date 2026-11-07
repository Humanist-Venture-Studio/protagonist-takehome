import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pdfLib from 'pdf-lib';
import { fillWorkspaceForm, inspectWorkspaceForm } from '../src/form-tools.ts';
import { deliveredFiles } from '../src/dashboard.ts';
import { sendWorkspaceFile } from '../src/files.ts';
import { inspectForm, verifyForm, type Value } from '../src/forms.ts';

async function fixture(workspace:string) {
  const doc=await pdfLib.PDFDocument.create(),page=doc.addPage(),form=doc.getForm();
  for(const [i,key] of ['name','email','program'].entries()) {
    const f=form.createTextField(key);f.enableRequired();f.addToPage(page,{x:50,y:700-i*50,width:220,height:20});
  }
  const consent=form.createCheckBox('consent');consent.enableRequired();consent.addToPage(page);
  const bytes=Buffer.from(await doc.save());await writeFile(join(workspace,'original.pdf'),bytes);
  return bytes;
}

test('a verified PDF is in Files before delivery, survives failures, and retries reuse the copy',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pv2-form-tool-')),workspace=join(dir,'student-a'),other=join(dir,'student-b');
  await mkdir(workspace);await mkdir(other);
  const context={workspace,token:'synthetic-worker-token'},values={name:'María Núñez',email:'maria@example.edu',program:'Nursing'};
  try {
    const original=await fixture(workspace);
    const info=await inspectWorkspaceForm(context,'original.pdf');assert.equal(info.supported,true);assert.equal(info.fields.length,4);
    const result=await fillWorkspaceForm(context,{path:'original.pdf',values,filename:'application-filled.pdf'});
    assert.equal(result.status,'saved');if(result.status!=='saved')throw Error('Expected saved PDF');
    assert.equal(result.verified,true);assert.deepEqual(result.report.blankRequired,['consent']);
    assert.deepEqual(await verifyForm(await readFile(result.path),values),{ok:true,mismatches:[]});
    assert.equal((await inspectForm(await readFile(result.path))).fields.length,4,'completed copy stays editable');
    assert.deepEqual(await readFile(join(workspace,'original.pdf')),original,'original is untouched');
    assert.deepEqual((await deliveredFiles(workspace)).map(f=>f.path),[result.path]);
    assert.deepEqual(await deliveredFiles(other),[],'other students cannot see the saved copy');
    await assert.rejects(inspectWorkspaceForm({workspace:other,token:context.token},result.path),/workspace/);
    await assert.rejects(sendWorkspaceFile({...context,path:result.path,broker:'http://fixture',requestId:'tool-1'},async()=>Response.json({error:'Unavailable'},{status:503})),/delivery failed/);
    assert.equal((await deliveredFiles(workspace)).length,1,'delivery failure leaves the saved file indexed');
    // No in-memory receipt: reconstruct the context as a restarted worker would.
    const retried=await fillWorkspaceForm({...context},{path:'original.pdf',values:{program:values.program,email:values.email,name:values.name},filename:result.filename});
    assert.equal(retried.status,'saved');if(retried.status!=='saved')throw Error('Expected saved PDF');
    assert.equal(retried.path,result.path);assert.equal((await deliveredFiles(workspace)).length,1);
    assert.equal((await readdir(join(workspace,'forms/completed'))).length,1);
    const revised=await fillWorkspaceForm(context,{path:'original.pdf',values:{...values,program:'Business'},filename:result.filename});
    assert.equal(revised.status,'saved');if(revised.status!=='saved')throw Error('Expected saved PDF');
    assert.notEqual(revised.path,result.path);assert.equal((await deliveredFiles(workspace)).length,2,'a changed answer keeps both versions');
    await writeFile(result.path,'student edited the saved copy');
    await assert.rejects(fillWorkspaceForm(context,{path:'original.pdf',values,filename:result.filename}),/not overwritten/);
    assert.equal(await readFile(result.path,'utf8'),'student edited the saved copy');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('invalid answers and unsupported PDFs do not produce completed files; explicit blanks remain reported',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'pv2-form-errors-')),context={workspace,token:'synthetic-worker-token'};
  try {
    await fixture(workspace);
    for(const values of [{unknown:'x'},{name:true},{name:'李小龙'}] as Record<string,Value>[]) {
      const result=await fillWorkspaceForm(context,{path:'original.pdf',values});
      assert.equal(result.status,'not_filled');assert.ok(result.report.problems.length);assert.deepEqual(await deliveredFiles(workspace),[]);
    }
    const flat=await pdfLib.PDFDocument.create();flat.addPage();await writeFile(join(workspace,'flat.pdf'),await flat.save());
    assert.equal((await inspectWorkspaceForm(context,'flat.pdf')).supported,false);
    const unsupported=await fillWorkspaceForm(context,{path:'flat.pdf',values:{name:'Ana'}});
    assert.equal(unsupported.status,'not_filled');assert.match(unsupported.report.problems[0],/no fillable fields/);
    const blank=await fillWorkspaceForm(context,{path:'original.pdf',values:{name:'',consent:false,email:'a@example.edu'}});
    assert.equal(blank.status,'saved');assert.deepEqual(blank.report.blankRequired,['name','program','consent']);
    await assert.rejects(fillWorkspaceForm(context,{path:'original.pdf',values:{}}),/at least one/);
    await assert.rejects(fillWorkspaceForm(context,{path:'original.pdf',values:{name:context.token}}),/credentials/);
    await assert.rejects(fillWorkspaceForm(context,{path:'original.pdf',values:{name:'Ana'},filename:'../overwrite.pdf'}),/filename/);
    await assert.rejects(fillWorkspaceForm(context,{path:'original.pdf',values:{name:'Ana'},filename:'form.html'}),/filename/);
  }finally{await rm(workspace,{recursive:true,force:true});}
});

test('input/output symlink escapes are refused and a failed Files index is retried honestly',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pv2-form-safety-')),workspace=join(dir,'workspace'),outside=join(dir,'outside');
  await mkdir(workspace);await mkdir(outside);
  const context={workspace,token:'synthetic-worker-token'},input={path:'original.pdf',values:{name:'Ana'}};
  try {
    await fixture(workspace);await fixture(outside);
    await symlink(join(outside,'original.pdf'),join(workspace,'link.pdf'));
    await assert.rejects(inspectWorkspaceForm(context,'link.pdf'));
    await assert.rejects(fillWorkspaceForm(context,{...input,path:'../outside/original.pdf'}),/workspace/);
    await symlink(outside,join(workspace,'forms'));
    await assert.rejects(fillWorkspaceForm(context,input),/symbolic links/);
    assert.deepEqual(await readdir(outside),['original.pdf'],'not even an output directory is created outside the workspace');
    await rm(join(workspace,'forms'));
    await writeFile(join(workspace,'.protagonist'),'index blocked');
    await assert.rejects(fillWorkspaceForm(context,input));
    await rm(join(workspace,'.protagonist'));
    const recovered=await fillWorkspaceForm(context,input);
    assert.equal(recovered.status,'saved');assert.equal((await deliveredFiles(workspace)).length,1);
    assert.equal((await readdir(join(workspace,'forms/completed'))).length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
