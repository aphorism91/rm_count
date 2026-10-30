/* 진천2 원자재 실사 웹앱
 * 품목 목록은 같은 폴더의 catalogs.json / items-YYYY-MM.json, 입력은 구글 시트(Apps Script 웹 앱)에 저장한다.
 * 모든 저장은 이 폰의 대기열(outbox)을 거쳐 보낸다. 통신이 끊겨도 입력이 사라지지 않고, 연결되면 자동으로 보낸다.
 */
const API = (window.APP_CONFIG || {}).apiUrl || "";
const LOCS = [
  { key: "I", name: "야적장" }, { key: "M", name: "야적장2" }, { key: "K", name: "에스제이" },
  { key: "O", name: "동일" }, { key: "S", name: "스카이" },
];
/* 실사 대상이 아니어서 입력 목록에서 숨기는 품목 (집계표에는 그대로 있음) */
const firstNum = spec => Number((String(spec).match(/\d+(\.\d+)?/) || [])[0]);
const HIDDEN = [
  it => it.grp === "SHEET 보강대" && it.len === 5400,
  // SOFFIT: 폭 210 이상은 4000만 쓰고, 200 이하는 4220만 쓴다
  it => it.grp === "SOFFIT" && firstNum(it.spec) >= 210 && it.len === 4220,
  it => it.grp === "SOFFIT" && firstNum(it.spec) <= 200 && it.len === 4000,
  it => it.grp === "SOFFIT" && it.len !== 4000 && it.len !== 4220,
  it => it.grp === "ANGLE" && [3650, 5430, 4840].includes(it.len),
];
const isHidden = it => HIDDEN.some(h => h(it));
const locName = k => (LOCS.find(l => l.key === k) || {}).name || (k === "Q" ? "한울" : k);
const S = {
  catalogs: [], month: null, cat: null, items: [], byRow: new Map(),
  server: [], entries: [], loaded: false, online: null, syncedAt: null, sig: "",
  loc: "I", tab: "input", q: "", grp: "", filt: "all", lq: "", showDel: false,
  allView: "items", iq: "", allFilt: "done", aq: "", lloc: "", showDelA: false,
  locks: {}, me: "", code: "", outbox: [], rejected: [], sending: false,
};
const isLocked = loc => !!S.locks[loc];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => (Math.round(n * 10) / 10).toLocaleString("ko-KR");
const fmtInt = n => Math.round(n).toLocaleString("ko-KR");
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/* 계산식: 숫자, ×(*), + 만 허용. 400×7+334 → 3134 */
function evalExpr(expr) {
  const s = String(expr).replace(/\s/g, "").replace(/[x*]/gi, "×");
  if (!s) return null;
  if (!/^[0-9.×+]+$/.test(s)) return NaN;
  let total = 0;
  for (const term of s.split("+")) {
    if (!term) return NaN;
    let p = 1;
    for (const f of term.split("×")) {
      if (!f || !/^\d+(\.\d+)?$/.test(f)) return NaN;
      p *= Number(f);
    }
    total += p;
  }
  return total;
}
const weightOf = (it, qty) => it && it.len && it.uw ? (it.len / 1000) * it.uw * qty : 0;
const itemLabel = it => it ? `${it.grp} ${it.spec}${it.len ?? ""}` : "";
const entryItem = e => e.r != null ? S.byRow.get(e.r) : null;
const entryLabel = e => {
  const it = entryItem(e);
  if (it) return itemLabel(it);
  if (e.custom) return `[추가] ${e.custom.name}${e.custom.len ? " × " + e.custom.len : ""}`;
  return `${e.grp || ""} ${e.spec || ""}${e.len || ""} (행 ${e.r})`;
};
const whoName = n => n || "이름 없음";

/* ---------- 품목 목록·조사월 ---------- */
/* 월 목록: 품목 목록(집계표)이 있는 달부터 다음 달까지. 그달 품목 목록이 없으면 가장 가까운 이전 달 목록을 쓴다 */
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const addMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); return ym(new Date(y, mo - 1 + n, 1)) };
const monthLabel = m => { const [y, mo] = m.split("-"); return `${y}년 ${Number(mo)}월말` };
function monthOptions() {
  const now = new Date(), end = addMonth(ym(now), 1);
  let m = S.catalogs.map(c => c.month).sort()[0] || ym(now);
  const out = [];
  while (m <= end) { out.push(m); m = addMonth(m, 1) }
  return out.reverse();
}
function defaultMonth(opts) {
  const now = new Date();
  const guess = now.getDate() >= 20 ? ym(now) : addMonth(ym(now), -1);  // 월말 실사는 다음 달 초까지 이어진다
  const saved = store.get("rm-month", null);
  if (saved && opts.includes(saved)) return saved;
  return opts.includes(guess) ? guess : opts[opts.length - 1];
}
function catalogFor(m) {
  const sorted = [...S.catalogs].sort((a, b) => a.month.localeCompare(b.month));
  return [...sorted].reverse().find(c => c.month <= m) || sorted[0];
}
async function loadCatalogs() {
  S.catalogs = (await (await fetch("catalogs.json", { cache: "no-cache" })).json()).catalogs;
  const opts = monthOptions();
  $("monthSel").innerHTML = opts.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  S.month = defaultMonth(opts);
  $("monthSel").value = S.month;
  await loadCatalog(catalogFor(S.month));
}
async function loadCatalog(c) {
  const cat = await (await fetch(c.file, { cache: "no-cache" })).json();
  S.cat = cat;
  S.byRow = new Map();
  S.items = cat.items.map(([r, grp, spec, len, uw, code]) => ({ r, grp, spec, len, uw, code,
    hay: `${grp} ${spec} ${len ?? ""} ${spec}${len ?? ""} ${code}`.toLowerCase().replace(/×/g, "x") })).filter(it => !isHidden(it));
  S.items.forEach(it => S.byRow.set(it.r, it));
  const groups = [...new Set(S.items.map(i => i.grp))];
  $("grpSel").innerHTML = `<option value="">전체 품목군</option>` + groups.map(g => `<option>${esc(g)}</option>`).join("");
  if (!groups.includes(S.grp)) S.grp = "";
  $("grpSel").value = S.grp;
}
async function setMonth(m) {
  S.month = m; store.set("rm-month", m);
  const c = catalogFor(m);
  if (S.cat?.month !== c.month) await loadCatalog(c);
  S.server = store.get("rm-cache-" + m, []);
  S.locks = store.get("rm-locks-" + m, {});
  S.loaded = S.server.length > 0; S.sig = "";
  merge(); renderAll();
  refresh();
}
/* 다른 달 품목 목록으로 입력한 기록은 규격·길이가 같은 품목에 붙인다 */
function remap(e) {
  if (e.r == null || !e.cm || e.cm === S.cat.month) return e;
  const it = S.items.find(i => i.grp === e.grp && i.spec === e.spec && i.len === e.len);
  return it ? { ...e, r0: e.r, r: it.r } : e;
}

const active = () => S.entries.filter(e => !e.del);
function tallies() {
  const byItemLoc = new Map(), byItem = new Map(), byLocCount = {};
  for (const e of active()) {
    const k = `${e.r}|${e.loc}`;
    byItemLoc.set(k, (byItemLoc.get(k) || 0) + e.qty);
    byItem.set(e.r, (byItem.get(e.r) || 0) + e.qty);
    byLocCount[e.loc] = (byLocCount[e.loc] || 0) + 1;
  }
  return { byItemLoc, byItem, byLocCount };
}

/* ---------- 구글 시트와 주고받기 ---------- */
async function apiGet(params) {
  const u = new URL(API);
  Object.entries({ ...params, code: S.code }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { cache: "no-store" });
  return r.json();
}
async function apiPost(body) {
  // text/plain 으로 보내야 브라우저가 사전 확인 요청 없이 Apps Script에 바로 보낸다
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, code: S.code }) });
  return r.json();
}

/* 서버 기록 + 아직 보내지 못한 이 폰의 변경 = 화면에 보이는 기록 */
function merge() {
  let list = S.server.map(e => ({ ...e }));
  for (const op of S.outbox) {
    if (op.op === "add" && op.entry.m === S.month && !list.some(e => e.id === op.entry.id)) list.push({ ...op.entry, pending: true });
    if (op.op === "edit") list = list.map(e => e.id === op.id ? { ...e, expr: op.expr, qty: op.qty, memo: op.memo, pending: true,
      edits: [...(e.edits || []), { expr: e.expr, qty: e.qty, memo: e.memo, at: op.at, by: op.by }] } : e);
    if (op.op === "del") list = list.map(e => e.id === op.id ? { ...e, del: true, delBy: op.by, delAt: op.at, pending: true } : e);
  }
  S.entries = list.map(remap);
}
/* 데이터가 바뀌었을 때만 다시 그린다 (주기적으로 새로 받아도 화면이 깜빡이지 않게) */
function mergeAndRender(force) {
  merge();
  const sig = JSON.stringify([S.entries, S.locks]);
  if (force || sig !== S.sig) { S.sig = sig; renderAll() } else { renderBanners(); renderSync() }
}

async function refresh() {
  if (!API || !S.code) { S.loaded = true; mergeAndRender(true); return }
  const month = S.month;
  try {
    const j = await apiGet({ action: "list", month });
    if (j.ok === false && j.error === "code") { openSetup("현장 코드가 맞지 않습니다. 다시 입력해 주세요."); return }
    if (month !== S.month) return;
    S.server = j.entries || [];
    S.locks = j.locks || {};
    store.set("rm-cache-" + month, S.server);
    store.set("rm-locks-" + month, S.locks);
    S.online = true; S.syncedAt = new Date(); S.loaded = true;
  } catch { S.online = false; S.loaded = true }
  mergeAndRender();
}

S.outbox = store.get("rm-outbox", []);
S.rejected = store.get("rm-rejected", []);
function saveOutbox() { store.set("rm-outbox", S.outbox); store.set("rm-rejected", S.rejected) }
function enqueue(op) {
  op.q = newId();
  S.outbox.push(op); saveOutbox();
  mergeAndRender(true);
  flush();
}
async function flush() {
  if (S.sending || !API || !S.code) return;
  S.sending = true;
  let sent = 0, failed = false;
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      let j;
      try {
        j = op.op === "add" ? await apiPost({ action: "add", entry: op.entry })
          : op.op === "edit" ? await apiPost({ action: "edit", id: op.id, expr: op.expr, qty: op.qty, memo: op.memo, by: op.by })
          : await apiPost({ action: "del", id: op.id, by: op.by });
      } catch { failed = true; break }  // 통신 실패: 대기열에 그대로 두고 다음에 다시 보낸다
      if (j.ok === false && j.error === "code") { failed = true; openSetup("현장 코드가 바뀌었습니다. 새 코드를 입력해 주세요."); break }
      // 보내는 사이 다른 사람이 구역을 잠갔으면 버리지 않고 따로 보관한다 (잠금 해제 후 다시 보내기)
      if (j.ok === false && j.error === "locked") { S.rejected.push(op); toast("잠긴 구역이라 저장하지 못한 입력이 있습니다") }
      else if (j.ok === false && j.error === "owner") toast("다른 사람이 입력한 기록은 수정·삭제할 수 없습니다");
      else if (j.ok === false) toast(`한 건을 저장하지 못했습니다 (${j.error}). 입력 내역을 확인해 주세요.`);
      S.outbox.shift(); saveOutbox(); sent++;
    }
  } finally { S.sending = false }
  S.online = !failed;
  if (sent) await refresh(); else mergeAndRender();
}

function addEntry(data) {
  const entry = { id: newId(), m: S.month, cm: S.cat.month, ...data, by: S.me, ts: new Date().toISOString() };
  enqueue({ op: "add", entry });
  toast(`저장: ${locName(entry.loc)} ${fmtInt(entry.qty)}本`);
}
function editEntry(e, expr, qty, memo) {
  enqueue({ op: "edit", id: e.id, expr, qty, memo, by: S.me, at: new Date().toISOString() });
  toast("수정했습니다 (이전 값은 내역에 남습니다)");
}
function deleteEntry(e) {
  enqueue({ op: "del", id: e.id, by: S.me, at: new Date().toISOString() });
  toast("삭제했습니다 (기록은 남습니다)");
}

/* ---------- 구역 잠금 ---------- */
/* 잠금·해제는 대기열에 두지 않고 바로 보낸다 (통신이 될 때만) */
let dlg = null;
function openDlg(kind, loc) { dlg = { kind, loc, err: "", busy: false }; drawDlg() }
function closeDlg() { dlg = null; $("dlgRoot").innerHTML = "" }
function drawDlg() {
  if (!dlg) return;
  const name = locName(dlg.loc);
  const n = active().filter(e => e.loc === dlg.loc).length;
  const body = dlg.kind === "lock"
    ? `<h2>${esc(name)} 입력을 마칠까요?</h2>
       <p>잠그면 ${esc(S.month ? monthLabel(S.month) : "")} ${esc(name)}에는 누구도 입력·수정·삭제할 수 없습니다. 지금까지 입력 ${n}건은 그대로 남습니다.</p>
       <p>다시 고치려면 잠금 해제 코드가 필요합니다.</p>`
    : `<h2>${esc(name)} 잠금 해제</h2>
       <p>잠금 해제 코드를 넣으면 다시 입력·수정·삭제할 수 있습니다.</p>
       <input id="unlockCode" type="password" inputmode="numeric" maxlength="12" placeholder="잠금 해제 코드" autocomplete="off">`;
  $("dlgRoot").innerHTML = `
    <div class="scrim" data-dlg="close"></div>
    <div class="dlg" role="dialog" aria-modal="true">
      ${body}
      <div class="err">${esc(dlg.err)}</div>
      <div class="dlg-btns"><button class="btn ghost" data-dlg="close">취소</button>
        <button class="btn" data-dlg="ok" ${dlg.busy ? "disabled" : ""}>${dlg.busy ? "처리 중…" : dlg.kind === "lock" ? "잠그기" : "잠금 해제"}</button></div>
    </div>`;
  $("unlockCode")?.focus();
}
async function submitDlg() {
  if (!dlg || dlg.busy) return;
  const unlock = ($("unlockCode")?.value || "").trim();
  if (dlg.kind === "unlock" && !unlock) { dlg.err = "코드를 넣어 주세요."; drawDlg(); return }
  if (S.outbox.length) { dlg.err = "아직 보내지 못한 입력이 있습니다. 먼저 보낸 뒤 다시 해 주세요."; drawDlg(); flush(); return }
  dlg.busy = true; dlg.err = ""; drawDlg();
  const { kind, loc } = dlg;
  let j;
  try { j = await apiPost({ action: kind, month: S.month, loc, by: S.me, unlock }) }
  catch { if (dlg) { dlg.busy = false; dlg.err = "통신이 안 됩니다. 연결된 곳에서 다시 해 주세요."; drawDlg() } return }
  if (!dlg) return;
  dlg.busy = false;
  if (j.ok === false) {
    dlg.err = { unlock: "잠금 해제 코드가 맞지 않습니다.", nounlock: "잠금 해제 코드가 아직 설정되지 않았습니다. 담당자에게 문의해 주세요.",
      action: "저장소가 아직 새 버전이 아닙니다. 담당자에게 문의해 주세요." }[j.error] || `처리하지 못했습니다 (${j.error}).`;
    drawDlg(); return
  }
  S.locks = j.locks || S.locks;
  store.set("rm-locks-" + S.month, S.locks);
  closeDlg();
  toast(kind === "lock" ? `${locName(loc)}을(를) 잠갔습니다` : `${locName(loc)} 잠금을 풀었습니다`);
  mergeAndRender(true);
  if (kind === "unlock" && S.rejected.some(op => opLoc(op) === loc)) toast("잠금 전에 저장하지 못한 입력이 있습니다. 위 안내에서 다시 보내기를 눌러 주세요.");
  refresh();
}
const opLoc = op => op.op === "add" ? op.entry.loc : (S.entries.find(e => e.id === op.id) || {}).loc;

/* ---------- 처음 설정 ---------- */
function openSetup(msg) {
  $("setup").hidden = false;
  $("setName").value = S.me;
  $("setCode").value = msg ? "" : S.code;
  $("setErr").textContent = msg || "";
}
$("setupForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const name = $("setName").value.trim(), code = $("setCode").value.trim();
  if (!name || !code) return;
  $("setBtn").disabled = true; $("setErr").textContent = "확인 중…";
  let ok = true;
  if (API) {
    try {
      const u = new URL(API); u.searchParams.set("action", "list"); u.searchParams.set("month", S.month || "0000-00"); u.searchParams.set("code", code);
      const j = await (await fetch(u, { cache: "no-store" })).json();
      if (j.ok === false && j.error === "code") ok = false;
    } catch { /* 통신이 안 되면 일단 받아두고, 연결될 때 다시 확인된다 */ }
  }
  $("setBtn").disabled = false;
  if (!ok) { $("setErr").textContent = "현장 코드가 맞지 않습니다."; return }
  S.me = name; S.code = code; store.set("rm-name", name); store.set("rm-code", code);
  $("setup").hidden = true;
  flush(); refresh();
});

/* ---------- 화면 ---------- */
function renderAll() { renderLocBar(); renderBanners(); renderSync(); renderTab(); if (sheet && !sheet.dirty) drawPrev() }
function renderSync() {
  const el = $("sync");
  if (!API) { el.textContent = "저장소 미설정"; el.className = "sync off"; return }
  if (S.online === false) { el.textContent = "오프라인"; el.className = "sync off"; return }
  const t = S.syncedAt;
  el.textContent = t ? `동기화 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "연결 중";
  el.className = "sync";
}
const LOCK_SVG = `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
function renderLocBar() {
  const { byLocCount } = tallies();
  $("locBar").hidden = S.tab === "all";  // 전체 탭은 구역과 상관없이 모두 보여준다
  $("locBar").innerHTML = LOCS.map(l =>
    `<button class="loc${isLocked(l.key) ? " locked" : ""}" data-loc="${l.key}" aria-pressed="${S.loc === l.key}">${isLocked(l.key) ? LOCK_SVG : ""}${l.name}<small>${byLocCount[l.key] || 0}</small></button>`).join("");
}
function renderBanners() {
  const b = [];
  if (!API) b.push(`<div class="banner warn"><span>저장소 주소가 설정되지 않았습니다. 지금 입력은 이 폰에만 보관됩니다.</span></div>`);
  else if (S.outbox.length) b.push(`<div class="banner warn"><span>아직 보내지 못한 입력 ${S.outbox.length}건 (이 폰에 보관 중, 연결되면 자동 전송)</span><button id="retry">지금 보내기</button></div>`);
  if (S.rejected.length) b.push(`<div class="banner warn"><span>잠긴 구역이라 저장하지 못한 입력 ${S.rejected.length}건 (${[...new Set(S.rejected.map(op => locName(opLoc(op))))].join(", ")}). 잠금을 푼 뒤 다시 보내세요.</span><button id="resend">다시 보내기</button><button id="dropRej">${S.dropRej ? "버리기 확인" : "버리기"}</button></div>`);
  $("banners").innerHTML = b.join("");
}
/* 입력·입력 내역 탭 위의 구역 잠금 줄 */
function renderLockBar() {
  const name = locName(S.loc), lk = S.locks[S.loc];
  const html = lk
    ? `<div class="lockbar locked"><span>${LOCK_SVG}<b>${esc(name)} 잠김</b> · ${esc(whoName(lk.by))} ${fmtTime(lk.at)} · 입력·수정·삭제 불가</span><button id="unlockBtn">잠금 해제</button></div>`
    : `<div class="lockbar"><span>${esc(name)} 입력 ${active().filter(e => e.loc === S.loc).length}건</span><button id="lockBtn">입력 완료 · 잠그기</button></div>`;
  $("lockBar1").innerHTML = html; $("lockBar2").innerHTML = html;
}
function renderTab() {
  for (const t of ["input", "log", "all"]) {
    $("tab-" + t).setAttribute("aria-selected", S.tab === t);
    $("view-" + t).hidden = S.tab !== t;
  }
  $("locBar").hidden = S.tab === "all";
  if (S.tab !== "all") renderLockBar();
  if (S.tab === "input") renderItems();
  if (S.tab === "log") renderLog();
  if (S.tab === "all") {
    for (const v of ["items", "log", "sum"]) {
      $("seg-" + v).setAttribute("aria-pressed", S.allView === v);
      $("all-" + v).hidden = S.allView !== v;
    }
    if (S.allView === "items") renderAllItems();
    if (S.allView === "log") renderAllLog();
    if (S.allView === "sum") renderSum();
  }
}
function renderItems() {
  if (!S.cat) return;
  const { byItemLoc, byItem } = tallies();
  const words = S.q.toLowerCase().replace(/×/g, "x").split(/\s+/).filter(Boolean);
  const rows = S.items.filter(it => {
    if (S.grp && it.grp !== S.grp) return false;
    if (words.length && !words.every(w => it.hay.includes(w))) return false;
    const hasHere = byItemLoc.has(`${it.r}|${S.loc}`);
    if (S.filt === "todo" && hasHere) return false;
    if (S.filt === "done" && !hasHere) return false;
    return true;
  });
  if (!rows.length) { $("itemList").innerHTML = `<div class="empty">조건에 맞는 품목이 없습니다.<br>목록에 없는 품목이면 아래 [목록에 없는 품목 입력]을 쓰세요.</div>`; return }
  const grpCount = {}, grpDone = {};
  for (const it of rows) {
    grpCount[it.grp] = (grpCount[it.grp] || 0) + 1;
    if (byItemLoc.has(`${it.r}|${S.loc}`)) grpDone[it.grp] = (grpDone[it.grp] || 0) + 1;
  }
  let html = "", g = null;
  for (const it of rows) {
    if (it.grp !== g) {
      if (g !== null) html += `</div></section>`;
      g = it.grp;
      html += `<section><div class="grp"><span>${esc(g)}</span><small>${grpDone[g] || 0}/${grpCount[g]}</small></div><div class="list">`;
    }
    const hasHere = byItemLoc.has(`${it.r}|${S.loc}`);
    const here = byItemLoc.get(`${it.r}|${S.loc}`) || 0;
    const all = byItem.get(it.r) || 0;
    html += `<button class="item${hasHere ? " done" : ""}" data-row="${it.r}">
      <span class="spec">${esc(it.spec)}<span class="len">${it.len ?? ""}</span></span>
      <span class="qty${hasHere ? "" : " zero"}">${hasHere ? fmtInt(here) : "–"}<small>${all && all !== here ? "전체 " + fmtInt(all) : locName(S.loc)}</small></span>
      <span class="meta">${esc(it.code || "코드 없음")} · ${it.uw ?? "-"} kg/m · 행 ${it.r}</span>
    </button>`;
  }
  $("itemList").innerHTML = html + `</div></section>`;
}
function fmtTime(ts) {
  const t = new Date(ts);
  return isNaN(t) ? "" : `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}
/* 입력 내역: 구역 탭은 고른 구역만, 전체 탭은 모든 구역 (장소 고르기 가능) */
function renderLog() { drawLog("logList", S.lq, S.showDel, S.loc, `${esc(locName(S.loc))}에 아직 입력이 없습니다.<br>[입력] 탭에서 품목을 눌러 수량을 넣으면 여기에 시간순으로 쌓입니다.`) }
function renderAllLog() { drawLog("allLogList", S.aq, S.showDelA, S.lloc, "아직 입력이 없습니다.") }
function drawLog(target, q, showDel, loc, emptyMsg) {
  const w = q.toLowerCase();
  const list = S.entries
    .filter(e => showDel || !e.del)
    .filter(e => !loc || e.loc === loc)
    .filter(e => !w || `${entryLabel(e)} ${e.memo || ""} ${whoName(e.by)} ${e.expr}`.toLowerCase().includes(w))
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  if (!S.loaded) { $(target).innerHTML = `<div class="empty">입력 내역을 불러오는 중입니다.</div>`; return }
  if (!list.length) { $(target).innerHTML = `<div class="empty">${w ? "검색에 맞는 입력이 없습니다." : emptyMsg}</div>`; return }
  const total = list.filter(e => !e.del).reduce((s, e) => s + e.qty, 0);
  $(target).innerHTML = `<div class="logsum">${list.filter(e => !e.del).length}건 · ${fmtInt(total)}本</div>` + list.map(e => {
    const hist = (e.edits || []).map(x => `${esc(x.expr)}→`).join("");
    return `<div class="entry${e.del ? " del" : ""}">
      <span class="what"><span class="tag">${esc(locName(e.loc))}</span> ${esc(entryLabel(e))}</span>
      <span class="how">${fmtInt(e.qty)}本<small>${esc(e.expr)}</small></span>
      <span class="who"><span>${fmtTime(e.ts)}</span><span>${esc(whoName(e.by))}</span>${e.memo ? `<span>메모: ${esc(e.memo)}</span>` : ""}
        ${e.pending ? `<span class="tag edit">전송 대기</span>` : ""}
        ${e.edits?.length ? `<span class="tag edit">수정 ${e.edits.length}회: ${hist}${esc(e.expr)}</span>` : ""}
        ${e.del ? `<span class="tag delt">삭제됨 · ${esc(whoName(e.delBy))}</span>` : ""}</span>
    </div>`;
  }).join("");
}
/* 전체 입력값: 품목별로 구역마다 들어간 수량과 합계 (보기 전용) */
function renderAllItems() {
  if (!S.cat) return;
  const { byItemLoc, byItem } = tallies();
  const words = S.iq.toLowerCase().replace(/×/g, "x").split(/\s+/).filter(Boolean);
  const rows = S.items.filter(it => (S.allFilt === "all" || byItem.has(it.r)) && (!words.length || words.every(w => it.hay.includes(w))));
  const customs = active().filter(e => e.r == null && (!words.length || words.every(w => entryLabel(e).toLowerCase().replace(/×/g, "x").includes(w))));
  if (!rows.length && !customs.length) { $("allItemList").innerHTML = `<div class="empty">${S.allFilt === "done" && !words.length ? "아직 입력된 품목이 없습니다." : "조건에 맞는 품목이 없습니다."}</div>`; return }
  const cell = (r, l) => { const v = byItemLoc.get(`${r}|${l.key}`); return v == null ? "" : `<span class="lq"><i>${l.name}</i>${fmtInt(v)}</span>` };
  let html = "", g = null;
  for (const it of rows) {
    if (it.grp !== g) {
      if (g !== null) html += `</div></section>`;
      g = it.grp;
      html += `<section><div class="grp"><span>${esc(g)}</span></div><div class="list">`;
    }
    const all = byItem.get(it.r);
    html += `<div class="item ro${all ? " done" : ""}">
      <span class="spec">${esc(it.spec)}<span class="len">${it.len ?? ""}</span></span>
      <span class="qty${all ? "" : " zero"}">${all ? fmtInt(all) : "–"}<small>${all ? "합계" : ""}</small></span>
      <span class="locq">${LOCS.map(l => cell(it.r, l)).join("")}</span>
    </div>`;
  }
  if (g !== null) html += `</div></section>`;
  if (customs.length) html += `<section><div class="grp"><span>목록에 없는 품목</span></div><div class="list">${customs.map(e => `
    <div class="item ro done"><span class="spec">${esc(entryLabel(e))}</span><span class="qty">${fmtInt(e.qty)}<small>${esc(locName(e.loc))}</small></span></div>`).join("")}</div></section>`;
  $("allItemList").innerHTML = html;
}
function renderSum() {
  const act = active();
  const per = LOCS.map(l => {
    const es = act.filter(e => e.loc === l.key);
    return { l, n: es.length, items: new Set(es.map(e => e.r ?? "c" + e.id)).size,
      qty: es.reduce((s, e) => s + e.qty, 0), wt: es.reduce((s, e) => s + weightOf(entryItem(e), e.qty), 0) };
  });
  const tot = per.reduce((a, p) => ({ n: a.n + p.n, qty: a.qty + p.qty, wt: a.wt + p.wt }), { n: 0, qty: 0, wt: 0 });
  const touched = new Set(act.filter(e => e.r != null).map(e => e.r)).size;
  const customs = act.filter(e => e.r == null).length;
  const nLocked = LOCS.filter(l => isLocked(l.key)).length;
  $("sumView").innerHTML = `
    <div class="tbl"><table>
      <thead><tr><th>장소</th><th>입력 건</th><th>품목 수</th><th>수량(本)</th><th>중량(kg)</th><th>상태</th></tr></thead>
      <tbody>${per.map(p => `<tr><td>${p.l.name}</td><td class="num">${p.n}</td><td class="num">${p.items}</td><td class="num">${fmtInt(p.qty)}</td><td class="num">${fmt(p.wt)}</td><td>${isLocked(p.l.key) ? `<span class="tag lk">${LOCK_SVG}잠김</span>` : `<span class="tag">입력 중</span>`}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>계</td><td class="num">${tot.n}</td><td class="num">${touched}</td><td class="num">${fmtInt(tot.qty)}</td><td class="num">${fmt(tot.wt)}</td><td>${nLocked}/${LOCS.length} 잠김</td></tr></tfoot>
    </table></div>
    <div class="card">
      <h2>PC 엑셀에 반영하기</h2>
      <p>입력은 구글 시트에 바로 저장됩니다. 조사가 끝나면 PC의 Claude에게 <b>"${Number(S.month.split("-")[1])}월 재고조사 반영해줘"</b>라고 하면 그달 원자재집계 파일의 장소별 수량 칸에 계산식 그대로(예: =400*7+334) 넣은 새 파일을 만듭니다.</p>
      <p>품목 목록: ${esc(monthLabel(S.cat.month))} 집계표 기준${S.cat.month !== S.month ? " (그달 집계표가 아직 없어 이전 달 목록을 씁니다)" : ""}.</p>
      <p>전체 품목 ${S.items.length}개 중 ${touched}개 입력됨${customs ? ` · 추가품목 ${customs}건(별도 시트로 정리)` : ""}.</p>
    </div>
    <div class="card">
      <h2>이 폰 설정</h2>
      <p>입력자: <b>${esc(S.me || "-")}</b> · 수정·삭제는 이 이름으로 입력한 기록만 할 수 있습니다.</p>
      <button class="btn ghost" id="openSetup">이름·현장 코드 바꾸기</button>
    </div>`;
}

/* ---------- 입력 시트 ---------- */
let sheet = null;
function openSheet(row, opts = {}) {
  const it = row != null ? S.byRow.get(row) : null;
  sheet = { it, custom: row == null, loc: S.loc, expr: opts.expr || "", memo: opts.memo || "", editing: opts.editing || null,
    cname: opts.cname || "", clen: opts.clen || "", fresh: true };
  drawSheet();
}
function sheetState() {
  const val = evalExpr(sheet.expr);
  const num = typeof val === "number" && !isNaN(val);
  const ok = num && (!sheet.custom || sheet.cname.trim());
  return { val, num, ok };
}
function exprHtml() {
  return sheet.expr ? esc(sheet.expr) : `<span class="ph">묶음 수량은 400 × 7 + 334 처럼 입력</span>`;
}
function resHtml() {
  const { val, num, ok } = sheetState();
  if (!sheet.expr) return `${locName(sheet.loc)}에 저장됩니다`;
  if (!num) return "식이 끝나지 않았습니다";
  const wt = sheet.it && ok ? ` · ${fmt(weightOf(sheet.it, val))} kg` : "";
  return `= <b>${fmtInt(val)}</b> 本${wt}`;
}
/* 키패드 입력 때는 창 전체를 다시 그리지 않고 숫자 칸과 저장 버튼만 바꾼다 (깜빡임 방지) */
function updateDisplay() {
  if (!$("disp")) return;  // 잠긴 구역은 키패드가 없다
  const { num, ok } = sheetState();
  $("dexpr").innerHTML = exprHtml();
  $("dres").innerHTML = resHtml();
  $("disp").classList.toggle("bad", !!sheet.expr && !num);
  $("saveBtn").disabled = !ok;
}
function closeSheet() { sheet = null; $("sheetRoot").innerHTML = "" }
function prevHtml() {
  const it = sheet.it;
  const prev = it ? S.entries.filter(e => e.r === it.r && !e.del).sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || ""))) : [];
  if (!prev.length) return "";
  return `<h3>이 품목에 입력된 기록 (모든 장소)</h3>${prev.map(e => `
    <div class="prow"><span class="tag">${isLocked(e.loc) ? LOCK_SVG : ""}${esc(locName(e.loc))}</span><span class="e">${esc(e.expr)} = ${fmtInt(e.qty)}${e.memo ? ` · ${esc(e.memo)}` : ""} · ${esc(whoName(e.by))}</span>
    <span class="acts">${canChange(e) ? `<button data-edit="${e.id}">수정</button>${sheet.confirmDel === e.id ? `<button class="danger" data-delok="${e.id}">삭제 확인</button>` : `<button data-del="${e.id}">삭제</button>`}`
      : `<span class="why">${isLocked(e.loc) ? "잠김" : "입력자만 수정"}</span>`}</span></div>`).join("")}`;
}
/* 수정·삭제: 잠기지 않은 구역의, 내가 입력한 기록만 */
const canChange = e => !isLocked(e.loc) && !!S.me && e.by === S.me;
/* 다른 사람이 같은 품목을 입력하면 아래 기록 목록만 새로 고친다 */
function drawPrev() { const el = $("prevBox"); if (el) el.innerHTML = prevHtml() }
function drawSheet() {
  if (!sheet) return;
  const { it } = sheet;
  const { num, ok } = sheetState();
  const anim = sheet.fresh ? " anim" : "";
  sheet.fresh = false;
  const head = it
    ? `<h2>${esc(it.grp)} · ${esc(it.spec)}<span class="num">${it.len ?? ""}</span></h2><div class="meta">${esc(it.code || "코드 없음")} · ${it.uw ?? "-"} kg/m · 행 ${it.r}</div>`
    : `<h2>목록에 없는 품목</h2><div class="meta">집계표 '당월 추가품목'으로 따로 정리됩니다</div>`;
  $("sheetRoot").innerHTML = `
    <div class="scrim" data-act="close"></div>
    <div class="sheet${anim}" role="dialog" aria-modal="true" aria-label="수량 입력">
      <div class="sheet-head"><div>${head}</div><button class="x" data-act="close" aria-label="닫기">✕</button></div>
      ${sheet.custom ? `<div class="custom-fields"><input id="cname" placeholder="품명·규격 (예: ONE SHEET 63.5×480×)" value="${esc(sheet.cname)}"><input id="clen" inputmode="numeric" placeholder="길이(mm)" value="${esc(sheet.clen)}"></div>` : ""}
      <div class="locs">${LOCS.map(l => `<button class="loc${isLocked(l.key) ? " locked" : ""}" data-sloc="${l.key}" aria-pressed="${sheet.loc === l.key}">${isLocked(l.key) ? LOCK_SVG : ""}${l.name}</button>`).join("")}</div>
      ${isLocked(sheet.loc) ? `<div class="lockbar locked"><span>${LOCK_SVG}<b>${esc(locName(sheet.loc))}</b>은(는) 입력을 마치고 잠근 구역입니다. 고치려면 잠금을 먼저 풀어야 합니다.</span></div>` : `
      ${sheet.editing ? `<div class="editing"><span>기존 입력 수정 중 (이전 값 ${esc(sheet.editing.expr)})</span><button data-act="canceledit">새로 입력으로</button></div>` : ""}
      <div class="display${sheet.expr && !num ? " bad" : ""}" id="disp">
        <div class="expr" id="dexpr">${exprHtml()}</div>
        <div class="res" id="dres">${resHtml()}</div>
      </div>
      <div class="memo"><input id="memo" placeholder="메모 (선택: 섹터 1-11, 랙 위치 등)" value="${esc(sheet.memo)}"></div>
      <div class="keys">
        ${["7", "8", "9"].map(k => `<button class="k" data-k="${k}">${k}</button>`).join("")}<button class="k fn" data-k="back" aria-label="한 글자 지우기">⌫</button>
        ${["4", "5", "6"].map(k => `<button class="k" data-k="${k}">${k}</button>`).join("")}<button class="k op" data-k="×">×</button>
        ${["1", "2", "3"].map(k => `<button class="k" data-k="${k}">${k}</button>`).join("")}<button class="k op" data-k="+">+</button>
        <button class="k fn" data-k="clear">지움</button><button class="k" data-k="0">0</button><button class="k save" id="saveBtn" data-act="save" ${ok ? "" : "disabled"} style="grid-column: span 2">${sheet.editing ? "수정 저장" : "저장"}</button>
      </div>`}
      <div class="prev" id="prevBox">${prevHtml()}</div>
    </div>`;
}
function press(k) {
  if (isLocked(sheet.loc)) return;
  let s = sheet.expr;
  if (k === "back") s = s.slice(0, -1);
  else if (k === "clear") s = "";
  else if (k === "×" || k === "+") { if (!s || /[×+]$/.test(s)) return; s += k }
  else s += k;
  if (s.length > 60) return;
  sheet.expr = s; updateDisplay();
}
function saveSheet() {
  if (isLocked(sheet.loc)) { toast("잠긴 구역에는 저장할 수 없습니다"); return }
  if (sheet.editing && !canChange(sheet.editing)) { toast("이 기록은 수정할 수 없습니다"); return }
  const val = evalExpr(sheet.expr);
  if (typeof val !== "number" || isNaN(val)) return;
  const memo = ($("memo")?.value || "").trim();
  const expr = sheet.expr;
  if (sheet.editing) {
    const e = sheet.editing;
    if (sheet.loc !== e.loc) {
      deleteEntry(e);
      addEntry({ r: e.r, grp: e.grp, spec: e.spec, len: e.len, code: e.code, custom: e.custom, loc: sheet.loc, expr, qty: val, memo });
    } else editEntry(e, expr, val, memo);
  } else if (sheet.custom) {
    const cname = ($("cname")?.value || "").trim(), clen = Number(($("clen")?.value || "").trim()) || null;
    if (!cname) return;
    addEntry({ r: null, custom: { name: cname, len: clen }, loc: sheet.loc, expr, qty: val, memo });
  } else {
    const it = sheet.it;
    addEntry({ r: it.r, grp: it.grp, spec: it.spec, len: it.len, code: it.code, loc: sheet.loc, expr, qty: val, memo });
  }
  closeSheet();
}

let toastTimer;
function toast(msg) {
  $("toastRoot").innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toastRoot").innerHTML = "", 2600);
}

/* ---------- 이벤트 ---------- */
document.addEventListener("click", ev => {
  const t = ev.target.closest("button, [data-act]");
  if (!t) return;
  if (t.dataset.dlg) { t.dataset.dlg === "ok" ? submitDlg() : closeDlg(); return }
  if (t.dataset.loc) { S.loc = t.dataset.loc; store.set("rm-loc", S.loc); renderLocBar(); renderTab(); return }
  if (t.classList.contains("tab")) { S.tab = t.id.slice(4); renderLocBar(); renderTab(); return }
  if (t.id.startsWith("seg-")) { S.allView = t.id.slice(4); renderTab(); return }
  if (t.id === "af-done" || t.id === "af-all") {
    S.allFilt = t.id.slice(3); ["done", "all"].forEach(f => $("af-" + f).setAttribute("aria-pressed", S.allFilt === f)); renderAllItems(); return
  }
  if (t.id === "lockBtn") { openDlg("lock", S.loc); return }
  if (t.id === "unlockBtn") { openDlg("unlock", S.loc); return }
  if (t.id === "showDelA") { S.showDelA = !S.showDelA; t.setAttribute("aria-pressed", S.showDelA); renderAllLog(); return }
  if (t.id === "resend") { S.outbox.push(...S.rejected); S.rejected = []; S.dropRej = false; saveOutbox(); renderBanners(); flush(); return }
  if (t.id === "dropRej") {
    if (!S.dropRej) { S.dropRej = true; renderBanners(); return }
    S.rejected = []; S.dropRej = false; saveOutbox(); renderBanners(); return
  }
  if (t.id === "f-all" || t.id === "f-todo" || t.id === "f-done") {
    S.filt = t.id.slice(2); ["all", "todo", "done"].forEach(f => $("f-" + f).setAttribute("aria-pressed", S.filt === f)); renderItems(); return
  }
  if (t.id === "showDel") { S.showDel = !S.showDel; t.setAttribute("aria-pressed", S.showDel); renderLog(); return }
  if (t.id === "retry") { flush(); return }
  if (t.id === "openSetup") { openSetup(); return }
  if (t.id === "addCustom") { openSheet(null); return }
  if (t.dataset.row) { openSheet(Number(t.dataset.row)); return }
  if (!sheet) return;
  if (t.dataset.act === "close") { closeSheet(); return }
  if (t.dataset.sloc) { sheet.loc = t.dataset.sloc; keepFields(); drawSheet(); return }
  if (t.dataset.k) { keepFields(); press(t.dataset.k); return }
  if (t.dataset.act === "save") { keepFields(); t.disabled = true; saveSheet(); return }
  if (t.dataset.act === "canceledit") { sheet.editing = null; sheet.expr = ""; drawSheet(); return }
  if (t.dataset.edit) { const e = S.entries.find(x => x.id === t.dataset.edit); if (e && canChange(e)) { keepFields(); sheet.editing = e; sheet.expr = e.expr; sheet.memo = e.memo || ""; sheet.loc = e.loc; drawSheet() } return }
  if (t.dataset.del) { keepFields(); sheet.confirmDel = t.dataset.del; drawPrev(); return }
  if (t.dataset.delok) { const e = S.entries.find(x => x.id === t.dataset.delok); sheet.confirmDel = null; if (e && canChange(e)) deleteEntry(e); drawPrev(); return }
});
function keepFields() {
  if (!sheet) return;
  if ($("memo")) sheet.memo = $("memo").value;
  if ($("cname")) sheet.cname = $("cname").value;
  if ($("clen")) sheet.clen = $("clen").value;
}
document.addEventListener("input", ev => {
  if (ev.target.id === "q") { S.q = ev.target.value; renderItems() }
  if (ev.target.id === "lq") { S.lq = ev.target.value; renderLog() }
  if (ev.target.id === "aq") { S.aq = ev.target.value; renderAllLog() }
  if (ev.target.id === "iq") { S.iq = ev.target.value; renderAllItems() }
  if (ev.target.id === "cname" && sheet) { sheet.cname = ev.target.value; updateDisplay() }
});
document.addEventListener("change", ev => {
  if (ev.target.id === "grpSel") { S.grp = ev.target.value; renderItems() }
  if (ev.target.id === "monthSel") setMonth(ev.target.value).catch(() => toast("품목 목록을 불러오지 못했습니다. 새로고침해 주세요."));
  if (ev.target.id === "lloc") { S.lloc = ev.target.value; renderAllLog() }
});
document.addEventListener("keydown", ev => {
  if (dlg) { if (ev.key === "Enter") { ev.preventDefault(); submitDlg() } else if (ev.key === "Escape") closeDlg(); return }
  if (!sheet || ev.target.tagName === "INPUT") return;
  if (/^[0-9]$/.test(ev.key)) press(ev.key);
  else if (ev.key === "*" || ev.key === "x") press("×");
  else if (ev.key === "+") press("+");
  else if (ev.key === "Backspace") press("back");
  else if (ev.key === "Enter") saveSheet();
  else if (ev.key === "Escape") closeSheet();
});

/* 다른 사람 입력을 받아오고, 보관 중인 입력을 보낸다: 화면이 켜져 있는 동안 20초마다, 앱으로 돌아올 때, 통신이 다시 될 때 */
setInterval(() => { if (!document.hidden) { S.outbox.length ? flush() : refresh() } }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush(); refresh() } });
window.addEventListener("online", () => { flush(); refresh() });

/* 고정 헤더 높이를 품목군 이름의 고정 위치로 쓴다 */
const hdr = document.querySelector("header");
const setHdr = () => document.documentElement.style.setProperty("--hdr", hdr.offsetHeight + "px");
setHdr();
if (window.ResizeObserver) new ResizeObserver(setHdr).observe(hdr);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  // 새 버전이 깔리면 한 번 다시 열어 바로 새 화면을 보여준다 (입력 중이 아닐 때만)
  let reloaded = false;
  const hadOld = !!navigator.serviceWorker.controller;  // 처음 설치 때는 다시 열 필요 없다
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadOld || reloaded || sheet || dlg) return;
    reloaded = true; location.reload();
  });
}

(async function start() {
  S.loc = store.get("rm-loc", "I");
  if (!LOCS.some(l => l.key === S.loc)) S.loc = "I";
  S.me = store.get("rm-name", ""); S.code = store.get("rm-code", "");
  $("lloc").insertAdjacentHTML("beforeend", LOCS.map(l => `<option value="${l.key}">${l.name}</option>`).join(""));
  try { await loadCatalogs() } catch { $("itemList").innerHTML = `<div class="empty">품목 목록을 불러오지 못했습니다. 통신을 확인하고 새로고침해 주세요.</div>`; return }
  S.server = store.get("rm-cache-" + S.month, []);
  S.locks = store.get("rm-locks-" + S.month, {});
  merge(); renderAll();
  if (!S.me || !S.code) openSetup();
  else { flush(); refresh() }
})();
