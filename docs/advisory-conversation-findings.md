# Advisory conversation findings

## Conversation reviewed

The student asked for help choosing a US philosophy master's program for personal curiosity. Relevant context emerged over several turns: prior engineering and MBA degrees from Israeli universities, a preference for Washington in-person study with remote study as a backup, and a Fall 2027 target.

Protagonist identified several legitimate considerations, including preparation without a philosophy BA, thesis versus taught programs, intellectual fit, format, cost and location. It was appropriately honest that live program facts could not be verified because this exercise has no web research.

## Observed problem

The experience gathered context effectively but did not convert it into sufficiently concrete decision support. Protagonist repeated generic criteria, asked another question in most replies and eventually asked the student to find programs before it would help compare them. This shifted the hardest discovery work back to the student.

The advice did not explain how to evaluate the criteria, weight them for this student's purpose, identify warning signs or question whether a master's degree was the best path for personal curiosity. Plausible alternatives such as non-degree graduate study, auditing seminars or an interdisciplinary program were omitted. A reference to English proof for Israeli degrees was presented too broadly and should instead have been marked as institution-specific and unverified.

The lack of web research made current recommendations impossible, but it did not require a shallow response. With the known context, Protagonist could still have supplied a working decision model, meaningful alternatives, an evidence-gathering plan, admissions questions and a reusable comparison worksheet. It could then analyze official pages, pasted text or uploaded documents supplied by the student.

## Root cause

The worker prompt and goal-planning skill emphasize asking one focused question at a time, while the reply policy targets short answers. Those safeguards reduce overwhelming intake, but together they encourage a question treadmill and generic phone-sized replies during complex choices. There was also no explicit recovery behavior when the student said the answer was unhelpful.

## Scoped improvement

The selected change adds a decision-support policy and matching goal-planning guidance:

- answer substantively from known context before asking at most one material question;
- show realistic paths, including an alternative to the assumed path;
- provide a tailored working recommendation, tradeoffs, evaluable criteria, warning signs and a next action;
- distinguish confirmed evidence, assumptions and facts needing official sources;
- recover from dissatisfaction with deeper analysis instead of repeated intake;
- create and send a prefilled comparison worksheet for consequential comparisons or requests for more depth.

General web search is deliberately not included. This copy has no research skill or search/fetch API, explicitly prohibits browsing, and isolates student workers. Safe browsing would require retrieval infrastructure, source provenance, network and SSRF controls, prompt-injection handling, limits and additional tests. The existing critique appropriately places reviewed college-source retrieval later in the 90-day plan.

## Alignment with the critique

This finding supports the critique's first priority: make one student workflow dependable and useful before expanding the product. It also gives the proposed quality evaluation a concrete supplied-information baseline. It does not conflict with the third priority to add reviewed college evidence later; it improves reasoning and actionability now without pretending current facts can be verified.

## Verification boundary

Ten focused tests verify step order, substantive decision outputs, evidence boundaries, worksheet triggers and content, dissatisfaction recovery, domain-generic guidance, worker wiring and agreement with the goal-planning skill. Type-checking passed, and the required Linux-container suite passed all 131 tests. Because model responses are nondeterministic, `advisory-manual-qa.md` defines a six-case replay matrix for the actual model and file-delivery path. Full web retrieval and factual program recommendations remain out of scope.

## Manual website findings

Three turns were replayed with a fresh fictional student:

1. **Initial choice:** Protagonist used the full-time-work and speed constraints, recommended the certificate as the likely route and explained the associate-degree tradeoff. It still ended by shifting program discovery back to the student and did not provide a concrete next action.
2. **Dissatisfaction recovery:** After being told the answer was too generic, it stopped asking questions and supplied a useful job-posting/catalog framework. It also invented "by Friday" as a personal target, presented the "4 of 5 postings" threshold too authoritatively and did not automatically create the worksheet requested through the new depth trigger.
3. **Explicit worksheet:** The first attempt created the document workspace but failed after four upstream Muse Spark `429` responses. After rebuilding the current worker and retrying with Muse Wonder, Protagonist delivered `bookkeeping-compare-v1.html`. The file included weighted criteria, scoring, evidence, labeled unknowns, warning signs and next steps without inventing current tuition or institutional deadlines.

The manual run therefore supports the direction of the change but does not establish that prompt guidance alone makes every model follow every step. It also demonstrated why provider failures must be separated from product-quality failures during evaluation.

## Follow-up work

- Prevent models from turning example timing in the goal skill into an unsupplied personal target.
- Require assistant-created thresholds such as "4 of 5 postings" to be labeled as suggested heuristics.
- Evaluate whether worksheet creation needs deterministic routing rather than prompt-only triggering.
- Improve the user-visible error for provider rate limits so it distinguishes a retryable external failure from an invalid request.
- Complete the remaining manual QA matrix across evidence boundaries, assumed paths and low-stakes choices.
