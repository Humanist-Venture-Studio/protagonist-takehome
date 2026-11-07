import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { htmlToText, decodeHtml, pdfToText } from '../src/extract.ts';

const PAGE=`<!doctype html><html><head><title>Nursing A.S. | Example County College</title><script>var secret='tracking'</script></head><body>
<header><nav><a href="/">Home</a> <a href="/about">About us</a></nav></header>
<main><h1>Nursing (A.S.)</h1><p>Evening   prerequisite courses are offered.</p>
<ul><li>Anatomy</li><li>Chemistry<ul><li>Lab required</li></ul></li></ul>
<table><caption>Costs 2026–27</caption><tr><th>Item</th><th>In-county</th></tr><tr><td>Tuition</td><td>$5,140</td></tr></table>
<p>Ready? <a href="/apply/nursing">Apply now</a> or read <a href="/files/handbook.pdf">the handbook</a>. <a href="/news">News</a></p>
<p hidden>Hidden text</p></main><footer>© College · Privacy</footer></body></html>`;

test('web pages become structured text: headings, lists, tables and the links a student needs',()=>{
  const {title,text}=htmlToText(PAGE,'https://www.example.edu/nursing');
  assert.equal(title,'Nursing A.S. | Example County College');
  assert.match(text,/^# Nursing \(A\.S\.\)/m);assert.match(text,/Evening prerequisite courses are offered\./);
  assert.match(text,/^- Anatomy$/m);assert.match(text,/^  - Lab required$/m);
  assert.match(text,/Table: Costs 2026–27\n\| Item \| In-county \|\n\| --- \| --- \|\n\| Tuition \| \$5,140 \|/);
  assert.match(text,/Apply now \(https:\/\/www\.example\.edu\/apply\/nursing\)/);assert.match(text,/the handbook \(https:\/\/www\.example\.edu\/files\/handbook\.pdf\)/);
  for(const absent of ['tracking','About us','Hidden text','Privacy','/news'])assert.ok(!text.includes(absent),absent);
});

test('legacy encodings are decoded from the header or the page',()=>{
  const latin=Buffer.from('<meta charset="iso-8859-1"><p>Matr\xedcula</p>','latin1');
  assert.match(decodeHtml(latin),/Matrícula/);assert.match(decodeHtml(Buffer.from('<p>Caf\xe9</p>','latin1'),'windows-1252'),/Café/);
});

// A minimal one-page PDF with real text, built with correct cross-reference offsets.
function pdf(text:string) {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${`BT /F1 18 Tf 72 700 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 72 700 Td (${text}) Tj ET\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out='%PDF-1.4\n';const offsets:number[]=[];
  objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out,'latin1');
}
test('PDFs become text page by page, and pages without text are flagged as possible scans',async()=>{
  const result=await pdfToText(pdf('Application deadline March 15'));
  assert.equal(result.pages,1);assert.match(result.text,/## Page 1\nApplication deadline March 15/);
  assert.match((await pdfToText(pdf(''))).text,/may be a scan/);
});

