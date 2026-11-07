import { mkdirSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const entries=['README.md','PROJECT.md','AGENTS.md','CLAUDE.md','package.json','package-lock.json','tsconfig.json','Dockerfile','compose.yaml','.gitignore','.dockerignore','src','web','skills','tests','scripts','docs'];
// Candidate submissions use the same source allowlist, plus their written deliverable.
if(existsSync('CRITIQUE.md')) {
  const critique=lstatSync('CRITIQUE.md');
  if(!critique.isFile()||critique.isSymbolicLink())throw Error('CRITIQUE.md must be a regular file.');
  entries.push('CRITIQUE.md');
}
function validate(path){const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error(`Refusing symlink: ${path}`);if(stat.isDirectory())for(const name of readdirSync(path)){if(name.startsWith('.')||name.endsWith('.log'))throw Error(`Unexpected hidden/runtime file: ${path}/${name}`);validate(`${path}/${name}`);}}
for(const path of entries)validate(path);
mkdirSync('dist',{recursive:true});
const result=spawnSync('tar',['-czf','dist/protagonist-takehome.tar.gz',...entries],{stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'}});
if(result.error||result.status!==0)process.exit(result.status||1);
console.log('Created dist/protagonist-takehome.tar.gz (source only; no credentials or student data).');
