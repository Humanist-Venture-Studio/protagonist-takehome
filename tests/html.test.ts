import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { htmlProblems, documentProblem } from '../src/html.ts';
import { Store } from '../src/store.ts';
import { readConfig } from '../src/config.ts';
import { brokerApp } from '../src/broker.ts';

const page=(body:string,head='')=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>T</title>${head}</head><body><h1>Title</h1>${body}</body></html>`;
const build=(file:string)=>{
  const dir=mkdtempSync(join(tmpdir(),'pv2-doc-')),out=join(dir,'out.html');
  try {execFileSync(process.execPath,['skills/html-document/bin/build.mjs',file,out]);return readFileSync(out,'utf8');}
  finally {rmSync(dir,{recursive:true,force:true});}
};

test('the template and the plan example build into passive, complete documents with fonts embedded',()=>{
  for(const file of ['skills/html-document/template.html','skills/html-document/examples/goal-plan.es.html']) {
    assert.deepEqual(htmlProblems(readFileSync(file,'utf8')),[]);
    const built=build(file);assert.deepEqual(htmlProblems(built),[]);
    assert.match(built,/font-family: 'Anton'/);assert.ok(!built.includes('fonts.gstatic.com'));assert.ok(!built.includes('<!--protagonist:fonts-->'));
  }
});

test('anything that runs, loads remotely, submits or redirects is refused with a reason',()=>{
  const bad:[string,string,RegExp][]=[
    ['<script>alert(1)</script>','',/<script>/],
    ['<SCRIPT SRC=//x.example/a.js></SCRIPT>','',/<script>/],
    ['<img src=x onerror=alert(1)>','',/onerror|Images must/],
    ['<div onclick="x()">a</div>','',/onclick/],
    ['<a href="javascript:alert(1)">a</a>','',/Links must/],
    ['<a href=" JaVaScRiPt:alert(1)">a</a>','',/Links must/],
    ['<a href="report.pdf">a</a>','',/Links must/],
    ['<img src="https://tracker.example/p.gif">','',/Images must/],
    ['<img src="data:image/svg+xml;base64,PHN2Zz4=">','',/Images must/],
    ['<iframe src="https://example.com"></iframe>','',/<iframe>/],
    ['<form action="https://x.example"><input name=a></form>','',/<form>|<input>/],
    ['<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>','',/Links must/],
    ['<svg><use href="https://x.example/s.svg#a"/></svg>','',/may only point inside/],
    ['<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>','',/<animate>/],
    ['<svg><foreignObject><p>x</p></foreignObject></svg>','',/foreignobject/],
    ['<template><script>x</script></template>','',/<script>/],
    ['<p style="background:url(https://x.example/a.png)">a</p>','',/CSS url/],
    ['','<style>@import url(https://fonts.example/a.css);</style>',/@import/],
    ['','<style>p{background:u\\72l(https://x.example/a)}</style>',/CSS url/],
    ['','<link rel="stylesheet" href="https://x.example/a.css">',/<link>/],
    ['','<meta http-equiv="refresh" content="0;url=https://x.example">',/http-equiv/],
    ['','<base href="https://x.example/">',/<base>/],
    ['<video src="https://x.example/v.mp4"></video>','',/<video>/],
    ['<img srcset="https://x.example/a.png 1x">','',/srcset|Images must/],
  ];
  for(const [body,head,reason] of bad) {
    const problems=htmlProblems(page(body,head));
    assert.ok(problems.some(p=>reason.test(p)),`${body||head} → ${JSON.stringify(problems)}`);
  }
  assert.deepEqual(htmlProblems(page('<a href="https://example.edu">ok</a><a href="#s1">1</a><a href="mailto:a@example.edu">m</a><img alt="" src="data:image/png;base64,iVBORw0KGgo=">','<style>@font-face{src:url(data:font/woff2;base64,AAAA)}</style>')),[]);
});

test('structure is required so documents open well on phones',()=>{
  const problems=htmlProblems('<html><body><h1>a</h1><h1>b</h1></body></html>');
  for(const reason of [/doctype/,/language/,/charset/,/viewport/,/<title>/,/exactly one <h1> \(found 2\)/])assert.ok(problems.some(p=>reason.test(p)),String(reason));
});

test('file names and sniffed content decide what is checked at delivery',()=>{
  assert.equal(documentProblem('notes.txt',Buffer.from('<script>plain text is fine</script>')),undefined);
  assert.match(documentProblem('report.html',Buffer.from('<p>no structure</p>'))!,/^HTML not accepted/);
  assert.match(documentProblem('report.txt',Buffer.from('<!DOCTYPE html><script>x</script>'))!,/<script>/);
  assert.match(documentProblem('chart.svg',Buffer.from('<svg/>'))!,/can run code/);
  assert.equal(documentProblem('report.html',Buffer.from(readFileSync('skills/html-document/template.html'))),undefined);
});

test('the broker refuses unsafe HTML uploads with the reason, before using the daily quota',async()=>{
  const store=new Store(':memory:');store.createStudent('Fixture');
  const token=store.students()[0].token;let sends=0;
  const app=brokerApp(store,readConfig(),async()=>{sends++;return Response.json({ok:true,result:{message_id:sends}});});
  const upload=(name:string,content:string,id:string)=>{const form=new FormData();form.set('requestId',id);form.set('document',new Blob([content]),name);return app.request('/documents',{method:'POST',headers:{authorization:`Bearer ${token}`},body:form});};
  const refused=await upload('report.html',page('<script>steal()</script>'),'tool-1');
  assert.equal(refused.status,400);assert.match((await refused.json()).error,/<script> is not allowed/);assert.equal(sends,0);
  assert.equal((await upload('report.html',page('<p>Safe</p>'),'tool-2')).status,200);assert.equal(sends,0);assert.equal(store.messages(store.students()[0].id).at(-1)?.role,'file');
  store.close();
});
