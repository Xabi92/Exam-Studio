/* Exam Studio core logic. Pure functions, no DOM, no storage. Works in browser (window.ESCore) and Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERIFICATION = {
    verified_supplied: 'Verified — Supplied Source',
    verified_external: 'Verified — External Source',
    independently_solved_high: 'Independently Solved — High Confidence',
    needs_review: 'Needs Review',
    ambiguous_defective: 'Ambiguous / Defective',
    unreadable_incomplete: 'Unreadable / Incomplete'
  };
  var VERIFIED = ['verified_supplied', 'verified_external'];
  var REVIEW_STATUSES = ['draft', 'needs_review', 'approved', 'rejected', 'hold'];

  function str(x) { return (x === undefined || x === null) ? '' : String(x); }
  function nonEmpty(x) { return str(x).trim().length > 0; }
  function stemOf(q) { return nonEmpty(q.stem_display) ? q.stem_display : q.stem_original; }

  /** Returns array of reason strings. Empty array = structurally publishable. */
  function validateQuestion(q) {
    var r = [];
    if (!nonEmpty(stemOf(q))) r.push('EMPTY_STEM: the question text is empty');
    var opts = Array.isArray(q.options) ? q.options : [];
    var type = q.question_type || 'single_choice';
    if (type === 'single_choice' || type === 'multiple_select') {
      if (opts.length < 2) r.push('OPTIONS_MISSING: fewer than 2 answer choices');
      var seen = {};
      opts.forEach(function (o, i) {
        if (!o || !nonEmpty(o.id)) r.push('OPTION_ID_MISSING: option #' + (i + 1) + ' has no stable id');
        else if (seen[o.id]) r.push('OPTION_ID_DUPLICATE: ' + o.id);
        else seen[o.id] = true;
        if (!o || !nonEmpty(o.text)) r.push('OPTION_EMPTY: option ' + (o && o.id ? o.id : '#' + (i + 1)) + ' has no text');
      });
      var ids = Array.isArray(q.correct_option_ids) ? q.correct_option_ids : [];
      if (ids.length === 0) r.push('NO_CORRECT_ANSWER: no correct option is recorded');
      ids.forEach(function (id) { if (!seen[id]) r.push('CORRECT_ID_INVALID: ' + id + ' is not an option id'); });
      if (type === 'single_choice' && ids.length > 1) r.push('MULTIPLE_CORRECT_FOR_SINGLE_CHOICE');
    }
    if (!nonEmpty(q.explanation_en) && !nonEmpty(q.explanation_ar)) r.push('NO_EXPLANATION: no question-specific explanation');
    if (!VERIFICATION[q.verification_status]) r.push('NO_VERIFICATION_STATUS: status is missing or unknown');
    if (!nonEmpty(q.source_file)) r.push('NO_SOURCE_FILE: source filename is not recorded');
    return r;
  }

  /** Can this question be shown to students in the given mode? Returns {ok, reasons[]} */
  function eligibility(q, mode, bankSettings) {
    var s = bankSettings || {};
    var reasons = validateQuestion(q);
    if (q.review_status !== 'approved') reasons.push('NOT_APPROVED: review status is "' + q.review_status + '"');
    var st = q.verification_status;
    if (mode === 'formal') {
      if (VERIFIED.indexOf(st) < 0) reasons.push('FORMAL_REQUIRES_VERIFIED_SOURCE');
      if (!q.approved_for_formal_test) reasons.push('NOT_APPROVED_FOR_FORMAL');
    } else {
      if (!q.approved_for_practice) reasons.push('NOT_APPROVED_FOR_PRACTICE');
      var okStatus = VERIFIED.indexOf(st) >= 0 || (st === 'independently_solved_high' && s.allowIndependentInPractice === true);
      if (!okStatus) reasons.push('STATUS_NOT_ALLOWED_IN_PRACTICE: ' + st);
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function eligibleQuestions(questions, mode, bankSettings) {
    return questions.filter(function (q) { return eligibility(q, mode, bankSettings).ok; });
  }

  /** Fisher-Yates; rng injectable for tests. Returns a new array. */
  function shuffle(arr, rng) {
    var a = arr.slice(), f = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(f() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** Option ids are stable. Display letters are assigned by position AFTER shuffling. */
  function presentQuestion(q, opts) {
    var o = opts || {};
    var options = o.shuffleOptions ? shuffle(q.options, o.rng) : q.options.slice();
    var letters = 'ABCDEFGHIJ';
    return {
      question: q,
      options: options.map(function (x, i) { return { id: x.id, text: x.text, displayLabel: letters[i] || String(i + 1) }; })
    };
  }

  function isCorrect(q, selectedIds) {
    var a = (q.correct_option_ids || []).slice().sort().join('|');
    var b = (selectedIds || []).slice().sort().join('|');
    return a.length > 0 && a === b;
  }

  function normalizeText(s) {
    return str(s).toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function fingerprint(q) {
    return normalizeText(stemOf(q)) + '||' + (q.options || []).map(function (o) { return normalizeText(o.text); }).join('|');
  }
  /** Flags (never merges) questions whose fingerprint already exists. Returns map newId -> existingId */
  function findDuplicates(existing, incoming) {
    var idx = {}; existing.forEach(function (q) { idx[fingerprint(q)] = q.id; });
    var out = {};
    incoming.forEach(function (q) { var f = fingerprint(q); if (idx[f]) out[q.id] = idx[f]; });
    return out;
  }

  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  function buildExport(bank, questions, imports, log) {
    return {
      format: 'exam-studio-bank', version: 1, exported_at: new Date().toISOString(),
      bank: bank, questions: questions, imports: imports || [], log: log || []
    };
  }

  /**
   * Import never overwrites. If bank id or any question id already exists, everything is re-keyed as a new copy.
   * mode 'new' => new bank. mode 'append' (targetBankId) => questions added to that bank as drafts, duplicates flagged only.
   */
  function prepareImport(existing, payload, options) {
    var opt = options || {};
    var errors = [];
    if (!payload || payload.format !== 'exam-studio-bank' || !payload.bank || !Array.isArray(payload.questions)) {
      return { ok: false, errors: ['Not an Exam Studio bank file.'] };
    }
    var existingBankIds = existing.banks.map(function (b) { return b.id; });
    var existingQIds = {}; existing.questions.forEach(function (q) { existingQIds[q.id] = true; });
    var bank = JSON.parse(JSON.stringify(payload.bank));
    var qs = JSON.parse(JSON.stringify(payload.questions));
    var rekeyed = false;
    var notes = [];

    if (opt.mode === 'append') {
      var target = existing.banks.filter(function (b) { return b.id === opt.targetBankId; })[0];
      if (!target) return { ok: false, errors: ['Target bank not found.'] };
      qs.forEach(function (q) {
        if (existingQIds[q.id]) { q.id = uid('q'); rekeyed = true; }
        q.bank_id = target.id; q.review_status = 'needs_review'; q.approved_for_practice = false; q.approved_for_formal_test = false;
      });
      var dups = findDuplicates(existing.questions.filter(function (q) { return q.bank_id === target.id; }), qs);
      qs.forEach(function (q) { if (dups[q.id]) { q.duplicate_of = dups[q.id]; q.ambiguity_notes = (q.ambiguity_notes ? q.ambiguity_notes + ' | ' : '') + 'Possible duplicate of ' + dups[q.id] + ' (not merged).'; } });
      notes.push('Appended ' + qs.length + ' questions to "' + target.name + '" as review-queue items; ' + Object.keys(dups).length + ' possible duplicate(s) flagged, none merged.');
      return { ok: true, bank: target, questions: qs, imports: payload.imports || [], log: payload.log || [], rekeyed: rekeyed, notes: notes, appended: true };
    }

    var conflict = existingBankIds.indexOf(bank.id) >= 0 || qs.some(function (q) { return existingQIds[q.id]; });
    if (conflict) {
      var newBankId = uid('bank');
      var map = {};
      qs.forEach(function (q) { var nid = uid('q'); map[q.id] = nid; q.original_id_before_import = q.id; q.id = nid; q.bank_id = newBankId; });
      bank.original_id_before_import = bank.id; bank.id = newBankId; bank.name = bank.name + ' (imported copy)';
      rekeyed = true;
      notes.push('A bank or question with the same ID already exists. Nothing was overwritten; the file was imported as a new copy.');
    }
    return { ok: true, bank: bank, questions: qs, imports: payload.imports || [], log: payload.log || [], rekeyed: rekeyed, notes: notes, appended: false };
  }

  function summarize(questions) {
    var s = { total: questions.length, approved: 0, by_verification: {}, by_review: {}, blocked: 0 };
    questions.forEach(function (q) {
      s.by_verification[q.verification_status] = (s.by_verification[q.verification_status] || 0) + 1;
      s.by_review[q.review_status] = (s.by_review[q.review_status] || 0) + 1;
      if (q.review_status === 'approved') s.approved++;
      if (validateQuestion(q).length) s.blocked++;
    });
    return s;
  }

  /** Approval gate used by the teacher UI. kind: 'practice' | 'formal'. */
  function canApprove(q, kind, bankSettings) {
    var reasons = validateQuestion(q);
    var st = q.verification_status;
    if (kind === 'formal' && VERIFIED.indexOf(st) < 0) reasons.push('Formal approval needs a Verified status with a source.');
    if (kind === 'formal' && VERIFIED.indexOf(st) >= 0 && (!Array.isArray(q.evidence) || q.evidence.length === 0)) reasons.push('Verified status needs at least one evidence entry.');
    if (kind === 'practice') {
      var ok = VERIFIED.indexOf(st) >= 0 || st === 'independently_solved_high';
      if (!ok) reasons.push('Status "' + VERIFICATION[st] + '" cannot be approved. Resolve the review issue first.');
      if (st === 'independently_solved_high' && !(bankSettings && bankSettings.allowIndependentInPractice))
        reasons.push('Note: students will not see it until "allow independently solved items in practice" is switched on for this bank.');
    }
    // the last note is advisory only
    var blocking = reasons.filter(function (x) { return x.indexOf('Note:') !== 0; });
    return { ok: blocking.length === 0, reasons: reasons, blocking: blocking };
  }

  /* WCAG contrast helper (used by tests) */
  function lum(hex) {
    var c = hex.replace('#', ''); var v = [0, 2, 4].map(function (i) { var x = parseInt(c.substr(i, 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var l1 = lum(a), l2 = lum(b); var hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); }


  /* ---------- Text format (what an AI or a person produces from files the app cannot read) ---------- */
  var TEXT_KEYS = ['BANK', 'SOURCE', 'Q', 'PAGE', 'LANG', 'TYPE', 'STEM', 'CONTEXT', 'ANSWER', 'EXPLANATION', 'EXPLANATION_EN', 'EXPLANATION_AR', 'STATUS', 'EVIDENCE', 'AMBIGUITY', 'OCR', 'CONFIDENCE_BASIS'];

  var AI_PROMPT = [
    'You are preparing exam questions for import into Exam Studio. Convert the attached file (PDF, scan, DOCX or image) into PLAIN TEXT in EXACTLY this format, one block per question, separated by a line of three dashes.',
    '',
    'BANK: <name of the bank>',
    'SOURCE: <original file name>',
    '---',
    'Q: <question number as printed>',
    'PAGE: <page number>',
    'LANG: en | ar | mixed',
    'STEM: <the full question text exactly as printed>',
    'CONTEXT: <passage / instruction / table text, only if needed>',
    'A) <option text>',
    'B) <option text>',
    'C) <option text>',
    'D) <option text>',
    'ANSWER: <letter, or leave empty if you cannot decide>',
    'EXPLANATION_EN: <explanation specific to THIS question, in English>',
    'EXPLANATION_AR: <the same explanation in Arabic, optional>',
    'STATUS: verified_supplied | verified_external | independently_solved_high | needs_review | ambiguous_defective | unreadable_incomplete',
    'EVIDENCE: <source title> | <URL or bibliographic details> | <date accessed YYYY-MM-DD> | <what it supports>',
    'AMBIGUITY: <why more than one answer may be defensible, if so>',
    'OCR: <any word you could not read with certainty>',
    '---',
    '',
    'RULES (important):',
    '1. Never invent missing question text, options, page numbers or sources. If something is unreadable write [unclear] in its place and use STATUS: unreadable_incomplete.',
    '2. Keep the source wording exactly, including mistakes in the exam itself.',
    '3. STATUS verified_supplied only if an official answer key supplied by the user supports the answer. STATUS verified_external only if you checked a real external source and can fill in EVIDENCE with title, URL and date. If you simply reasoned the answer out, use independently_solved_high. If unsure or several answers are defensible, use needs_review or ambiguous_defective.',
    '4. Coloured marks, ticks or watermarks in a scan are NOT evidence of the correct answer.',
    '5. Explanations must apply the rule to this exact question, not generic filler. Say clearly when reasoning is inferred.',
    '6. Output only the formatted text, nothing before or after it.'
  ].join('\n');

  function detectLang(s) {
    var ar = /[\u0600-\u06FF]/.test(s), la = /[A-Za-z]/.test(s);
    return ar && la ? 'mixed' : (ar ? 'ar' : 'en');
  }

  function parseTextBank(text, opts) {
    var o = opts || {};
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var meta = {}, blocks = [], cur = null, field = null, warnings = [];
    function startBlock(i) { cur = { fields: {}, options: [], evidence: [], line: i + 1 }; blocks.push(cur); field = null; }
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (/^(-{3,}|={3,})$/.test(s)) { cur = null; field = null; continue; }
      var m = s.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      var key = m ? m[1].toUpperCase() : null;
      if (m && TEXT_KEYS.indexOf(key) >= 0) {
        if (blocks.length === 0 && !cur && (key === 'BANK' || key === 'SOURCE' || key === 'LANG')) { meta[key] = m[2].trim(); field = null; continue; }
        if (key === 'Q' || !cur) startBlock(i);
        if (key === 'EVIDENCE') { cur.evidence.push(m[2].trim()); field = null; continue; }
        cur.fields[key] = m[2].trim(); field = { key: key }; continue;
      }
      var om = cur && s.match(/^\(?([A-Ja-j])[\)\.:]\s+(.*)$/);
      if (om && !cur.fields.ANSWER && !cur.fields.EXPLANATION && !cur.fields.EXPLANATION_EN && !cur.fields.EXPLANATION_AR) {
        cur.options.push({ id: om[1].toUpperCase(), text: om[2].trim() }); field = { opt: cur.options[cur.options.length - 1] }; continue;
      }
      if (s === '') continue;
      if (field && cur) {
        if (field.opt) field.opt.text += ' ' + s;
        else cur.fields[field.key] += '\n' + s;
      } else warnings.push('Line ' + (i + 1) + ' ignored (outside any question): ' + s.slice(0, 60));
    }
    var questions = [], t0 = new Date().toISOString();
    blocks.forEach(function (b, idx) {
      var f = b.fields, notes = [];
      var num = f.Q || String(idx + 1);
      var stem = f.STEM || '';
      var opts = b.options.map(function (x) { return { id: x.id, label: x.id, text: x.text }; });
      var ans = (f.ANSWER || '').toUpperCase().split(/[^A-J]+/).filter(Boolean);
      var st = (f.STATUS || '').trim().toLowerCase();
      var ev = b.evidence.map(function (e) { var p = e.split('|').map(function (x) { return x.trim(); }); return { title: p[0] || '', url: p[1] || '', accessed: p[2] || '', supports: p[3] || '' }; }).filter(function (e) { return e.title || e.url; });
      if (!VERIFICATION[st]) { if (st) notes.push('Unknown STATUS "' + st + '" replaced by needs_review.'); st = 'needs_review'; }
      if (VERIFIED.indexOf(st) >= 0 && ev.length === 0) { notes.push('Verified status downgraded to needs_review: no EVIDENCE was given.'); st = 'needs_review'; }
      if (st === 'verified_external' && ev.length && !(ev[0].url && ev[0].accessed)) { notes.push('verified_external downgraded: EVIDENCE lacks URL or access date.'); st = 'needs_review'; }
      if (st === 'independently_solved_high' && ans.length === 0) { notes.push('No ANSWER given; status set to needs_review.'); st = 'needs_review'; }
      var lang = (f.LANG || meta.LANG || '').toLowerCase(); if (['en', 'ar', 'mixed'].indexOf(lang) < 0) lang = detectLang(stem);
      var gen = f.EXPLANATION || '';
      var q = {
        id: uid('q'), bank_id: o.bankId || null, source_file: o.sourceFile || meta.SOURCE || 'pasted text',
        source_page: f.PAGE ? (isNaN(parseInt(f.PAGE, 10)) ? f.PAGE : parseInt(f.PAGE, 10)) : null, source_question_number: num,
        language: lang, question_type: (f.TYPE || 'single_choice').toLowerCase(),
        stem_original: stem, stem_display: stem, context: f.CONTEXT || '', options: opts, correct_option_ids: ans,
        explanation_en: f.EXPLANATION_EN || (lang !== 'ar' ? gen : ''), explanation_ar: f.EXPLANATION_AR || (lang === 'ar' ? gen : ''),
        distractor_explanations: {}, verification_status: st, estimated_confidence: null,
        confidence_basis: f.CONFIDENCE_BASIS || (st === 'independently_solved_high' ? 'Independently reasoned; not checked against an official key.' : ''),
        evidence: ev, ambiguity_notes: [f.AMBIGUITY || ''].concat(notes).filter(Boolean).join(' | '), ocr_notes: f.OCR || '',
        review_status: 'needs_review', approved_for_practice: false, approved_for_formal_test: false, reviewer_decision: null, reviewer_date: null,
        created_at: t0, updated_at: t0
      };
      var probs = validateQuestion(q);
      if (!stem.trim()) warnings.push('Question ' + num + ' (line ' + b.line + '): empty stem; it will be blocked.');
      if (opts.length < 2) warnings.push('Question ' + num + ' (line ' + b.line + '): fewer than 2 options; it will be blocked.');
      questions.push(q);
      q._problems = probs;
    });
    questions.forEach(function (q) { delete q._problems; });
    return { meta: meta, questions: questions, warnings: warnings };
  }

  return {
    TEXT_KEYS: TEXT_KEYS, AI_PROMPT: AI_PROMPT, parseTextBank: parseTextBank, detectLang: detectLang,
    VERIFICATION: VERIFICATION, VERIFIED: VERIFIED, REVIEW_STATUSES: REVIEW_STATUSES,
    stemOf: stemOf, validateQuestion: validateQuestion, eligibility: eligibility, eligibleQuestions: eligibleQuestions,
    shuffle: shuffle, presentQuestion: presentQuestion, isCorrect: isCorrect, fingerprint: fingerprint, findDuplicates: findDuplicates,
    uid: uid, buildExport: buildExport, prepareImport: prepareImport, summarize: summarize, canApprove: canApprove, contrast: contrast
  };
});
