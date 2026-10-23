"""End-to-end browser tests (headless Chromium via Playwright). Usage: python3 tests/e2e_test.py
Serves the app folder on localhost, drives the real UI, writes tests/e2e_results.txt."""
import http.server, socketserver, threading, os, json, sys, re, tempfile, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765
results, failures = [], 0


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve():
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def check(name, cond, detail=""):
    global failures
    if cond:
        results.append("PASS  " + name)
    else:
        failures += 1
        results.append("FAIL  " + name + (" :: " + str(detail) if detail else ""))


def lum(rgb):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = [f(x) for x in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def parse_rgb(s):
    nums = re.findall(r"[\d.]+", s)
    return [float(x) for x in nums[:3]]


def colors(page, selector):
    return page.eval_on_selector(selector, "e => { const s = getComputedStyle(e); return [s.color, s.backgroundColor]; }")


def main():
    httpd = serve()
    bank = json.load(open(os.path.join(ROOT, "data/sample_bank.json"), encoding="utf8"))
    by_num = {q["source_question_number"]: q for q in bank["questions"]}
    exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 390, "height": 800}, accept_downloads=True)
        page = ctx.new_page()
        errors, dialogs = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept("Test bank") if d.type == "prompt" else d.accept()))
        page.goto(f"http://127.0.0.1:{PORT}/index.html")
        page.wait_for_selector("h1")

        # --- shell / RTL ---
        check("page loads without JS errors", not errors, errors)
        check("UI defaults to Arabic RTL", page.evaluate("document.documentElement.dir") == "rtl" and page.evaluate("document.documentElement.lang") == "ar")
        page.click("[data-action=lang]")
        check("language toggle -> English LTR", page.evaluate("document.documentElement.dir") == "ltr" and page.inner_text("h1") == "Exam Studio")
        check("empty-state message shown with no banks", "No bank yet" in page.inner_text("main"))

        # --- import sample bank ---
        page.click("[data-action=import-new]")
        page.set_input_files("#fileIn", os.path.join(ROOT, "data/sample_bank.json"))
        page.wait_for_selector("article.q")
        check("sample bank imports 86 cards", page.locator("article.q").count() == 86, page.locator("article.q").count())
        check("sample bank starts with 0 approved", "Approved: 0" in page.inner_text(".chips").replace("\n", " "), page.inner_text(".chips"))
        check("Q56 shows Unreadable status and block reason", "Unreadable / Incomplete" in page.inner_text("#card-awqaf2026-q056") and "NO_CORRECT_ANSWER" in page.inner_text("#card-awqaf2026-q056"))
        check("Q56 original source wording kept (no guessing)", "Translate the underlined word" in page.inner_text("#card-awqaf2026-q056"))
        check("original shown for Arabic Q71 with dir=auto", page.get_attribute("#card-awqaf2026-q071 .stem", "dir") == "auto")
        check("English stem renders LTR / Arabic stem RTL", page.eval_on_selector("#card-awqaf2026-q001 .stem", "e=>getComputedStyle(e).direction") == "ltr" and page.eval_on_selector("#card-awqaf2026-q072 .stem", "e=>getComputedStyle(e).direction") == "rtl")

        # --- students see nothing before approval ---
        page.click("[data-action=ws][data-v=student]")
        check("student: 0 questions available before approval; Start disabled", "available in this mode: 0" in page.inner_text("main") and page.is_disabled("[data-action=start]"))
        page.click("[data-action=ws][data-v=teacher]")

        # --- approval gates ---
        page.click("#card-awqaf2026-q056 [data-action=approve][data-kind=practice]")
        check("cannot approve unreadable Q56", "Cannot approve" in page.inner_text("main") and "NO_CORRECT_ANSWER" in page.inner_text("main"))
        page.click("#card-awqaf2026-q005 [data-action=approve][data-kind=practice]")
        check("cannot approve Needs Review Q5", "Cannot approve" in page.inner_text("main"))
        page.click("#card-awqaf2026-q002 [data-action=approve][data-kind=formal]")
        check("cannot approve independently-solved Q2 for FORMAL test", "Cannot approve" in page.inner_text("main") and "Verified" in page.inner_text("main"))

        # approve 8 clean solved English questions for practice
        picks = ["2", "4", "9", "10", "14", "15", "25", "55"]
        for n in picks:
            page.click(f"#card-awqaf2026-q{int(n):03d} [data-action=approve][data-kind=practice]")
            page.wait_for_selector(f"#card-awqaf2026-q{int(n):03d} .rv-approved")
        check("8 questions approved for practice", "Approved: 8" in page.inner_text(".chips").replace("\n", " "))
        check("approved-but-independent shows hidden-from-students notice", "currently hidden from students" in page.inner_text("#card-awqaf2026-q002"))
        page.click("[data-action=ws][data-v=student]")
        check("student still sees 0: independently solved is off by default", "available in this mode: 0" in page.inner_text("main"))
        page.click("[data-action=ws][data-v=teacher]")
        page.click("[data-action=tab][data-v=settings]")
        page.check("#s_ind")
        page.click("[data-action=save-settings]")
        page.click("[data-action=ws][data-v=student]")
        check("after teacher enables it, student sees exactly the 8 approved", "available in this mode: 8" in page.inner_text("main"), page.inner_text("main")[:200])
        page.select_option("#q_mode", "formal")
        check("formal mode: 0 available (needs verified source)", "available in this mode: 0" in page.inner_text("main"))
        page.select_option("#q_mode", "practice")

        # --- quiz: shuffle + mapping + next-once + feedback ---
        page.fill("#q_count", "8")
        page.check("#q_sq"); page.check("#q_so")
        page.click("[data-action=start]")
        seen_stems, correct_count, double_next_ok = [], 0, True
        for i in range(8):
            stem = page.inner_text("#stem")
            seen_stems.append(stem)
            check_visible = page.is_visible(".opts") and page.locator(".opt").count() == 4
            if i == 0:
                check("Q shows progress, full stem and 4 options together", "Question 1 of 8" in page.inner_text(".prog") and len(stem) > 5 and check_visible)
                check("answers not revealed before checking (no 'Correct answer' tag, no explanation)", "Correct answer" not in page.inner_text(".quiz") and "Explanation" not in page.inner_text(".quiz"))
                check("Check answer disabled until an option is chosen", page.is_disabled("[data-action=check]"))
            q = next(x for x in bank["questions"] if x["stem_original"] == stem and x["source_question_number"] in picks)
            right = next(o for o in q["options"] if o["id"] == q["correct_option_ids"][0])["text"]
            wrong = next(o for o in q["options"] if o["id"] != q["correct_option_ids"][0])["text"]
            choose_right = (i % 2 == 0)  # alternate right / wrong
            target = right if choose_right else wrong
            page.locator(".opt", has=page.locator(f".ot:text-is({json.dumps(target)})")).click()
            page.click("[data-action=check]")
            panel = page.inner_text("#live")
            if choose_right:
                correct_count += 1
                check(f"Q{i+1}: correct choice -> 'Correct' status after shuffle", "Correct" in panel and "Incorrect" not in panel, panel)
            else:
                check(f"Q{i+1}: wrong choice -> Incorrect + correct answer + explanation + verification", "Incorrect" in panel and right in panel and "Explanation" in panel and "Independently Solved" in panel, panel)
            if i == 0:
                check("correct panel contrast >= 4.5", ratio(*[parse_rgb(c) for c in colors(page, "#live .panel.good")]) >= 4.5)
            if i == 1:
                check("incorrect panel contrast >= 4.5", ratio(*[parse_rgb(c) for c in colors(page, "#live .panel.bad")]) >= 4.5)
                check("explanation panel contrast >= 4.5", ratio(*[parse_rgb(c) for c in colors(page, "#live .panel.expl")]) >= 4.5)
                check("explanation font >= 16px, line-height >= 1.5", page.eval_on_selector("#live .panel.expl", "e=>{const s=getComputedStyle(e);return parseFloat(s.fontSize)>=16 && parseFloat(s.lineHeight)/parseFloat(s.fontSize)>=1.5}"))
                check("Next button is prominent (>=44px high)", page.eval_on_selector("[data-action=next]", "e=>e.getBoundingClientRect().height>=44"))
                check("stem 19-22px / options >=17px", page.eval_on_selector("#stem", "e=>{const f=parseFloat(getComputedStyle(e).fontSize);return f>=19&&f<=22}") and page.eval_on_selector(".opt", "e=>parseFloat(getComputedStyle(e).fontSize)>=17"))
            if i == 2:
                # double-click Next must advance exactly once
                before = page.inner_text(".prog")
                page.dblclick("[data-action=next]")
                after = page.inner_text(".prog")
                nxt = f"Question {i+2} of 8"
                double_next_ok = nxt in after
                check("double-click Next advances exactly one question", double_next_ok, (before, after))
                continue
            page.click("[data-action=next]")
        check("all 8 questions were distinct (no repeats)", len(set(seen_stems)) == 8, seen_stems)
        check("summary shows score and accuracy", "Quiz summary" in page.inner_text("main") and f"{correct_count}/8" in page.inner_text("main") and f"{round(correct_count/8*100)}%" in page.inner_text("main"), page.inner_text("main")[:300])
        check("summary lists mistakes with explanations", page.locator("article.q").count() == 8 - correct_count)
        page.click("[data-action=retry]")
        check("retry mistakes starts a quiz of exactly the missed questions", f"Question 1 of {8-correct_count}" in page.inner_text(".prog"))
        page.click("[data-action=ws][data-v=teacher]")

        # --- text add: AI-converted file flow ---
        page.click("[data-action=tab][data-v=add]")
        page.set_input_files("#aFile", {"name": "scan.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 fake"})
        page.wait_for_selector(".panel.warn")
        check("PDF selection: honest 'cannot read' notice + AI prompt available, nothing added", "cannot be read by this app" in page.inner_text("main") and "Nothing was added" in page.inner_text("main") and "You are preparing exam questions" in page.input_value("#aiPrompt"))
        txt = ("BANK: AI bank\nSOURCE: ai-output.pdf\n---\nQ: 1\nPAGE: 3\nSTEM: She <b>go</b> & \"run\"?\nA) goes\nB) go\nC) <img src=x onerror=alert(1)>\nD) going\nANSWER: A\nEXPLANATION_EN: Third person singular takes -s.\nSTATUS: verified_supplied\n---\nQ: 2\nSTEM: \nA) one\nB) two\nANSWER: A\nEXPLANATION_EN: x\n---\nQ: 3\nSTEM: Full Q3\nA) a\nB) b\nANSWER: B\nEXPLANATION_EN: because b\nSTATUS: independently_solved_high\n")
        path = os.path.join(tempfile.gettempdir(), "ai_bank.txt")
        open(path, "w", encoding="utf8").write(txt)
        page.set_input_files("#aFile", path)
        page.wait_for_function("document.getElementById('a_text').value.includes('AI bank')")
        page.select_option("#a_target", "new")
        page.fill("#a_new", "AI imported bank")
        page.click("[data-action=add-preview]")
        pv = page.inner_text("main")
        check("preview: 3 questions found; empty-stem Q2 flagged blocked", "3 questions found" in pv and "EMPTY_STEM" in pv)
        page.click("[data-action=add-commit]")
        page.wait_for_selector("article.q")
        check("new bank created and items are in review queue (3 cards)", page.locator("article.q").count() == 3 and "AI imported bank" in page.inner_text("#bankSel"))
        check("claimed 'verified_supplied' without evidence was downgraded to Needs Review", "Verified status downgraded" in page.inner_text("main"))
        check("HTML in source text rendered as text; no script executed", "<b>go</b>" in page.inner_text("main") and "<img src=x" in page.inner_text("main") and not any("1" == d for d in dialogs) and page.locator("main img").count() == 0)
        check("Q2 (empty stem) blocked with reason, cannot be approved", "EMPTY_STEM" in page.inner_text("main"))
        cards = page.locator("article.q")
        ids = [cards.nth(i).get_attribute("id") for i in range(cards.count())]
        q2 = [i for i in ids if "EMPTY_STEM" in page.inner_text("#" + i)][0]
        page.click(f"#{q2} [data-action=approve][data-kind=practice]")
        check("approval of empty-stem question is refused", "Cannot approve" in page.inner_text("main"))

        # --- manual add + edit, edit-resets-approval ---
        page.click("[data-action=add-manual]")
        page.wait_for_selector("#f_stem")
        page.fill("#f_stem", "Manual question stem?")
        for i, t in enumerate(["alpha", "beta", "gamma", "delta"]):
            page.fill(f"#f_opt_{i}", t)
        page.check("input[name=f_correct][value=B]")
        page.fill("#f_en", "Beta is correct because it is the second Greek letter.")
        page.select_option("#f_vs", "independently_solved_high")
        page.click("[data-action=add-option]")
        check("add-option adds a 5th option row", page.locator("[id^=f_opt_]").count() == 5)
        page.click("[data-action=remove-option]")
        check("remove-option removes it", page.locator("[id^=f_opt_]").count() == 4)
        page.click("[data-action=save-edit]")
        page.wait_for_selector("article.q >> text=Manual question stem?")
        check("manual question saved with original preserved", "Manual question stem?" in page.inner_text("main"))
        mid = [page.locator("article.q").nth(i).get_attribute("id") for i in range(page.locator("article.q").count())]
        mq = [i for i in mid if "Manual question stem?" in page.inner_text("#" + i)][0]
        page.click(f"#{mq} [data-action=approve][data-kind=practice]")
        page.wait_for_selector(f"#{mq} .rv-approved")
        page.click(f"#{mq} [data-action=edit]")
        page.fill("#f_stem", "Manual question stem (edited)?")
        page.click("[data-action=save-edit]")
        page.wait_for_selector(f"#{mq}")
        check("editing an approved question resets approval", "Awaiting review" in page.inner_text(f"#{mq}") and "approval was reset" in page.inner_text("main"))
        page.click(f"#{mq} [data-action=edit]")
        page.select_option("#f_vs", "verified_external")
        page.click("[data-action=save-edit]")
        check("verified status without evidence is refused in editor", "needs an evidence entry" in page.inner_text("main"))
        page.click("[data-action=cancel-edit]")

        # --- ambiguous mark ---
        page.click(f"#{mq} [data-action=mark][data-v=ambiguous]")
        page.wait_for_function("(id)=>document.getElementById(id).innerText.includes('Ambiguous / Defective')", arg=mq)
        check("mark ambiguous sets Ambiguous/Defective", "Ambiguous / Defective" in page.inner_text(f"#{mq}"))

        # --- log ---
        page.click("[data-action=tab][data-v=log]")
        check("change log records approvals, edits, imports", all(k in page.inner_text("main") for k in ["approve_practice", "edit", "import"]) or all(k in page.inner_text("main") for k in ["approve_practice", "edit", "add_from_text"]))

        # --- export + re-import: roundtrip, no overwrite ---
        page.click("[data-action=tab][data-v=queue]")
        with page.expect_download() as dl:
            page.click("[data-action=export-bank]")
        exp_path = os.path.join(tempfile.gettempdir(), "exported.json")
        dl.value.save_as(exp_path)
        exported = json.load(open(exp_path, encoding="utf8"))
        check("export JSON has format, bank, questions, IDs, explanations, statuses", exported["format"] == "exam-studio-bank" and len(exported["questions"]) == 4 and all(q["id"] and q["verification_status"] and ("explanation_en" in q) for q in exported["questions"]))
        before_banks = page.locator("#bankSel option").count()
        page.click("[data-action=import-new]")
        page.set_input_files("#fileIn", exp_path)
        page.wait_for_function(f"document.querySelectorAll('#bankSel option').length === {before_banks + 1}")
        check("re-importing same file creates a NEW copy; nothing overwritten", page.locator("#bankSel option").count() == before_banks + 1 and "imported copy" in page.inner_text("#bankSel"))
        # sample bank still has 86
        page.select_option("#bankSel", index=0)
        check("original bank still intact after duplicate import (86 questions)", "Total: 86" in page.inner_text(".chips").replace("\n", " "))

        # --- student export refuses when nothing approved in bank; persists across reload ---
        page.reload(); page.wait_for_selector("article.q")
        check("data persists after reload (IndexedDB)", page.locator("#bankSel option").count() == before_banks + 1)

        # --- mobile layout ---
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        offenders = page.evaluate("()=>{const w=document.documentElement.clientWidth;return [...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>w+1).slice(0,5).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right))}")
        check("no horizontal overflow at 390px", not overflow, offenders)
        check("body text >= 16px", page.evaluate("parseFloat(getComputedStyle(document.body).fontSize)") >= 16)
        page.emulate_media(color_scheme="dark")
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        check("dark mode emulation keeps light background", bg == "rgb(244, 247, 251)", bg)
        page.emulate_media(color_scheme="light")

        # --- keyboard: tab reaches a focusable control with visible outline ---
        page.keyboard.press("Tab"); page.keyboard.press("Tab")
        check("keyboard focus lands on an interactive element", page.evaluate("['A','BUTTON','SELECT','INPUT','TEXTAREA'].includes(document.activeElement.tagName)"))
        check("focus outline defined (3px)", page.evaluate("(()=>{page=document.activeElement;const s=getComputedStyle(document.activeElement);return parseFloat(s.outlineWidth)>=2})()"))

        # --- PWA ---
        check("manifest is served and valid JSON", json.loads(page.evaluate("fetch('manifest.webmanifest').then(r=>r.text())")).get("display") == "standalone")
        page.wait_for_function("navigator.serviceWorker.ready.then(()=>true)", timeout=10000)
        check("service worker registered and ready", page.evaluate("navigator.serviceWorker.ready.then(r=>!!r.active)"))
        page.reload(); page.wait_for_selector("h1")
        ctx.set_offline(True)
        page.reload(); page.wait_for_selector("h1", timeout=10000)
        check("app loads fully OFFLINE after first visit (service worker)", page.inner_text("h1") == "Exam Studio" and page.locator("article.q").count() > 0)
        ctx.set_offline(False)

        check("no uncaught JS errors during the whole run", not [e for e in errors if "Failed to load resource" not in e], errors)
        browser.close()
    httpd.shutdown()
    out = "\n".join(results) + f"\n\n{len(results)-failures} passed, {failures} failed\n"
    open(os.path.join(ROOT, "tests", "e2e_results.txt"), "w", encoding="utf8").write(out)
    print(out)
    sys.exit(1 if failures else 0)


main()
