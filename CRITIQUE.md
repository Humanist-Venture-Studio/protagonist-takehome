# Protagonist critique and 90-day plan

## Methodology

I started with the student problem: completing school-related tasks around work and family, then resuming without explaining everything again. For this exercise, I worked quickly with AI to sketch the near-term product strategy and basic governance needs; this work is preliminary. I compared the system design with that direction, identifying immediate product, scalability and maintainability gaps. I checked the strongest claims against code and fictional-data tests, separating reproduced behavior from assumptions.

**Recommendation:** Keep student isolation, durable requests, saved context and the central AI gateway. Start with a college-process navigator: understand a supplied notice, prepare one useful action, and resume with reliable progress.

## From 50 students to 5,000

Assume 20% daily activity, 10 messages per active student, a 10-hour demand window and a peak four times its average. Assume 10% of daily users have chats open at peak, 45-second AI turns and three model calls per message.

| Metric | 50 students | 5,000 students |
| --- | ---: | ---: |
| Daily active students | 10 | 1,000 |
| Messages per day | 100 | 10,000 |
| Open conversations at peak | About 1 | 100 |
| Messages per peak minute | 0.67 | 66.7 |
| Simultaneous AI turns | About 1 | 50 |
| Model calls per peak minute | 2 | 200 |

At 5,000: `10,000 / 36,000 × 4 = 1.11 messages/s`; `1.11 × 45 = 50` active turns. Open conversations and active AI work are different capacity requirements.

**Reproduced scheduling limit:** With the actual queue/dispatcher and mocked 45-second workers, five simulated minutes admitted 333 messages, completed 115 and left 200 never started; active work peaked at 20. Older unfinished jobs repeatedly win selection; a separate check showed a slow response delaying another student's next poll. This is not a hard concurrency cap or production benchmark ([selection](https://github.com/Humanist-Venture-Studio/protagonist-takehome/blob/a28e5d33fc74adbb3e1bb12fa79564f381e5de0c/src/store.ts#L143), [dispatch](https://github.com/Humanist-Venture-Studio/protagonist-takehome/blob/a28e5d33fc74adbb3e1bb12fa79564f381e5de0c/src/server.ts#L30)).

**First focus:** Fix fair dispatch and independent polling, move container maintenance out of that loop, and verify the modeled peak of 67 messages/minute—about 50 simultaneous AI turns—without a growing queue before raising the student limit.

## Three priorities for the first 90 days

### 1. Days 1–30 — Make one student workflow dependable and trustworthy

**Simplify:** Focus on one registration requirement. Keep the mobile web shell, short replies and editable memory; provide a student chat entry without evaluator controls. Phone usability remains untested.

**Reproduced advisory-quality gap:** In a fictional philosophy-program choice, Protagonist gathered useful context but then repeated a generic checklist, asked a question in most replies and shifted program discovery back to the student. The absence of web research explains why current programs could not be verified, but not why the assistant omitted a tailored decision model, credible alternatives, warning signs and an evidence-gathering plan. The goal prompt's one-question cadence and short-reply target combine into a "question treadmill." Preserve concise intake, but require substantive advice from known context before at most one material question; use a downloadable worksheet when the comparison needs more depth.

**Build the product contract:** Give goals/tasks a validated API for prerequisites, status and evidence, shared by chat, Today and reminders. The current [goal parser](https://github.com/Humanist-Venture-Studio/protagonist-takehome/blob/a28e5d33fc74adbb3e1bb12fa79564f381e5de0c/src/dashboard.ts#L88) selected a waiting task over an independent ready task in a focused test. Let the assistant propose plans and code validate updates; a separate multi-agent planner is unnecessary here.

**Include immediate governance:** Before real data, verify identity/permissions, define retention/deletion and AI-provider handling, and test account deletion. Explain that forgetting a fact does not erase chat. Enforce reminder consent in the [service](https://github.com/Humanist-Venture-Studio/protagonist-takehome/blob/a28e5d33fc74adbb3e1bb12fa79564f381e5de0c/src/broker.ts#L86); require confirmation for future sharing/submissions. Name a correction owner; start manual source review and basic English/Spanish AI checks. Resolve sharing terms before ingesting college-supplied records. These are deployment gaps in a local exercise, not evidence of a breach.

**Success:** A transcript is the school's official course/grade record. Requested, sent and college-confirmed receipt remain distinct; chat, Today and reminders agree after restart.

### 2. Days 31–60 — Make execution scale with activity

**Re-architect:** Separate fleet maintenance from dispatch; make polling fair and independently progressing, with bounded active work. Preserve request IDs, ordering and private durable state. Safely wake/suspend workers instead of keeping every account running ([lifecycle](https://github.com/Humanist-Venture-Studio/protagonist-takehome/blob/a28e5d33fc74adbb3e1bb12fa79564f381e5de0c/src/docker.ts#L65)).

**Unmeasured cost risk:** At an assumed 100 MiB idle footprint, 5,000 workers require 488 GiB. At an assumed 200 MiB, 100 warm workers require about 20 GiB plus overhead. Measure footprints and wake-up latency before sizing hosts.

Keep the AI broker/usage ledger; add shared concurrency/spend limits. Verify provider capacity for 200 calls/min, approximately 0.8M input and 0.1M output tokens/min in the smaller scenario below. Trace queue, capture, tools and rewrite latency before simplifying paid stages; end-to-end latency is unmeasured.

**Success:** Sustain peak load with a heavy neighboring user and verify restart/restore. Add multi-host placement when measurements justify it; this demand alone does not justify replacing SQLite or adopting microservices.

### 3. Days 61–90 — Add reviewed college evidence and evaluate quality and cost

**Build/evaluate:** Extend the tool interface with reviewed college-source lookup, tagged by program, term and review date. Personal memory/file tools exist; managed college retrieval and web research do not. Automate the manual review started in month one. Missing/conflicting evidence should lead to clarification or a college contact.

Evaluate English/Spanish answers, corrections and unwanted actions before model/prompt changes. Compare task completion with the supplied-text baseline. Test cheaper extraction/rewrite models and caching without weakening memory or source accuracy.

**AI cost scenarios:** At three calls/message and 30 days of baseline activity, 4,000 input + 500 output tokens/call costs approximately **$64/month for 50 students and $6,413 for 5,000**. At 20,000 + 2,000 tokens, the figures become **$302 and $30,150**. These use [reference rates](https://openrouter.ai/meta/muse-spark-1.3) of $1.25/M input and $4.25/M billable output tokens; they exclude hosting, extra retry/background calls and cache discounts. Six calls/message doubles cost. The architecture leaves optimization options; quality checks determine which to adopt.

Start these contracts as modules. Career drafting and student-approved summaries reuse them; advisor access and portal actions need new permissions/integrations.

## Verification and handoff

Snapshot: `a28e5d3`. Four queue/goal checks passed. The peak fixture used a one-second loop, 1,000 fictional accounts with a raised cap and instantaneous mocked polls; Docker/network/model variability was excluded. I steered AI toward the student journey and challenged its claims against code/tests.

Part B adds a shared, five-step decision-support policy and matching goal-planning guidance. It answers from known context before asking at most one material question, considers alternatives and tradeoffs, preserves evidence boundaries, recovers from explicit dissatisfaction, and directs consequential comparisons into a prefilled downloadable worksheet using the existing HTML/document-delivery path. I deliberately did not add web search: this copy has no research tool and safe retrieval would require source provenance, network/SSRF controls, prompt-injection handling and broader tests. `npm run check:types` passed, and the required Linux-container suite passed all 131 tests, including ten focused contract and wiring tests for this change. A documented six-case replay matrix covers nondeterministic model behavior but still requires manual execution. Live latency, device usability and broader advice-quality evaluations were not completed.
