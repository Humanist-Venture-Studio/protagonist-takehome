import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,LOGIN_TTL,SESSION_TTL} from '../src/store.ts';
import {publicApp} from '../src/web.ts';
import {readConfig} from '../src/config.ts';
import {onboardingProfile,onboardingPrompt,PLAN_PATH} from '../src/onboarding.ts';
import {prepareOnboarding,starterPlan,onboardingPlanReady} from '../src/onboarding-workspace.ts';
import {ensureNotes,deliveredFiles,goals,writeNote} from '../src/dashboard.ts';
import {atomicWorkspaceText} from '../src/workspace.ts';
import {htmlProblems} from '../src/html.ts';
import {Docker} from '../src/docker.ts';
import {withStudentLock} from '../src/lifecycle.ts';
const profile={name:'Ana',location:'Newark, NJ, USA',zone:'America/New_York',goal:'school' as const,outcome:'Find a nursing program with evening classes',startingPoint:'High school diploma, working afternoons',target:'Within a year',hours:'3–5 hours per week',constraints:'A limited budget'};

test('starter plans, memory and goals survive retries without overwriting student changes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pv2-onboard-'));
  try{
    await ensureNotes(dir);await prepareOnboarding(dir,profile);
    assert.match(await readFile(join(dir,'MEMORY.md'),'utf8'),/Name: Ana/);assert.match(await readFile(join(dir,'MEMORY.md'),'utf8'),/America\/New_York/);
    const [g]=await goals(dir);assert.equal(g.goal,profile.outcome);assert.equal(g.steps.total,6);
    assert.equal((await deliveredFiles(dir))[0].name,'your-plan.html');
    const html=await readFile(join(dir,PLAN_PATH),'utf8');assert.deepEqual(htmlProblems(html),[]);assert.match(html,/Newark/);assert.match(html,/limited budget/);assert.match(html,/have not been verified/);
    assert.equal(await onboardingPlanReady(dir),false,'unchanged starter is not reported as a finished personalized plan');
    await atomicWorkspaceText(dir,PLAN_PATH,html.replace('This starter gives you useful steps now.','This refined plan is ready.'));assert.equal(await onboardingPlanReady(dir),true);
    await atomicWorkspaceText(dir,PLAN_PATH,'<script>unsafe()</script>');assert.equal(await onboardingPlanReady(dir),false);
    await writeNote(dir,'memory','# Corrected by the student','test-token');await atomicWorkspaceText(dir,PLAN_PATH,'refined plan');
    await prepareOnboarding(dir,profile);assert.equal(await readFile(join(dir,'MEMORY.md'),'utf8'),'# Corrected by the student');assert.equal(await readFile(join(dir,PLAN_PATH),'utf8'),'refined plan');
    for(const goal of ['school','career','other'] as const){const plan=starterPlan({...profile,goal,name:'<script>test</script>'});assert.deepEqual(htmlProblems(plan.html),[]);assert.ok(!plan.html.includes('<script>'));assert.equal(plan.goal.split('| Student + Protagonist |').length,7);}
    assert.throws(()=>onboardingProfile({...profile,goal:'invalid'}));assert.match(onboardingPrompt(profile),/do not repeat/i);assert.match(onboardingPrompt(profile),/unverified/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
