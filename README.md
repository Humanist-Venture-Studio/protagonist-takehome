# Protagonist — Candidate Take-Home & Working Session

A sample AI student advisor for first-generation students, working adults, and bilingual EN/ES learners. This standalone exercise copy of `Humanist-Venture-Studio/protagonist-v2` uses a browser simulator, persistent goals and memory, downloadable plans, and reminders. OpenRouter is the only external runtime service.

The code was built iteratively with AI coding agents. We’re evaluating your ability to choose the right problem, justify the tradeoffs, and verify a change.

## Run

You need Node.js 24.14+ and Docker running. We’ll provide an OpenRouter test key separately.

```sh
npm ci
npm run setup
```

Add your key to `openrouterKey` in `.local/runtime.json`, then:

```sh
npm run local
```

Open the [simulator](http://localhost:3210/simulator). **Open dashboard** shows the student’s goals, memory, and files; [Admin](http://localhost:3210/admin/) shows what the assistant is doing. This copy accepts text; voice/photo input and web research are outside the exercise.

## Candidate instructions

**Spend 2.5–3 hours maximum.** Suggested split: 30 minutes exploring, 60 minutes critique, 75 minutes implementation, 15 minutes handoff. Stop after three hours; incomplete work with clear reasoning is acceptable.

Explore as two fictional students. Try setting a goal, correcting a remembered fact, requesting a file, and restarting. Check that their data stays separate. See [architecture](docs/architecture.md) for the code map.

**A. Critique and 90-day plan:** Write a 1–2 page `CRITIQUE.md`. Focus on your two or three strongest findings:

- What would you keep or change across UX/latency/cost, scaling, and maintainability? Support findings with code references, observed behavior, or measurements. Distinguish demonstrated problems from hypotheses.
- What changes between a 50-student pilot and 5,000 students? State assumptions about daily activity, concurrent conversations, and message volume.
- What are your top three priorities for the first 90 days? Explain what you would simplify, re-architect, and build or evaluate next.

**B. One scoped improvement:** On a local branch, fix or prototype one finding. Use your normal AI coding tools. Preserve student isolation and durable state. Possible investigation areas:

- Turn latency and context/reply processing: `src/worker.ts`, `src/persistence.ts`, `src/replies.ts`.
- Dispatch and concurrency: `src/simulator.ts`, `src/jobs.ts`, `src/server.ts`, `src/docker.ts`.
- Memory/Ideas grounding and regression tests: `src/persistence.ts`, `src/ideas.ts`, `tests/`.
- Decomposing a compressed module into testable pieces.

Verify with:

```sh
npm run check:types
npm run test:linux
```

The Linux suite runs in Docker, including on macOS. Rebuild with `npm run local`; stop with `npm run local:stop`.

## Submit

Send your code and `CRITIQUE.md` to [matthew@getprotagonist.com](mailto:matthew@getprotagonist.com) by the deadline in your interview invitation. Include a short handoff in `CRITIQUE.md`: what changed, verification results, tradeoffs, unfinished work, and how you steered and checked your AI tools. No slides needed.

Run `npm run package:candidate` to create `dist/protagonist-takehome.tar.gz`, including `CRITIQUE.md` when present. Submit that archive or an agreed private branch/PR link. Work from this copy; keep API keys and student data out of your submission. Model calls use OpenRouter credit.

## Live working session — 110 minutes

- Past systems and context: 20 minutes.
- Architecture, product strategy, and your critique: 30 minutes.
- Pairing on a new requirement or constraint using your normal AI setup: 45 minutes.
- Your questions: 15 minutes.
