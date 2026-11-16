// 살핌 사이트 만들기: src/index.html(본문)을 감싸서 배포용 site/index.html을 만든다.
// 주소(도메인)가 정해지면 SITE_URL만 바꾸고 다시 실행하면 된다.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_URL = ""; // 예: "https://salpim.net" (도메인 구입 후 입력)
// 연락처: 정해지면 여기만 채우고 다시 빌드한다. 비워 둔 것은 사이트에 나오지 않는다.
const CONTACT = {
  tel: "",   // 전화·문자 번호. 예: "010-1234-5678"
  kakao: "", // 카카오톡 채널 주소. 예: "https://pf.kakao.com/_abcdef"
  email: "", // 이메일. 예: "hello@salpim.net"
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const body = readFileSync(join(ROOT, "src/index.html"), "utf8");

const title = (body.match(/<title>([^<]*)<\/title>/) || [, "살핌"])[1];
const desc = (body.match(/<meta name="description" content="([^"]*)"/) || [, ""])[1];

const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="theme-color" content="#F7F7F4" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#0F1113" media="(prefers-color-scheme: dark)">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="${title}">`,
  `<meta property="og:description" content="${desc}">`,
  SITE_URL && `<link rel="canonical" href="${SITE_URL}/">`,
  SITE_URL && `<meta property="og:url" content="${SITE_URL}/">`,
  `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "ProfessionalService",
    name: title, description: desc, areaServed: "부산", ...(SITE_URL ? { url: SITE_URL + "/" } : {}),
  })}</script>`,
].filter(Boolean).join("\n");

// 연락처 칸 만들기 (글자는 HTML에 넣기 전에 안전하게 바꾼다)
const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function contactHtml() {
  const ways = [];
  if (CONTACT.tel) {
    const num = CONTACT.tel.replace(/[^0-9+]/g, "");
    ways.push(`<div class="way"><span class="k">전화·문자</span><span class="v">${esc(CONTACT.tel)}</span><span class="acts"><a href="tel:${num}">전화 걸기</a><a href="sms:${num}">문자 보내기</a></span></div>`);
  }
  if (CONTACT.kakao) {
    const url = CONTACT.kakao.replace(/\/(chat)?$/, "");
    ways.push(`<div class="way"><span class="k">카카오톡 채널</span><span class="v">살핌</span><span class="acts"><a href="${esc(url)}/chat" target="_blank" rel="noopener">채널로 상담하기</a></span></div>`);
  }
  if (CONTACT.email) ways.push(`<div class="way"><span class="k">이메일</span><span class="v">${esc(CONTACT.email)}</span><span class="acts"><a href="mailto:${esc(CONTACT.email)}">메일 쓰기</a></span></div>`);
  return ways.length ? `<div class="ways" style="--n:${ways.length}">\n        ${ways.join("\n        ")}\n      </div>` : "";
}

// 미리보기 전용 줄(claude:viewport-fit-sides)은 배포본에 넣지 않는다.
const contact = contactHtml();
const content = body.replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n?/, "")
  .replace(/<!--연락처 시작[^>]*-->([\s\S]*?)<!--연락처 끝-->/, (m, inner) => contact || inner.trim());
// 배포본은 :root 위아래 안전영역 여백을 직접 준다(미리보기 화면은 자동으로 넣어 줌).
const safe = "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style>";

const html = `<!doctype html>\n<html lang="ko">\n<head>\n${head}\n${safe}\n${content.trim()}\n</body>\n</html>\n`
  .replace(/(<\/style>\s*)(\n<header)/, "$1\n</head>\n<body>$2");

mkdirSync(join(ROOT, "site"), { recursive: true });
writeFileSync(join(ROOT, "site/index.html"), html);
console.log("site/index.html 생성 완료", SITE_URL ? `(${SITE_URL})` : "(도메인 미정)");

// 업종별 샘플 사이트는 그대로 복사한다(각자 완성된 HTML).
cpSync(join(ROOT, "src/samples"), join(ROOT, "site/samples"), { recursive: true });
console.log("site/samples/ 복사 완료");
