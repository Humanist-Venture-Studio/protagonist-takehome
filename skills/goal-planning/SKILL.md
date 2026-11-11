---
name: goal-planning
description: Help a student choose their first goal and learn to set goals, then turn what they want to achieve into a clear outcome, personal target and next step, with a plan based on verified deadlines and agreed reminders.
---
# Goals and plans

Use this at the beginning of the conversation to help the student choose their first goal, when they want to act on a choice ("help me apply to this program before the deadline"), ask "what should I do today?", report progress ("I sent the transcript request"), or want to change, pause or stop a goal or its reminders.

## Helping a student set their first goal

- Read existing goals and memory first. Continue a returning student's goal rather than restarting the introduction.
- Invite one thing they want to achieve. If they are unsure, offer two or three simple examples, such as finishing the GED, finding an affordable program, or completing an application. Examples are suggestions, not goals to save without their agreement.
- Teach through their own goal: a clear result ("finish my application"), a personal target ("by Friday"), and one small next action ("find the application requirements"). Explain each briefly as it becomes relevant; do not deliver a lecture or an intake form.
- Save and read back the draft as soon as the student states or confirms a goal, even if dates or the program are unknown. Build on that same file. Ask one focused question at a time to clarify the outcome, then a realistic target if useful, then agree the first small step. Never invent a date or treat a personal target as an institutional deadline.
- Keep first steps and milestones inside the existing goal; do not create a separate goal for each task.
- Once the next step is clear, help them take it. Explain that they can ask to see their goals at any time, and use `get_dashboard_link` when they do. Offer reminders only when useful and with their consent.
- Respect the student's pace: answer other requests first and do not require goal setting before helping.

## Exploring a decision before setting the goal

When the student asks for help choosing a school, program, pathway or other consequential option, follow these steps in order before continuing goal intake:

1. **Answer before asking.** Use what is already known to give substantive help first. Ask at most one question, and only when the answer would materially change the recommendation. A question is not required in every reply.
2. **Frame the decision.** Show realistic paths, including a credible alternative to the assumed path. Give a tailored working recommendation, tradeoffs, concrete criteria with instructions for evaluating them, warning signs and one next action. Do not hand discovery back with only a generic checklist.
3. **Bound the evidence.** When current facts cannot be researched, say which evidence is needed and how it affects the decision. Offer to analyze official pages, pasted text or uploaded documents supplied by the student; never imply that you browsed for them.
4. **Make the comparison usable.** For a consequential comparison, use the html-document skill to create and send a reusable comparison worksheet when the student requests a comparison, requests more depth or would otherwise need a long answer. Prefill confirmed priorities. Include options, weighted criteria, evidence, unknowns, scores, tradeoffs, questions for the institution and next steps.
5. **Recover from dissatisfaction.** If the student calls an answer shallow, generic, vague or unhelpful, acknowledge what was missing and recover with deeper analysis, examples, a concrete framework and an action or artifact you can complete. Do not repeat the same checklist or immediately ask another intake question.

## Where goals live

- One file per goal: `/data/workspace/goals/<slug>.md`. The slug is short, lowercase and hyphenated, like `ecc-nursing-fall-2027`. This file is the plan's source of truth; a delivered HTML plan is only a dated copy.
- `/data/workspace/MEMORY.md` holds the student's time zone (IANA name, for example `America/New_York`), the language they prefer, their weekly availability, and quiet hours if they gave any. Ask for the time zone once, the first time you need it, and record it there.
- Read the goal file before answering anything about the goal. Update it after every change, and keep a short dated `## Log` at the end.
- The app captures a clear new goal as a draft before you receive the request, even when the program is unknown. Use the saved filename from the application persistence status, read it, and develop that same goal. If the student confirms a goal through context-dependent replies such as "yes", save and read back a draft yourself before asking for more details. Do not wait for a full plan or reminder consent to record an explicit goal.
- `target: YYYY-MM-DD` is the student's personal target, shown separately on both dashboards. Keep it distinct from sourced institutional `deadlines`; it is not proof that a course starts or accepts applications on that day.

## Goal file format

```markdown
---
goal: Submit a complete application to Example County College's RN program for Fall 2027, and confirm the college received everything.
status: active            # draft | active | waiting | paused | completed | cancelled
timezone: America/New_York
created: 2026-10-20
updated: 2026-10-20
deadlines:
  - what: RN application
    date: 2027-03-15        # a date only, unless the source gives a time
    time: null
    zone: America/New_York  # the institution's zone, not the student's
    source: https://www.example.edu/nursing
    checked: 2026-10-20
---

## Steps

| # | Step | Owner | Depends on | Effort / wait | Target | Status | Reminder | Done when |
|---|------|-------|-----------|---------------|--------|--------|----------|-----------|
| 1 | Confirm program, term and requirements | Student + Protagonist | – | 1 h | 2026-10-24 | completed | – | Student confirmed in chat 2026-10-20 |
| 2 | Request high school transcript | Student | 1 | 30 min / up to 3 weeks | 2026-11-15 | ready | #12 | Student forwards the school's confirmation |

## Notes

## Log
- 2026-10-20: Goal created from the research report.
```

- Step statuses: `not-started`, `ready`, `in-progress`, `waiting-student`, `waiting-third-party`, `completed`, `skipped` (with a reason).
- **Done when** names the evidence:
  - "Student says it is done" is valid evidence; record it as `student reported <date>`.
  - It is different from an institution's receipt or a confirmation number.
  - A reminder being sent never completes a step.

## Making a plan

1. **Pin the outcome.** Preserve the student's request and personal target in a draft first. Then clarify one missing detail per reply, starting with the college or field of study. Wait for the answer before asking about term, applicant type, availability or reminders. Do not present a checklist of questions or combine a school question with a time-zone question; ask the time zone only when it is needed for a reminder. If the student has not chosen yet, help them explore options using the information they have provided.
2. **Collect every external deadline**: application, financial aid, scholarships, transcripts, tests, portfolio.
   - There is no web research in this exercise. Use sources supplied by the student and mark every unverified external deadline as unverified. Record source and checked only when supported by the supplied evidence.
   - If a source gives only a date, keep only the date. Never invent a time of day.
   - If you cannot verify a deadline, mark it `unverified` and make confirming it the first step.
3. **List the real steps.** Only the steps this pathway needs: no essay step if there is no essay. Usually 4–8 milestones, with small tasks grouped inside them.
4. **Plan backward from each deadline.**
   - Estimate effort (hours of the student's work) separately from waiting (days for a transcript or a recommendation).
   - Add buffers: about 2 weeks before external deadlines for anything that depends on a third party, about 3 days for final review and submission, and holidays.
   - Respect dependencies and the student's weekly availability.
   - Do the date arithmetic with `bash` (for example `date -d '2027-03-15 -21 days' +%F`); don't guess.
5. **Check feasibility.**
   - If the recommended start dates have already passed, show the fastest path from today: what to do immediately, and what can run in parallel.
   - If the official deadline has passed, say so with the source and look for the next intake or an official late route.
   - Never move an official deadline.
6. **Propose, then confirm.** Deliver the full plan as a file, summarize the next step in one short plain-text message, and offer a reminder when the relevant details are known: "Want me to remind you on Nov 10 at 6 pm to request your transcript?" Save the goal as `draft` until they agree, then make it `active`.

## Reminders

- Schedule only reminders the student asked for or accepted.
- Use the student's local time and zone, and the `goal` slug. Put in the note which step it is for and what to check.
- Tell the student the exact local time the tool confirms, and record the reminder number in the step's Reminder column.
- **Moving one:** `cancel_reminder`, then `schedule_reminder` with the new time. Update the file and confirm the new time.
- **Pausing, completing or cancelling a goal:** cancel all its pending reminders (`list_reminders` shows them) and say so.
- **When a reminder fires:** you receive `[Scheduled reminder #N for goal <slug>]`.
  - Read the goal file.
  - If that step is done, skipped, or no longer relevant, or the goal is paused, reply exactly `SKIP`.
  - Otherwise send one short, friendly message with the single next action, and offer help ("I can draft the email for you").
  - For a repeating check-in (for example every Sunday at 5 pm), schedule the next one, then reply.
- Respect quiet hours from MEMORY.md. Do not schedule anything between 9 pm and 8 am local time unless the student asked for that time.

## Everyday questions

- **"Show me my goals" or "Where can I see my goals?"** Call `get_dashboard_link` and return its exact private URL. Explain that opening it and pressing **Continue to my dashboard** takes them to their goals. The link works once, expires in 10 minutes, and must not be stored in goal files or memory. Get a fresh link each time; use `/dashboard` only as a fallback if the tool fails.
- **"What should I do today?"** Read the active goal files. Answer with the one or two most urgent ready steps, how long each takes, and what you can prepare for them.
- **"I sent it" or "I did it":** mark the step `completed` with the evidence. Unblock what depends on it, cancel that step's remaining reminders, and say what comes next.
- **A deadline or constraint changes:** re-check the source, recompute the affected dates, keep the completed steps, cancel or replace the reminders that changed, and tell the student only what materially changed.

## Plan document

When the student asks for the plan, or after a material change, make an HTML plan with the html-document skill, starting from `/app/skills/html-document/examples/goal-plan.es.html`. Include:

- the outcome;
- the deadlines with sources;
- a timeline marking done and due steps;
- what you need from the student;
- this week's steps.

Its footer says it is a dated copy and that the plan in the chat is current. Do not send a new document after every small change.

## Never

- Mark anything `submitted` without a confirmation number, a receipt, or the student saying they submitted it.
- Submit, sign, pay, or message an institution for the student.
- Store passwords, payment details or government ID numbers in goal files.
