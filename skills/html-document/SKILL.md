---
name: html-document
description: Make a polished Protagonist HTML document (report, comparison, plan, checklist) and deliver it as a file in the simulator.
---
# Protagonist HTML documents

Use this whenever you deliver a report, comparison, plan, checklist or other document. The student gets one self-contained `.html` file that looks like Protagonist, reads well on a phone, prints cleanly, and works offline.

## Steps

1. Work in a folder for this document, for example `/data/workspace/documents/<short-name>/`.
2. Copy the template: `cp /app/skills/html-document/template.html /data/workspace/documents/<short-name>/draft.html`. For a plan, copy `/app/skills/html-document/examples/goal-plan.es.html` instead; it shows the timeline.
3. Read the draft once to see the components, then replace the example content section by section with `edit` (or `write` small pieces). Keep the `<style>` block and the `<!--protagonist:fonts-->` line exactly as they are. Never `read` `fonts/fonts.css`; it is large and the build step adds it.
4. Set `<html lang>` to the student's language (`en` or `es`) and write every word in that language, including labels.
5. Build: `node /app/skills/html-document/bin/build.mjs draft.html <name>-v1.html`. It embeds the fonts and checks the document. If it prints problems, fix them in the draft and build again.
6. Deliver the built file with `send_file`, with a one-line caption. Then reply in chat with the answer in two or three sentences and one or two natural next steps. The chat reply must make sense without opening the file.

## Content rules

- **Title:** short and specific to what was actually covered ("Nursing at a community college near Newark", not "School Report"). Never put the student's full name, birth date or ID numbers in the title, filename or body unless the document needs them.
- **The answer comes first,** in the yellow `.answer` panel: the recommendation or key point, its main reason, and the main tradeoff. Use exactly one.
- **Facts:** up to three in `.facts`. Each one should matter for the decision.
- **Tables:** always wrap them in `<div class="scroll">` with a `<caption>`, and add the `.scroll-hint` line above. Mark the recommended row `class="pick"`.
- **Evidence labels:** use `.tag verified`, `.tag estimate`, `.tag unknown` and `.tag deadline` next to the value they describe. The words carry the meaning and the colour only supports them. Say "unknown" rather than guessing.
- **Citations:** every cost, deadline, requirement or statistic gets a `<sup class="ref"><a href="#sN">N</a></sup>` pointing to an `<li id="sN">` in Sources, with the page title as a link and the date you read it.
- **Uncertainty:** put what could change the recommendation in a `.callout` ("Check this before you decide").
- **Next steps:** up to three in `.steps`, each with a `.when`.
- **Handwritten notes:** `.note` at most twice, for a short human aside. No other decoration.
- **Status:** mark a document `Draft` until the student has confirmed the facts it depends on, then `Final`. Increase the version (`-v2`) whenever you send a changed copy.
- Remove example sections you do not need. Add only the components defined in the template.

## What the build refuses

Scripts, event handlers (`onclick` and the like), iframes, objects, embeds, forms and inputs, `<link>`, `<base>`, `<meta http-equiv>`, audio and video, remote images, fonts or stylesheets (anything not a `data:` URI), `javascript:` links, and relative links. It also requires `<!doctype html>`, `lang`, `<meta charset="utf-8">`, a viewport meta tag, a `<title>`, and exactly one `<h1>`. The same check runs when the file is sent, so a document that skips the build is refused at delivery with the reason.

See `style-guide.md` for the visual rules behind the template.
