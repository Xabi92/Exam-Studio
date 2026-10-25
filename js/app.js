/* Exam Studio UI. Teacher workspace + student quiz. Depends on ESCore, ESI18n, ESDB. */
(function () {
  'use strict';
  var C = window.ESCore, DB = window.ESDB, I = window.ESI18n;
  var $app = document.getElementById('app');

  var S = {
    lang: (function () { try { return localStorage.getItem('es-lang') || 'ar'; } catch (e) { return 'ar'; } })(),
    ws: 'teacher', tab: 'queue', filter: 'all',
    banks: [], questions: [], imports: [], log: [],
    bankId: null, editingId: null, msg: null, importMode: 'new',
    quizSetup: { mode: 'practice', count: 20, shuffleQ: true, shuffleO: true, feedback: 'immediate', minutes: 0 },
    quiz: null, error: null, loading: true, draft: null,
    add: { text: '', source: '', target: 'current', newName: '', preview: null, notice: null }
  };
  var timerHandle = null;

  function t(k, v) { return I.t(S.lang, k, v); }
  function esc(x) { return String(x === undefined || x === null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function bank() { return S.banks.filter(function (b) { return b.id === S.bankId; })[0] || null; }
  function bankQs() { return S.questions.filter(function (q) { return q.bank_id === S.bankId; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; }); }
  function qById(id) { return S.questions.filter(function (q) { return q.id === id; })[0]; }
  function now() { return new Date().toISOString(); }
  function vlabel(st) { return t('v_' + st); }
  function expFor(q) {
    var a = q.explanation_ar, e = q.explanation_en;
    if (S.lang === 'ar') return a || e || ''; return e || a || '';
  }

  /* ---------- persistence helpers ---------- */
  function addLog(action, qid, detail) {
    var e = { id: C.uid('log'), at: now(), actor: 'teacher', action: action, question_id: qid || null, bank_id: S.bankId, detail: detail || '' };
    S.log.push(e); return DB.put('log', e);
  }
  function saveQ(q) { q.updated_at = now(); return DB.put('questions', q); }
  function flash(type, text) { S.msg = { type: type, text: text }; }

  function load() {
    return Promise.all([DB.getAll('banks'), DB.getAll('questions'), DB.getAll('imports'), DB.getAll('log')]).then(function (r) {
      S.banks = r[0]; S.questions = r[1]; S.imports = r[2]; S.log = r[3];
      if (!bank() && S.banks.length) S.bankId = S.banks[0].id;
      S.loading = false;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    }).catch(function (e) { S.loading = false; S.error = e.message; });
  }

  /* ---------- shared view pieces ---------- */
  function badge(st) {
    var icon = { verified_supplied: '✔', verified_external: '✔', independently_solved_high: '◐', needs_review: '!', ambiguous_defective: '⚠', unreadable_incomplete: '✖' }[st] || '?';
    return '<span class="badge st-' + esc(st) + '"><span aria-hidden="true">' + icon + '</span> ' + esc(vlabel(st)) + '</span>';
  }
  function optionsHtml(q, markProposed) {
    return '<ol class="opts-static" type="A">' + q.options.map(function (o) {
      var isC = (q.correct_option_ids || []).indexOf(o.id) >= 0;
      return '<li class="' + (markProposed && isC ? 'proposed' : '') + '"><span class="ol">' + esc(o.label || o.id) + '</span><span dir="auto">' + esc(o.text) + '</span>' +
        (markProposed && isC ? ' <strong class="tag">' + esc(t('proposed')) + '</strong>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  function msgHtml() {
    if (!S.msg) return '';
    var m = S.msg; S.msg = null;
    return '<div class="toast panel ' + (m.type === 'error' ? 'bad' : m.type === 'warn' ? 'warn' : 'good') + '" role="status" aria-live="polite"><strong>' + esc(m.type === 'error' ? t('error') : t('notice')) + ':</strong> ' + esc(m.text) + '</div>';
  }

  /* ---------- top bar ---------- */
  function topbar() {
    return '<header class="top"><div class="brand"><h1>' + esc(t('app')) + '</h1></div>' +
      '<nav class="ws" aria-label="' + esc(t('workspace')) + '">' +
      '<button class="tab' + (S.ws === 'teacher' ? ' on' : '') + '" data-action="ws" data-v="teacher" aria-pressed="' + (S.ws === 'teacher') + '">' + esc(t('teacher')) + '</button>' +
      '<button class="tab' + (S.ws === 'student' ? ' on' : '') + '" data-action="ws" data-v="student" aria-pressed="' + (S.ws === 'student') + '">' + esc(t('student')) + '</button>' +
      '<button class="tab lang" data-action="lang" lang="' + (S.lang === 'ar' ? 'en' : 'ar') + '">' + esc(t('switch_lang')) + '</button></nav></header>';
  }

  /* ---------- TEACHER ---------- */
  function teacherView() {
    var b = bank();
    var h = '<div class="panel warn small"><strong>' + esc(t('storage_title')) + '</strong> ' + esc(t('storage_warn')) + '</div>';
    h += '<section class="card"><div class="row">' +
      '<label class="grow">' + esc(t('bank')) + '<select id="bankSel" data-change="bank">' + (S.banks.length ? S.banks.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === S.bankId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') : '<option>' + esc(t('no_banks')) + '</option>') + '</select></label></div>' +
      '<div class="btns">' +
      '<button class="btn" data-action="new-bank">' + esc(t('new_bank')) + '</button>' +
      '<button class="btn" data-action="import-new">' + esc(t('import_new')) + '</button>' +
      (b ? '<button class="btn" data-action="import-append">' + esc(t('import_append')) + '</button>' +
        '<button class="btn" data-action="export-bank">' + esc(t('export_bank')) + '</button>' +
        '<button class="btn" data-action="export-student">' + esc(t('export_student')) + '</button>' +
        '<button class="btn" data-action="preview">' + esc(t('preview')) + '</button>' : '') +
      '</div><input type="file" id="fileIn" accept="application/json,.json" hidden></section>';
    if (!b) return h + '<div class="card"><p>' + esc(t('empty_teacher')) + '</p></div>';

    var tabs = ['queue', 'add', 'settings', 'log', 'imports'];
    h += '<nav class="subtabs" aria-label="' + esc(t('sections')) + '">' + tabs.map(function (k) {
      return '<button class="tab' + (S.tab === k ? ' on' : '') + '" data-action="tab" data-v="' + k + '" aria-pressed="' + (S.tab === k) + '">' + esc(t('tab_' + k)) + '</button>';
    }).join('') + '</nav>';
    if (S.tab === 'queue') h += queueView();
    if (S.tab === 'add') h += addView();
    if (S.tab === 'settings') h += settingsView();
    if (S.tab === 'log') h += logView();
    if (S.tab === 'imports') h += importsView();
    return h;
  }

  function summaryHtml(qs) {
    var s = C.summarize(qs), v = s.by_verification;
    var items = [['total', s.total], ['approved', s.approved], ['blocked', s.blocked]];
    var h = '<div class="chips">' + items.map(function (i) { return '<span class="chip">' + esc(t('sum_' + i[0])) + ': <strong>' + i[1] + '</strong></span>'; }).join('');
    Object.keys(C.VERIFICATION).forEach(function (k) { h += '<span class="chip">' + esc(vlabel(k)) + ': <strong>' + (v[k] || 0) + '</strong></span>'; });
    return h + '</div>';
  }

  function shownQuestions(qs) {
    var f = S.filter;
    return qs.filter(function (q) {
      if (f === 'all') return true;
      if (f === 'blocked') return C.validateQuestion(q).length > 0;
      if (f === 'flagged') return !!q.flagged;
      if (f === 'dup') return !!q.duplicate_of;
      if (C.VERIFICATION[f]) return q.verification_status === f;
      return q.review_status === f;
    });
  }

  function queueView() {
    var qs = bankQs();
    if (S.editingId) return editView(S.draft);
    var shown = shownQuestions(qs);
    var f = S.filter;
    var opts = ['all', 'approved', 'needs_review', 'hold', 'rejected', 'blocked', 'flagged', 'dup'].concat(Object.keys(C.VERIFICATION));
    var h = summaryHtml(qs) + '<div class="btns"><button class="btn primary" data-action="add-manual">+ ' + esc(t('add_manual')) + '</button><button class="btn primary" data-action="approve-all">' + esc(t('approve_all')) + '</button></div><div class="row"><label class="grow">' + esc(t('filter')) + '<select data-change="filter">' + opts.map(function (o) {
      var label = C.VERIFICATION[o] ? vlabel(o) : t('f_' + o);
      return '<option value="' + o + '"' + (o === f ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('') + '</select></label></div>';
    h += '<p class="muted">' + esc(t('showing', { n: shown.length, m: qs.length })) + '</p>';
    h += shown.map(cardHtml).join('');
    return h;
  }

  function cardHtml(q) {
    var problems = C.validateQuestion(q);
    var el = C.eligibility(q, 'practice', bank().settings);
    var h = '<article class="card q" id="card-' + esc(q.id) + '"><header class="qh"><strong>' + esc(t('qno')) + ' ' + esc(q.source_question_number) + '</strong> <span class="muted">' + (q.source_page ? esc(t('page')) + ' ' + esc(q.source_page) + ' · ' : '') + esc(q.language) + (q.category ? ' · ' + esc(q.category) : '') + '</span></header>';
    h += '<div class="badges">' + badge(q.verification_status) +
      '<span class="badge rv-' + esc(q.review_status) + '">' + esc(t('rv_' + q.review_status)) + '</span>' +
      (q.flagged ? '<span class="badge st-needs_review">⚑ ' + esc(t('flagged')) + '</span>' : '') +
      (q.duplicate_of ? '<span class="badge st-needs_review">⧉ ' + esc(t('dup')) + '</span>' : '') + '</div>';
    h += '<div class="stem" dir="auto">' + esc(q.stem_original) + '</div>';
    if (q.stem_display && q.stem_display !== q.stem_original) h += '<div class="panel info small"><strong>' + esc(t('display_text')) + ':</strong> <span dir="auto">' + esc(q.stem_display) + '</span></div>';
    if (q.context) h += '<div class="ctx" dir="auto">' + esc(q.context) + '</div>';
    h += optionsHtml(q, true);
    var ex = expFor(q);
    h += '<div class="panel expl"><strong>' + esc(t('explanation')) + ':</strong> <span dir="auto">' + esc(ex || t('none')) + '</span></div>';
    if (q.ambiguity_notes) h += '<div class="panel warn small"><strong>' + esc(t('ambiguity')) + ':</strong> <span dir="auto">' + esc(q.ambiguity_notes) + '</span></div>';
    if (q.ocr_notes) h += '<div class="panel warn small"><strong>' + esc(t('ocr')) + ':</strong> <span dir="auto">' + esc(q.ocr_notes) + '</span></div>';
    if (q.confidence_basis) h += '<p class="muted small" dir="auto"><strong>' + esc(t('basis')) + ':</strong> ' + esc(q.confidence_basis) + '</p>';
    if (q.evidence && q.evidence.length) h += '<p class="small"><strong>' + esc(t('evidence')) + ':</strong> ' + q.evidence.map(function (e) { return esc([e.title, e.url, e.accessed, e.supports].filter(Boolean).join(' — ')); }).join('; ') + '</p>';
    if (problems.length) h += '<div class="panel bad small"><strong>' + esc(t('blocked_reason')) + ':</strong><ul>' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>';
    else if (q.review_status === 'approved' && !el.ok) h += '<div class="panel warn small">' + esc(t('hidden_from_students')) + ': ' + esc(el.reasons.join('; ')) + '</div>';
    h += '<div class="btns">' +
      '<button class="btn" data-action="edit" data-id="' + esc(q.id) + '">' + esc(t('edit')) + '</button>' +
      '<button class="btn primary" data-action="approve" data-kind="practice" data-id="' + esc(q.id) + '">' + esc(t('approve_practice')) + '</button>' +
      '<button class="btn primary" data-action="approve" data-kind="formal" data-id="' + esc(q.id) + '">' + esc(t('approve_formal')) + '</button>' +
      '<button class="btn" data-action="mark" data-v="hold" data-id="' + esc(q.id) + '">' + esc(t('hold')) + '</button>' +
      '<button class="btn" data-action="mark" data-v="ambiguous" data-id="' + esc(q.id) + '">' + esc(t('mark_ambiguous')) + '</button>' +
      '<button class="btn danger" data-action="mark" data-v="rejected" data-id="' + esc(q.id) + '">' + esc(t('reject')) + '</button>' +
      '</div></article>';
    return h;
  }

  function editView(q) {
    if (!q) { S.editingId = null; return ''; }
    var ev = (q.evidence && q.evidence[0]) || {};
    var h = '<section class="card"><h2>' + esc(t('edit_question')) + ' ' + esc(q.source_question_number) + '</h2>' +
      '<p class="muted small">' + esc(t('original_kept')) + '</p>' +
      (q.stem_original ? '<label>' + esc(t('orig_stem')) + '<textarea readonly dir="auto" rows="3">' + esc(q.stem_original) + '</textarea></label>' : '') +
      '<label>' + esc(t('display_text')) + '<textarea id="f_stem" dir="auto" rows="3">' + esc(q.stem_display) + '</textarea></label>' +
      '<label>' + esc(t('context')) + '<textarea id="f_ctx" dir="auto" rows="2">' + esc(q.context) + '</textarea></label>';
    q.options.forEach(function (o, i) {
      var chk = (q.correct_option_ids || []).indexOf(o.id) >= 0;
      h += '<div class="optedit"><label class="inl"><input type="' + (q.question_type === 'multiple_select' ? 'checkbox' : 'radio') + '" name="f_correct" value="' + esc(o.id) + '"' + (chk ? ' checked' : '') + '> ' + esc(t('correct')) + ' ' + esc(o.label) + '</label>' +
        '<input type="text" dir="auto" id="f_opt_' + i + '" value="' + esc(o.text) + '" aria-label="' + esc(t('option')) + ' ' + esc(o.label) + '"></div>';
    });
    h += '<div class="btns"><button class="btn" data-action="add-option">+ ' + esc(t('add_option')) + '</button>' + (q.options.length > 2 ? '<button class="btn" data-action="remove-option">− ' + esc(t('remove_option')) + '</button>' : '') + '</div>';
    h += '<label>' + esc(t('expl_en')) + '<textarea id="f_en" dir="ltr" rows="3">' + esc(q.explanation_en) + '</textarea></label>' +
      '<label>' + esc(t('expl_ar')) + '<textarea id="f_ar" dir="rtl" rows="3">' + esc(q.explanation_ar) + '</textarea></label>' +
      '<label>' + esc(t('verification')) + '<select id="f_vs">' + Object.keys(C.VERIFICATION).map(function (k) { return '<option value="' + k + '"' + (q.verification_status === k ? ' selected' : '') + '>' + esc(vlabel(k)) + '</option>'; }).join('') + '</select></label>' +
      '<fieldset><legend>' + esc(t('evidence')) + '</legend>' +
      '<label>' + esc(t('ev_title')) + '<input type="text" id="f_evt" value="' + esc(ev.title || '') + '"></label>' +
      '<label>' + esc(t('ev_url')) + '<input type="text" id="f_evu" dir="ltr" value="' + esc(ev.url || '') + '"></label>' +
      '<label>' + esc(t('ev_date')) + '<input type="text" id="f_evd" dir="ltr" placeholder="YYYY-MM-DD" value="' + esc(ev.accessed || '') + '"></label>' +
      '<label>' + esc(t('ev_supports')) + '<input type="text" id="f_evs" value="' + esc(ev.supports || '') + '"></label></fieldset>' +
      '<label>' + esc(t('ambiguity')) + '<textarea id="f_amb" dir="auto" rows="2">' + esc(q.ambiguity_notes) + '</textarea></label>' +
      '<label>' + esc(t('ocr')) + '<textarea id="f_ocr" dir="auto" rows="2">' + esc(q.ocr_notes) + '</textarea></label>' +
      '<div class="btns"><button class="btn primary" data-action="save-edit" data-id="' + esc(q.id) + '">' + esc(t('save')) + '</button>' +
      '<button class="btn" data-action="cancel-edit">' + esc(t('cancel')) + '</button></div></section>';
    return h;
  }

  function settingsView() {
    var b = bank(), s = b.settings || {};
    return '<section class="card"><h2>' + esc(t('tab_settings')) + '</h2>' +
      '<label>' + esc(t('bank_name')) + '<input type="text" id="s_name" value="' + esc(b.name) + '"></label>' +
      '<label class="inl"><input type="checkbox" id="s_ind"' + (s.allowIndependentInPractice ? ' checked' : '') + '> ' + esc(t('allow_ind')) + '</label>' +
      '<p class="muted small">' + esc(t('allow_ind_help')) + '</p>' +
      '<label class="inl"><input type="checkbox" id="s_study"' + (s.studyMode ? ' checked' : '') + '> ' + esc(t('study_mode')) + '</label>' +
      '<div class="btns"><button class="btn primary" data-action="save-settings">' + esc(t('save')) + '</button>' +
      '<button class="btn danger" data-action="delete-bank">' + esc(t('delete_bank')) + '</button></div></section>';
  }
  function logView() {
    var rows = S.log.filter(function (l) { return l.bank_id === S.bankId || !l.bank_id; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    return '<section class="card"><h2>' + esc(t('tab_log')) + '</h2>' + (rows.length ? '<ul class="log">' + rows.slice(0, 200).map(function (l) {
      return '<li><span class="muted">' + esc(l.at.replace('T', ' ').slice(0, 19)) + '</span> <strong>' + esc(l.action) + '</strong> ' + esc(l.question_id || '') + ' <span dir="auto">' + esc(l.detail || '') + '</span></li>';
    }).join('') + '</ul>' : '<p>' + esc(t('none')) + '</p>') + '</section>';
  }
  function importsView() {
    var rows = S.imports.filter(function (i) { return true; });
    return '<section class="card"><h2>' + esc(t('tab_imports')) + '</h2>' + (rows.length ? rows.map(function (i) {
      return '<div class="panel info small"><strong dir="auto">' + esc(i.source_file) + '</strong><br>' + esc(i.imported_at || '') + '<br><span dir="auto">' + esc(i.method || '') + '</span><br><span dir="auto">' + esc(i.notes || '') + '</span></div>';
    }).join('') : '<p>' + esc(t('none')) + '</p>') + '</section>';
  }

  /* ---------- STUDENT ---------- */
  function studentView() {
    if (S.quiz) return S.quiz.done ? resultView() : quizView();
    var b = bank();
    var h = '';
    if (!b) return '<div class="card"><p>' + esc(t('no_banks_student')) + '</p></div>';
    var su = S.quizSetup, el = C.eligibleQuestions(bankQs(), su.mode, b.settings);
    h += '<section class="card"><h2>' + esc(t('start_quiz')) + '</h2>' +
      '<label>' + esc(t('bank')) + '<select data-change="bank">' + S.banks.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === S.bankId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>' + esc(t('mode')) + '<select id="q_mode" data-change="qs-mode"><option value="practice"' + (su.mode === 'practice' ? ' selected' : '') + '>' + esc(t('practice')) + '</option><option value="formal"' + (su.mode === 'formal' ? ' selected' : '') + '>' + esc(t('formal')) + '</option></select></label>' +
      '<p class="panel info small">' + esc(t('available', { n: el.length })) + '</p>';
    if (!el.length) {
      var apr = bankQs().filter(function (q) { return q.review_status === 'approved'; }).length;
      h += '<div class="panel warn">' + esc(apr ? t('approved_but_hidden', { n: apr }) : t('none_available')) + '</div>';
    }
    h += '<label>' + esc(t('count')) + '<input type="number" id="q_count" min="1" max="500" value="' + esc(su.count) + '"></label>' +
      '<label>' + esc(t('feedback')) + '<select id="q_fb"><option value="immediate"' + (su.feedback === 'immediate' ? ' selected' : '') + '>' + esc(t('fb_immediate')) + '</option><option value="end"' + (su.feedback === 'end' ? ' selected' : '') + '>' + esc(t('fb_end')) + '</option></select></label>' +
      '<label class="inl"><input type="checkbox" id="q_sq"' + (su.shuffleQ ? ' checked' : '') + '> ' + esc(t('shuffle_q')) + '</label>' +
      '<label class="inl"><input type="checkbox" id="q_so"' + (su.shuffleO ? ' checked' : '') + '> ' + esc(t('shuffle_o')) + '</label>' +
      '<label>' + esc(t('timer')) + '<input type="number" id="q_min" min="0" max="300" value="' + esc(su.minutes) + '"></label>' +
      '<div class="btns"><button class="btn primary big" data-action="start"' + (el.length ? '' : ' disabled') + '>' + esc(t('start')) + '</button></div></section>';
    return h;
  }

  function readSetup() {
    var su = S.quizSetup;
    var g = function (id) { return document.getElementById(id); };
    if (g('q_mode')) su.mode = g('q_mode').value;
    if (g('q_count')) su.count = Math.max(1, parseInt(g('q_count').value, 10) || 1);
    if (g('q_fb')) su.feedback = g('q_fb').value;
    if (g('q_sq')) su.shuffleQ = g('q_sq').checked;
    if (g('q_so')) su.shuffleO = g('q_so').checked;
    if (g('q_min')) su.minutes = Math.max(0, parseInt(g('q_min').value, 10) || 0);
  }

  function startQuiz(questions, setup, title) {
    var qs = setup.shuffleQ ? C.shuffle(questions) : questions.slice();
    qs = qs.slice(0, setup.count);
    S.quiz = {
      title: title || bank().name, setup: setup, idx: 0, done: false, answers: {},
      items: qs.map(function (q) { return C.presentQuestion(q, { shuffleOptions: setup.shuffleO }); }),
      deadline: setup.minutes > 0 ? Date.now() + setup.minutes * 60000 : null
    };
    startTimer();
  }
  function startTimer() {
    clearInterval(timerHandle);
    if (!S.quiz || !S.quiz.deadline) return;
    timerHandle = setInterval(function () {
      if (!S.quiz || S.quiz.done) { clearInterval(timerHandle); return; }
      var left = S.quiz.deadline - Date.now(), el = document.getElementById('timer');
      if (left <= 0) { clearInterval(timerHandle); finishQuiz(); render(); return; }
      if (el) { var m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000); el.textContent = m + ':' + (s < 10 ? '0' : '') + s; }
    }, 1000);
  }
  function finishQuiz() { if (S.quiz) { S.quiz.done = true; clearInterval(timerHandle); } }

  function quizView() {
    var qz = S.quiz, it = qz.items[qz.idx], q = it.question, a = qz.answers[q.id] || {};
    var immediate = qz.setup.feedback === 'immediate';
    var multi = q.question_type === 'multiple_select';
    var h = '<section class="card quiz"><div class="qtop"><h2 class="qtitle" dir="auto">' + esc(qz.title) + '</h2>' +
      (qz.deadline ? '<span class="timer" aria-label="' + esc(t('time_left')) + '">⏱ <span id="timer"></span></span>' : '') + '</div>' +
      '<div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="' + qz.items.length + '" aria-valuenow="' + (qz.idx + 1) + '"><div class="bar" style="width:' + Math.round((qz.idx + (a.checked ? 1 : 0)) / qz.items.length * 100) + '%"></div></div>' +
      '<p class="prog">' + esc(t('progress', { i: qz.idx + 1, n: qz.items.length })) + (immediate ? ' · ' + esc(t('score')) + ': ' + scoreNow() : '') + '</p>' +
      '<p class="muted small">' + esc(t('qno')) + ' ' + esc(q.source_question_number) + (q.category ? ' · ' + esc(q.category) : '') + ' · ' + esc(q.source_file) + (q.source_page ? ' · ' + esc(t('page')) + ' ' + esc(q.source_page) : '') + '</p>';
    if (S.ws === 'student' && C.VERIFIED.indexOf(q.verification_status) < 0) h += '<p class="panel warn small">' + esc(vlabel(q.verification_status)) + '</p>';
    if (q.context) h += '<div class="ctx" dir="auto">' + esc(q.context) + '</div>';
    h += '<div class="stem" id="stem" dir="auto">' + esc(C.stemOf(q)) + '</div>';
    h += '<div role="' + (multi ? 'group' : 'radiogroup') + '" aria-labelledby="stem" class="opts">';
    it.options.forEach(function (o) {
      var sel = (a.selected || []).indexOf(o.id) >= 0, isC = (q.correct_option_ids || []).indexOf(o.id) >= 0;
      var cls = 'opt';
      var tag = '';
      if (a.checked) {
        if (isC) { cls += ' is-correct'; tag = '<strong class="tag">✔ ' + esc(t('correct_answer')) + '</strong>'; }
        else if (sel) { cls += ' is-wrong'; tag = '<strong class="tag">✖ ' + esc(t('your_answer')) + '</strong>'; }
      } else if (sel) cls += ' is-sel';
      h += '<label class="' + cls + '"><input type="' + (multi ? 'checkbox' : 'radio') + '" name="opt" value="' + esc(o.id) + '"' + (sel ? ' checked' : '') + (a.checked ? ' disabled' : '') + ' data-change="pick">' +
        '<span class="ol" aria-hidden="true">' + esc(o.displayLabel) + '</span><span class="ot" dir="auto">' + esc(o.text) + '</span> ' + tag + '</label>';
    });
    h += '</div><div id="live" aria-live="polite">';
    if (a.checked && immediate) h += feedbackHtml(it, a);
    if (a.revealed && !a.checked) h += '<div class="panel warn"><strong>' + esc(t('answer_revealed')) + ':</strong> <span dir="auto">' + esc(correctText(it)) + '</span></div>';
    h += '</div>';
    var last = qz.idx === qz.items.length - 1;
    h += '<div class="btns sticky">';
    if (!a.checked) {
      if (immediate) h += '<button class="btn primary big" data-action="check" ' + ((a.selected && a.selected.length) ? '' : 'disabled') + '>' + esc(t('check')) + '</button>';
      if (bank() && bank().settings && bank().settings.studyMode && immediate) h += '<button class="btn" data-action="reveal">' + esc(t('reveal')) + '</button>';
    }
    var canNext = a.checked || !immediate || a.revealed;
    h += '<button class="btn ' + (a.checked ? 'primary big' : '') + '" data-action="next" data-idx="' + qz.idx + '"' + ((canNext || !immediate) ? '' : ' disabled') + '>' + esc(last ? t('finish') : t('next')) + '</button>';
    h += '</div><div class="btns"><button class="btn" data-action="flag" data-id="' + esc(q.id) + '">⚑ ' + esc(t('flag')) + '</button></div></section>';
    return h;
  }

  function correctText(it) {
    var ids = it.question.correct_option_ids || [];
    return it.options.filter(function (o) { return ids.indexOf(o.id) >= 0; }).map(function (o) { return o.displayLabel + '. ' + o.text; }).join(' / ');
  }
  function feedbackHtml(it, a) {
    var q = it.question, ok = a.correct;
    return '<div class="panel ' + (ok ? 'good' : 'bad') + '" role="status"><strong class="big">' + (ok ? '✔ ' + esc(t('right')) : '✖ ' + esc(t('incorrect'))) + '</strong>' +
      (ok ? '' : '<p><strong>' + esc(t('correct_answer')) + ':</strong> <span dir="auto">' + esc(correctText(it)) + '</span></p>') + '</div>' +
      '<div class="panel expl"><strong>' + esc(t('explanation')) + ':</strong><p dir="auto">' + esc(expFor(q)) + '</p>' +
      '<p class="small"><strong>' + esc(t('verification')) + ':</strong> ' + esc(vlabel(q.verification_status)) + '</p></div>';
  }
  function scoreNow() {
    var c = 0, n = 0; Object.keys(S.quiz.answers).forEach(function (k) { var a = S.quiz.answers[k]; if (a.checked) { n++; if (a.correct) c++; } }); return c + '/' + n;
  }

  function resultView() {
    var qz = S.quiz, total = qz.items.length, correct = 0, answered = 0, wrong = [];
    qz.items.forEach(function (it) {
      var a = qz.answers[it.question.id];
      if (a && (a.checked || a.saved)) { answered++; if (a.correct) correct++; else wrong.push(it); }
      else if (a && a.revealed) { answered++; wrong.push(it); }
    });
    var pct = total ? Math.round(correct / total * 100) : 0;
    var h = '<section class="card"><h2>' + esc(t('summary')) + '</h2>' +
      '<div class="chips"><span class="chip">' + esc(t('score')) + ': <strong>' + correct + '/' + total + '</strong></span><span class="chip">' + esc(t('accuracy')) + ': <strong>' + pct + '%</strong></span>' +
      '<span class="chip">' + esc(t('unanswered')) + ': <strong>' + (total - answered) + '</strong></span></div>' +
      '<p class="muted small">' + esc(t('accuracy_note')) + '</p>';
    var unans = qz.items.filter(function (it) { var a = qz.answers[it.question.id]; return !a || (!a.checked && !a.saved && !a.revealed); });
    if (wrong.length || unans.length) {
      h += '<h3>' + esc(t('review_mistakes')) + '</h3>';
      wrong.concat(unans).forEach(function (it) {
        var q = it.question, a = qz.answers[q.id] || {};
        var mine = it.options.filter(function (o) { return (a.selected || []).indexOf(o.id) >= 0; }).map(function (o) { return o.displayLabel + '. ' + o.text; }).join(' / ');
        h += '<article class="card q"><div class="stem" dir="auto">' + esc(C.stemOf(q)) + '</div>' +
          '<p><strong>' + esc(t('your_answer')) + ':</strong> <span dir="auto">' + esc(mine || t('unanswered')) + '</span></p>' +
          '<div class="panel good"><strong>✔ ' + esc(t('correct_answer')) + ':</strong> <span dir="auto">' + esc(correctText(it)) + '</span></div>' +
          '<div class="panel expl"><strong>' + esc(t('explanation')) + ':</strong> <span dir="auto">' + esc(expFor(q)) + '</span><p class="small">' + esc(vlabel(q.verification_status)) + '</p></div></article>';
      });
    }
    h += '<div class="btns">' + (wrong.length || unans.length ? '<button class="btn primary big" data-action="retry">' + esc(t('retry_mistakes')) + '</button>' : '') +
      '<button class="btn" data-action="new-quiz">' + esc(t('new_quiz')) + '</button></div></section>';
    return h;
  }

  /* ---------- render ---------- */
  function render() {
    document.documentElement.lang = S.lang;
    document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('app');
    var body;
    if (S.loading) body = '<p class="card">' + esc(t('loading')) + '</p>';
    else if (S.error) body = '<div class="panel bad">' + esc(S.error) + '</div>';
    else body = (S.ws === 'teacher' ? teacherView() : studentView());
    var toast = S.loading ? '' : msgHtml();
    $app.innerHTML = topbar() + '<main id="main">' + body + '</main>' + toast;
    if (toast) setTimeout(function () { var el = document.querySelector('.toast'); if (el) el.remove(); }, 12000);
    if (S.quiz && !S.quiz.done && S.quiz.deadline) { var el = document.getElementById('timer'); if (el) { var left = Math.max(0, S.quiz.deadline - Date.now()); el.textContent = Math.floor(left / 60000) + ':' + ('0' + Math.floor(left % 60000 / 1000)).slice(-2); } }
  }
  function renderKeepScroll() { var y = window.scrollY; render(); window.scrollTo(0, y); }

  /* ---------- actions ---------- */
  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function slug(s) { return String(s).replace(/[^\w\u0600-\u06FF]+/g, '-').slice(0, 50); }

  function doImport(file, mode) {
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try { payload = JSON.parse(reader.result); } catch (e) { flash('error', t('bad_json')); render(); return; }
      var res = C.prepareImport({ banks: S.banks, questions: S.questions }, payload, { mode: mode, targetBankId: S.bankId });
      if (!res.ok) { flash('error', res.errors.join(' ')); render(); return; }
      var ops = [DB.putMany('questions', res.questions), DB.putMany('imports', res.imports)];
      if (!res.appended) ops.push(DB.put('banks', res.bank));
      Promise.all(ops).then(function () {
        if (!res.appended) S.banks.push(res.bank);
        res.questions.forEach(function (q) { S.questions.push(q); });
        res.imports.forEach(function (i) { if (!S.imports.some(function (x) { return x.id === i.id; })) S.imports.push(i); });
        S.bankId = res.bank.id; S.tab = 'queue'; S.filter = 'all';
        return addLog('import', null, file.name + ' → ' + res.questions.length + ' questions. ' + res.notes.join(' '));
      }).then(function () { flash('ok', t('imported', { n: res.questions.length }) + ' ' + res.notes.join(' ')); render(); })
        .catch(function (e) { flash('error', e.message); render(); });
    };
    reader.readAsText(file);
  }

  function approve(q, kind) {
    var chk = C.canApprove(q, kind, bank().settings);
    if (!chk.ok) { flash('error', t('cannot_approve') + ' Q' + q.source_question_number + ': ' + chk.blocking.join(' ')); return renderKeepScroll(); }
    q.review_status = 'approved'; q.approved_for_practice = true;
    if (kind === 'formal') q.approved_for_formal_test = true;
    q.reviewer_decision = 'approved_' + kind; q.reviewer_date = now();
    saveQ(q).then(function () { return addLog('approve_' + kind, q.id, ''); }).then(function () {
      var adv = chk.reasons.filter(function (x) { return x.indexOf('Note:') === 0; });
      flash(adv.length ? 'warn' : 'ok', adv.length ? t('approved_ok') + ' ' + t('hidden_until_allowed') : t('approved_ok')); renderKeepScroll();
    });
  }

  function readEvidence() {
    var g = function (id) { return document.getElementById(id); };
    var evt = g('f_evt').value.trim(), evu = g('f_evu').value.trim();
    return evt || evu ? [{ title: evt, url: evu, accessed: g('f_evd').value.trim(), supports: g('f_evs').value.trim() }] : [];
  }
  function applyForm(q) {
    var g = function (id) { return document.getElementById(id); };
    q.stem_display = g('f_stem').value; q.context = g('f_ctx').value;
    q.options.forEach(function (o, i) { var el = g('f_opt_' + i); if (el) o.text = el.value; });
    q.correct_option_ids = Array.prototype.slice.call(document.querySelectorAll('input[name=f_correct]:checked')).map(function (x) { return x.value; });
    q.explanation_en = g('f_en') ? g('f_en').value : q.explanation_en; q.explanation_ar = g('f_ar') ? g('f_ar').value : q.explanation_ar;
    q.verification_status = g('f_vs') ? g('f_vs').value : q.verification_status;
    if (g('f_evt')) q.evidence = readEvidence();
    if (g('f_amb')) q.ambiguity_notes = g('f_amb').value;
    if (g('f_ocr')) q.ocr_notes = g('f_ocr').value;
  }
  function approveAll() {
    var b = bank(), list = shownQuestions(bankQs());
    var ok = list.filter(function (q) { return q.review_status !== 'approved' && C.canApprove(q, 'practice', b.settings).ok; });
    var skipped = list.filter(function (q) { return q.review_status !== 'approved' && !C.canApprove(q, 'practice', b.settings).ok; });
    if (!ok.length) { flash('warn', t('nothing_to_approve', { m: skipped.length })); return renderKeepScroll(); }
    if (!window.confirm(t('confirm_approve_all', { n: ok.length, m: skipped.length }))) return;
    var needInd = ok.some(function (q) { return q.verification_status === 'independently_solved_high'; }) && !(b.settings && b.settings.allowIndependentInPractice);
    var enable = needInd && window.confirm(t('confirm_enable_ind'));
    var ts = now();
    ok.forEach(function (q) { q.review_status = 'approved'; q.approved_for_practice = true; q.reviewer_decision = 'approved_practice'; q.reviewer_date = ts; q.updated_at = ts; });
    var ops = [DB.putMany('questions', ok)];
    if (enable) { b.settings = Object.assign({}, b.settings, { allowIndependentInPractice: true }); ops.push(DB.put('banks', b)); }
    Promise.all(ops).then(function () { return addLog('approve_all_practice', null, ok.length + ' approved' + (enable ? '; independently solved allowed in practice' : '')); }).then(function () {
      flash(needInd && !enable ? 'warn' : 'ok', t('approved_n', { n: ok.length, m: skipped.length }) + (needInd && !enable ? ' ' + t('hidden_until_allowed') : '')); renderKeepScroll();
    });
  }

  function saveEdit(id) {
    var q = qById(id), d = S.draft;
    var snap = function (x) { return JSON.stringify([x.stem_display, x.context, x.options, x.correct_option_ids, x.explanation_en, x.explanation_ar, x.verification_status]); };
    var before = snap(q);
    applyForm(d);
    if (C.VERIFIED.indexOf(d.verification_status) >= 0 && !d.evidence.length) { flash('error', t('need_evidence')); return render(); }
    if (d.verification_status === 'verified_external' && !(d.evidence[0].url && d.evidence[0].accessed)) { flash('error', t('need_external_fields')); return render(); }
    if (!d.stem_original && d.stem_display) d.stem_original = d.stem_display;
    var changed = before !== snap(d) || q._new;
    delete d._new;
    Object.keys(d).forEach(function (k) { q[k] = d[k]; });
    delete q._new;
    var reset = changed && q.review_status === 'approved';
    if (reset) { q.review_status = 'needs_review'; q.approved_for_practice = false; q.approved_for_formal_test = false; }
    if (q.review_status === 'draft') q.review_status = 'needs_review';
    saveQ(q).then(function () { return addLog('edit', q.id, reset ? 'approval reset after edit' : ''); }).then(function () {
      S.editingId = null; S.draft = null; flash(reset ? 'warn' : 'ok', reset ? t('edit_reset') : t('saved')); render();
    });
  }
  function cancelEdit() {
    var q = qById(S.editingId);
    S.editingId = null; S.draft = null;
    if (q && q._new) {
      S.questions = S.questions.filter(function (x) { return x.id !== q.id; });
      return DB.del('questions', q.id).then(render);
    }
    render();
  }
  function addManual() {
    var b = bank(); if (!b) return;
    var q = {
      id: C.uid('q'), bank_id: b.id, source_file: 'manual entry', source_page: null, source_question_number: String(bankQs().length + 1),
      language: 'en', question_type: 'single_choice', stem_original: '', stem_display: '', context: '',
      options: ['A', 'B', 'C', 'D'].map(function (l) { return { id: l, label: l, text: '' }; }), correct_option_ids: [],
      explanation_en: '', explanation_ar: '', distractor_explanations: {}, verification_status: 'needs_review', estimated_confidence: null,
      confidence_basis: '', evidence: [], ambiguity_notes: '', ocr_notes: '', review_status: 'draft', approved_for_practice: false,
      approved_for_formal_test: false, reviewer_decision: null, reviewer_date: null, created_at: now(), updated_at: now(), _new: true
    };
    S.questions.push(q);
    DB.put('questions', q).then(function () { S.editingId = q.id; S.draft = JSON.parse(JSON.stringify(q)); S.tab = 'queue'; render(); window.scrollTo(0, 0); });
  }

  /* ---------- Add / import questions from text ---------- */
  function addView() {
    var a = S.add, b = bank();
    var h = '<section class="card"><h2>' + esc(t('add_title')) + '</h2><p>' + esc(t('add_intro')) + '</p>' +
      '<ul class="small"><li>' + esc(t('add_way1')) + '</li><li>' + esc(t('add_way2')) + '</li><li>' + esc(t('add_way3')) + '</li></ul>' +
      '<label>' + esc(t('add_file')) + '<input type="file" id="aFile" accept=".txt,.md,.text,.json,.html,.htm,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"></label>';
    if (a.notice) h += '<div class="panel ' + (a.notice.type === 'warn' ? 'warn' : 'info') + '" role="status">' + esc(a.notice.text) + '</div>';
    h += '<details class="panel info small"><summary><strong>' + esc(t('ai_prompt_title')) + '</strong></summary><p>' + esc(t('ai_prompt_help')) + '</p>' +
      '<textarea id="aiPrompt" readonly dir="ltr" rows="8">' + esc(C.AI_PROMPT) + '</textarea>' +
      '<div class="btns"><button class="btn" data-action="copy-prompt">' + esc(t('copy_prompt')) + '</button></div></details>';
    h += '<label>' + esc(t('add_text')) + '<textarea id="a_text" dir="auto" rows="10" placeholder="Q: 1&#10;STEM: ...&#10;A) ...&#10;B) ...&#10;ANSWER: B&#10;EXPLANATION_EN: ...">' + esc(a.text) + '</textarea></label>' +
      '<label>' + esc(t('add_source')) + '<input type="text" id="a_source" dir="auto" value="' + esc(a.source) + '"></label>' +
      '<label>' + esc(t('add_target')) + '<select id="a_target" data-change="a-target"><option value="current"' + (a.target === 'current' ? ' selected' : '') + '>' + esc(t('target_current')) + (b ? ': ' + esc(b.name) : '') + '</option><option value="new"' + (a.target === 'new' ? ' selected' : '') + '>' + esc(t('target_new')) + '</option></select></label>';
    if (a.target === 'new') h += '<label>' + esc(t('bank_name')) + '<input type="text" id="a_new" dir="auto" value="' + esc(a.newName) + '"></label>';
    h += '<div class="btns"><button class="btn primary" data-action="add-preview">' + esc(t('add_preview')) + '</button></div></section>';
    if (a.preview) {
      var p = a.preview;
      h += '<section class="card"><h2>' + esc(t('preview_result')) + '</h2><p><strong>' + p.questions.length + '</strong> ' + esc(t('questions_found')) + '</p>';
      if (p.warnings.length) h += '<div class="panel warn small"><strong>' + esc(t('warnings')) + ':</strong><ul>' + p.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
      h += p.questions.map(function (q) {
        var pr = C.validateQuestion(q);
        return '<div class="panel ' + (pr.length ? 'bad' : 'good') + ' small"><strong>' + esc(t('qno')) + ' ' + esc(q.source_question_number) + '</strong> · ' + esc(vlabel(q.verification_status)) + '<div dir="auto">' + esc((q.stem_original || '').slice(0, 120)) + '</div>' + (pr.length ? '<ul>' + pr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      }).join('');
      h += '<p class="muted small">' + esc(t('add_commit_note')) + '</p><div class="btns"><button class="btn primary big" data-action="add-commit"' + (p.questions.length ? '' : ' disabled') + '>' + esc(t('add_commit')) + '</button></div></section>';
    }
    return h;
  }

  function readAddFields() {
    var g = function (id) { return document.getElementById(id); };
    if (g('a_text')) S.add.text = g('a_text').value;
    if (g('a_source')) S.add.source = g('a_source').value;
    if (g('a_target')) S.add.target = g('a_target').value;
    if (g('a_new')) S.add.newName = g('a_new').value;
  }

  function handleAddFile(file) {
    var name = file.name, ext = (name.split('.').pop() || '').toLowerCase();
    S.add.source = name; S.add.preview = null;
    if (['txt', 'md', 'text'].indexOf(ext) >= 0) {
      var r = new FileReader();
      r.onload = function () { S.add.text = String(r.result); S.add.notice = { type: 'info', text: t('file_loaded', { name: name }) }; render(); };
      r.readAsText(file, 'utf-8'); return;
    }
    if (ext === 'html' || ext === 'htm') {
      var hr = new FileReader();
      hr.onload = function () {
        var res = C.parseQuizHtml(String(hr.result), { sourceFile: name, bankId: '__new__' });
        if (!res.ok) { S.add.notice = { type: 'warn', text: res.warnings.join(' ') }; S.add.preview = null; return render(); }
        S.add.target = 'new'; S.add.newName = res.meta.BANK; S.add.text = ''; S.add.preview = res;
        S.add.notice = { type: 'info', text: t('html_loaded', { name: name }) }; render();
      };
      hr.readAsText(file, 'utf-8'); return;
    }
    if (ext === 'json') { S.add.notice = { type: 'info', text: t('json_routed') }; doImport(file, S.add.target === 'new' ? 'new' : (bank() ? 'append' : 'new')); return; }
    // PDF / DOCX / images: this app has no OCR/PDF engine. Record the attempt, tell the teacher what to do.
    var rec = { id: C.uid('import'), source_file: name, imported_at: now(), method: 'File selected; not readable by the app. Awaiting AI-converted text file.', notes: 'No questions were created from this file.', bank_id: S.bankId };
    DB.put('imports', rec).then(function () { S.imports.push(rec); return addLog('file_not_readable', null, name); }).then(function () {
      S.add.notice = { type: 'warn', text: t('unreadable_file', { name: name }) }; render();
    });
  }

  function previewAdd() {
    readAddFields();
    var a = S.add;
    if (!a.text.trim()) { a.notice = { type: 'warn', text: t('add_empty') }; a.preview = null; return render(); }
    a.preview = C.parseTextBank(a.text, { sourceFile: a.source.trim() || undefined, bankId: a.target === 'current' ? S.bankId : '__new__' });
    a.notice = null; render();
  }

  function commitAdd() {
    var a = S.add, p = a.preview; if (!p || !p.questions.length) return;
    var target = bank(), newBank = null;
    if (a.target === 'new') {
      var nm = (a.newName || '').trim() || p.meta.BANK || ('Bank ' + new Date().toISOString().slice(0, 10));
      newBank = { id: C.uid('bank'), name: nm, description: p.meta.DESCRIPTION || '', created_at: now(), settings: { allowIndependentInPractice: false, studyMode: false } };
      target = newBank;
    }
    if (!target) { a.notice = { type: 'warn', text: t('no_target') }; return render(); }
    var qs = p.questions;
    qs.forEach(function (q) { q.bank_id = target.id; });
    var existing = newBank ? [] : S.questions.filter(function (q) { return q.bank_id === target.id; });
    var dups = C.findDuplicates(existing, qs);
    qs.forEach(function (q) { if (dups[q.id]) { q.duplicate_of = dups[q.id]; q.ambiguity_notes = (q.ambiguity_notes ? q.ambiguity_notes + ' | ' : '') + 'Possible duplicate of ' + dups[q.id] + ' (not merged).'; } });
    var rec = { id: C.uid('import'), source_file: a.source.trim() || p.meta.SOURCE || 'pasted text', imported_at: now(), method: 'Text format (AI-converted or typed). Parsed by the app; all answers and statuses are as supplied in the text.', notes: qs.length + ' questions, ' + Object.keys(dups).length + ' possible duplicates flagged (not merged).', bank_id: target.id };
    var ops = [DB.putMany('questions', qs), DB.put('imports', rec)];
    if (newBank) ops.push(DB.put('banks', newBank));
    Promise.all(ops).then(function () {
      if (newBank) S.banks.push(newBank);
      qs.forEach(function (q) { S.questions.push(q); });
      S.imports.push(rec); S.bankId = target.id;
      S.add = { text: '', source: '', target: 'current', newName: '', preview: null, notice: null };
      S.tab = 'queue'; S.filter = 'all';
      return addLog('add_from_text', null, rec.source_file + ' → ' + qs.length + ' questions');
    }).then(function () { flash('ok', t('imported', { n: qs.length }) + ' ' + t('in_queue')); render(); })
      .catch(function (e) { flash('error', e.message); render(); });
  }

  function copyPrompt() {
    var done = function () { S.add.notice = { type: 'info', text: t('prompt_copied') }; render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(C.AI_PROMPT).then(done, function () { var el = document.getElementById('aiPrompt'); if (el) { el.focus(); el.select(); } });
    else { var el = document.getElementById('aiPrompt'); if (el) { el.focus(); el.select(); try { document.execCommand('copy'); done(); } catch (e) {} } }
  }

  function mark(q, v) {
    var detail = '';
    if (v === 'hold') q.review_status = 'hold';
    if (v === 'rejected') q.review_status = 'rejected';
    if (v === 'ambiguous') { q.verification_status = 'ambiguous_defective'; q.review_status = 'needs_review'; }
    q.approved_for_practice = false; q.approved_for_formal_test = false;
    q.reviewer_decision = v; q.reviewer_date = now();
    saveQ(q).then(function () { return addLog('mark_' + v, q.id, detail); }).then(function () { flash('ok', t('saved')); render(); });
  }

  function quizCheck() {
    var qz = S.quiz, it = qz.items[qz.idx], a = qz.answers[it.question.id];
    if (!a || !a.selected || !a.selected.length || a.checked) return;
    a.checked = true; a.correct = C.isCorrect(it.question, a.selected);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
    var act = el.dataset.action, id = el.dataset.id, v = el.dataset.v;
    if (act === 'lang') { S.lang = S.lang === 'ar' ? 'en' : 'ar'; try { localStorage.setItem('es-lang', S.lang); } catch (x) {} return render(); }
    if (act === 'ws') { S.ws = v; if (v === 'teacher') { clearInterval(timerHandle); S.quiz = null; } return render(); }
    if (act === 'tab') { if (S.editingId) cancelEdit(); S.tab = v; S.editingId = null; return render(); }
    if (act === 'preview') { S.ws = 'student'; S.quiz = null; return render(); }
    if (act === 'new-bank') {
      var name = window.prompt(t('bank_name_prompt')); if (!name || !name.trim()) return;
      var b = { id: C.uid('bank'), name: name.trim(), description: '', created_at: now(), settings: { allowIndependentInPractice: false, studyMode: false } };
      DB.put('banks', b).then(function () { S.banks.push(b); S.bankId = b.id; return addLog('create_bank', null, b.name); }).then(function () { flash('ok', t('saved')); render(); });
      return;
    }
    if (act === 'import-new' || act === 'import-append') { S.importMode = act === 'import-new' ? 'new' : 'append'; var f = document.getElementById('fileIn'); f.value = ''; f.click(); return; }
    if (act === 'export-bank') { var bk = bank(); download('exam-studio-' + slug(bk.name) + '.json', C.buildExport(bk, bankQs(), S.imports, S.log.filter(function (l) { return l.bank_id === bk.id; }))); return addLog('export', null, 'full bank'); }
    if (act === 'export-student') {
      var bk2 = bank(); var ap = bankQs().filter(function (q) { return C.eligibility(q, 'practice', bk2.settings).ok || C.eligibility(q, 'formal', bk2.settings).ok; });
      if (!ap.length) { flash('warn', t('nothing_to_publish')); return render(); }
      if (!window.confirm(t('confirm_student_export', { n: ap.length }))) return;
      var sb = JSON.parse(JSON.stringify(bk2)); sb.name = bk2.name + ' (student version)';
      download('exam-studio-student-' + slug(bk2.name) + '.json', C.buildExport(sb, ap, [], []));
      return addLog('export_student', null, ap.length + ' approved questions');
    }
    if (act === 'edit') { S.editingId = id; S.draft = JSON.parse(JSON.stringify(qById(id))); render(); window.scrollTo(0, 0); return; }
    if (act === 'cancel-edit') return cancelEdit();
    if (act === 'save-edit') return saveEdit(id);
    if (act === 'add-manual') return addManual();
    if (act === 'approve-all') return approveAll();
    if (act === 'add-option' || act === 'remove-option') {
      applyForm(S.draft);
      if (act === 'add-option') { var L = 'ABCDEFGHIJ'; if (S.draft.options.length < 10) { var nl = L[S.draft.options.length]; S.draft.options.push({ id: nl, label: nl, text: '' }); } }
      else if (S.draft.options.length > 2) { var rm = S.draft.options.pop(); S.draft.correct_option_ids = S.draft.correct_option_ids.filter(function (x) { return x !== rm.id; }); }
      return renderKeepScroll();
    }
    if (act === 'add-preview') return previewAdd();
    if (act === 'add-commit') return commitAdd();
    if (act === 'copy-prompt') { readAddFields(); return copyPrompt(); }
    if (act === 'approve') return approve(qById(id), el.dataset.kind);
    if (act === 'mark') return mark(qById(id), v);
    if (act === 'save-settings') {
      var b2 = bank(); b2.name = document.getElementById('s_name').value.trim() || b2.name;
      b2.settings = { allowIndependentInPractice: document.getElementById('s_ind').checked, studyMode: document.getElementById('s_study').checked };
      DB.put('banks', b2).then(function () { return addLog('settings', null, JSON.stringify(b2.settings)); }).then(function () { flash('ok', t('saved')); render(); });
      return;
    }
    if (act === 'delete-bank') {
      var b3 = bank(); if (!window.confirm(t('confirm_delete', { name: b3.name }))) return;
      var ids = bankQs().map(function (q) { return q.id; });
      Promise.all([DB.delMany('questions', ids), DB.del('banks', b3.id)]).then(function () {
        S.questions = S.questions.filter(function (q) { return q.bank_id !== b3.id; }); S.banks = S.banks.filter(function (x) { return x.id !== b3.id; });
        S.bankId = S.banks.length ? S.banks[0].id : null; return addLog('delete_bank', null, b3.name);
      }).then(function () { flash('ok', t('saved')); render(); });
      return;
    }
    /* student */
    if (act === 'start') {
      readSetup(); var el2 = C.eligibleQuestions(bankQs(), S.quizSetup.mode, bank().settings);
      if (!el2.length) return render();
      startQuiz(el2, S.quizSetup); return render();
    }
    if (act === 'check') { quizCheck(); return renderKeepScroll(); }
    if (act === 'reveal') { var it0 = S.quiz.items[S.quiz.idx]; var a0 = S.quiz.answers[it0.question.id] || (S.quiz.answers[it0.question.id] = {}); a0.revealed = true; a0.correct = false; return renderKeepScroll(); }
    if (act === 'next') {
      var qz = S.quiz; if (!qz || +el.dataset.idx !== qz.idx) return; // advance exactly once per question
      var cur = qz.items[qz.idx], a1 = qz.answers[cur.question.id];
      if (qz.setup.feedback === 'end' && a1 && a1.selected && a1.selected.length) { a1.saved = true; a1.correct = C.isCorrect(cur.question, a1.selected); }
      if (qz.setup.feedback === 'immediate' && !(a1 && (a1.checked || a1.revealed))) return;
      if (qz.idx >= qz.items.length - 1) finishQuiz(); else qz.idx++;
      render(); window.scrollTo(0, 0); var s = document.getElementById('stem'); if (s) { s.setAttribute('tabindex', '-1'); s.focus(); } return;
    }
    if (act === 'flag') {
      var fq = qById(id); fq.flagged = true; fq.flag_count = (fq.flag_count || 0) + 1;
      saveQ(fq).then(function () { return addLog('student_flag', fq.id, ''); }).then(function () { flash('ok', t('flag_thanks')); render(); }); return;
    }
    if (act === 'retry') {
      var qz2 = S.quiz, redo = qz2.items.filter(function (it) { var a = qz2.answers[it.question.id]; return !(a && (a.checked || a.saved) && a.correct); }).map(function (it) { return it.question; });
      var su = JSON.parse(JSON.stringify(qz2.setup)); su.count = redo.length; startQuiz(redo, su, qz2.title); return render();
    }
    if (act === 'new-quiz') { S.quiz = null; clearInterval(timerHandle); return render(); }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'fileIn') { if (el.files && el.files[0]) doImport(el.files[0], S.importMode); return; }
    if (el.id === 'aFile') { readAddFields(); if (el.files && el.files[0]) handleAddFile(el.files[0]); return; }
    var k = el.dataset && el.dataset.change; if (!k) return;
    if (k === 'bank') { S.bankId = el.value; S.editingId = null; S.quiz = null; return render(); }
    if (k === 'filter') { S.filter = el.value; return render(); }
    if (k === 'a-target') { readAddFields(); return render(); }
    if (k === 'qs-mode') { readSetup(); return render(); }
    if (k === 'pick' && S.quiz) {
      var it = S.quiz.items[S.quiz.idx], a = S.quiz.answers[it.question.id] || (S.quiz.answers[it.question.id] = {});
      if (a.checked) return;
      if (el.type === 'checkbox') { a.selected = Array.prototype.slice.call(document.querySelectorAll('input[name=opt]:checked')).map(function (x) { return x.value; }); }
      else a.selected = [el.value];
      var y = window.scrollY; render(); window.scrollTo(0, y);
      var again = document.querySelector('input[name=opt][value="' + el.value + '"]'); if (again) again.focus();
    }
  });

  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'a_text') S.add.text = e.target.value; else if (id === 'a_source') S.add.source = e.target.value; else if (id === 'a_new') S.add.newName = e.target.value;
  });

  render();
  load().then(render);
})();
