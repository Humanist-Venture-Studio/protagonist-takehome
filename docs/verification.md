# Verification

## November 6, 2026 — candidate handoff

- Updated the README assignment, three-hour timebox, submission instructions, and 110-minute live-session agenda to match this standalone copy.
- TypeScript passes. Packaging was checked in a temporary extracted copy: `CRITIQUE.md` is included when present, local configuration is excluded, and a symlink in place of the critique is rejected.
- The candidate archive was rebuilt. The Linux suite could not run because the local Docker daemon was stopped; the full-suite results below are from October 28, not a new run.

## October 28, 2026 — application verification

- TypeScript: `npm run check:types` passes.
- Linux behavior suite: 121 tests pass with `npm run test:linux`; no skipped tests. Tests use synthetic responses and no external network.
- Ideas: a fresh fictional student received two starter suggestions in a 19 ms HTTP response once its worker was ready, while model refinement ran in the background. Tests cover slow/failed generation, context changes, stable selection, and chat preemption; the rebuilt page was checked in the browser.
- Live OpenRouter: a fictional student stated a Spanish-learning goal and morning study availability. The assistant replied, saved the goal and memory, and used the follow-up travel preference to generate and deliver a one-week text plan.
- The generated attachment downloaded successfully with an attachment disposition. A second fictional student's transcript contained none of the first student's information and could not download the first student's file through its own route.
- Controller rebuild/restart preserved the transcript; student memory and the goal were visible in the dashboard.
- The simulator was inspected at desktop and mobile sizes, including a 320px width without horizontal overflow. Admin and the student dashboard were opened in the browser.
- A real worker could reach the broker (401 without a credential), but could not reach the evaluator listener through either bridge address or make a direct public-internet request.
- The source archive was inspected for excluded local configuration, databases, credentials, and removed integration endpoints.

This is a runnable local exercise. These checks do not establish production readiness or model quality across every possible student journey. The simulator accepts text; input attachment UI is outside this baseline.
