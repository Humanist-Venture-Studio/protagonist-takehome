import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
mkdirSync('.local',{recursive:true});
if(!existsSync('.local/runtime.json'))writeFileSync('.local/runtime.json',JSON.stringify({openrouterKey:'',model:'meta/muse-spark-1.3'},null,2)+'\n',{mode:0o600});
chmodSync('.local/runtime.json',0o600);
console.log('Local configuration ready at .local/runtime.json. Add your OpenRouter key there; never commit it.');
