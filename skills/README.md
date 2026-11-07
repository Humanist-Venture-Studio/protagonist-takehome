# Skills

Each folder here is one skill, baked into the worker image at `/app/skills/<name>/`. The worker lists every skill's name and description in the system prompt; the agent reads the skill's `SKILL.md` with its `read` tool before doing that kind of work.

```
skills/<name>/SKILL.md      front matter (name, description) and the instructions
skills/<name>/...           templates and other assets the instructions refer to
skills/<name>/bin/*.mjs     scripts the agent runs with bash: node /app/skills/<name>/bin/<script>.mjs
```

`SKILL.md` starts with:

```
---
name: <folder name>
description: <one line: when to use this skill>
---
```

Skills are instructions and tools, not permissions. Anything a skill must not be able to do is enforced by the broker or controller, because the agent's `bash` can reach every broker route. Large assets (fonts, templates) should be copied with `cp`/`cat`, never opened with `read`, so they do not enter the conversation. Changing a skill changes the worker image; reconciliation moves idle students to it after a deploy.
