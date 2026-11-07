---
name: pdf-forms
description: Fill a PDF using confirmed information already known, ask for missing answers, and save a verified editable copy in the student's Files and the simulator, never claiming submission.
---
# Filling PDF forms

Use this when the student asks you to fill out a form, or a plan step needs a form prepared. You prepare a reviewable copy. The student checks it, signs, pays or submits it themselves.

## 1. Get the official original

- If the student sent the form, it is in `/data/workspace/uploads/`. There is no web access in this exercise. Use a PDF already in the workspace.
- Record where the form came from, its edition or revision date if printed, and keep the original untouched. Work on copies in `/data/workspace/forms/<short-name>/`.
- A copy from an unofficial site is labelled as such until you confirm it matches the official one.

## 2. Inspect

Call `inspect_pdf_form` with the original PDF's workspace `path`.

- **The output:** one line per field, with its `name` (use exactly this in values), `type`, `page`, `label` (the field's tooltip, when present), `nearby` (the printed words beside or above it, which is usually the question), `options`, `maxLength`, and `required`.
- **When labels are not enough:** read the form's text (the text extracted from the workspace PDF) to understand instructions that apply to several fields.
- **`supported: false`:** an XFA-only, encrypted, already-signed or flat (scanned) form. Tell the student plainly why. Offer to look for the official fillable version, or make an answer sheet: a short HTML document (html-document skill) listing each question and their answer, which they copy onto the form or into the portal. Never claim to have filled a form you could not fill.

## 3. Map answers, with care

- Read current `MEMORY.md`, relevant goal files, the current conversation and any existing form draft first. Use information already confirmed for this student; do not make them repeat it. Respect corrections and deletions in current memory rather than restoring old facts from conversation history.
- Write `/data/workspace/forms/<short-name>/values.json`, mapping each field name to its value. For each value, note where it came from (the student said, current memory, their goal file) in `notes.md`. Record the original PDF path and every unresolved field there too. Save the draft before asking a question, update it after each answer, and resume it on later turns instead of starting over.
- **Use only confirmed facts.** A preferred name is not automatically a legal name. An old address may be stale. Something read from a photo is not confirmed until the student says so. Keep "unknown", "not applicable" and "left blank on purpose" distinct.
- **Ask only for missing or uncertain answers**, one focused question per reply. Keep the full missing-items list in the draft, avoid repeating answered questions, and explain unusual questions in plain words. Distinguish unanswered questions from fields the student explicitly chose to leave blank. Do not complete the final copy while answerable questions remain unresolved; the student can ask for a partial draft or leave fields to fill in by hand.
- **Never ask for or enter** Social Security or other government ID numbers, passwords, bank or card details, or immigration document numbers. Leave those fields blank and list them for the student to complete.
- **Checkboxes** take `true` or `false`. Radio and dropdown fields take one of the listed `options`, exactly as written.

## 4. Fill and verify

1. Call `fill_pdf_form` with the original `path`, the confirmed field-to-value mapping as `values`, and an optional neutral `filename` such as `application-filled.pdf`.
   - It fills everything or nothing. If `status` is `not_filled`, fix the reported problems (an unknown field, a bad option, too long, characters the form font cannot show) and retry. No completed file was saved.
   - Read the warnings, `blankRequired`, `blank`, and `signatures`. Required flags in PDFs are not always reliable; also use the printed instructions and your unresolved-fields list.
2. A successful `status: saved` means the tool read every written value back, saved an editable copy without changing the original, verified the saved bytes, and added it to the student's dashboard **Files**. Use the returned `path`; never invent a completed-file path or claim a failed save succeeded. Repeating the same input reuses the same file.
3. Keep fields editable so the student can correct them or complete sensitive fields. The CLI remains available for a requested flattened extra copy: `node /app/skills/pdf-forms/bin/pdf-form.mjs fill <form.pdf> <values.json> <copy.pdf> --flatten <flat.pdf>`, followed by `verify <copy.pdf> <values.json>`. Never flatten away fields the student still has to complete or sign, and deliver the extra copy with `send_file`.
4. A mapping you have checked is valid only for that exact original. If the institution posts a new version, inspect it again. File verification checks stored values, not the correctness of personal facts or every PDF viewer's visual layout.

## 5. Deliver for review

- `send_file` the filled PDF, captioned something like "Filled draft: please review before you sign or submit".
- Tell the student the completed copy is saved in **Files**. If the simulator delivery fails, say that sending failed but the saved copy remains in their dashboard; offer a fresh dashboard link when useful. Never claim an attachment arrived until `send_file` succeeds.
- Then reply in chat with:
  - what you filled, in a few words;
  - what is still blank and why (sensitive fields, things they need to decide);
  - where they must sign, date, pay or upload;
  - how to submit it (the official address or portal from the form or the institution's page).
- If a plan step depends on this form, mark it "form prepared". It becomes "submitted" only when the student confirms they submitted it or sends a confirmation.

## Never

- Submit, email, upload, sign, certify or pay on the student's behalf.
- Fill in answers the student has not confirmed for consequential questions (eligibility, income, residency, criminal history, certifications).
- Present a prepared form as submitted.
