import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DECISION_SUPPORT_POLICY, DECISION_SUPPORT_STEPS } from '../src/advice.ts';

const skill=readFileSync('skills/goal-planning/SKILL.md','utf8');
const worker=readFileSync('src/worker.ts','utf8');

test('decision support exposes five documented steps in execution order',()=>{
  // Arrange - Build the step labels expected by the documented advisory flow.
  const expectedLabels=DECISION_SUPPORT_STEPS.map((_step,index)=>`Step ${index+1} -`);

  // Act - Locate each label in the assembled runtime policy.
  const labelPositions=expectedLabels.map(label=>DECISION_SUPPORT_POLICY.indexOf(label));

  // Assert - Every step is present once and follows the preceding step.
  assert.equal(DECISION_SUPPORT_STEPS.length,5);
  assert.ok(labelPositions.every(position=>position>=0));
  assert.deepEqual([...labelPositions].sort((first,second)=>first-second),labelPositions);
});

test('step one provides value before an optional material question',()=>{
  // Arrange - Select the intake-to-advice transition contract.
  const answerBeforeAsking=DECISION_SUPPORT_STEPS[0];

  // Act - Read its answer and question constraints.
  const answersFirst=answerBeforeAsking.includes('best useful analysis possible first');
  const questionIsMaterial=answerBeforeAsking.includes('materially change the recommendation');
  const questionIsOptional=answerBeforeAsking.includes('not mandatory');

  // Assert - Intake cannot become a mandatory question treadmill.
  assert.equal(answersFirst,true);
  assert.equal(questionIsMaterial,true);
  assert.equal(questionIsOptional,true);
});

test('step two requires alternatives, recommendation, evaluation and action',()=>{
  // Arrange - Select the decision-framing contract.
  const decisionFrame=DECISION_SUPPORT_STEPS[1];

  // Act - Check each output needed to make a choice actionable.
  const requiredOutputs=['credible alternative','tailored working recommendation','tradeoffs','how to evaluate','warning signs','one action'];

  // Assert - The response cannot degrade into an unweighted generic checklist.
  for(const requiredOutput of requiredOutputs)assert.ok(decisionFrame.includes(requiredOutput),requiredOutput);
  assert.match(decisionFrame,/Do not shift discovery back/);
});

test('step three separates known context from unverified current evidence',()=>{
  // Arrange - Select the evidence-boundary contract.
  const evidenceBoundary=DECISION_SUPPORT_STEPS[2];

  // Act - Identify its provenance and capability claims.
  const distinguishesEvidence=evidenceBoundary.includes('confirmed facts from assumptions');
  const acceptsSuppliedSources=/official pages, pasted text, or uploaded documents supplied by the student/.test(evidenceBoundary);
  const forbidsFalseBrowsing=evidenceBoundary.includes('without implying that you browsed');

  // Assert - Helpful analysis must not become fabricated live research.
  assert.equal(distinguishesEvidence,true);
  assert.equal(acceptsSuppliedSources,true);
  assert.equal(forbidsFalseBrowsing,true);
});

test('step four triggers a delivered worksheet for comparison, depth or long answers',()=>{
  // Arrange - Select the artifact contract.
  const worksheet=DECISION_SUPPORT_STEPS[3];

  // Act - Read the supported triggers and delivery path.
  const triggers=['asks for a comparison','asks for more depth','would otherwise need a long answer'];

  // Assert - Each trigger uses the existing safe document and delivery capabilities.
  for(const trigger of triggers)assert.ok(worksheet.includes(trigger),trigger);
  assert.match(worksheet,/use the html-document skill to create and send/);
});

test('the comparison worksheet contains the information needed to make a decision',()=>{
  // Arrange - Select the worksheet content contract.
  const worksheet=DECISION_SUPPORT_STEPS[3];

  // Act - Enumerate the concrete fields promised to the student.
  const requiredFields=['options','weighted criteria','evidence to collect','unknowns','scores','tradeoffs','questions for the institution','next steps'];

  // Assert - The artifact is a usable decision aid, not a longer generic checklist.
  for(const requiredField of requiredFields)assert.ok(worksheet.includes(requiredField),requiredField);
});

test('step five changes move shape after explicit dissatisfaction',()=>{
  // Arrange - Select the dissatisfaction-recovery contract.
  const recovery=DECISION_SUPPORT_STEPS[4];

  // Act - Read the feedback signals, repair content and prohibited fallback.
  const recognizesFeedback=/shallow, generic, vague, or unhelpful/.test(recovery);
  const deepensResponse=/more depth, examples, a concrete framework/.test(recovery);
  const avoidsLoop=/Do not repeat the checklist or immediately ask another intake question/.test(recovery);

  // Assert - Negative feedback results in useful advancement rather than more intake.
  assert.equal(recognizesFeedback,true);
  assert.equal(deepensResponse,true);
  assert.equal(avoidsLoop,true);
});

test('production guidance remains generic rather than encoding the philosophy fixture',()=>{
  // Arrange - List details that belong only to the observed conversation.
  const fixtureTerms=['philosophy',"master's",'Washington','Israeli','Fall 2027'];

  // Act - Search the production policy for fixture leakage.
  const leakedTerms=fixtureTerms.filter(term=>DECISION_SUPPORT_POLICY.includes(term));

  // Assert - The policy generalizes to other consequential student decisions.
  assert.deepEqual(leakedTerms,[]);
});

test('worker runtime includes the policy and no longer mandates a question',()=>{
  // Arrange - Read the real worker call site rather than testing an imagined integration.
  const runtimePromptSource=worker;

  // Act - Locate the import, prompt insertion and intake wording.
  const importsPolicy=runtimePromptSource.includes("import { DECISION_SUPPORT_POLICY } from './advice.ts';");
  const insertsPolicy=runtimePromptSource.includes('  DECISION_SUPPORT_POLICY,');
  const usesOptionalLimit=runtimePromptSource.includes('Ask at most one focused question per reply');

  // Assert - The checked contract is wired into the prompt used by student workers.
  assert.equal(importsPolicy,true);
  assert.equal(insertsPolicy,true);
  assert.equal(usesOptionalLimit,true);
  assert.doesNotMatch(runtimePromptSource,/Ask only one focused question per reply/);
});

test('goal-planning skill mirrors all runtime steps and worksheet delivery',()=>{
  // Arrange - Define the skill headings that correspond to the runtime contract.
  const expectedSkillSteps=['Answer before asking','Frame the decision','Bound the evidence','Make the comparison usable','Recover from dissatisfaction'];

  // Act - Check the skill loaded by the assistant for each documented step.
  const missingSteps=expectedSkillSteps.filter(step=>!skill.includes(step));

  // Assert - Runtime and task-specific guidance cannot silently diverge.
  assert.deepEqual(missingSteps,[]);
  assert.match(skill,/use the html-document skill to create and send/);
  assert.match(skill,/Do not repeat the same checklist or immediately ask another intake question/);
});
