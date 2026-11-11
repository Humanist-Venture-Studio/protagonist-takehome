# Architecture

The browser simulator is a second application beside the student dashboard. Both are served by the same local controller, so there is one command to start the exercise and no cross-origin setup.

```text
Browser simulator ──→ Controller / simulator API ──→ SQLite queue
Student dashboard ──→ Controller / session API          │
Admin dashboard   ──→ Controller / inspection API       ▼
                                                Student worker
                                                Pi Durable
                                                Workspace + SQLite
                                                      │
                                                Credential broker ──→ OpenRouter
```

| Area | Files | Responsibility |
| --- | --- | --- |
| Bootstrap | `src/server.ts`, `compose.yaml`, `src/config.ts` | Local listeners, scheduler, configuration |
| Simulator | `web/simulator.html`, `src/simulator.ts` | Students, chat, polling, stopping, downloads, dashboard handoff |
| Durable controller state | `src/store.ts`, `src/jobs.ts` | Idempotent input, ordered jobs, local outbox, retries, reminders |
| Workers | `src/docker.ts`, `src/worker.ts` | Per-student container/volume, Pi lifecycle, local tools |
| Context | `src/persistence.ts`, `src/admission.ts`, `src/workspace.ts` | Fact and goal extraction, verification, restart-safe admission |
| Advice policy | `src/advice.ts`, `skills/goal-planning/SKILL.md` | Ordered decision-support, evidence and dissatisfaction-recovery contract |
| Broker | `src/broker.ts`, `src/model-usage.ts`, `src/models.ts` | Student credentials, local deliveries, OpenRouter, limits and cost metadata |
| Dashboards | `src/student.ts`, `src/admin.ts`, `web/dashboard.html`, `web/admin.html` | Student state and evaluator inspection |
| Documents | `src/files.ts`, `src/html.ts`, `src/forms.ts`, `skills/` | Safe downloads, document validation and local file generation |

## Message lifecycle

The simulator generates a request ID and retains it if submission fails. Admission stores the message and queue item in one SQLite transaction; retries with the same ID and text reuse the job. Each student's oldest unfinished job runs first, while different students can run concurrently.

The controller submits a stable `simulator-N` request to the worker. Before Pi admission, the worker persists an input manifest and captures explicit goals and durable facts. Pi and the manifest retain the state needed to resume. The controller polls for completion and atomically stores the local reply and completion receipt. A browser reload reads the same transcript.

Files and progress messages use tool request IDs and durable receipts. A file is stored in the controller for simulator download and indexed in the worker for the dashboard. Both are scoped to the issuing student's identity. The transcript endpoint returns the most recent 300 entries; older entries remain in SQLite.

## Ideas loading

Ideas first serves the current saved list, or immediate starting suggestions derived from active goals. Model refinement runs in the background and is scheduled on the first visit rather than waiting for the reconciliation interval. Chat takes priority and cancels a running refinement. Starting suggestions have stable context-based IDs so a visible suggestion remains selectable after refinement finishes; changed or deleted context invalidates it.

## Decision-support flow

Choice-oriented conversations use the ordered contract in `src/advice.ts`: answer from known context, frame realistic paths, bound current evidence, create a delivered comparison worksheet when depth requires it, and change move shape after dissatisfaction. The same five steps appear in the goal-planning skill so the runtime prompt and task guidance agree. Automated tests pin the deterministic contract and its worker wiring; `docs/advisory-manual-qa.md` defines model replay cases because generated behavior remains nondeterministic.

## Isolation and recovery

Each worker has its own volume, SQLite conversation, workspace, and broker token. The internal Docker bridge has no internet egress. The controller belongs to both bridges: its evaluator HTTP listener binds only to the public bridge interface, while the credential broker is available to workers. Docker bridge isolation prevents workers from reaching the evaluator listener through the public address.

The worker can use read/write/edit/bash and local document tools, but it has no search or page-fetch tool. The broker exposes only a fixed OpenRouter destination for model requests. Model selection and output limits are enforced by the controller.

The schema is a fresh exercise schema. It is not a migration target for an existing production database. Local data persists across ordinary container restarts. Deleting a test student in Admin removes their worker volume and controller records. The package command never includes that data.

## Deliberate limits

The console has no user login and is intended for one local evaluator. The UI polls for updates. There is no input-attachment UI, production deployment system, or exact dollar spending cap. These constraints are visible so a candidate can distinguish the provided application from a production design.
