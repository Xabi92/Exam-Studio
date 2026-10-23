# EXAM STUDIO — MASTER BUILD PROMPT / COMMAND
Reusable multi-file exam practice application. User-facing interface: Arabic and English, including RTL support.

## ROLE
Act as a senior full-stack developer, UX/UI designer, assessment specialist, and careful question-bank editor. Build a reusable application named Exam Studio. It must not be a static page with hard-coded questions. It must support repeated imports of PDF/DOCX exam files, question extraction, answer verification, explanations, uncertainty review, teacher approval, and student quizzes.

Never claim that a question is verified if it is not. Never invent missing question text, answer choices, page references, sources, or evidence. Preserve source wording unless the teacher approves an edit.

## 1. TWO WORKSPACES

**TEACHER / ADMIN**
- Import new files repeatedly and create separate named banks.
- Show extracted question, options, source filename/page, proposed answer, explanation, evidence, confidence/verification status, OCR notes, and ambiguity flags.
- Preserve original extracted text alongside any corrected display text.
- Allow edit, approve, reject, hold, or mark ambiguous.
- Keep unverified questions out of student quizzes by default.
- Preview the student view before publishing.
- Export/import complete banks as JSON, preserving IDs, explanations, source metadata, and statuses.
- Never silently overwrite existing banks or questions.
- Maintain a simple change/review log.

**STUDENT / QUIZ**
- Show only approved questions by default.
- Always display the complete question stem, any necessary instruction/passage/image, and all answer choices.
- Never show choices without the question text.
- After the student selects an answer and presses "Check answer", show correct/incorrect status, correct answer, explanation, and verification status.
- Include a prominent "Next question" button; do not auto-advance before the explanation can be read.
- Show progress, score, end summary, incorrect-answer review, and retry mistakes.
- Hide answers before submission unless the teacher deliberately enables study mode.
- Allow flagging a questionable item.

## 2. REPEATED FILE-IMPORT WORKFLOW
For every new file:
1. Preserve original filename and create an import record.
2. Extract question text; for scanned PDFs, use OCR and page images, not just text-layer extraction.
3. Detect question boundaries, numbering, instructions, passages, tables, images, options, and language.
4. Preserve source page number and, if possible, page image/crop reference for teacher comparison.
5. Put extracted questions in a teacher review queue before adding them to the approved bank.
6. Detect duplicates but never merge automatically.
7. Let the teacher create a new bank, append to an existing bank, or merge after preview.
8. Prevent incomplete questions from being published.

Validation required before student use:
- Non-empty complete question stem.
- All required choices are present and non-empty.
- Valid correct answer(s) mapped to stable option IDs, not just visual letters.
- A question-specific explanation exists.
- Verification status is set.
- Source filename/page are recorded when available.
- Empty-stem questions are never shown in student mode.
- Failed records appear in the teacher queue with a clear reason.

## 3. ANSWER TRUST / VERIFICATION STATES
- **A. VERIFIED — SUPPLIED SOURCE:** supported by an official key, textbook, guide, or source supplied by the user.
- **B. VERIFIED — EXTERNAL SOURCE:** checked against a credible external reference; store its title, URL/bibliographic details, access date, and what it supports.
- **C. INDEPENDENTLY SOLVED — HIGH CONFIDENCE:** reasoned out, but not authoritatively verified.
- **D. NEEDS REVIEW:** uncertainty, unclear source, or possibly multiple answers.
- **E. AMBIGUOUS / DEFECTIVE:** more than one defensible answer or a likely flaw.
- **F. UNREADABLE / INCOMPLETE:** source/OCR quality prevents reliable transcription.

Never label an independently reasoned answer as verified. Confidence percentages are not proof; if displayed, label them as estimates, not statistical guarantees, and state the basis. Prefer clear status labels over misleading precision.

Default policy:
- Only "Verified — Supplied Source" and "Verified — External Source" may appear in formal graded quizzes.
- "Independently Solved — High Confidence" may appear in practice mode only if the teacher explicitly allows it, with its status visible.
- Needs Review, Ambiguous/Defective, and Unreadable/Incomplete are excluded from quizzes by default.
- Ambiguous questions must not be scored as though one answer is certainly correct.

Store for each question: answer option IDs, explanation, optional distractor explanations, source/evidence, verification status, confidence basis if used, ambiguity/OCR notes, reviewer decision/date, and original/display wording.

## 4. QUESTION-SPECIFIC EXPLANATIONS
Every published question needs a useful explanation that:
- Explains the rule/fact/reasoning and applies it to this exact question.
- Is not generic filler.
- Identifies when reasoning is inferred rather than based on an official key.
- For grammar, names the rule and applies it to the sentence.
- For vocabulary, explains meaning/use in context.
- For pronunciation, identifies the relevant sound.
- For pedagogy, explains the concept and distinguishes close alternatives when useful.
- For translation/religious text, does not guess obscured words; flag unclear source text for review.
- Supports Arabic, English, or bilingual explanations.
- Can be edited by the teacher before approval.
Optionally explain why distractors are wrong.

## 5. VISUAL DESIGN / COLOURS / ACCESSIBILITY
Clean, calm, professional, mobile-first, suitable for Android phones, tablets, and desktops. Use high contrast and never rely on color alone.

Palette: app background #F4F7FB; card #FFFFFF; main text #172033; secondary text #475569; primary button #1D4ED8 with white text; correct panel #DCFCE7 / text #14532D; incorrect panel #FEE2E2 / text #7F1D1D; explanation panel #DBEAFE / text #1E3A8A; warning panel #FEF3C7 / text #78350F; borders #CBD5E1; focus outline #2563EB.

Rules: dark text on coloured panels; no light-gray text on white; no gradients or patterned/photo backgrounds behind explanation text; correct/incorrect feedback includes words/icons; mobile body text ≥16px, stem 19–22px semibold, options 17–18px, explanation 16–18px with line-height ≥1.5; WCAG AA (4.5:1); support zoom, keyboard focus, screen readers and RTL; Arabic UI flows RTL while English question text remains LTR; prevent device/browser dark mode from making text unreadable (consistent light theme).

## 6. QUIZ BEHAVIOUR
Order on screen: bank/test title → progress (e.g. 7 of 30) → question number and source context → full question text and necessary passage/instruction/image → all answer choices with clear labels → Check answer → after submission: correct/incorrect status, correct answer, explanation, verification status → Next question → optional flag → final score, accuracy, unanswered items, review mistakes, retry mistakes.

Teacher configuration: number of questions, topic/category, practice vs formal test, immediate vs end feedback, question/option randomization, optional timer (off by default), inclusion of independently solved items in practice, retrying mistakes. When options are shuffled, stable option IDs must preserve answer mapping.

## 7. DATA MODEL
```json
{
  "id": "stable-unique-id",
  "bank_id": "source-bank-id",
  "source_file": "original filename",
  "source_page": 1,
  "source_question_number": "1",
  "language": "en|ar|mixed",
  "question_type": "single_choice|multiple_select|short_answer|other",
  "stem_original": "exact source text",
  "stem_display": "reviewed display text",
  "context": "passage or instruction if needed",
  "options": [{"id":"A","label":"A","text":"option text"}],
  "correct_option_ids": ["C"],
  "explanation_en": "specific explanation",
  "explanation_ar": "specific explanation",
  "distractor_explanations": {},
  "verification_status": "needs_review",
  "estimated_confidence": null,
  "confidence_basis": "",
  "evidence": [],
  "ambiguity_notes": "",
  "ocr_notes": "",
  "review_status": "draft|needs_review|approved|rejected",
  "approved_for_practice": false,
  "approved_for_formal_test": false,
  "created_at": "",
  "updated_at": ""
}
```
Do not store only the correct letter if options can be reordered; use stable option IDs.

## 8. LOCAL STORAGE, PRIVACY, MULTIPLE USE
Preferred first delivery: a local-first teacher master app storing multiple named banks in IndexedDB or equivalent persistent storage, with explicit backup/export and restore/import. Explain that browser data may be lost if storage is cleared or a different browser/device is used. Offline mode should allow practice from approved banks without AI.

Do not claim the HTML file itself provides cloud sync, OCR, AI, or a database. Do not place an AI API key in client-side HTML/JavaScript. AI requires a secure backend or a deliberately configured local model. If public multi-student deployment is later required, add authentication, role-based permissions, database backups, and secure server hosting. Never expose the master answer key before quiz submission.

## 9. QUALITY ASSURANCE — MUST TEST BEFORE DELIVERY
Every question has a visible non-empty full stem; all options display and are readable; HTML characters in source text do not break rendering; feedback and explanations readable on every screen; sufficient contrast; Next advances exactly once; progress and score accurate; correct answer stays correct after shuffling; OCR uncertainty flagged; incomplete records cannot be published; JSON export/import preserves explanations, IDs and statuses; import does not overwrite existing banks; mobile layout, zoom, keyboard, LTR and RTL work. Regression tests: question with options but no stem is blocked; published question with no explanation is blocked; contrast of correct, incorrect, explanation and warning panels.
Provide a report distinguishing tests actually run from tests not run. Never claim unperformed tests passed.

## 10. CURRENT SOURCE EXAM TO PROCESS
Current file: "أسئلة مسابقة انكليزي - أوقاف 2026.pdf" (scanned; questions 1–86: English 1–70, Arabic pedagogical 71–86). Use page images and OCR review. Preserve source question numbers/pages. Treat green diagonal marks as possible watermark, not proof of a correct answer.
Known items needing special review: Q5 (to / into / both), Q22 (complement phrase terminology), Q39 (several activities plausible), Q52 (-ed pronunciation; possible defect), Q56 (underlined word may be obscured; do not guess), Arabic questions 71–86 (careful transcription; mark unreadable rather than invent).

## 11. REQUIRED DELIVERABLES
1. Runnable app files, not a mockup alone. 2. This reusable specification. 3. A sample bank export containing only actually extracted questions with unverified answers clearly marked. 4. A teacher review report with counts. 5. Local setup/use instructions and explicit limitations. 6. Never call the bank fully verified if anything remains unchecked. 7. For each future uploaded file, repeat extraction, verification, explanation, review, approval and save. 8. Keep the master bank private unless the user explicitly chooses to publish a student version.

---

## 12. ADDENDUM (added in build 1): installable app and AI-converted text files
- The app is a PWA: it can be installed on Android, desktop and iOS (Add to Home Screen) when served over https or localhost, and then works offline. Question data stays in IndexedDB on that device; the service worker caches only app files.
- Files the app cannot read itself (scanned PDF, DOCX, images; the app contains no OCR/PDF/Word engine) are converted to the **Exam Studio text format** by an AI assistant using the prompt built into the app (tab "Add questions" → "Prompt to give an AI assistant"). The resulting `.txt` is loaded in the app, previewed, and added to the review queue.
- The importer never trusts a verification claim: `verified_supplied` / `verified_external` without evidence (and, for external, URL + access date) is automatically downgraded to *Needs Review*. A solved status without an answer is downgraded too. Everything lands as *awaiting review*, never approved.
- Questions can also be typed directly, edited, given more/fewer options, and re-approved. Editing an approved question resets its approval.

### Text format
```
BANK: <bank name>
SOURCE: <original file name>
---
Q: <number as printed>
PAGE: <page>
LANG: en | ar | mixed
STEM: <full question text exactly as printed>
CONTEXT: <passage / instruction, optional>
A) <option>
B) <option>
C) <option>
D) <option>
ANSWER: <letter(s) or empty>
EXPLANATION_EN: <specific explanation>
EXPLANATION_AR: <optional>
STATUS: verified_supplied | verified_external | independently_solved_high | needs_review | ambiguous_defective | unreadable_incomplete
EVIDENCE: <title> | <URL or bibliographic details> | <date accessed> | <what it supports>
AMBIGUITY: <notes>
OCR: <notes>
---
```
