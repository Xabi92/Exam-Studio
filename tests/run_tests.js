/* Unit tests (Node, no dependencies). Run: node tests/run_tests.js */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const C = require('../js/core.js'), I = require('../js/i18n.js');
const root = path.join(__dirname, '..');
const bankFile = JSON.parse(fs.readFileSync(path.join(root, 'data/sample_bank.json'), 'utf8'));
let pass = 0, fail = 0; const results = [];
function test(name, fn) { try { fn(); pass++; results.push('PASS  ' + name); } catch (e) { fail++; results.push('FAIL  ' + name + ' :: ' + e.message); } }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const good = () => ({
  id: 'q1', bank_id: 'b', source_file: 'f.pdf', source_page: 1, source_question_number: '1', language: 'en', question_type: 'single_choice',
  stem_original: 'Pick one', stem_display: 'Pick one', context: '', options: [{ id: 'A', label: 'A', text: 'x' }, { id: 'B', label: 'B', text: 'y' }, { id: 'C', label: 'C', text: 'z' }],
  correct_option_ids: ['C'], explanation_en: 'Because z.', explanation_ar: '', verification_status: 'verified_supplied', evidence: [{ title: 'Key', url: '', accessed: '', supports: 'answer' }],
  review_status: 'approved', approved_for_practice: true, approved_for_formal_test: true
});

test('valid question passes validation', () => eq(C.validateQuestion(good()), []));
test('REGRESSION: options but no stem is blocked', () => { const q = good(); q.stem_original = ''; q.stem_display = ''; ok(C.validateQuestion(q).some(r => r.startsWith('EMPTY_STEM'))); ok(!C.eligibility(q, 'practice', {}).ok); });
test('REGRESSION: whitespace-only stem is blocked', () => { const q = good(); q.stem_original = '   '; q.stem_display = ' \n'; ok(C.validateQuestion(q).some(r => r.startsWith('EMPTY_STEM'))); });
test('REGRESSION: published question without explanation is blocked', () => { const q = good(); q.explanation_en = ''; q.explanation_ar = ''; ok(C.validateQuestion(q).some(r => r.startsWith('NO_EXPLANATION'))); ok(!C.eligibility(q, 'practice', {}).ok); });
test('empty option text is blocked', () => { const q = good(); q.options[1].text = ' '; ok(C.validateQuestion(q).some(r => r.startsWith('OPTION_EMPTY'))); });
test('missing / invalid correct answer is blocked', () => { const q = good(); q.correct_option_ids = []; ok(C.validateQuestion(q).some(r => r.startsWith('NO_CORRECT_ANSWER'))); q.correct_option_ids = ['Z']; ok(C.validateQuestion(q).some(r => r.startsWith('CORRECT_ID_INVALID'))); });
test('unknown verification status is blocked', () => { const q = good(); q.verification_status = 'verified'; ok(C.validateQuestion(q).some(r => r.startsWith('NO_VERIFICATION_STATUS'))); });
test('missing source file is blocked', () => { const q = good(); q.source_file = ''; ok(C.validateQuestion(q).some(r => r.startsWith('NO_SOURCE_FILE'))); });
test('duplicate option ids are blocked', () => { const q = good(); q.options[1].id = 'A'; ok(C.validateQuestion(q).some(r => r.startsWith('OPTION_ID_DUPLICATE'))); });

test('policy: formal needs verified status + formal approval', () => {
  const q = good(); ok(C.eligibility(q, 'formal', {}).ok);
  q.verification_status = 'independently_solved_high'; ok(!C.eligibility(q, 'formal', { allowIndependentInPractice: true }).ok);
});
test('policy: independently solved only in practice and only if teacher allows', () => {
  const q = good(); q.verification_status = 'independently_solved_high';
  ok(!C.eligibility(q, 'practice', {}).ok); ok(!C.eligibility(q, 'practice', { allowIndependentInPractice: false }).ok); ok(C.eligibility(q, 'practice', { allowIndependentInPractice: true }).ok);
});
test('policy: needs_review / ambiguous / unreadable never reach students, even if approved flags are set', () => {
  ['needs_review', 'ambiguous_defective', 'unreadable_incomplete'].forEach(s => { const q = good(); q.verification_status = s; ok(!C.eligibility(q, 'practice', { allowIndependentInPractice: true }).ok, s); ok(!C.eligibility(q, 'formal', {}).ok, s); });
});
test('policy: unapproved questions are hidden', () => { const q = good(); q.review_status = 'needs_review'; ok(!C.eligibility(q, 'practice', {}).ok); });
test('canApprove: verified without evidence cannot be approved for formal', () => { const q = good(); q.evidence = []; ok(!C.canApprove(q, 'formal', {}).ok); });
test('canApprove: needs_review status cannot be approved', () => { const q = good(); q.verification_status = 'needs_review'; ok(!C.canApprove(q, 'practice', {}).ok); });
test('canApprove: independently solved can be approved for practice (advisory note if setting off)', () => {
  const q = good(); q.verification_status = 'independently_solved_high'; const r = C.canApprove(q, 'practice', {}); ok(r.ok); ok(r.reasons.some(x => x.startsWith('Note:')));
});

test('shuffle keeps correct answer mapped by stable option id (1000 random shuffles)', () => {
  const q = good(); for (let i = 0; i < 1000; i++) {
    const p = C.presentQuestion(q, { shuffleOptions: true }); const c = p.options.find(o => q.correct_option_ids.includes(o.id));
    eq(c.text, 'z'); ok(C.isCorrect(q, [c.id]));
    eq(p.options.map(o => o.displayLabel).join(''), 'ABC', 'display letters are positional');
  }
});
test('shuffle with injected rng is deterministic and a permutation', () => {
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const a = C.shuffle([1, 2, 3, 4, 5, 6], rng); eq(a.slice().sort(), [1, 2, 3, 4, 5, 6]);
});
test('isCorrect: wrong / empty / multi-select', () => {
  const q = good(); ok(!C.isCorrect(q, ['A'])); ok(!C.isCorrect(q, [])); q.correct_option_ids = ['A', 'C']; ok(C.isCorrect(q, ['C', 'A'])); ok(!C.isCorrect(q, ['A']));
});

test('export/import roundtrip preserves ids, explanations, statuses, source metadata', () => {
  const q = good(); const bank = { id: 'bk', name: 'B', settings: {} }; q.bank_id = 'bk';
  const exp = JSON.parse(JSON.stringify(C.buildExport(bank, [q], [], [])));
  const res = C.prepareImport({ banks: [], questions: [] }, exp, { mode: 'new' });
  ok(res.ok); eq(res.bank.id, 'bk'); eq(res.questions[0].id, 'q1'); eq(res.questions[0].explanation_en, 'Because z.'); eq(res.questions[0].verification_status, 'verified_supplied');
  eq(res.questions[0].source_file, 'f.pdf'); eq(res.questions[0].source_page, 1); eq(res.questions[0].correct_option_ids, ['C']); eq(res.rekeyed, false);
});
test('import never overwrites: same bank id => imported as new copy with new ids', () => {
  const q = good(); q.bank_id = 'bk'; const bank = { id: 'bk', name: 'B', settings: {} };
  const exp = JSON.parse(JSON.stringify(C.buildExport(bank, [q], [], [])));
  const res = C.prepareImport({ banks: [bank], questions: [q] }, exp, { mode: 'new' });
  ok(res.ok && res.rekeyed); ok(res.bank.id !== 'bk'); ok(res.questions[0].id !== 'q1'); eq(res.questions[0].bank_id, res.bank.id); ok(/imported copy/.test(res.bank.name));
});
test('import rejects non-Exam-Studio files', () => { ok(!C.prepareImport({ banks: [], questions: [] }, { hello: 1 }, {}).ok); });
test('append import: forced into review queue, never approved, duplicates flagged not merged', () => {
  const q = good(); q.bank_id = 'bk'; const bank = { id: 'bk', name: 'B', settings: {} };
  const exp = JSON.parse(JSON.stringify(C.buildExport(bank, [q], [], [])));
  const res = C.prepareImport({ banks: [bank], questions: [q] }, exp, { mode: 'append', targetBankId: 'bk' });
  ok(res.ok && res.appended); const n = res.questions[0];
  eq(n.review_status, 'needs_review'); eq(n.approved_for_practice, false); eq(n.approved_for_formal_test, false); ok(n.duplicate_of === 'q1'); ok(n.id !== 'q1');
});

test('text format parser: full question incl. evidence, multi-line stem, Arabic', () => {
  const t = 'BANK: B\nSOURCE: a.pdf\n---\nQ: 5\nPAGE: 2\nSTEM: Line one\nline two\nA) one\nB) two\nANSWER: B\nEXPLANATION_EN: because\nSTATUS: verified_external\nEVIDENCE: Dict | https://x.org | 2026-10-23 | meaning\n---\nQ: 6\nSTEM: سؤال عربي\nA) أ\nB) ب\nANSWER: A\nEXPLANATION_AR: لأن\nSTATUS: independently_solved_high\n';
  const r = C.parseTextBank(t, { bankId: 'b' }); eq(r.questions.length, 2);
  const a = r.questions[0]; eq(a.stem_original, 'Line one\nline two'); eq(a.verification_status, 'verified_external'); eq(a.evidence[0].url, 'https://x.org'); eq(a.source_file, 'a.pdf'); eq(a.source_page, 2); eq(a.review_status, 'needs_review'); eq(a.approved_for_practice, false);
  eq(r.questions[1].language, 'ar'); eq(r.questions[1].explanation_ar, 'لأن');
});
test('text format parser: never trusts a "verified" claim without evidence (downgrades)', () => {
  const r = C.parseTextBank('Q: 1\nSTEM: s\nA) a\nB) b\nANSWER: A\nEXPLANATION_EN: e\nSTATUS: verified_supplied\n', {}); eq(r.questions[0].verification_status, 'needs_review'); ok(/downgraded/.test(r.questions[0].ambiguity_notes));
});
test('text format parser: verified_external needs URL and date', () => {
  const r = C.parseTextBank('Q: 1\nSTEM: s\nA) a\nB) b\nANSWER: A\nEXPLANATION_EN: e\nSTATUS: verified_external\nEVIDENCE: Title only\n', {}); eq(r.questions[0].verification_status, 'needs_review');
});
test('text format parser: solved without answer becomes needs_review; empty stem warns and is blocked', () => {
  const r = C.parseTextBank('Q: 1\nSTEM:\nA) a\nB) b\nSTATUS: independently_solved_high\n', {}); eq(r.questions[0].verification_status, 'needs_review'); ok(r.warnings.some(w => /empty stem/.test(w))); ok(C.validateQuestion(r.questions[0]).length > 0);
});
test('text format parser: HTML-like source text is preserved verbatim (escaping is done at render)', () => {
  const r = C.parseTextBank('Q: 1\nSTEM: Is <b>x</b> & "y" > 1?\nA) <script>alert(1)</script>\nB) b\nANSWER: B\nEXPLANATION_EN: e\n', {}); eq(r.questions[0].stem_original, 'Is <b>x</b> & "y" > 1?'); eq(r.questions[0].options[0].text, '<script>alert(1)</script>');
});
test('AI prompt mentions the key anti-fabrication rules', () => { ['Never invent', 'unreadable_incomplete', 'NOT evidence', 'verified_external'].forEach(k => ok(C.AI_PROMPT.includes(k), k)); });

test('duplicate detection flags but does not merge; ignores case/punctuation/Arabic diacritics', () => {
  const a = good(); const b = good(); b.id = 'q2'; b.stem_display = b.stem_original = 'PICK ONE!!'; eq(C.findDuplicates([a], [b]), { q2: 'q1' });
  const x = good(); x.stem_display = 'مَنْ هو؟'; x.stem_original = x.stem_display; const y = good(); y.id = 'q3'; y.stem_display = y.stem_original = 'من هو'; eq(C.findDuplicates([x], [y]), { q3: 'q1' });
});

/* ---- sample bank facts ---- */
const qs = bankFile.questions;
test('sample bank: 86 questions, numbering 1-86 preserved (77 printed twice)', () => {
  eq(qs.length, 86); const nums = qs.map(q => q.source_question_number);
  eq(nums.filter(n => n === '77').length, 2); for (let i = 1; i <= 86; i++) if (i !== 78) ok(nums.includes(String(i)), 'missing ' + i);
  ok(!nums.includes('78'), 'the scan has no printed 78 (second 77 preserved as printed)');
});
test('sample bank: pages 1-5, English 1-70, Arabic 71-86', () => {
  qs.forEach(q => { ok(q.source_page >= 1 && q.source_page <= 5); const n = +q.source_question_number; eq(q.language, n >= 71 ? 'ar' : 'en', 'lang of ' + n); });
});
test('sample bank: nothing is verified, nothing approved (honesty check)', () => {
  qs.forEach(q => { ok(!C.VERIFIED.includes(q.verification_status), 'verified claim at ' + q.source_question_number); eq(q.review_status, 'needs_review'); eq(q.approved_for_practice, false); eq(q.approved_for_formal_test, false); eq(q.evidence, []); });
});
test('sample bank: no student can see anything before teacher approval', () => {
  eq(C.eligibleQuestions(qs, 'practice', { allowIndependentInPractice: true }).length, 0); eq(C.eligibleQuestions(qs, 'formal', {}).length, 0);
});
test('sample bank: known problem items are NOT marked solved', () => {
  const by = n => qs.find(q => q.source_question_number === n);
  ['5', '22', '39', '52'].forEach(n => eq(by(n).verification_status, 'needs_review', 'Q' + n));
  eq(by('56').verification_status, 'unreadable_incomplete'); eq(by('56').correct_option_ids, []); eq(by('22').correct_option_ids, []);
});
test('sample bank: stems preserved identically in original and display; unique ids; stable option ids', () => {
  const ids = new Set(); qs.forEach(q => { ok(!ids.has(q.id)); ids.add(q.id); eq(q.stem_original, q.stem_display); eq(q.options.map(o => o.id).join(''), 'ABCD'); });
});
test('sample bank: only unanswerable items fail structural validation (Q22, Q56)', () => {
  const bad = qs.filter(q => C.validateQuestion(q).length).map(q => q.source_question_number); eq(bad, ['22', '56']);
});
test('sample bank: every record has a specific explanation (en or ar) of reasonable length', () => {
  qs.forEach(q => { const e = (q.explanation_en || q.explanation_ar || '').trim(); ok(e.length > 25, 'Q' + q.source_question_number); });
});
test('sample bank: Arabic questions carry Arabic explanations', () => { qs.filter(q => q.language === 'ar').forEach(q => ok(/[\u0600-\u06FF]/.test(q.explanation_ar))); });

/* ---- contrast (WCAG AA 4.5:1) ---- */
const pairs = { 'main text on app bg': ['#172033', '#F4F7FB'], 'main text on card': ['#172033', '#FFFFFF'], 'secondary text on card': ['#475569', '#FFFFFF'], 'secondary text on app bg': ['#475569', '#F4F7FB'], 'primary button': ['#FFFFFF', '#1D4ED8'], 'correct panel': ['#14532D', '#DCFCE7'], 'incorrect panel': ['#7F1D1D', '#FEE2E2'], 'explanation panel': ['#1E3A8A', '#DBEAFE'], 'warning panel': ['#78350F', '#FEF3C7'], 'selected option': ['#172033', '#EFF6FF'], 'disabled button': ['#334155', '#E2E8F0'] };
Object.keys(pairs).forEach(k => test('contrast >= 4.5:1: ' + k + ' (' + C.contrast(pairs[k][0], pairs[k][1]).toFixed(2) + ')', () => ok(C.contrast(pairs[k][0], pairs[k][1]) >= 4.5)));

/* ---- i18n coverage ---- */
test('i18n: every key used in app.js exists in both Arabic and English', () => {
  const src = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'); const keys = new Set();
  [...src.matchAll(/\bt\('([a-z0-9_]+)'/g)].forEach(m => keys.add(m[1]));
  const dyn = ['v_', 'rv_', 'f_', 'tab_', 'sum_']; const missing = [];
  keys.forEach(k => { if (k.endsWith('_')) return; if (!I.D.en[k]) missing.push('en:' + k); if (!I.D.ar[k]) missing.push('ar:' + k); });
  Object.keys(C.VERIFICATION).forEach(k => { if (!I.D.en['v_' + k] || !I.D.ar['v_' + k]) missing.push('v_' + k); });
  ['draft', 'needs_review', 'approved', 'rejected', 'hold'].forEach(k => { if (!I.D.en['rv_' + k] || !I.D.ar['rv_' + k]) missing.push('rv_' + k); });
  ['all', 'approved', 'needs_review', 'hold', 'rejected', 'blocked', 'flagged', 'dup'].forEach(k => { if (!I.D.en['f_' + k] || !I.D.ar['f_' + k]) missing.push('f_' + k); });
  ['queue', 'add', 'settings', 'log', 'imports'].forEach(k => { if (!I.D.en['tab_' + k] || !I.D.ar['tab_' + k]) missing.push('tab_' + k); });
  ['total', 'approved', 'blocked'].forEach(k => { if (!I.D.en['sum_' + k] || !I.D.ar['sum_' + k]) missing.push('sum_' + k); });
  eq(missing, []);
});
test('i18n: English and Arabic dictionaries have the same keys', () => { eq(Object.keys(I.D.en).sort(), Object.keys(I.D.ar).sort()); });

test('JS files pass syntax check', () => { ['core', 'i18n', 'db', 'app'].forEach(f => cp.execFileSync('node', ['--check', path.join(root, 'js', f + '.js')])); cp.execFileSync('node', ['--check', path.join(root, 'sw.js')]); });
test('index.html declares light-only colour scheme and links manifest', () => { const h = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); ok(h.includes('name="color-scheme" content="light"')); ok(h.includes('manifest.webmanifest')); const c = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8'); ok(c.includes('color-scheme: light')); ok(!/prefers-color-scheme\s*:\s*dark/.test(c)); });
test('CSS: no gradients behind text', () => { ok(!/gradient/i.test(fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8'))); });

console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed');
fs.writeFileSync(path.join(root, 'tests', 'unit_results.txt'), results.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
