/**
 * Headless UI checks (no browser required).
 *
 *   npm install jsdom          # once
 *   node tests/ui_checks.js    # with the app running on :5000
 *
 * Loads the real page in jsdom, stubs Chart.js, drives the analyzer end to end and
 * verifies rendering, the payoff chart window, single-strategy selection and the
 * settings side effects.
 */
const { JSDOM, VirtualConsole } = require("jsdom");

const APP = process.env.APP_URL || "http://127.0.0.1:5000";
const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", RESET = "\x1b[0m";
let failed = 0;

function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`  [${ok ? GREEN + "PASS" : RED + "FAIL"}${RESET}] ${name}${detail ? `  ${DIM}${detail}${RESET}` : ""}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let html = await (await fetch(APP)).text();
  const cdn = [...html.matchAll(/<script src="(https:\/\/[^"]+)"><\/script>/g)].map(m => m[1]);
  html = html.replace(/<script src="https:\/\/cdn[^>]*><\/script>/g, "");

  // The app ships as an external bundle now; inline it so jsdom executes it in the
  // same order a browser would (the tag is deferred, i.e. after parsing).
  const localScripts = [...html.matchAll(/<script src="(\/static\/[^"]+)"[^>]*><\/script>/g)];
  for (const m of localScripts) {
    const code = await (await fetch(APP + m[1])).text();
    html = html.replace(m[0], "");
    // replacer function, not a string: "$$" in the bundle would otherwise be
    // collapsed to "$" by String.replace's substitution rules
    html = html.replace("</body>", () => `<script>${code}</script></body>`);
  }
  const cssLinks = [...html.matchAll(/<link rel="stylesheet" href="(\/static\/[^"]+)"/g)].map(m => m[1]);

  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", e => { if (!/scrollTo|scrollIntoView|Not implemented/.test(e.message)) errors.push(e.message.slice(0, 120)); });
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ").slice(0, 120)));

  const dom = new JSDOM(html, { url: APP, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.fetch = (u, o) => fetch(u.startsWith("http") ? u : APP + u, o);
  const charts = [];
  class ChartStub { constructor(ctx, cfg) { this.cfg = cfg; charts.push(this); } destroy() {} update() {} }
  ChartStub.register = () => {};
  w.Chart = ChartStub;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
  w.Element.prototype.scrollIntoView = function () {};

  w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));
  await sleep(2000);
  const doc = w.document;
  const chips = () => [...doc.querySelectorAll("#chips .chip")];
  const selected = () => w.eval("[...SEL]");

  console.log("\n────────────────────────────────────────────────────────────\n  UI — boot\n────────────────────────────────────────────────────────────");
  check("only Chart.js is loaded from a CDN (annotation plugin removed)",
    cdn.length === 1 && /chart\.js/.test(cdn[0]), cdn.join(", "));
  check("the page loads one external script bundle and one stylesheet",
    localScripts.length === 1 && cssLinks.length === 1,
    `${localScripts.length} js, ${cssLinks.length} css`);
  check("static assets are cache-busted with a version hash",
    /\?v=[0-9a-f]{6,}/.test(localScripts[0]?.[1] + cssLinks[0]), localScripts[0]?.[1]);
  check("12 strategy chips rendered", chips().length === 12, `${chips().length} chips`);
  check("expiry list populated", doc.getElementById("f-expiry").options.length > 1);
  check("market ticker shows a price", /\$/.test(doc.getElementById("mkt-price").textContent));

  console.log("\n────────────────────────────────────────────────────────────\n  UI — asset picker (from the exchange)\n────────────────────────────────────────────────────────────");
  const assetSel = doc.getElementById("f-asset");
  const listed = w.eval("JSON.stringify(ASSETS.map(a=>a.currency))");
  check("asset dropdown is built from /api/assets, not hardcoded",
    assetSel.options.length === JSON.parse(listed).length && assetSel.options.length >= 2, listed);
  check("no placeholder left in the picker", ![...assetSel.options].some(o => /Loading/.test(o.textContent)));
  const other = [...assetSel.options].map(o => o.value).find(v => v !== "BTC" && v !== "ETH");
  if (other) {
    assetSel.value = other;
    await w.eval(`(async()=>{ document.getElementById("f-asset").value=${JSON.stringify(other)};
                               await loadExp(); })()`);
    await sleep(1500);
    check(`switching to ${other} loads only that asset's expiries`,
      doc.getElementById("f-expiry").options.length > 1,
      `${doc.getElementById("f-expiry").options.length - 1} expiries`);
    check(`contract size adapts to ${other}`,
      parseFloat(doc.getElementById("f-size").value) > 0,
      `size=${doc.getElementById("f-size").value}`);
    assetSel.value = "BTC";
    await w.eval('(async()=>{ document.getElementById("f-asset").value="BTC"; await loadExp(); })()');
    await sleep(1200);
  }

  console.log("\n────────────────────────────────────────────────────────────\n  UI — single strategy selection\n────────────────────────────────────────────────────────────");
  check("chips form a radio group", doc.getElementById("chips").getAttribute("role") === "radiogroup");
  check("exactly one strategy selected on load", selected().length === 1, JSON.stringify(selected()));

  doc.getElementById("f-expiry").value = doc.getElementById("f-expiry").options[3].value;
  for (const id of ["long_call", "iron_condor", "bear_put_spread"]) {
    chips().find(c => c.dataset.sid === id).dispatchEvent(new w.Event("click", { bubbles: true }));
    await sleep(120);
    const onChips = chips().filter(c => c.classList.contains("on")).map(c => c.dataset.sid);
    check(`clicking "${id}" replaces the selection instead of adding to it`,
      onChips.length === 1 && onChips[0] === id && selected().length === 1 && selected()[0] === id,
      `highlighted=${JSON.stringify(onChips)} SEL=${JSON.stringify(selected())}`);
  }
  check("aria-checked / tabindex track the single selection",
    chips().filter(c => c.getAttribute("aria-checked") === "true").length === 1 &&
    chips().filter(c => c.tabIndex === 0).length === 1);

  chips().find(c => c.dataset.sid === "bear_put_spread").dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(100);
  check("re-clicking the active chip keeps it selected (never empty)",
    selected().length === 1 && selected()[0] === "bear_put_spread");

  chips().find(c => c.dataset.sid === "bear_put_spread")
    .dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await sleep(150);
  check("arrow keys move the selection", selected().length === 1, JSON.stringify(selected()));

  console.log("\n────────────────────────────────────────────────────────────\n  UI — results table\n────────────────────────────────────────────────────────────");
  w.eval("selectStrategy('iron_condor'); document.getElementById('f-maxloss').value='0';");
  await w.eval("compute()");
  await sleep(2500);
  const rows = doc.querySelectorAll("#results tbody tr");
  check("results contain exactly one strategy",
    w.eval("new Set(DATA.strategies.map(s=>s.id)).size") === 1, w.eval("JSON.stringify([...new Set(DATA.strategies.map(s=>s.id))])"));
  check("rows rendered", rows.length > 0, `${rows.length} rows`);
  check("long tables scroll inside the card so the header can stick",
    rows.length <= 12 || !!doc.querySelector(".tbl-scroll.tall"));
  const popHeader = [...doc.querySelectorAll("#results thead th")].some(th => /PoP/.test(th.textContent));
  check("results table has a sortable PoP column", popHeader);
  const popCell = rows[0].querySelector('[data-label="PoP"]');
  check("each row shows a probability of profit", !!popCell && /%|—/.test(popCell.textContent),
    popCell?.textContent.trim());
  w.eval("sortTable('pop')");
  await sleep(400);
  const popsSorted = w.eval("JSON.stringify(DATA.strategies.map(s=>s.pop).slice(0,5))");
  check("sorting by PoP works", JSON.parse(popsSorted).every((v, i, a) => i === 0 || a[i - 1] <= v),
    popsSorted);
  w.eval("sortTable('pop');sortTable('pop')");
  await sleep(400);

  check("every cell carries a data-label for the mobile card view",
    [...rows[0].children].every(td => td.getAttribute("data-label")),
    [...rows[0].children].map(td => td.getAttribute("data-label")).join("|"));
  check("odometer animation is capped (DOM stays small)",
    doc.querySelectorAll("#results .odo-digit-box").length < 1200,
    `${doc.querySelectorAll("#results .odo-digit-box").length} digit boxes / ${doc.querySelectorAll("#results *").length} nodes`);

  w.eval("selectStrategy('covered_call')");
  await sleep(1800);
  check("covered call is not reported as unlimited loss",
    w.eval("DATA.strategies.every(s=>!s.max_loss_inf)"));

  console.log("\n────────────────────────────────────────────────────────────\n  UI — virtualised table (large result sets)\n────────────────────────────────────────────────────────────");
  // give the scroll container a real size: jsdom reports 0 for every box
  Object.defineProperty(w.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.classList?.contains("tbl-scroll") ? 600 : 0; } });
  w.eval("SETTINGS.maxCombos = 250; selectStrategy('iron_condor'); document.getElementById('f-maxloss').value='0';");
  await w.eval("compute()");
  await sleep(2500);
  const total = w.eval("DATA.strategies.length");
  const inDom = doc.querySelectorAll("#results tbody tr.row-entry-anim").length;
  check("a large result set is windowed, not fully materialised",
    total > 60 && inDom > 0 && inDom < total, `${inDom} of ${total} rows in the DOM`);
  check("spacer rows hold the scroll height",
    doc.querySelectorAll("#results tbody tr.v-spacer").length >= 1);
  const firstBtn = doc.querySelector("#results tbody tr.row-entry-anim .chart-btn");
  check("windowed rows keep working P&L buttons", !!firstBtn && /openChart\(\d+\)/.test(firstBtn.getAttribute("onclick")));

  const scroller = doc.querySelector("#results .tbl-scroll");
  scroller.scrollTop = 100000;
  scroller.dispatchEvent(new w.Event("scroll"));
  await sleep(300);
  const lastVisible = [...doc.querySelectorAll("#results tbody tr.row-entry-anim")].pop();
  check("scrolling to the bottom renders the last rows",
    !!lastVisible && doc.querySelectorAll("#results tbody tr.row-entry-anim").length < total,
    `${doc.querySelectorAll("#results tbody tr.row-entry-anim").length} rows after scrolling`);

  w.eval("SETTINGS.maxCombos = 30; selectStrategy('covered_call');");
  await sleep(1800);
  check("small result sets render every row directly",
    doc.querySelectorAll("#results tbody tr.v-spacer").length === 0);

  console.log("\n────────────────────────────────────────────────────────────\n  UI — payoff chart\n────────────────────────────────────────────────────────────");
  w.eval("openChart(0)");
  await sleep(400);
  const spot = w.eval("DATA.spot");
  const edges = c => {
    const l = c.cfg.data.labels;
    return [+l[0].replace(/[$,]/g, ""), +l[l.length - 1].replace(/[$,]/g, "")];
  };
  let [lo, hi] = edges(charts[charts.length - 1]);
  check("chart window matches the ±30% label",
    Math.abs(lo / spot - 0.7) < 0.01 && Math.abs(hi / spot - 1.3) < 0.01,
    `${((lo / spot - 1) * 100).toFixed(1)}% .. +${((hi / spot - 1) * 100).toFixed(1)}%`);

  const savedBefore = w.eval('JSON.parse(localStorage.getItem("d_settings")||"{}").chartRange');
  doc.getElementById("chart-range").value = "60";
  w.eval("onRangeChange(60)");
  await sleep(300);
  [lo, hi] = edges(charts[charts.length - 1]);
  check("chart window follows the slider to ±60%",
    Math.abs(lo / spot - 0.4) < 0.01 && Math.abs(hi / spot - 1.6) < 0.01,
    `${((lo / spot - 1) * 100).toFixed(1)}% .. +${((hi / spot - 1) * 100).toFixed(1)}%`);
  check("the slider does not overwrite the saved default range",
    w.eval('JSON.parse(localStorage.getItem("d_settings")||"{}").chartRange') === savedBefore);

  doc.getElementById("fit-strikes").checked = true;
  w.eval("onRangeChange(60)");
  await sleep(250);
  check("'Fit to strikes' switches to the strike window and disables the slider",
    doc.getElementById("range-val").textContent === "Auto" && doc.getElementById("chart-range").disabled);
  check("modal shows a Fee column", /<th>Fee<\/th>/.test(doc.getElementById("m-greeks").innerHTML));

  console.log("\n────────────────────────────────────────────────────────────\n  UI — order ticket\n────────────────────────────────────────────────────────────");
  w.eval("selectStrategy('protective_put'); document.getElementById('f-maxloss').value='0';");
  await sleep(1800);
  w.eval("openChart(0)");
  await sleep(400);
  const ticket = doc.querySelector("#m-greeks table");
  const headers = [...ticket.querySelectorAll("thead th")].map(t => t.textContent.trim());
  check("ticket states action, amount, unit price and cash per leg",
    ["Action", "Instrument", "Amount", "Unit price", "Book", "Cash"].every(hd => headers.includes(hd)),
    headers.join(" | "));
  const legRows = [...ticket.querySelectorAll("tbody tr")];
  const spotRow = legRows.find(tr => /spot/i.test(tr.textContent));
  check("the underlying leg shows a real amount and price (used to be blank)",
    !!spotRow && /0\.001\s*BTC/.test(spotRow.textContent) && /\$1[0-9,]{4,}/.test(spotRow.textContent),
    spotRow ? spotRow.textContent.replace(/\s+/g, " ").trim().slice(0, 90) : "missing");
  const optRow = legRows.find(tr => /-P\b|-C\b/.test(tr.textContent));
  check("option legs show which side of the book they execute against",
    !!optRow && /(ask|bid|mark)/.test(optRow.textContent), optRow?.textContent.replace(/\s+/g, " ").trim().slice(0, 90));
  check("cash per leg = unit price x amount", (() => {
    const cs = w.eval("DATA.contract_size"), spot = w.eval("DATA.spot");
    const want = (spot * cs).toFixed(2);
    return spotRow.textContent.includes(want.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  })(), `expected ${(w.eval("DATA.spot") * w.eval("DATA.contract_size")).toFixed(2)}`);
  check("a totals row sums the structure",
    /Net/.test(ticket.querySelector("tbody tr:last-child").textContent));
  const text = w.eval("orderTicketText(CURR_STRAT, DATA.contract_size)");
  check("the ticket can be copied as plain text",
    /BUY/.test(text) && /@ \$/.test(text) && /(Net debit|Net credit)/.test(text),
    text.split("\n")[1]);

  console.log("\n────────────────────────────────────────────────────────────\n  UI — misc\n────────────────────────────────────────────────────────────");
  w.eval("toggleFilterCollapse(true)");
  await sleep(100);
  check("collapsed filter strip names the active strategy",
    /[A-Za-z]/.test(doc.getElementById("mini-strats").textContent) &&
    !/Strats/.test(doc.getElementById("mini-strats").textContent),
    doc.getElementById("mini-strats").textContent);

  w.eval("switchTab('strategies')");
  await sleep(200);
  doc.querySelectorAll(".strat-card")[5].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(1500);
  check("a reference card jumps into the analyzer with that strategy selected",
    doc.getElementById("tab-analyzer").style.display !== "none" && selected().length === 1,
    `SEL=${JSON.stringify(selected())}`);

  w.eval("setPalette('cyberpunk');setTheme('oled');setTheme('dark');setOrbs(false);setOrbs(true);toggleZenMode();toggleZenMode();");
  await sleep(200);
  check("theme / palette / particle toggles run without errors",
    doc.documentElement.getAttribute("data-palette") === "cyberpunk");

  check("no runtime errors during the whole run", errors.length === 0, errors.join(" | "));

  console.log(`\n${failed ? RED + failed + " failed" : GREEN + "all UI checks passed"}${RESET}\n`);
  process.exit(failed ? 1 : 0);
})();
