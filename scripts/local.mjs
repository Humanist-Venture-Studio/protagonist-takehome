import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const run=(...args)=>{const r=spawnSync('docker',args,{stdio:'inherit'});if(r.error||r.status!==0)process.exit(r.status||1);};
const action=process.argv[2]||'start';
if(action==='start'){
  await import('./setup.mjs');
  run('build','--target','worker','-t','protagonist-takehome-worker:local','.');
  run('compose','up','-d','--build','--wait');
  console.log('Open http://localhost:3210/simulator (student chat) or http://localhost:3210/admin/ (inspection).');
}else if(action==='restart')run('compose','up','-d','--force-recreate','--wait');
else if(action==='stop'){
  run('compose','stop');
  const listed=spawnSync('docker',['ps','-q','--filter','label=app=protagonist-takehome','--filter','label=role=student'],{encoding:'utf8'});
  if(listed.status!==0)process.exit(listed.status||1);
  const ids=listed.stdout.trim().split(/\s+/).filter(Boolean);if(ids.length)run('stop',...ids);
}else if(action==='test'){
  run('build','--target','base','-t','protagonist-takehome-test:local','.');
  run('run','--rm','--network','none','--mount',`type=bind,source=${process.cwd()}/tests,target=/app/tests,readonly`,'protagonist-takehome-test:local','node','--test',...readdirSync('tests').filter(n=>n.endsWith('.test.ts')).map(n=>'tests/'+n));
}else throw Error('Unknown local action');
