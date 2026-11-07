// Finish a document: embed the Protagonist fonts and check it is safe and complete.
// Usage: node /app/skills/html-document/bin/build.mjs <draft.html> <final.html>
// Prints "OK <path> <bytes>" and writes the final file, or prints every problem and writes nothing.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { htmlProblems } from '../../../src/html.ts';
const [draft,final]=process.argv.slice(2);
if(!draft||!final){console.error('Usage: build.mjs <draft.html> <final.html>');process.exit(2);}
const fonts=readFileSync(new URL('../fonts/fonts.css',import.meta.url),'utf8');
let html=readFileSync(draft,'utf8');
const block=`<style>\n${fonts}</style>`;
html=html.includes('<!--protagonist:fonts-->')?html.replace('<!--protagonist:fonts-->',block):html.replace(/<\/head>/i,`${block}\n</head>`);
const problems=htmlProblems(html);
if(problems.length){console.log('NOT BUILT. Fix these in the draft and run again:\n- '+problems.join('\n- '));process.exit(1);}
writeFileSync(final+'.tmp',html);renameSync(final+'.tmp',final);
console.log(`OK ${final} ${Buffer.byteLength(html)} bytes. Now deliver it with send_file.`);
