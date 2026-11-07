import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pdfLib from 'pdf-lib';
import { inspectForm, fillForm, verifyForm } from '../src/forms.ts';

const {PDFDocument,PDFName,PDFString,PDFDict,StandardFonts}=pdfLib;
console.warn=()=>{};
// A small application form with every field type, printed labels, and a tooltip on one field.
async function form(extra?:(doc:Awaited<ReturnType<typeof PDFDocument.create>>)=>void) {
  const doc=await PDFDocument.create(),page=doc.addPage([612,792]),font=await doc.embedFont(StandardFonts.Helvetica),f=doc.getForm();
  page.drawText('Legal name (as on your ID)',{x:50,y:712,size:10,font});
  const name=f.createTextField('applicant.name');name.addToPage(page,{x:50,y:690,width:220,height:18});
  page.drawText('ZIP',{x:300,y:695,size:10,font});
  const zip=f.createTextField('applicant.zip');zip.setMaxLength(5);zip.addToPage(page,{x:330,y:690,width:60,height:18});
  const essay=f.createTextField('essay');essay.enableMultiline();essay.addToPage(page,{x:50,y:500,width:500,height:120});
  page.drawText('I am a first-generation student',{x:72,y:455,size:10,font});
  f.createCheckBox('firstgen').addToPage(page,{x:50,y:452,width:14,height:14});
  const term=f.createRadioGroup('term');term.addOptionToPage('Fall',page,{x:50,y:420,width:14,height:14});term.addOptionToPage('Spring',page,{x:120,y:420,width:14,height:14});
  const program=f.createDropdown('program');program.addOptions(['Nursing','Business','Undecided']);program.addToPage(page,{x:50,y:380,width:150,height:18});
  f.getTextField('applicant.zip').acroField.dict.set(PDFName.of('TU'),PDFString.of('Home ZIP code'));
  const bytes=await doc.save();if(!extra)return bytes;
  // pdf-lib drops XFA whenever it refreshes appearances, so changes go on a reloaded copy saved without that.
  const copy=await PDFDocument.load(bytes);extra(copy);return copy.save({updateFieldAppearances:false});
}

test('inspect lists every field with type, options, limits, tooltip and the printed label beside it',async()=>{
  const info=await inspectForm(await form(),true);
  assert.equal(info.supported,true);assert.equal(info.xfa,'none');
  const by=Object.fromEntries(info.fields.map(f=>[f.name,f]));
  assert.equal(by['applicant.name'].nearby,'Legal name (as on your ID)');assert.equal(by['applicant.zip'].label,'Home ZIP code');assert.equal(by['applicant.zip'].maxLength,5);
  assert.equal(by.firstgen.type,'checkbox');assert.equal(by.firstgen.nearby,'I am a first-generation student');
  assert.deepEqual(by.term.options,['Fall','Spring']);assert.deepEqual(by.program.options,['Nursing','Business','Undecided']);assert.equal(by.program.page,1);
});

test('filling is typed and all-or-nothing, keeps accents, reports blanks, and verifies by reading back',async()=>{
  const original=await form();
  const bad=await fillForm(original,{'applicant.zip':'071020',term:'Summer',firstgen:'yes' as never,nope:'x',program:'Law'});
  assert.equal(bad.pdf,undefined,'nothing is produced when anything is wrong');
  for(const reason of [/at most 5 characters/,/one of \["Fall","Spring"\]/,/needs true or false/,/No field named "nope"/,/must be from/])assert.ok(bad.report.problems.some(p=>reason.test(p)),String(reason));
  assert.match((await fillForm(original,{'applicant.name':'李小龙'})).report.problems[0],/cannot show/);
  const values={'applicant.name':'María José Núñez-Ávila','applicant.zip':'07102',firstgen:true,term:'Fall',program:'Nursing'};
  const good=await fillForm(original,values,true);
  assert.ok(good.pdf);assert.deepEqual(good.report.problems,[]);assert.deepEqual(good.report.blank,['essay']);
  assert.deepEqual(await verifyForm(good.pdf!,values),{ok:true,mismatches:[]});
  assert.equal((await verifyForm(good.pdf!,{...values,term:'Spring'})).ok,false);
  assert.equal((await inspectForm(good.pdf!)).fields.length,6,'the filled copy stays editable');
  assert.equal((await inspectForm(good.flat!)).supported,false,'the flattened copy has no fields left');
  assert.match((await fillForm(original,{'applicant.name':'A very long legal name that will not fit in this box at all'})).report.warnings[0],/may be cut off/);
});

test('XFA-only, encrypted, signed and flat PDFs are reported as unsupported; hybrid XFA is filled via its fields',async()=>{
  const hybrid=await form(doc=>doc.catalog.lookup(PDFName.of('AcroForm'),PDFDict).set(PDFName.of('XFA'),PDFString.of('<xdp/>')));
  const h=await inspectForm(hybrid);assert.equal(h.supported,true);assert.equal(h.xfa,'hybrid');
  const filled=await fillForm(hybrid,{'applicant.name':'Ana'});assert.match(filled.report.warnings[0],/XFA layer; it was removed/);assert.equal((await inspectForm(filled.pdf!)).xfa,'none');
  const dynamic=await PDFDocument.create();dynamic.addPage();dynamic.catalog.set(PDFName.of('AcroForm'),dynamic.context.obj({Fields:[],XFA:PDFString.of('<xdp/>')}));
  assert.match((await inspectForm(await dynamic.save())).reason!,/XFA form/);
  const locked=await PDFDocument.create();locked.addPage();locked.context.trailerInfo.Encrypt=locked.context.register(locked.context.obj({Filter:'Standard'}));
  assert.match((await inspectForm(await locked.save({useObjectStreams:false}))).reason!,/encrypted/);
  const signed=await form(doc=>{
    const page=doc.getPage(0),sig=doc.context.register(doc.context.obj({FT:'Sig',T:PDFString.of('signature'),V:doc.context.obj({Type:'Sig'}),Type:'Annot',Subtype:'Widget',Rect:[50,100,250,130],P:page.ref}));
    (doc.catalog.lookup(PDFName.of('AcroForm'),PDFDict).lookup(PDFName.of('Fields')) as any).push(sig);
  });
  assert.match((await inspectForm(signed)).reason!,/already signed/);
  const flat=await PDFDocument.create();flat.addPage();assert.match((await inspectForm(await flat.save())).reason!,/no fillable fields/);
  assert.match((await inspectForm(new TextEncoder().encode('not a pdf'))).reason!,/could not be read/);
});

test('the skill script fills a form end to end and refuses mistakes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pv2-form-')),script='skills/pdf-forms/bin/pdf-form.mjs';
  try {
    writeFileSync(join(dir,'form.pdf'),await form());writeFileSync(join(dir,'values.json'),JSON.stringify({'applicant.name':'Ana Ruiz',term:'Spring'}));
    const run=(...args:string[])=>execFileSync(process.execPath,[script,...args],{encoding:'utf8'});
    assert.match(run('inspect',join(dir,'form.pdf')),/"nearby":"Legal name \(as on your ID\)"/);
    const filled=run('fill',join(dir,'form.pdf'),join(dir,'values.json'),join(dir,'filled.pdf'),'--flatten',join(dir,'flat.pdf'));
    assert.match(filled,/FILLED 2 field\(s\)/);assert.ok(!filled.includes('Removing XFA'));
    assert.match(run('verify',join(dir,'filled.pdf'),join(dir,'values.json')),/VERIFIED/);assert.ok(existsSync(join(dir,'flat.pdf')));
    writeFileSync(join(dir,'bad.json'),JSON.stringify({term:'Winter'}));
    assert.throws(()=>run('fill',join(dir,'form.pdf'),join(dir,'bad.json'),join(dir,'bad.pdf')),(e:{stdout?:string})=>/NOT FILLED/.test(e.stdout||''));assert.ok(!existsSync(join(dir,'bad.pdf')));
    assert.equal(readFileSync(join(dir,'form.pdf')).length>0,true,'the original is untouched');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
