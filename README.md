# Exam Studio — استوديو الاختبارات

Local-first exam practice app (teacher review queue + student quizzes), Arabic/English with RTL. Installable on Android / desktop / iOS and works offline.

## الاستخدام بالعربية (ملخص)

**1) التثبيت كتطبيق على الجهاز (PWA)**
- ارفع مجلد المشروع كما هو إلى أي استضافة ثابتة مجانية (Netlify Drop أو GitHub Pages أو Cloudflare Pages)، ثم افتح الرابط (https) في Chrome على الأندرويد ← القائمة ⋮ ← «تثبيت التطبيق / Add to Home screen». على الحاسوب: أيقونة التثبيت في شريط العنوان (Chrome/Edge).
- أو على الحاسوب: افتح الطرفية داخل المجلد ونفّذ `python3 -m http.server 8000` ثم افتح `http://localhost:8000` (يمكن تثبيته من هناك أيضاً).
- بعد أول فتح يعمل التطبيق دون إنترنت.
- بديل بلا تثبيت: افتح الملف المنفرد `dist/exam-studio.html` بالنقر المزدوج في Chrome (يعمل لكنه لا يُثبَّت كتطبيق).

**2) أول استخدام:** مساحة المعلّم ← «استيراد ملف كبنك جديد» ← اختر `data/sample_bank.json` (86 سؤالاً مستخرجاً من ملف الأوقاف). كلها بانتظار المراجعة؛ **لا شيء معتمد ولا موثّق**.

**3) إضافة ملفات جديدة** (تبويب «إضافة أسئلة»):
1. **مباشرة داخل التطبيق:** «إضافة سؤال يدوياً» في قائمة المراجعة، أو اكتب/الصق أسئلة بالصيغة النصية.
2. **ملف نصي .txt/.md:** حمّله ثم «معاينة» ثم «إضافة إلى قائمة المراجعة».
3. **ملفات لا يقرؤها التطبيق (PDF ممسوح، صور، Word):** التطبيق لا يحتوي محرك OCR أو قراءة PDF/Word. انسخ «التعليمات» من نفس التبويب، أرفق ملفك مع التعليمات في محادثة مع مساعد ذكاء اصطناعي، احفظ الرد كملف `.txt` وحمّله هنا. التعليمات تُلزم المساعد بعدم الاختراع وبوسم غير الواضح.
4. **ملف بنك .json** مُصدَّر من التطبيق: يُستورد كبنك جديد أو يُلحق ببنك موجود (التكرارات تُوسَم ولا تُدمج).

**4) المراجعة والاعتماد:** قارن كل بطاقة بصفحة PDF ← عدّل (النص الأصلي يبقى محفوظاً) ← «اعتماد للتدريب». الاختبار الرسمي يتطلب حالة «موثّق» مع دليل. الحالة «محلول باستقلال» لا تظهر للطلاب إلا إذا فعّلتها من «إعدادات البنك».

**5) النسخ الاحتياطي:** البيانات محفوظة في هذا المتصفح فقط. امسح بيانات المتصفح أو غيّر الجهاز فقد تضيع. استخدم «تصدير البنك (JSON)» بانتظام. «تصدير نسخة الطالب» يحتوي المعتمد فقط (مع الإجابات والشروح) — أبقِ البنك الرئيسي خاصاً.

## English

**Install:** host this folder on any static host (Netlify Drop, GitHub Pages, Cloudflare Pages) → open the https URL → *Install app* / *Add to Home screen*. Or run `python3 -m http.server 8000` in this folder and open `http://localhost:8000`. After the first load it works offline. `dist/exam-studio.html` is a single-file version that opens by double-click (not installable).

**Adding files:** (a) type/paste or add questions manually; (b) load a `.txt`/`.md` file in the Exam Studio text format; (c) for PDFs/scans/Word/images, which this app cannot read, copy the built-in AI prompt, give it plus the file to an AI assistant, save the reply as `.txt` and load it; (d) import/append bank `.json` files. Everything lands in the review queue; the importer downgrades any "verified" claim lacking evidence.

**Files**
- `index.html`, `css/`, `js/` (`core.js` logic, `db.js` IndexedDB, `i18n.js`, `app.js` UI), `sw.js`, `manifest.webmanifest`, `icons/` — the app
- `data/sample_bank.json` — 86 transcribed questions (unverified, unapproved)
- `docs/` — master prompt/spec, teacher review report, test report
- `tests/` — `node tests/run_tests.js` (unit) and `python3 tests/e2e_test.py` (Playwright browser tests)
- `tools/` — `build_bank.js` (regenerates the sample bank), `build_single.js` (single-file build), `make_report.js`

## Limitations (honest list)
- No OCR, PDF/Word parsing, AI or cloud sync inside the app. AI conversion happens outside, in a chat you control. No API key is stored anywhere.
- Data is local to one browser profile on one device. Export backups. There is no multi-user login: the student workspace on the same device can be switched to the teacher workspace. For public multi-student use you need a backend with authentication and roles (not included).
- The student view reads the same local database, so answers exist on that device; they are only hidden in the UI until submission.
- The sample bank is not verified. See `docs/REVIEW_REPORT.md`.
- iOS Safari can evict local data after about 7 days without use unless the app is installed to the Home Screen; export backups.
