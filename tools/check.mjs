// 살핌 전체 기능 점검: 살핌이 고객에게 약속한 "월요일 점검 6항목"을 살핌 사이트 자신에게 그대로 한다.
// 쓰는 법
//   node tools/check.mjs                         → 내 컴퓨터(site/ 폴더)를 임시로 띄워 점검
//   node tools/check.mjs https://salpim.pages.dev → 실제 사이트 점검 (GitHub Actions가 매주 월요일 실행)
//   뒤에 --shots=폴더 를 붙이면 화면 사진도 저장한다.
// 결과: 화면에 요약, tools/data/check-results.json 에 자세한 내용.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import tls from "node:tls";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); } // Claude 작업 환경에 깔려 있는 위치

const args = process.argv.slice(2);
const liveBase = (args.find(a => /^https?:\/\//.test(a)) || "").replace(/\/$/, "");
const shotsDir = (args.find(a => a.startsWith("--shots=")) || "").slice(8);
const LIVE = !!liveBase;

// 점검할 페이지와 화면 폭 (작은 휴대폰 ~ PC)
const PAGES = [
  { path: "/", name: "첫 페이지" },
  { path: "/samples/restaurant", name: "샘플 음식점" },
  { path: "/samples/academy", name: "샘플 학원" },
  { path: "/samples/clinic", name: "샘플 병원" },
  { path: "/samples/company", name: "샘플 회사" },
];
const WIDTHS = [[320, 640], [360, 740], [390, 844], [1200, 800]];

const items = [];
const add = (group, name, ok, detail = "") => items.push({ group, name, ok, detail: String(detail) });
const G = { open: "① 사이트 접속", phone: "② 휴대폰 화면", links: "③ 링크와 사진", contact: "④ 전화·지도·예약 버튼", cert: "⑤ 인증서와 도메인", stale: "⑥ 지난 내용", func: "기능 동작" };

// 한국 날짜 계산 (사이트 코드와 같은 방식으로 따로 계산해서 서로 맞는지 본다)
const kst = new Date(Date.now() + 9 * 3600e3);
const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
const nextMon = new Date(today + ((8 - kst.getUTCDay()) % 7) * 864e5);
const expectDate = `${nextMon.getUTCMonth() + 1}월 ${nextMon.getUTCDate()}일 (월)`;
const jan1 = Date.UTC(kst.getUTCFullYear(), 0, 1);
const firstMon = jan1 + ((8 - new Date(jan1).getUTCDay()) % 7) * 864e5;
const expectWeeks = Math.min(52, Math.max(0, Math.floor((kst - firstMon) / (7 * 864e5)) + 1));

// 내 컴퓨터 점검용 임시 서버 (Cloudflare Pages처럼 .html 없는 주소도 열어 준다)
function startLocal() {
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };
  const dir = join(ROOT, "site");
  const srv = createServer((req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let f = join(dir, p);
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!f.startsWith(dir) || !existsSync(f)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise(ok => srv.listen(0, "127.0.0.1", () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

function certDays(host) {
  return new Promise(ok => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const c = s.getPeerCertificate(); s.end();
      ok(c && c.valid_to ? Math.floor((new Date(c.valid_to) - Date.now()) / 864e5) : null);
    });
    s.on("error", () => ok(null)); s.on("timeout", () => { s.destroy(); ok(null); });
  });
}

const local = LIVE ? null : await startLocal();
const BASE = LIVE ? liveBase : local.base;
const origin = new URL(BASE).origin;
const browser = await chromium.launch();
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

try {
  // ①②③ 페이지마다, 화면 폭마다
  const externalLinks = new Set();
  for (const pg of PAGES) {
    for (const [w, h] of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 800, hasTouch: w < 800, locale: "ko-KR", timezoneId: "Asia/Seoul" });
      const page = await ctx.newPage();
      const errors = [];
      // 내 컴퓨터 점검은 바깥 사이트(글꼴·샘플 사진)에 못 나가므로 막아 두고 넘어간다
      if (!LIVE) await page.route(u => !u.href.startsWith(origin), r => r.abort());
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (m.type() === "error" && !(!LIVE && /Failed to load resource|ERR_FAILED/.test(m.text()))) errors.push(m.text()); });
      const t0 = Date.now();
      let status = 0;
      try { const r = await page.goto(BASE + pg.path, { waitUntil: LIVE ? "load" : "domcontentloaded", timeout: 30000 }); status = r ? r.status() : 0; }
      catch (e) { errors.push("열기 실패: " + e.message.split("\n")[0]); }
      const ms = Date.now() - t0;
      const tag = `${pg.name} ${w}px`;
      if (w === 390) {
        add(G.open, `${pg.name} 열림`, status === 200, status === 200 ? `${ms}ms` : `응답 ${status}`);
        if (LIVE) add(G.open, `${pg.name} 속도`, ms < 4000, `${ms}ms (기준 4초)`);
      }
      if (status !== 200) { await ctx.close(); continue; }
      await page.waitForTimeout(300);
      // 끝까지 내려 보며 늦게 나타나는 것(보고 문자 등)까지 띄운다
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } scrollTo(0, 0); });
      await page.waitForTimeout(LIVE ? 1500 : 300);

      // 휴대폰 흉내에서는 내용이 넘치면 화면이 축소되며 innerWidth가 같이 커지므로, 정해 둔 화면 폭(w)과 비교한다
      const m = await page.evaluate(w => {
        const de = document.documentElement;
        // 옆으로 미는 목록(샘플 카드, 가격표)처럼 일부러 넘치게 만든 상자 안은 제외
        const inScroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true; } return false; };
        const wide = [...document.querySelectorAll("body *")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.right > w + 1 && !inScroller(el); })
          .slice(0, 3).map(el => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""));
        return {
          overflow: Math.max(de.scrollWidth, document.body.scrollWidth) - w, wide, title: document.title,
          anchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute("href")).filter(h => h.length > 1 && !document.getElementById(h.slice(1))),
          links: [...document.querySelectorAll("a[href]")].map(a => a.href),
          imgs: [...document.images].map(i => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0, alt: i.hasAttribute("alt") })),
        };
      }, w);
      const over = m.overflow > 1 || m.wide.length > 0;
      add(G.phone, `${tag} 가로 넘침 없음`, !over, over ? `${Math.max(m.overflow, 0)}px 넘침 (${m.wide.join(", ")})` : "");
      add(G.phone, `${tag} 오류 없음`, errors.length === 0, errors.slice(0, 2).join(" / "));
      if (w === 390) {
        add(G.links, `${pg.name} 제목 있음`, !!m.title.trim(), m.title);
        add(G.links, `${pg.name} 쪽 안 이동(#) 링크`, m.anchors.length === 0, m.anchors.join(", "));
        const inner = [...new Set(m.links.filter(u => u.startsWith(origin)).map(u => u.split("#")[0]))];
        const bad = [];
        for (const u of inner) { const r = await ctx.request.get(u, { timeout: 20000 }).catch(() => null); if (!r || r.status() !== 200) bad.push(`${u.replace(origin, "")} → ${r ? r.status() : "응답 없음"}`); }
        add(G.links, `${pg.name} 사이트 안 링크 ${inner.length}개`, bad.length === 0, bad.join(", "));
        m.links.filter(u => /^https?:/.test(u) && !u.startsWith(origin)).forEach(u => externalLinks.add(u));
        const mine = m.imgs.filter(i => LIVE || i.src.startsWith(origin));
        const broken = mine.filter(i => !i.ok).map(i => i.src.slice(0, 80));
        add(G.links, `${pg.name} 사진 ${mine.length}장`, broken.length === 0, broken.join(", ") || (LIVE ? "" : "바깥 사진은 실제 사이트 점검에서 확인"));
        const noAlt = m.imgs.filter(i => !i.alt).length;
        add(G.links, `${pg.name} 사진 설명(alt)`, noAlt === 0, noAlt ? `${noAlt}장에 설명 없음` : "");
      }
      if (shotsDir && (w === 390 || w === 1200)) await page.screenshot({ path: join(shotsDir, `${pg.path === "/" ? "home" : pg.path.split("/").pop()}-${w}.png`), fullPage: true });
      await ctx.close();
    }
  }

  // ③ 바깥 링크 (실제 사이트 점검에서만)
  if (LIVE) {
    const ctx = await browser.newContext();
    const bad = [];
    for (const u of externalLinks) { const r = await ctx.request.get(u, { timeout: 20000, maxRedirects: 5 }).catch(() => null); if (!r || r.status() >= 400) bad.push(`${u.slice(0, 70)} → ${r ? r.status() : "응답 없음"}`); }
    add(G.links, `바깥 링크 ${externalLinks.size}개`, bad.length === 0, bad.join(", "));
    await ctx.close();
  }

  // ④⑥ + 기능: 첫 페이지
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    const page = await ctx.newPage();
    if (!LIVE) await page.route(u => !u.href.startsWith(origin), r => r.abort());
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const c = await page.evaluate(() => ({
      todo: [...document.querySelectorAll("#contact .way .v.todo")].map(e => e.previousElementSibling.textContent),
      ways: [...document.querySelectorAll("#contact .way")].map(e => ({ k: e.querySelector(".k").textContent, href: (e.querySelector("a") || {}).href || "", text: e.querySelector(".v").textContent.trim() })),
      tels: [...document.querySelectorAll('a[href^="tel:"], a[href^="sms:"]')].map(a => a.getAttribute("href")),
      mails: [...document.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute("href")),
      date: document.getElementById("sheetDate").textContent,
      weeksOn: document.querySelectorAll("#weeks i.on").length, weeksAll: document.querySelectorAll("#weeks i").length,
      text: document.body.innerText,
    }));
    const filled = c.ways.filter(x => x.href);
    add(G.contact, "연락 방법이 하나 이상 연결됨", filled.length > 0, filled.length ? filled.map(x => x.k).join(", ") : "아직 연락처가 비어 있음 (상담 신청을 받을 수 없음)");
    if (c.todo.length && filled.length) add(G.contact, "빈 연락처 칸 없음", false, `비어 있음: ${c.todo.join(", ")}`);
    const badTel = c.tels.filter(t => !/^(tel|sms):\+?[0-9-]{9,16}$/.test(t));
    if (c.tels.length) add(G.contact, `전화·문자 버튼 ${c.tels.length}개 번호 형식`, badTel.length === 0, badTel.join(", "));
    const badMail = c.mails.filter(t => !/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(t));
    if (c.mails.length) add(G.contact, `이메일 버튼 ${c.mails.length}개 주소 형식`, badMail.length === 0, badMail.join(", "));

    add(G.stale, "첫 화면 리포트 날짜가 다가오는 월요일", c.date === expectDate, `화면 ${c.date} / 맞는 값 ${expectDate}`);
    add(G.stale, "올해 점검표 칸 수", c.weeksOn === expectWeeks && c.weeksAll === 52, `채워진 칸 ${c.weeksOn}/${c.weeksAll}, 맞는 값 ${expectWeeks}`);
    // 본문에 적힌 날짜 중 이미 지난 것(끝난 공지 등) 찾기
    const past = [];
    for (const x of c.text.matchAll(/(20\d\d)[년.\-/]\s?(\d{1,2})[월.\-/]\s?(\d{1,2})일?/g)) { if (Date.UTC(+x[1], +x[2] - 1, +x[3]) < today) past.push(x[0]); }
    add(G.stale, "지난 날짜가 적힌 글 없음", past.length === 0, [...new Set(past)].join(", "));
    // 살핌의 약속: '무제한'이라는 말은 쓰지 않는다(횟수 제한 없이 + 범위를 같이 적는다)
    add(G.stale, "'무제한'이라는 말 없음", !c.text.includes("무제한"));

    // 기능: 가격 합계 바꾸기
    const before = await page.textContent("#s1a");
    await page.click('.seg button[data-size="five"]'); const five = await page.textContent("#s1a");
    await page.click('.seg button[data-size="one"]'); const one = await page.textContent("#s1a");
    add(G.func, "가격 1년·2년 합계 규모 바꾸기", five !== before && one === before, `${before} ↔ ${five}`);
    // 기능: 질문 펼치기
    const faq = await page.evaluate(() => { const d = document.querySelector(".faq details"); if (!d) return null; d.querySelector("summary").click(); return d.open; });
    add(G.func, "자주 묻는 질문 펼치기", faq === true, faq === null ? "질문 구역 없음" : "");
    // 기능: 보고 문자 도착
    await page.evaluate(() => document.getElementById("bubble").parentElement.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1600);
    add(G.func, "보고 문자 도착", await page.evaluate(() => !document.getElementById("bubble").hidden && document.getElementById("typing").hidden));
    // 기능: 메뉴 → 구역 이동
    await page.click('a.btn-main[href="#contact"]'); await page.waitForTimeout(900);
    add(G.func, "상담 신청 버튼 → 상담 구역", await page.evaluate(() => { const r = document.getElementById("contact").getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
    await ctx.close();
  }

  // 기능: 다크 모드·움직임 줄이기에서도 깨지지 않는지
  for (const [label, opt] of [["다크 모드", { colorScheme: "dark" }], ["움직임 줄이기", { reducedMotion: "reduce" }]]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, ...opt });
    const page = await ctx.newPage(); const errs = [];
    if (!LIVE) await page.route(u => !u.href.startsWith(origin), r => r.abort());
    page.on("pageerror", e => errs.push(e.message));
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const r = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - 375, bubble: !document.getElementById("bubble").hidden, bg: getComputedStyle(document.body).backgroundColor }));
    add(G.func, `${label} 화면`, r.over <= 1 && errs.length === 0 && (label !== "움직임 줄이기" || r.bubble), errs[0] || (r.over > 1 ? `${r.over}px 넘침` : `바탕 ${r.bg}`));
    if (shotsDir && label === "다크 모드") await page.screenshot({ path: join(shotsDir, "home-dark-375.png") });
    await ctx.close();
  }

  // 기능: 샘플 사이트
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    const page = await ctx.newPage();
    if (!LIVE) await page.route(u => !u.href.startsWith(origin), r => r.abort());
    await page.goto(BASE + "/samples/restaurant", { waitUntil: "domcontentloaded" });
    const rs = await page.evaluate(() => ({ label: document.getElementById("status").lastElementChild.textContent, today: !!document.querySelector("#hours tr.today") }));
    add(G.func, "음식점 '지금 영업 중' 표시", /영업|쉬는 시간|휴무/.test(rs.label) && rs.today, rs.label);
    await page.goto(BASE + "/samples/clinic", { waitUntil: "domcontentloaded" });
    const cs = await page.evaluate(() => ({ label: document.getElementById("st").lastElementChild.textContent, hours: document.getElementById("todayHours").textContent }));
    add(G.func, "병원 '오늘 진료' 안내판", /진료|점심시간|휴진/.test(cs.label) && !!cs.hours.trim(), `${cs.label} / ${cs.hours}`);
    await page.goto(BASE + "/samples/company", { waitUntil: "domcontentloaded" });
    const co = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#rows tr")], btn = [...document.querySelectorAll(".filters button")].find(b => b.dataset.f !== "all");
      const all = rows.length; btn.click();
      const shown = rows.filter(r => !r.hidden), right = shown.every(r => r.dataset.f === btn.dataset.f);
      document.querySelector('.filters button[data-f="all"]').click();
      return { all, some: shown.length, right, back: rows.filter(r => !r.hidden).length, f: btn.textContent };
    });
    add(G.func, "회사 실적 공종별 거르기", co.some > 0 && co.some < co.all && co.right && co.back === co.all, `전체 ${co.all}건 → '${co.f}' ${co.some}건 → 전체 ${co.back}건`);
    for (const s of ["restaurant", "academy", "clinic", "company"]) {
      await page.goto(BASE + "/samples/" + s, { waitUntil: "domcontentloaded" });
      const r = await page.evaluate(() => ({ demo: /샘플/.test((document.querySelector(".demo") || {}).textContent || ""), noindex: /noindex/.test((document.querySelector('meta[name="robots"]') || {}).content || ""), real: [...document.querySelectorAll('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')].length }));
      add(G.func, `샘플(${s}) '샘플' 표시·검색 제외·가짜 연락처 연결 안 됨`, r.demo && r.noindex && r.real === 0, `샘플 띠 ${r.demo ? "있음" : "없음"}, 검색 제외 ${r.noindex ? "됨" : "안 됨"}, 연결된 연락처 ${r.real}개`);
    }
    await ctx.close();
  }

  // ⑤ 인증서 (실제 사이트만)
  if (LIVE && BASE.startsWith("https://")) {
    const host = new URL(BASE).hostname, d = await certDays(host);
    add(G.cert, `보안 인증서 (${host})`, d !== null && d > 14, d === null ? "확인 못 함" : `${d}일 남음`);
  }
} finally {
  await browser.close();
  if (local) local.srv.close();
}

const fails = items.filter(i => !i.ok);
const out = { checkedAt: new Date().toISOString(), kstDate: kst.toISOString().slice(0, 10), base: LIVE ? BASE : "내 컴퓨터(site/)", total: items.length, passed: items.length - fails.length, failed: fails.length, fails, items };
mkdirSync(join(ROOT, "tools/data"), { recursive: true });
if (LIVE || args.includes("--save")) writeFileSync(join(ROOT, "tools/data/check-results.json"), JSON.stringify(out, null, 1) + "\n");

for (const g of Object.values(G)) {
  const list = items.filter(i => i.group === g); if (!list.length) continue;
  const bad = list.filter(i => !i.ok);
  console.log(`${bad.length ? "⚠️" : "✅"} ${g}: ${list.length - bad.length}/${list.length}`);
  bad.forEach(i => console.log(`   - ${i.name}: ${i.detail}`));
}
console.log(`\n${fails.length ? "⚠️ 문제 " + fails.length + "건" : "✅ 이상 없음"} — ${out.passed}/${out.total} 통과 (${out.base})`);
process.exit(fails.length ? 1 : 0);
