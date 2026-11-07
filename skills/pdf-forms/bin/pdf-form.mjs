// Inspect, fill and verify standard fillable PDF forms.
//   node /app/skills/pdf-forms/bin/pdf-form.mjs inspect <form.pdf>
//   node /app/skills/pdf-forms/bin/pdf-form.mjs fill <form.pdf> <values.json> <filled.pdf> [--flatten <flat.pdf>]
//   node /app/skills/pdf-forms/bin/pdf-form.mjs verify <filled.pdf> <values.json>
// values.json maps field names (from inspect) to text, true/false for checkboxes, or an option for radio and dropdown fields.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { inspectForm, fillForm, verifyForm } from '../../../src/forms.ts';
const [command,...args]=process.argv.slice(2);
const save=(path,bytes)=>{writeFileSync(path+'.tmp',bytes);renameSync(path+'.tmp',path);};
// pdf-lib announces that it drops XFA; inspect already reports that more usefully.
const quiet=console.log;console.warn=console.log=(...a)=>{if(!String(a[0]).startsWith('Removing XFA'))quiet(...a);};
try {
  if(command==='inspect'&&args[0]) {
    const info=await inspectForm(readFileSync(args[0]),true);
    if(!info.supported){quiet(`NOT SUPPORTED: ${info.reason}`);process.exit(1);}
    quiet(`Fillable form: ${info.pages} page(s), ${info.fields.length} fields${info.xfa==='hybrid'?' (has an XFA layer that will be removed when filled)':''}.`);
    for(const f of info.fields)quiet(JSON.stringify({name:f.name,type:f.type,page:f.page,label:f.label!==f.name?f.label:undefined,nearby:f.nearby,options:f.options,maxLength:f.maxLength,required:f.required||undefined,readOnly:f.readOnly||undefined,value:f.value||undefined}));
  } else if(command==='fill'&&args.length>=3) {
    const flatAt=args.indexOf('--flatten'),flatPath=flatAt>=0?args[flatAt+1]:undefined;
    const values=JSON.parse(readFileSync(args[1],'utf8'));
    const {report,pdf,flat}=await fillForm(readFileSync(args[0]),values,!!flatPath);
    if(!pdf){quiet('NOT FILLED. Fix these and run again:\n- '+report.problems.join('\n- '));process.exit(1);}
    save(args[2],pdf);if(flat&&flatPath)save(flatPath,flat);
    quiet(`FILLED ${report.filled.length} field(s) into ${args[2]}${flatPath?` and a flattened copy at ${flatPath}`:''}.`);
    if(report.warnings.length)quiet('Warnings:\n- '+report.warnings.join('\n- '));
    if(report.blankRequired.length)quiet('Required fields still blank:\n- '+report.blankRequired.join('\n- '));
    quiet(`${report.blank.length} optional field(s) left blank. Now run verify, then deliver with send_file.`);
  } else if(command==='verify'&&args.length>=2) {
    const result=await verifyForm(readFileSync(args[0]),JSON.parse(readFileSync(args[1],'utf8')));
    quiet(result.ok?'VERIFIED: every value reads back exactly.':'MISMATCH:\n- '+result.mismatches.join('\n- '));process.exit(result.ok?0:1);
  } else {quiet('Usage: pdf-form.mjs inspect <pdf> | fill <pdf> <values.json> <out.pdf> [--flatten <flat.pdf>] | verify <pdf> <values.json>');process.exit(2);}
} catch(error) {quiet(`ERROR: ${error.message}`);process.exit(1);}
