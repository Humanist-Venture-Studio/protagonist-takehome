import { readFileSync, existsSync } from 'node:fs';

export const MAX_OUTPUT_TOKENS=8192, CONTEXT_WINDOW=65_536;
export type Features = { autoRollout:boolean; photos:boolean; reminders:boolean };
export type Limits = {messages:number; model:number; documents:number; notify:number; reminders:number};
export const DEFAULT_LIMITS:Limits={messages:100,model:300,documents:20,notify:40,reminders:40};
export type Config = {
  publicUrl:string; openrouterKey:string; model:string;
  workerImage:string; workerNetwork:string; brokerUrl:string; maxStudents:number;
  features:Features; limits:Limits;
};
export function readConfig():Config {
  const file=process.env.CONFIG_FILE||'.local/runtime.json';
  const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
  return {
    publicUrl:process.env.PUBLIC_URL||'http://localhost:3210',
    openrouterKey:saved.openrouterKey||'',model:saved.model||'meta/muse-spark-1.3',
    workerImage:'protagonist-takehome-worker:local',workerNetwork:'protagonist-takehome-students',
    brokerUrl:'http://controller:3001',maxStudents:50,
    features:{autoRollout:true,photos:true,reminders:true},limits:{...DEFAULT_LIMITS,...saved.limits},
  };
}
export function allowed(config:Config,feature:Exclude<keyof Features,'autoRollout'>,_student?:unknown) {
  return config.features[feature];
}
