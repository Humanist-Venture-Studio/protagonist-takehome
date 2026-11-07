# Protagonist take-home

Read README.md and PROJECT.md before changing code.

- This is a standalone local coding exercise. Do not deploy it or publish it to another repository unless explicitly asked.
- OpenRouter is the only external runtime service. Keep student messaging and file delivery local.
- Preserve per-student worker isolation, durable requests, and saved goals and memory.
- Use fictional data. Never print, commit, or package `.local/runtime.json`, API keys, databases, or student files.
- Runtime configuration is JSON, not dotenv. Use `npm run setup` to create the ignored mode-0600 config.
- Run `npm run check:types` and `npm run test:linux` after substantive changes. Linux is required for worker file-safety tests.
- Rebuild/start with `npm run local`; stop with `npm run local:stop`.
- Package with `npm run package:candidate`, which uses an explicit source allowlist.
