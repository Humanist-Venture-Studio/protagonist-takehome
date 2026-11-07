import { mkdirSync, writeFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { readConfig } from './config.ts';
import { Store } from './store.ts';
import { Docker, reconcile } from './docker.ts';
import { publicApp } from './web.ts';
import { brokerApp } from './broker.ts';
import { processJob, delay } from './jobs.ts';

const config=readConfig();
const data=process.env.DATA_DIR||'data';mkdirSync(data,{recursive:true});
const store=new Store(`${data}/app.sqlite`);
const docker=new Docker(process.env.DOCKER_SOCKET||'/var/run/docker.sock');
store.publicUrl=config.publicUrl;
// The evaluator console has no production identity provider. Listen only on the
// controller's public bridge interface; workers are on a different, internal bridge.
// Binding the console to all interfaces would let an agent impersonate a localhost Host.
let publicHost=process.env.BIND_HOST||'127.0.0.1';
if(publicHost==='0.0.0.0') {
  const self=process.env.HOSTNAME||'';
  if(!/^[a-f0-9]{12,64}$/.test(self))throw Error('Public binding requires the local Compose controller.');
  const own=await docker.call<{NetworkSettings:{Networks:Record<string,{IPAddress:string}>}}>('GET',`/containers/${self}/json`);
  publicHost=own.NetworkSettings.Networks['protagonist-takehome_default']?.IPAddress;
  if(!publicHost)throw Error('Local Compose public network is missing.');
}
writeFileSync('/tmp/protagonist-public-host',publicHost);
const publicServer=serve({fetch:publicApp(store,docker,config).fetch,hostname:publicHost,port:Number(process.env.PORT||3210)});
const brokerServer=serve({fetch:brokerApp(store,config).fetch,hostname:process.env.BIND_HOST||'127.0.0.1',port:Number(process.env.BROKER_PORT||3001)});
const stop=new AbortController();
async function run() {
  let reconcileAt=0;
  while(!stop.signal.aborted) {
    if(Date.now()>reconcileAt) {
      store.expireNotificationDrafts();
      await reconcile(store,docker,config);
      reconcileAt=Date.now()+30_000;
    }
    if(config.openrouterKey)store.fireIdeas();
    if(config.features.reminders&&config.openrouterKey)store.fireReminders();
    await Promise.all(store.pending().map(job=>processJob(store,docker,config,job)));
    await delay(1000,stop.signal);
  }
}
console.log(`Student simulator: ${config.publicUrl}/simulator`);
void run().catch(()=>{console.error('Controller stopped unexpectedly');process.exit(1);});
function shutdown(){stop.abort();publicServer.close();brokerServer.close();setTimeout(()=>{store.close();process.exit(0);},1000);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
