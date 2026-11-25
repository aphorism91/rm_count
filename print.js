/* 구역별 실사표 인쇄 (원자재 index.html · 재공품 wip.html 같이 씀, 2026-11-25)
 * 반기 때 회계법인 실사에서 예전 꼬리표 대신 대조할 수 있게, 장소 → 구역별로 입력값을 표로 뽑는다.
 * 같은 품목이라도 구역이 다르면 따로 나온다.
 * 새 창(팝업)은 폰·설치된 앱에서 막히는 일이 많아서, 앱 화면 위에 전체 화면으로 띄우고 인쇄할 때는 이 표만 나가게 한다.
 *
 * openZonePrint({ title, month, headers, numCols, sections:[{loc, locName, locOrder, zone, rows:[[칸...]], total}] })
 *   headers: 표 머리글 (맨 앞 No, 맨 끝 '확인' 빈 칸이 저절로 붙는다)
 */
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const natural = (a, b) => String(a).localeCompare(String(b), "ko", { numeric: true });
  const CSS = `
  #zonePrint { position: fixed; inset: 0; z-index: 100; overflow: auto; background: #fff; color: #111; font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 12px }
  #zonePrint * { box-sizing: border-box }
  #zonePrint .zp-bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 10px 14px; background: #eef1f4; border-bottom: 1px solid #ccc; color: #111 }
  #zonePrint .zp-bar b { font-size: 15px } #zonePrint .zp-bar select, #zonePrint .zp-bar button { font: inherit; font-size: 14px; padding: 5px 10px; color: #111 }
  #zonePrint .zp-bar .zp-go { background: #1f5fbf; color: #fff; border: 0; border-radius: 6px; font-weight: 700 }
  #zonePrint .zp-bar .zp-x { background: #fff; border: 1px solid #999; border-radius: 6px }
  #zonePrint .zp-bar small { color: #555; flex-basis: 100% }
  #zonePrint main { padding: 10px 14px }
  #zonePrint .zone { margin: 0 0 16px; break-inside: avoid }
  #zonePrint .zh { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 10px; border-bottom: 2px solid #111; padding-bottom: 3px; margin-bottom: 4px }
  #zonePrint .zh h2 { margin: 0; font-size: 16px; color: #111 } #zonePrint .zh h2 span { margin-left: 8px; padding: 1px 8px; border: 2px solid #111; border-radius: 4px; font-size: 15px }
  #zonePrint .zm { color: #444; font-size: 11px }
  #zonePrint table { width: 100%; border-collapse: collapse; background: #fff; font-size: 12px }
  #zonePrint th, #zonePrint td { border: 1px solid #999; padding: 3px 5px; text-align: left; vertical-align: top; white-space: normal; color: #111 }
  #zonePrint th { background: #f0f0f0; font-weight: 700; font-size: 11px } #zonePrint td.num { text-align: right; font-family: Consolas, monospace; white-space: nowrap }
  #zonePrint .n { width: 30px; text-align: center } #zonePrint .ck { width: 46px } #zonePrint tr { break-inside: avoid }
  #zonePrint .empty { color: #666; padding: 20px }
  #zonePrint.pp .zone.on ~ .zone.on { break-before: page }
  #zonePrint .zone.off { display: none }
  @media print {
    @page { size: A4; margin: 12mm }
    html.zp-printing body > *:not(#zonePrint) { display: none !important }
    html.zp-printing, html.zp-printing body { background: #fff !important; zoom: 1 !important }
    #zonePrint { position: static; overflow: visible }
    #zonePrint .zp-bar { display: none }
    #zonePrint main { padding: 0 }
  }`;
  window.openZonePrint = function (opt) {
    if (!document.getElementById("zonePrintCss")) {
      const st = document.createElement("style"); st.id = "zonePrintCss"; st.textContent = CSS; document.head.appendChild(st);
    }
    document.getElementById("zonePrint")?.remove();
    // 장소는 locOrder 순서, 구역은 숫자 순서(1, 2, 10 …), 구역 없는 입력은 맨 뒤
    const secs = opt.sections.slice().sort((a, b) =>
      (a.locOrder ?? 0) - (b.locOrder ?? 0) || (a.zone === "" ? 1 : 0) - (b.zone === "" ? 1 : 0) || natural(a.zone, b.zone));
    const locs = [...new Map(secs.map(s => [s.loc, s.locName])).entries()];
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const body = secs.map(s => `
      <section class="zone on" data-loc="${esc(s.loc)}">
        <div class="zh"><h2>${esc(s.locName)}<span>구역 ${esc(s.zone || "없음")}</span></h2><div class="zm">${esc(opt.title)} · ${esc(opt.month)} · ${s.rows.length}품목${s.total ? " · " + esc(s.total) : ""}</div></div>
        <table><thead><tr><th class="n">No</th>${opt.headers.map(h => `<th>${esc(h)}</th>`).join("")}<th class="ck">확인</th></tr></thead>
        <tbody>${s.rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${r.map((c, j) => `<td class="${(opt.numCols || []).includes(j) ? "num" : ""}">${esc(c)}</td>`).join("")}<td class="ck"></td></tr>`).join("")}</tbody></table>
      </section>`).join("") || `<p class="empty">구역이 들어간 입력이 없습니다.</p>`;
    const el = document.createElement("div");
    el.id = "zonePrint";
    el.innerHTML = `<div class="zp-bar"><b>${esc(opt.title)} 구역별 실사표</b><span>${esc(opt.month)} · 출력 ${stamp}</span>
      <label>장소 <select class="zp-loc"><option value="">전체</option>${locs.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join("")}</select></label>
      <label><input type="checkbox" class="zp-pp"> 구역마다 새 쪽</label>
      <button class="zp-go">인쇄</button><button class="zp-x">닫기</button>
      <small>PC에서 열면 깔끔하게 인쇄됩니다. 인쇄 창에서 'PDF로 저장'도 됩니다. 같은 품목도 구역이 다르면 따로 나옵니다.</small></div>
      <main>${body}</main>`;
    document.body.appendChild(el);
    el.querySelector(".zp-loc").onchange = e => el.querySelectorAll(".zone").forEach(z => { const on = !e.target.value || z.dataset.loc === e.target.value; z.classList.toggle("on", on); z.classList.toggle("off", !on) });
    el.querySelector(".zp-pp").onchange = e => el.classList.toggle("pp", e.target.checked);
    // 이 화면이 떠 있는 동안에는 브라우저 메뉴로 인쇄해도 표만 나가게 한다
    const on = () => document.documentElement.classList.add("zp-printing");
    const off = () => document.documentElement.classList.remove("zp-printing");
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    el.querySelector(".zp-x").onclick = () => { el.remove(); off(); window.removeEventListener("beforeprint", on); window.removeEventListener("afterprint", off) };
    el.querySelector(".zp-go").onclick = () => { on(); window.print() };
  };
})();
