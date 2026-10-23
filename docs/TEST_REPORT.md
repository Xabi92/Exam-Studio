# Test report

## Actually run (all passed on the final build)
**Unit tests — `node tests/run_tests.js`: 55 passed, 0 failed.** Validation rules (empty stem, whitespace stem, missing options/answer/explanation/status/source, duplicate ids), the two regression tests (options but no stem → blocked; no explanation → blocked), quiz-eligibility policy (formal = verified only; independently solved only if the teacher allows; needs-review/ambiguous/unreadable never shown), approval gates, 1000 random shuffles keep the right answer by stable option id, JSON export→import round-trip, import never overwrites (re-keyed copy), append import forces review queue and flags duplicates without merging, text-format parser (incl. downgrade of unsupported "verified" claims, HTML-like text kept verbatim), sample-bank honesty checks (86 questions, nothing verified/approved, Q22/Q56 blocked), WCAG contrast of all panel/button colour pairs ≥ 4.5:1, Arabic/English string coverage, syntax checks, light-only theme, no gradients.

**Browser tests — `python3 tests/e2e_test.py` (headless Chromium via Playwright, 390 px phone viewport): 68 passed, 0 failed.** Real UI flows: RTL/LTR switching, sample import (86 cards), students see nothing before approval, approval gates (Q56, Q5, formal), practice-setting gate, quiz with shuffled questions and options (8 distinct questions, correct/incorrect feedback, explanation and verification shown, answers hidden before checking), double-click on Next advances once, score/accuracy/mistake review/retry, computed-style contrast on the correct, incorrect and explanation panels, font sizes, PDF-selection notice and AI prompt, text-file import with preview, claimed-verified downgrade, HTML/`<img onerror>` rendered as text (no script run), empty-stem item refused, manual add/edit/add-remove option, edit resets approval, verified-without-evidence refused, mark ambiguous, change log, export download and re-import as a new copy, persistence after reload, no horizontal overflow at 390 px, dark-mode emulation keeps the light theme, keyboard focus outline, manifest, service worker, offline reload.
Also: the single-file build opened from `file://` and imported the bank without errors.
Not covered by the warning-panel contrast browser check: the warning-panel colours were checked in the unit contrast test only.

## NOT run (do not assume these pass)
- Real Android/iOS devices, tablets, Firefox, Safari, Edge; the actual install prompt on a phone.
- Screen readers (TalkBack, VoiceOver, NVDA); 200 % browser zoom; full keyboard-only walkthrough of every screen.
- Large banks (thousands of questions) and performance.
- Timer behaviour (implemented, not exercised), study-mode "show answer", multiple-select questions, student-flag button, student-version export, bank deletion.
- Pixel comparison of the transcription against the PDF page images: transcription was done by reading the images, and the teacher must compare each card (see OCR notes).
- Any verification of answers against an official key (none was available).
