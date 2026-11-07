import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { atomicWorkspaceText, readWorkspaceText, withWorkspaceLock } from './workspace.ts';
import { DEFAULT_MEMORY, recordDelivery } from './dashboard.ts';
import { GOALS, PLAN_PATH, type OnboardingProfile } from './onboarding.ts';
import { htmlProblems, MAX_HTML_BYTES } from './html.ts';

const escape=(s:string)=>s.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const cell=(s:string)=>s.replaceAll('|',' / ').replace(/[\r\n]/g,' ');
const profileMemory=(p:OnboardingProfile)=>'\n## Your starting point\n'+Object.entries({Name:p.name,Location:p.location,'Time zone':p.zone||'Not yet confirmed','Goal category':GOALS[p.goal],Goal:p.outcome,'Starting point':p.startingPoint,'Target timing':p.target,'Weekly availability':p.hours,Constraints:p.constraints||'Not specified'}).map(([key,value])=>`- ${key}: ${value}`).join('\n')+'\n';
// An immediately cancelled first plan never reaches prepareOnboarding. Copy its confirmed
// profile once into an untouched workspace, without creating or resuming the cancelled plan.
export async function prepareIdeasProfile(workspace:string,p:OnboardingProfile) {
  await withWorkspaceLock(workspace,async()=>{
    if(await readWorkspaceText(workspace,'.protagonist/onboarded')||await readWorkspaceText(workspace,'.protagonist/ideas-profile'))return;
    const memory=await readWorkspaceText(workspace,'MEMORY.md');
    const goals=await readdir(`${workspace}/goals`).catch(()=>[]);
    if(memory===DEFAULT_MEMORY&&!goals.length&&await readWorkspaceText(workspace,'.protagonist/memory-edited')===null)
      await atomicWorkspaceText(workspace,'MEMORY.md',memory+profileMemory(p));
    // Record skipped initialization too: later forgetting must never restore the old intake.
    await atomicWorkspaceText(workspace,'.protagonist/ideas-profile','initialized');
  });
}
// An immediate, honest starting plan survives provider or simulator outages. The assistant refines this same file.
export function starterPlan(p:OnboardingProfile) {
  const steps=p.goal==='school'?[
    ['Define the qualification','List the qualification or subject you want and why it helps. Use your current education and experience to separate entry-level study from transfer or postgraduate options.','A clear study objective and a list of qualifications you already hold.'],
    ['Compare three realistic programs',`Find three accredited programs accessible from ${p.location}, including online options if useful. Compare schedule, entry requirements, total costs, support and application dates on each institution’s official site.`,'A comparison with official links and a reason for your first choice.'],
    ['Check entry requirements','Ask admissions to confirm prior-credit transfer, missing prerequisites and any entrance tests. Request transcripts early; record how long each document takes.','An admissions checklist with each requirement confirmed or marked unknown.'],
    ['Make the time and funding work',`Build a weekly schedule around ${p.hours}. Estimate tuition, fees, materials and transport; check grants, aid and employer support before committing.`,'A feasible weekly schedule and a funding gap you understand.'],
    ['Prepare and review the application','Collect documents, draft any statements and check every field. Verify the actual deadline with the institution and plan backward with a buffer. You review and submit it yourself.','A reviewed application and, after you submit, a confirmation receipt.'],
    ['Get ready for the first term','Confirm acceptance conditions, enrollment steps, orientation, books and access to student support. Review your workload after the first two weeks.','An enrollment checklist and a manageable study routine.'],
  ]:p.goal==='career'?[
    ['Choose the next role','Name the role, responsibility or promotion you want. Write down what would make it a worthwhile step: work, schedule, development and compensation.','A target role and three criteria for a good fit.'],
    ['Map the skills gap',`Compare three current job descriptions available in ${p.location} or remotely. Separate essential skills from nice-to-haves and match them to your existing experience.`,'A short list of skill gaps backed by actual role requirements.'],
    ['Build one piece of evidence',`Pick the most important gap and a small work sample, project or stretch assignment you can complete within ${p.hours}. Use training only where it supports that evidence.`,'A finished example you can show and explain.'],
    ['Tell your story','Update your résumé and professional profile with outcomes and evidence. Prepare three specific examples of problems you solved and the results.','A tailored résumé and three interview stories.'],
    ['Start focused conversations','If seeking promotion, ask your manager about expectations and decision timing. If changing jobs, identify suitable employers, make relevant contacts and tailor each application.','A small tracked pipeline with a next action for each contact or role.'],
    ['Practice, evaluate and adjust','Practice interviews, compare opportunities against your criteria, and review what is getting responses. Verify qualifications or costs before paying for a credential.','A weekly review and a next experiment based on feedback.'],
  ]:[
    ['Define what done looks like',`Turn “${p.outcome}” into one observable result. Separate what you can control from decisions other people must make.`,'A clear finish line you can check.'],
    ['Map the route from today',`Start from ${p.startingPoint}. List what must be true before your goal is possible: skills, information, resources and outside approvals.`,'Three to five milestones in dependency order.'],
    ['Verify the unknowns','Find official sources or the person responsible for requirements, costs and dates. Record what is confirmed and what still needs an answer.','A short evidence list with no guessed requirements.'],
    ['Make a workable weekly plan',`Choose one small action per work session within ${p.hours}. Leave space for delays and adjust the scope if the goal does not fit your target timing.`,'A realistic first week with time set aside.'],
    ['Complete the first milestone','Do the smallest useful piece, save the result and ask for feedback where it helps. Handle any action needing a signature, payment or submission yourself.','A tangible result and a record of what you learned.'],
    ['Review and keep moving','Compare progress with your finish line each week. Change the approach when evidence changes, and break the next milestone into concrete actions.','Visible progress and the next useful step.'],
  ];
  const constraints=p.constraints||'No specific constraints shared yet.';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your first plan · Protagonist</title><style>
  *{box-sizing:border-box}body{margin:0;background:#FFFCF4;color:#17130F;font:17px/1.6 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:24px}h1{font-size:clamp(30px,6vw,48px);line-height:1.1}h2{line-height:1.25}section{margin:22px 0;padding:20px;border:2px solid #17130F;border-radius:16px;background:white}header{border-bottom:3px solid #17130F}.next{background:#FFD43B}dt{font-weight:700}dd{margin:0 0 10px;overflow-wrap:anywhere}p{overflow-wrap:anywhere}.label{color:#5C534A}@media print{body{background:white}section{break-inside:avoid}main{max-width:none}}
  </style></head><body><main><header><p>PROTAGONIST · ${escape(GOALS[p.goal])}</p><h1>${escape(p.outcome)}</h1><p>A working plan for ${escape(p.name)}</p></header>
  <section class="next"><h2>Your first move</h2><p>${escape(steps[0][1])}</p><p>Bring the result back to our simulator chat. We’ll turn it into the next concrete action.</p></section>
  <section><h2>Built around your life</h2><dl><dt>Location</dt><dd>${escape(p.location)}</dd><dt>Starting point</dt><dd>${escape(p.startingPoint)}</dd><dt>Your target timing</dt><dd>${escape(p.target)} — a personal target, not a verified deadline.</dd><dt>Time each week</dt><dd>${escape(p.hours)}</dd><dt>What we need to work around</dt><dd>${escape(constraints)}</dd></dl></section>
  <section><h2>How to use this plan</h2><p>This starter gives you useful steps now. Your assistant is researching and tailoring this same page; check Files for the latest version. Specific options, prices, eligibility and institutional deadlines have not been verified yet.</p><p>Start with steps 1–2 this week if your available time allows. Complete prerequisites before moving on, leave room for waiting, and revise the timeline when requirements are confirmed. No reminders, applications or payments have been made.</p></section>
  ${steps.map(([title,action,evidence],i)=>`<section><p class="label">STEP ${i+1} · ${i?'After the previous step':'Start here'}</p><h2>${escape(title)}</h2><p>${escape(action)}</p><p><strong>Done when:</strong> ${escape(evidence)}</p></section>`).join('')}
  <section><h2>When things get in the way</h2><p>Start with the constraint you named: ${escape(constraints)} Discuss it with your assistant before committing time or money. If time is tight, shrink the first milestone. If cost is the obstacle, compare supported or lower-cost routes. If a requirement is unclear, get confirmation before taking the next dependent step.</p><h2>Your next check-in</h2><p>Tell your assistant what you completed, what you learned and what is blocking you. We’ll update this plan together. Ask in chat if you want a reminder.</p></section></main></body></html>`;
  if(htmlProblems(html).length)throw Error('Starter plan failed validation');
  const goal=`---\ngoal: ${cell(p.outcome)}\nstatus: draft\ntarget: ${cell(p.target)}\ntimezone: ${p.zone}\nupdated: ${new Date().toISOString().slice(0,10)}\n---\n\n# First goal\n\nCategory: ${GOALS[p.goal]}\nStarting point: ${cell(p.startingPoint)}\nAvailability: ${cell(p.hours)}\nConstraints: ${cell(constraints)}\nPersonal timing is not a verified external deadline.\n\n| # | Step | Owner | Depends on | Effort / wait | Target | Status | Reminder | Done when |\n|---|---|---|---|---|---|---|---|---|\n`+steps.map(([title,,evidence],i)=>`| ${i+1} | ${cell(title)} | Student + Protagonist | ${i||'—'} | To estimate together | | ${i?'pending':'ready'} | — | ${cell(evidence)} |`).join('\n')+'\n';
  return {html,goal};
}
export async function prepareOnboarding(workspace:string,p:OnboardingProfile) {
  await withWorkspaceLock(workspace,async()=>{
    // Each write is idempotent; a crash resumes missing work without overwriting later student edits.
    if(await readWorkspaceText(workspace,'.protagonist/onboarded'))return;
    const {html,goal}=starterPlan(p);
    if(await readWorkspaceText(workspace,'goals/first-goal.md')===null)await atomicWorkspaceText(workspace,'goals/first-goal.md',goal);
    if(await readWorkspaceText(workspace,PLAN_PATH)===null)await atomicWorkspaceText(workspace,PLAN_PATH,html);
    const memory=await readWorkspaceText(workspace,'MEMORY.md')||'# MEMORY.md\n';
    const marker='## Your starting point';
    if(!memory.includes(marker)&&await readWorkspaceText(workspace,'.protagonist/memory-edited')===null)
      await atomicWorkspaceText(workspace,'MEMORY.md',memory+profileMemory(p));
    await recordDelivery(workspace,{name:'your-plan.html',path:`${workspace}/${PLAN_PATH}`,caption:'Your personal goal plan'});
    await atomicWorkspaceText(workspace,'.protagonist/onboarded',JSON.stringify({created:new Date().toISOString(),starterHash:createHash('sha256').update(html).digest('hex')}));
  });
}

export async function onboardingPlanReady(workspace:string) {
  try {
    const receipt=JSON.parse(await readWorkspaceText(workspace,'.protagonist/onboarded')||'null');
    const html=await readWorkspaceText(workspace,PLAN_PATH,MAX_HTML_BYTES);
    return !!html&&!!receipt?.starterHash&&createHash('sha256').update(html).digest('hex')!==receipt.starterHash&&htmlProblems(html).length===0;
  }catch{return false;}
}
