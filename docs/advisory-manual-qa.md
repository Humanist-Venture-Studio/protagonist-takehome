# Decision-support manual QA

Automated tests pin the deterministic prompt and skill contract. Model behavior is nondeterministic, so replay these fictional cases after rebuilding the worker image. Evaluate the move shape and usefulness rather than exact wording.

## Case matrix

| Case | Student turn | Required behavior | Failure signal |
| --- | --- | --- | --- |
| Known context | "Help me choose between a certificate and an associate degree. I work full time and want the fastest credible route into bookkeeping." | Uses the stated schedule and outcome; gives realistic paths, a working recommendation, tradeoffs, evaluable criteria and a next action before any question. | Starts a profile questionnaire or returns only a generic checklist. |
| Assumed path | "I want an MBA for personal growth, not a promotion." | Examines the MBA assumption and includes a credible lower-cost alternative such as non-degree courses; explains when each path is worthwhile. | Treats the MBA as the only option. |
| Evidence boundary | "Which program has the lowest 2027 tuition?" | Says live tuition is unverified, identifies the official evidence needed and offers to analyze supplied pages or documents. | Invents a price, implies browsing or stops without an evidence plan. |
| Detailed comparison | "Compare these two supplied program pages in depth." | Creates and sends a prefilled comparison worksheet with weighted criteria, evidence, unknowns, scores, tradeoffs, institution questions and next steps; chat contains a concise summary. | Provides only chat bullets or an internal file path. |
| Dissatisfaction recovery | After a generic answer: "That is shallow and not helping me decide." | Names what was missing and advances with deeper analysis, examples, a concrete framework and an action or artifact. | Repeats the checklist or immediately asks another intake question. |
| Simple low-stakes choice | "Should I study tonight or tomorrow morning? I am exhausted." | Gives a direct concise recommendation; does not create an unnecessary worksheet. | Over-processes the choice or forces a document. |

## Replay steps

1. Rebuild the app and start a new fictional student so the worker uses the new image.
2. Run each case in a fresh conversation or reset relevant memory between cases.
3. Record pass/fail and a short reason against every required behavior; do not grade exact prose.
4. Inspect the dashboard after the detailed-comparison case and confirm the worksheet is downloadable and contains no invented current facts.
5. Run the dissatisfaction turn after intentionally eliciting or pasting a generic prior answer so the recovery path is exercised with realistic conversation history.

## Scope boundary

These cases verify advisory behavior with known or student-supplied information. General web search, current-program discovery and factual validation against live institutional pages remain outside this change.

## Recorded run

| Case | Result | Notes |
| --- | --- | --- |
| Known context | Partial pass | Used work/speed constraints and recommended a certificate, but lacked a concrete next action and shifted discovery back to the student. |
| Dissatisfaction recovery | Partial pass | Stopped questioning and gave a concrete framework; invented "by Friday," treated a suggested threshold as authoritative and did not automatically create a worksheet. |
| Explicit worksheet delivery | Pass after retry | First attempt was interrupted by upstream Muse Spark 429s. Muse Wonder delivered a valid worksheet with the required sections and evidence labels. |
| Assumed path | Not run | Follow-up. |
| Evidence boundary | Not run | Follow-up. |
| Simple low-stakes choice | Not run | Follow-up. |
