import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { Store } from './store.ts';
import { adminApp, type AdminDocker } from './admin.ts';
import type { Config } from './config.ts';
import { studentApp } from './student.ts';
import { simulatorApp } from './simulator.ts';

export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
export function policy(html:string) {
  const hashes=(tag:string)=>[...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`,'g'))].map(m=>`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  return `default-src 'none'; script-src ${hashes('script')||"'none'"}; style-src ${hashes('style')||"'none'"}; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
}
export function publicApp(store:Store,docker:AdminDocker,config:Config,workerFetch:typeof fetch=fetch) {
  const app=new Hono();
  // This exercise deliberately has no identity provider. Serve only through a loopback host,
  // reject DNS rebinding and cross-site requests, and publish Docker ports on 127.0.0.1 only.
  app.use('*',async(c,next)=>{
    const host=new URL(c.req.url).hostname;
    if(c.req.path!=='/health'&&!['localhost','127.0.0.1','[::1]'].includes(host))return c.json({error:'Local access only'},403);
    const origin=c.req.header('origin'),site=c.req.header('sec-fetch-site');
    if((site&&site!=='same-origin'&&site!=='none')||(origin&&origin!==new URL(c.req.url).origin))return c.json({error:'Same-origin access required'},403);
    if(!['GET','HEAD'].includes(c.req.method)&&!c.req.path.endsWith('/logout')&&c.req.header('x-protagonist')!=='1')return c.json({error:'Request header required'},403);
    await next();c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');c.header('Cache-Control','no-store');
  });
  const page=async(name:string)=>readFile(new URL(`../web/${name}.html`,import.meta.url),'utf8');
  app.get('/health',c=>c.json({ok:true}));
  app.get('/',c=>c.redirect('/simulator'));
  app.get('/chat',c=>c.redirect('/simulator'));
  app.get('/favicon.ico',c=>c.redirect('/favicon.svg'));
  app.get('/favicon.svg',async c=>c.body(await readFile(new URL('../web/favicon.svg',import.meta.url)),200,{'Content-Type':'image/svg+xml'}));
  app.get('/simulator',async c=>{const html=await page('simulator');c.header('Content-Security-Policy',policy(html));return c.html(html);});
  app.route('/simulator/api',simulatorApp(store,config));
  app.route('/me',studentApp(store,config,workerFetch));
  app.get('/admin',c=>c.redirect('/admin/'));
  app.get('/admin/',async c=>{const html=await page('admin');c.header('Content-Security-Policy',policy(html));return c.html(html);});
  app.route('/admin',adminApp(store,docker,config,workerFetch));
  app.onError((_error,c)=>c.json({error:'Temporarily unavailable'},503));
  return app;
}
