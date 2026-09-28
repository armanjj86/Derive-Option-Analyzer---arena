/* Derive Option Strategy Analyzer — application script
   Extracted from templates/index.html and loaded with `defer`, so it runs
   after parsing but before DOMContentLoaded — the same order as before. */

/* ═════════ inline block 1 of 3 (was in index.html) ═════════ */
let DATA=null,CHART=null,STRATS=[],CURR_STRAT=null;
let SEL=new Set(["protective_put"]);
let SPOT_PRICE=0,autoTimer=null;
let sortState={col:null,dir:0};
let CHART_RANGE=null;   // chart zoom for this session only (never persisted)
/* ═══ MULTI-EXPIRY COMPARISON ═══
   The extra expiries analysed alongside the one in the dropdown. The server runs
   them in a single request, so comparing three expiries is one round trip. */
let CMP_EXPIRIES = [];                    // extra expiry dates (strings)
let CMP_CHART = null;
const CMP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899"];
const MAX_COMPARE_EXPIRIES = 4;
const ODO_MAX_ANIMATED_ROWS=20;  // rows beyond this render their numbers as plain text
const ASSET_NAMES={BTC:"Bitcoin",ETH:"Ethereum",SOL:"Solana",XAUT:"Tether Gold",DOGE:"Dogecoin",
                   AVAX:"Avalanche",LINK:"Chainlink",ARB:"Arbitrum",OP:"Optimism",SUI:"Sui",
                   MATIC:"Polygon",BNB:"BNB",XRP:"XRP",TIA:"Celestia",WSTETH:"Lido wstETH"};
let ASSETS=[];                                   // option underlyings from the exchange
const DEFAULT_CS={"BTC":0.001,"ETH":0.01};       // fallback until /api/assets answers
function defaultContractSize(asset){
  const a = ASSETS.find(x=>x.currency===asset);
  if(a && a.default_contract_size) return a.default_contract_size;
  return DEFAULT_CS[asset] || 0.001;
}
const SETTINGS={refreshInterval:0,fontScale:1,theme:"dark",chartRange:30,blur:12,orbs:true,fontFamily:"mixed",palette:"default",maxLossFilter:10,includeFees:true,feeMode:"taker",marginType:"SM",maxCombos:30,maxSpreadPct:0,minOpenInterest:0};

/* MINI CHART SVGs — shapes preserved, dual-color via clipPath (unique IDs) */
const MINI_CHARTS={
  long_call:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_long_call"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_long_call"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_long_call)"><path d="M0 38L50 38L100 6" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_long_call)"><path d="M0 38L50 38L100 6" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  long_put:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_long_put"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_long_put"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_long_put)"><path d="M0 6L50 38L100 38" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_long_put)"><path d="M0 6L50 38L100 38" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  protective_put:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_protective_put"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_protective_put"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_protective_put)"><path d="M0 38L40 38L100 6" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_protective_put)"><path d="M0 38L40 38L100 6" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  covered_call:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_covered_call"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_covered_call"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_covered_call)"><path d="M0 38L45 10L100 10" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_covered_call)"><path d="M0 38L45 10L100 10" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  collar:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_collar"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_collar"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_collar)"><path d="M0 38L30 38L50 10L75 10" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_collar)"><path d="M0 38L30 38L50 10L75 10" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  bull_call_spread:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_bull_call_spread"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_bull_call_spread"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_bull_call_spread)"><path d="M0 38L40 38L60 10L100 10" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_bull_call_spread)"><path d="M0 38L40 38L60 10L100 10" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  bear_put_spread:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_bear_put_spread"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_bear_put_spread"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_bear_put_spread)"><path d="M0 10L40 10L60 38L100 38" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_bear_put_spread)"><path d="M0 10L40 10L60 38L100 38" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  bull_put_spread:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_bull_put_spread"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_bull_put_spread"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_bull_put_spread)"><path d="M0 10L50 10L70 38L100 38" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_bull_put_spread)"><path d="M0 10L50 10L70 38L100 38" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  bear_call_spread:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_bear_call_spread"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_bear_call_spread"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_bear_call_spread)"><path d="M0 38L50 38L70 10L100 10" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_bear_call_spread)"><path d="M0 38L50 38L70 10L100 10" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  straddle:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_straddle"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_straddle"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_straddle)"><path d="M0 6L50 38L100 6" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_straddle)"><path d="M0 6L50 38L100 6" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  strangle:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_strangle"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_strangle"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_strangle)"><path d="M0 6L30 38L70 38L100 6" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_strangle)"><path d="M0 6L30 38L70 38L100 6" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`,
  iron_condor:`<svg viewBox="0 0 100 44"><defs><clipPath id="loss_iron_condor"><rect x="0" y="22" width="100" height="22"/></clipPath><clipPath id="prof_iron_condor"><rect x="0" y="0" width="100" height="22"/></clipPath></defs><line x1="0" y1="22" x2="100" y2="22" stroke="#334155" stroke-width=".8" stroke-dasharray="3 3"/><g clip-path="url(#prof_iron_condor)"><path d="M0 38L30 38L40 10L60 10L70 38L100 38" stroke="#22c55e" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><g clip-path="url(#loss_iron_condor)"><path d="M0 38L30 38L40 10L60 10L70 38L100 38" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round"/></g></svg>`
};

/* ══════ GLASS DROPDOWN — body-appended ══════ */
class GlassDropdown {
  constructor(nativeSelect, opts = {}) {
    this.native = nativeSelect;
    this.placeholder = opts.placeholder || "— Select —";
    this.onChange = opts.onChange || null;
    this.build();
    this.sync();
    this.bindEvents();
  }
  build() {
    this.native.classList.add("native-select-hidden");
    this.native.setAttribute("tabindex", "-1");

    this.wrap = document.createElement("div");
    this.wrap.className = "glass-select";
    this.native.parentNode.insertBefore(this.wrap, this.native);
    this.wrap.appendChild(this.native);

    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "glass-select-btn";
    this.btn.textContent = this.placeholder;
    this.wrap.appendChild(this.btn);

    // Dropdown → append to BODY so it's above everything
    this.dd = document.createElement("div");
    this.dd.className = "_glass-dd";
    document.body.appendChild(this.dd);

    // Close on click outside
    document.addEventListener("click", (e) => {
      if (!this.wrap.contains(e.target) && !this.dd.contains(e.target)) this.close();
    });
  }
  sync() {
    this.dd.innerHTML = "";
    const getIconHtml = (val, text) => {
      if (val === "BTC") {
        return `<span class="dd-logo" style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:6px"><svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block"><circle cx="16" cy="16" r="16" fill="#F7931A"/><path d="M21.91 14.18c.36-2.4-1.48-3.69-4-4.5l.82-3.3-2-.5-.8 3.2c-.52-.13-1.05-.25-1.58-.37l.8-3.22-2-.5-.81 3.27c-.43-.1-.85-.2-1.26-.3l-2.76-.69-.53 2.13s1.48.34 1.45.36c.8.2 1.05.74.96 1.17l-.96 3.86c.06.01.13.04.21.09l-.21-.05-1.35 5.4c-.1.25-.43.62-.97.43.03.02-1.46-.36-1.46-.36l-1 2.3 2.6.65c.48.12.96.24 1.43.35l-.83 3.33 2 .5.82-3.29c.55.15 1.08.28 1.6.4l-.82 3.28 2 .5.83-3.34c3.41.65 5.98.39 7.06-2.31.87-2.18-.04-3.44-1.61-4.26 1.15-.27 2.01-1.02 2.24-2.58zm-4.01 5.62c-.54 2.21-4.24 1.02-5.44.72l.97-3.89c1.2.3 5.03.88 4.47 3.17zm.4-5.66c-.5 2.01-3.6 0.94-4.6.68l.88-3.52c1 .25 4.25.75 3.72 2.84z" fill="#FFF"/></svg></span><span style="font-weight:700">Bitcoin</span>`;
      } else if (val === "ETH") {
        return `<span class="dd-logo" style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:6px"><svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16 5.5v7.75l6.5 2.91L16 5.5z" fill="#FFF" fill-opacity=".6"/><path d="M16 5.5L9.5 16.16l6.5-2.91V5.5z" fill="#FFF"/><path d="M16 22.02v4.48l6.51-9.13L16 22.02z" fill="#FFF" fill-opacity=".6"/><path d="M16 22.02l-6.5-5.38 6.5 9.13v-4.48z" fill="#FFF"/><path d="M16 20.67l6.5-3.8L16 14.5l-6.5 2.37 6.5 3.8z" fill="#FFF" fill-opacity=".2"/><path d="M9.5 16.87l6.5 3.8V14.5l-6.5 2.37z" fill="#FFF" fill-opacity=".6"/></svg></span><span style="font-weight:700">Ethereum</span>`;
      }
      // any other listed underlying: a neutral coin badge with its ticker
      if (val && ASSETS.some(a => a.currency === val)) {
        const initials = val.slice(0, 3);
        return `<span class="dd-logo" style="width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:6px;border-radius:50%;background:var(--accent-g);color:#fff;font-size:8px;font-weight:900;letter-spacing:-0.3px">${initials}</span><span style="font-weight:700">${text}</span>`;
      }
      return text;
    };
    const opts = this.native.options;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      const div = document.createElement("div");
      div.className = "glass-opt";
      div.innerHTML = getIconHtml(o.value, o.textContent);
      div.dataset.value = o.value;
      if (o.disabled) div.classList.add("disabled");
      if (o.selected && o.value) div.classList.add("selected");
      div.addEventListener("click", () => {
        if (o.disabled) return;
        this.native.value = o.value;
        this.native.dispatchEvent(new Event("change", {bubbles: true}));
        this.sync();
        this.close();
        if (this.onChange) this.onChange(o.value);
      });
      this.dd.appendChild(div);
    }
    const sel = this.native.options[this.native.selectedIndex];
    this.btn.innerHTML = (sel && sel.value) ? getIconHtml(sel.value, sel.textContent) : this.placeholder;
  }
  open() {
    const r = this.btn.getBoundingClientRect();
    this.dd.style.top = (r.bottom + 4) + "px";
    this.dd.style.left = r.left + "px";
    this.dd.style.width = r.width + "px";
    this.dd.classList.add("show");
    this.btn.classList.add("open");
  }
  close() {
    this.dd.classList.remove("show");
    this.btn.classList.remove("open");
  }
  toggle() {
    if (this.dd.classList.contains("show")) this.close(); else this.open();
  }
  bindEvents() {
    this.btn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    this.btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggle(); }
      if (e.key === "Escape") this.close();
    });
    const repos = () => { if (this.dd.classList.contains("show")) this.open(); };
    window.addEventListener("scroll", repos, true);
    window.addEventListener("resize", repos);
  }
  refresh() { this.sync(); }
  setEnabled(v) { this.btn.disabled = !v; this.btn.style.opacity = v ? "1" : "0.5"; }
}

/* INIT */

/* Every underlying the exchange lists an option market for. One call at boot —
   option chains are still only fetched for the asset the user actually picks. */
async function loadAssets(){
  const sel=document.getElementById("f-asset");
  try{
    const r=await(await fetch("/api/assets")).json();
    if(r.error||!r.assets?.length) throw new Error(r.error||"no assets");
    ASSETS=r.assets;
    const previous=SETTINGS.asset||sel.value;
    sel.innerHTML=ASSETS.map(a=>`<option value="${a.currency}">${ASSET_NAMES[a.currency]||a.currency}</option>`).join("");
    sel.value=ASSETS.some(a=>a.currency===previous)?previous:ASSETS[0].currency;
  }catch(e){
    console.error("Asset list error:",e);
    ASSETS=[{currency:"BTC",default_contract_size:0.001},{currency:"ETH",default_contract_size:0.01}];
    sel.innerHTML=`<option value="BTC">Bitcoin</option><option value="ETH">Ethereum</option>`;
  }
  if(window._glassDropdowns?.asset) window._glassDropdowns.asset.refresh();
  if(!document.getElementById("f-size").dataset.userSet){
    document.getElementById("f-size").value=defaultContractSize(sel.value);
  }
}

document.addEventListener("DOMContentLoaded",async()=>{
  loadSettings();
  STRATS=await(await fetch("/api/strategies")).json();
  // Initialize glass dropdowns
  window._glassDropdowns = {};
  await loadAssets();
  window._glassDropdowns.asset = new GlassDropdown(document.getElementById("f-asset"), {
    onChange: async()=>{
      _cachedExpiry=null;
      SPOT_PRICE=0;
      setMarketBarShimmer();
      setSummaryBoxShimmer();
      const a = document.getElementById("f-asset").value;
      SETTINGS.asset = a;
      localStorage.setItem("d_settings", JSON.stringify(SETTINGS));
      if(!document.getElementById("f-size").dataset.userSet){
        document.getElementById("f-size").value = defaultContractSize(a);
      }
      await loadExp();
      if(document.getElementById("f-expiry").value && SEL.size > 0 && DATA) {
        compute();
      } else {
        Promise.all([loadMarketData(), fetchSpot(), updateSizeUsd()]);
      }
    }
  });
  window._glassDropdowns.expiry = new GlassDropdown(document.getElementById("f-expiry"), {
    placeholder:"Loading…",
    onChange:()=>{
      updBtn();
      _cachedExpiry=document.getElementById("f-expiry").value||null;
      // the primary expiry can never also be a comparison chip
      CMP_EXPIRIES=CMP_EXPIRIES.filter(e=>e!==_cachedExpiry);
      renderCompareChips();
      if(_cachedExpiry && SEL.size > 0 && DATA) {
        compute();
      } else if(_cachedExpiry) {
        loadMarketData();
      }
    }
  });
  window._glassDropdowns.fontsize = new GlassDropdown(document.getElementById("set-fontsize"), {
    onChange:()=>{}
  });

  renderChips();renderStratsGuide();
  await loadExp(); // First fetch expiries (caches instruments in app.py)
  Promise.all([loadMarketData(), fetchSpot()]); // Now fetch Top Market Bar concurrently!
  // Asset change handled by GlassDropdown above
  document.getElementById("f-size").addEventListener("input",function(){
    this.dataset.userSet="1";
    const newCS = parseFloat(this.value);
    if (!isNaN(newCS) && newCS > 0 && DATA) {
      recomputeContractSize(newCS);
    } else {
      updateSizeUsd();
    }
  });
  let _maxLossDebounce=null;
  document.getElementById("f-maxloss")?.addEventListener("input",function(){
    this.dataset.userSet="1";
    // debounce: re-rendering ~200 rows on every keystroke froze the page
    clearTimeout(_maxLossDebounce);
    _maxLossDebounce=setTimeout(()=>{if(DATA)render(DATA);},220);
  });
  startHealthCheck();
  startMarketTicker();
});

/* TABS */
function switchTab(tab){
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
  document.getElementById("tab-analyzer").style.display=tab==="analyzer"?"block":"none";
  document.getElementById("tab-strategies").style.display=tab==="strategies"?"block":"none";
}

/* SETTINGS */
function loadSettings(){try{const s=JSON.parse(localStorage.getItem("d_settings"));if(s)Object.assign(SETTINGS,s);applySettings()}catch(e){applySettings()}}
function saveSettings(){
  const oldFees = SETTINGS.includeFees, oldMode = SETTINGS.feeMode, oldCombos = SETTINGS.maxCombos,
        oldSpread = SETTINGS.maxSpreadPct, oldOi = SETTINGS.minOpenInterest;
  SETTINGS.chartRange=parseInt(document.getElementById("set-chartrange").value)||30;
  SETTINGS.blur=parseInt(document.getElementById("set-blur").value)||0;
  SETTINGS.refreshInterval=parseInt(document.getElementById("set-refresh").value)||0;
  SETTINGS.fontScale=parseFloat(document.getElementById("set-fontsize").value)||1;
  SETTINGS.maxLossFilter=parseFloat(document.getElementById("set-maxloss").value)||0;
  SETTINGS.includeFees = document.getElementById("set-fees") ? document.getElementById("set-fees").checked : true;
  const fm = document.getElementById("set-feemode");
  SETTINGS.feeMode = fm && ["taker","maker","rfq"].includes(fm.value) ? fm.value : "taker";
  const mt = document.getElementById("set-margintype");
  SETTINGS.marginType = mt && ["SM","PM2"].includes(mt.value) ? mt.value : "SM";
  SETTINGS.maxCombos = parseInt(document.getElementById("set-maxcombos")?.value) || 30;
  SETTINGS.maxSpreadPct = parseFloat(document.getElementById("set-maxspread")?.value) || 0;
  SETTINGS.minOpenInterest = parseFloat(document.getElementById("set-minoi")?.value) || 0;
  localStorage.setItem("d_settings",JSON.stringify(SETTINGS));applySettings();toggleSettings();
  if(autoTimer){clearInterval(autoTimer);autoTimer=null}
  if(SETTINGS.refreshInterval>0)startAutoRefresh();
  if((oldFees !== SETTINGS.includeFees || oldMode !== SETTINGS.feeMode || oldCombos !== SETTINGS.maxCombos
      || oldSpread !== SETTINGS.maxSpreadPct || oldOi !== SETTINGS.minOpenInterest)
      && DATA && document.getElementById("f-expiry")?.value) {
    compute();
  }
}
function applySettings(){
  document.documentElement.style.setProperty("--font-scale",SETTINGS.fontScale);
  document.documentElement.style.setProperty("--blur",SETTINGS.blur+"px");
  applyFont();
  document.documentElement.setAttribute("data-theme",SETTINGS.theme);
  document.documentElement.setAttribute("data-palette",SETTINGS.palette||"default");
  document.querySelectorAll(".palette-card").forEach(c=>{
    c.classList.toggle("active",c.dataset.palette===(SETTINGS.palette||"default"));
  });
  document.getElementById("set-refresh").value=SETTINGS.refreshInterval;
  document.getElementById("set-chartrange").value=SETTINGS.chartRange;
  document.getElementById("set-maxloss").value=SETTINGS.maxLossFilter!==undefined?SETTINGS.maxLossFilter:10;
  const fMl=document.getElementById("f-maxloss");
  if(fMl&&!fMl.dataset.userSet){fMl.value=SETTINGS.maxLossFilter!==undefined?SETTINGS.maxLossFilter:10;}
  const sFees=document.getElementById("set-fees");
  if(sFees){sFees.checked=SETTINGS.includeFees!==undefined?SETTINGS.includeFees:true;}
  const sMode=document.getElementById("set-feemode");
  if(sMode){sMode.value=SETTINGS.feeMode||"taker";}
  const sMargin=document.getElementById("set-margintype");
  if(sMargin){sMargin.value=SETTINGS.marginType||"SM";}
  const sCombos=document.getElementById("set-maxcombos");
  if(sCombos){sCombos.value=SETTINGS.maxCombos||30;document.getElementById("maxcombos-val").textContent=sCombos.value;}
  const sSpread=document.getElementById("set-maxspread");
  if(sSpread){sSpread.value=SETTINGS.maxSpreadPct||0;document.getElementById("maxspread-val").textContent=(SETTINGS.maxSpreadPct||0)==0?"off":SETTINGS.maxSpreadPct+"%";}
  const sOi=document.getElementById("set-minoi");
  if(sOi){sOi.value=SETTINGS.minOpenInterest||0;}
  document.getElementById("set-blur").value=SETTINGS.blur;
  document.getElementById("blur-val").textContent=SETTINGS.blur+"px";
  document.getElementById("set-fontsize").value=SETTINGS.fontScale;
  document.getElementById("theme-dark")?.classList.toggle("active",SETTINGS.theme==="dark");
  document.getElementById("theme-light")?.classList.toggle("active",SETTINGS.theme==="light");
  document.getElementById("theme-oled")?.classList.toggle("active",SETTINGS.theme==="oled");
  document.getElementById("theme-contrast")?.classList.toggle("active",SETTINGS.theme==="contrast");
  const orbs=document.getElementById("bg-orbs");if(orbs)orbs.classList.toggle("off",!SETTINGS.orbs);
  document.getElementById("orbs-on")?.classList.toggle("active",SETTINGS.orbs);
  document.getElementById("orbs-off")?.classList.toggle("active",!SETTINGS.orbs);
  const theme = SETTINGS.theme || "dark";
  const pCvs = document.getElementById("cyber-particles");
  if (pCvs) {
    const isVisibleTheme = theme !== "oled" && theme !== "contrast" && SETTINGS.orbs;
    if (isVisibleTheme) {
      pCvs.style.opacity = theme === "light" ? "0.6" : "0.85";
      startCyberParticles();
    } else {
      pCvs.style.opacity = "0";
      stopCyberParticles();
    }
  }
  const ab=document.getElementById("auto-badge");
  if(SETTINGS.refreshInterval>0){ab.classList.add("on");ab.textContent=`AUTO ${SETTINGS.refreshInterval}s`}
  else ab.classList.remove("on");
}
function setFont(f){
  SETTINGS.fontFamily=f;
  applySettings();
  localStorage.setItem("d_settings",JSON.stringify(SETTINGS));
}
function applyFont(){
  const f=SETTINGS.fontFamily||"mixed";
  const root=document.documentElement;
  if(f==="sans"){
    root.style.setProperty("--font-ui",'"Inter",system-ui,sans-serif');
  }else if(f==="mono"){
    root.style.setProperty("--font-ui",'"JetBrains Mono",monospace');
  }else{
    root.style.setProperty("--font-ui",'"Inter",system-ui,sans-serif');
  }
  // Update font cards
  document.querySelectorAll(".font-card").forEach(c=>{
    c.classList.toggle("active",c.dataset.font===f);
  });
}
function setTheme(t){
  SETTINGS.theme=t;
  applySettings();
  localStorage.setItem("d_settings",JSON.stringify(SETTINGS));
}
function setPalette(p){
  SETTINGS.palette=p;
  applySettings();
  localStorage.setItem("d_settings",JSON.stringify(SETTINGS));
  if(CHART && CURR_STRAT) {
    drawChart(CURR_STRAT, parseInt(document.getElementById("chart-range")?.value) || SETTINGS.chartRange || 30);
  }
}
function setOrbs(v){SETTINGS.orbs=v;applySettings()}
function toggleSettings(){document.getElementById("settings-overlay").classList.toggle("on");document.getElementById("settings-panel").classList.toggle("on")}

/* ═══ AMBIENT CYBER PARTICLES / BOKEH DUST ENGINE ═══ */
class CyberParticle {
  constructor(w, h) { this.reset(w, h, true); }
  reset(w, h, randomY = false) {
    this.x = Math.random() * w;
    this.y = randomY ? Math.random() * h : h + 10;
    this.size = Math.random() * 4.5 + 2.5;
    this.speedY = -(Math.random() * 0.45 + 0.15);
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.alpha = Math.random() * 0.4 + 0.5;
    this.pulseSpeed = Math.random() * 0.02 + 0.01;
    this.pulseVal = Math.random() * Math.PI;
    this.colorIdx = Math.floor(Math.random() * 3);
  }
  update(w, h) {
    this.x += this.speedX;
    this.y += this.speedY;
    this.pulseVal += this.pulseSpeed;
    if (this.y < -15 || this.x < -15 || this.x > w + 15) this.reset(w, h, false);
  }
  draw(ctx, colors) {
    const color = colors[this.colorIdx] || colors[0];
    const currentAlpha = this.alpha * (0.65 + 0.35 * Math.sin(this.pulseVal));
    ctx.save();
    ctx.globalAlpha = currentAlpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.size * 6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function getParticleColors(pal) {
  if (pal === "emerald") return ["#10b981", "#34d399", "#06b6d4"];
  if (pal === "sunset") return ["#f43f5e", "#fb7185", "#fb923c"];
  if (pal === "ocean") return ["#06b6d4", "#22d3ee", "#3b82f6"];
  if (pal === "cyberpunk") return ["#ec4899", "#22d3ee", "#a855f7"];
  if (pal === "gold") return ["#f59e0b", "#fbbf24", "#d97706"];
  return ["#3b82f6", "#8b5cf6", "#60a5fa"];
}

let _cyberParticles = [];
let _cyberRafId = null;
let _cyberRunning = false;
let _cyberViewport = { w: 0, h: 0 };

function initCyberParticles() {
  const cvs = document.getElementById("cyber-particles");
  if (!cvs) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Back the canvas with the device pixel ratio (capped at 2) so the glow is not
  // blurry on HiDPI screens, then work in CSS pixels.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(w * dpr);
  cvs.height = Math.round(h * dpr);
  cvs.style.width = w + "px";
  cvs.style.height = h + "px";
  const ctx = cvs.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _cyberViewport = { w, h };
  const count = Math.min(50, Math.floor((w * h) / 25000));
  _cyberParticles = [];
  for (let i = 0; i < count; i++) _cyberParticles.push(new CyberParticle(w, h));
}

function startCyberParticles() {
  if (_cyberRunning) return;
  _cyberRunning = true;
  if (!_cyberParticles.length) initCyberParticles();
  const cvs = document.getElementById("cyber-particles");
  if (!cvs) return;
  const ctx = cvs.getContext("2d");
  function loop() {
    if (!_cyberRunning) return;
    const w = _cyberViewport.w, h = _cyberViewport.h;
    ctx.clearRect(0, 0, w, h);
    const colors = getParticleColors(SETTINGS.palette || "default");
    for (let i = 0; i < _cyberParticles.length; i++) {
      _cyberParticles[i].update(w, h);
      _cyberParticles[i].draw(ctx, colors);
    }
    _cyberRafId = requestAnimationFrame(loop);
  }
  _cyberRafId = requestAnimationFrame(loop);
}

function stopCyberParticles() {
  _cyberRunning = false;
  if (_cyberRafId) cancelAnimationFrame(_cyberRafId);
  _cyberRafId = null;
  // Wipe the canvas: the last frame used to stay behind the (transparent) layer.
  const cvs = document.getElementById("cyber-particles");
  if (cvs) {
    const ctx = cvs.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.restore();
  }
  _cyberParticles = [];   // rebuilt for the current viewport on the next start
}

let _cyberResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_cyberResizeTimer);
  // Re-init even while stopped, otherwise the canvas keeps a stale size and the
  // particles reappear in the wrong place when they are switched back on.
  _cyberResizeTimer = setTimeout(() => {
    if (_cyberRunning) initCyberParticles(); else _cyberParticles = [];
  }, 200);
});

/* Pause the animation loop when the tab is hidden (it burned GPU in the background) */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (_cyberRunning) { _cyberRunning = false; if (_cyberRafId) cancelAnimationFrame(_cyberRafId); _cyberRafId = null; _cyberPausedByTab = true; }
  } else if (_cyberPausedByTab) {
    _cyberPausedByTab = false;
    startCyberParticles();
  }
});
let _cyberPausedByTab = false;

/* ZEN / FOCUS MODE ENGINE */
function toggleZenMode(forceState) {
  const isZen = forceState !== undefined ? forceState : !document.body.classList.contains("zen-mode");
  document.body.classList.toggle("zen-mode", isZen);
  if (isZen) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/* FILTER ACCORDION COLLAPSE ENGINE */
function toggleFilterCollapse(forceState) {
  const flt = document.getElementById("flt-sec");
  if (!flt) return;
  const isCollapsed = forceState !== undefined ? forceState : !flt.classList.contains("collapsed");
  flt.classList.toggle("collapsed", isCollapsed);
  
  if (isCollapsed) {
    document.getElementById("mini-asset").textContent = document.getElementById("f-asset")?.value || "BTC";
    const expText = document.getElementById("f-expiry")?.options[document.getElementById("f-expiry")?.selectedIndex]?.textContent || "—";
    document.getElementById("mini-exp").textContent = expText;
    const activeId = [...SEL][0];
    const active = STRATS.find(x => x.id === activeId);
    document.getElementById("mini-strats").textContent = active ? `${active.emoji} ${active.name}` : "No strategy";
  }
}

document.addEventListener("keydown", function(e) {
  if (e.altKey && (e.key === "z" || e.key === "Z" || e.key === "ظ")) {
    e.preventDefault();
    toggleZenMode();
  }
  if (e.key === "Escape" && document.body.classList.contains("zen-mode")) {
    if (!document.getElementById("overlay")?.classList.contains("on") && !document.getElementById("settings-overlay")?.classList.contains("on")) {
      toggleZenMode(false);
    }
  }
});
function startAutoRefresh(){
  if(autoTimer){clearInterval(autoTimer);autoTimer=null}
  if(SETTINGS.refreshInterval<=0)return;
  autoTimer=setInterval(()=>{
    // Refreshing while a modal is open would replace DATA under the chart the user
    // is reading (CURR_STRAT would point at a discarded object) — only tick the
    // market data in that case.
    const busy = document.getElementById("overlay")?.classList.contains("on")
              || document.getElementById("settings-overlay")?.classList.contains("on")
              || document.getElementById("share-preview-modal")?.classList.contains("on");
    if(!busy && document.getElementById("f-expiry").value && SEL.size>0){
      compute();
    } else {
      Promise.all([loadMarketData(), fetchSpot()]);
    }
  },SETTINGS.refreshInterval*1000);
}

/* HEALTH */
/* MARKET DATA — uses cached expiry from loadExp to avoid slow fetch_instruments */
let _cachedExpiry = null;  // set by loadExp

let mktTickerPos = 0;
let mktTickerLastTime = null;
let mktTickerRafId = null;
let mktTickerPaused = false;
let mktTickerWaitUntil = 0;
let mktStreamWidth = 416;

function updateMarketStreamWidth() {
  const stream1 = document.getElementById("mkt-stream-1");
  if (stream1 && stream1.offsetWidth > 50) {
    mktStreamWidth = stream1.offsetWidth;
  }
}

/* Re-measure on resize / font-scale changes, and retry while the width is still
   unknown (e.g. measured while the header was collapsed) — otherwise the ticker
   scrolls past its loop point and leaves an empty bar. */
let _mktResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_mktResizeTimer);
  _mktResizeTimer = setTimeout(() => {
    const before = mktStreamWidth;
    updateMarketStreamWidth();
    if (mktStreamWidth !== before) { mktTickerPos = 0; }
  }, 200);
});

function triggerMarketTickerWait(seconds = 5) {
  mktTickerPos = 0;
  const track = document.getElementById("mkt-track");
  if (track) track.style.transform = "translate3d(0, 0, 0)";
  mktTickerWaitUntil = performance.now() + (seconds * 1000);
  updateMarketStreamWidth();
}

function setMarketBarShimmer() {
  document.querySelectorAll(".mkt-val-price").forEach(p => p.innerHTML = '<div class="skeleton-box" style="width:55px;height:14px;border-radius:4px"></div>');
  document.querySelectorAll(".mkt-val-change").forEach(c => c.innerHTML = '<div class="skeleton-box" style="width:45px;height:14px;border-radius:4px"></div>');
  document.querySelectorAll(".mkt-val-dvol").forEach(d => d.innerHTML = '<div class="skeleton-box" style="width:40px;height:14px;border-radius:4px"></div>');
  document.querySelectorAll(".mkt-val-ivrank").forEach(r => r.innerHTML = '<div class="skeleton-box" style="width:30px;height:14px;border-radius:4px"></div>');
  const u = document.getElementById("size-usd"); if(u) u.innerHTML = '<div class="skeleton-box" style="width:45px;height:14px;border-radius:4px"></div>';
  triggerMarketTickerWait(5);
}

async function loadMarketData(){
  const asset = document.getElementById("f-asset").value;
  try{
    const r = await (await fetch("/api/market",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({asset, expiry:_cachedExpiry})
    })).json();
    if(r.error) throw new Error(r.error);

    document.querySelectorAll(".mkt-lbl-asset").forEach(el => el.textContent = r.asset);
    document.querySelectorAll(".mkt-val-price").forEach((el, i) => rollOdometer(el, "$"+fmt(r.spot), 650, "mkt_price_"+i));

    const chg = r.change_24h;
    document.querySelectorAll(".mkt-val-change").forEach((el, i) => {
      rollOdometer(el, (chg>=0?"+":"")+chg.toFixed(2)+"%", 700, "mkt_change_"+i);
      el.className = "mkt-chip-val "+(chg>0?"up":chg<0?"down":"neu")+" mkt-val-change";
    });

    document.querySelectorAll(".mkt-val-dvol").forEach((el, i) => {
      if(r.dvol>0) rollOdometer(el, r.dvol.toFixed(1)+"%", 750, "mkt_dvol_"+i); else el.textContent = "—";
      el.className = "mkt-chip-val "+(r.dvol>60?"up":r.dvol>40?"neu":"down")+" mkt-val-dvol";
    });

    document.querySelectorAll(".mkt-val-ivrank").forEach((el, i) => {
      if(r.iv_rank>0) rollOdometer(el, String(r.iv_rank), 800, "mkt_rank_"+i); else el.textContent = "—";
      el.className = "mkt-chip-val "+(r.iv_rank>=70?"down":r.iv_rank>=40?"neu":"up")+" mkt-val-ivrank";
    });

    document.querySelectorAll(".mkt-dot-chg").forEach(dot => dot.className = "mkt-dot mkt-dot-chg "+(chg>=0?"green":"red"));
    document.querySelectorAll(".mkt-dot-rank").forEach(dot => dot.className = "mkt-dot mkt-dot-rank "+(r.iv_rank>=70?"red":r.iv_rank>=40?"green":"green"));
    setTimeout(updateMarketStreamWidth, 850);
  }catch(e){console.error("Market data error:",e)}
}

async function checkHealth(){
  const b=document.getElementById("live-badge"),t=document.getElementById("live-text");
  try{const r=await fetch("/api/health");if(r.ok){b.classList.remove("error");t.textContent="LIVE"}else{b.classList.add("error");t.textContent="DEGRADED"}}
  catch(e){b.classList.add("error");t.textContent="OFFLINE"}}
function startHealthCheck(){checkHealth();setInterval(()=>{checkHealth();loadMarketData()},30000)}

function mktTickerLoop(now) {
  if (!mktTickerLastTime) mktTickerLastTime = now;
  const dt = Math.min((now - mktTickerLastTime) / 1000, 0.1);
  mktTickerLastTime = now;

  if (!document.hidden && !mktTickerPaused && now >= mktTickerWaitUntil) {
    if (mktStreamWidth <= 50) updateMarketStreamWidth();
    const track = document.getElementById("mkt-track");
    if (track) {
      mktTickerPos += 30 * dt; // Constant linear speed: 30 pixels per second
      if (mktTickerPos >= mktStreamWidth && mktStreamWidth > 0) {
        mktTickerPos -= mktStreamWidth;
      }
      track.style.transform = `translate3d(-${mktTickerPos.toFixed(2)}px, 0, 0)`;
    }
  }
  mktTickerRafId = requestAnimationFrame(mktTickerLoop);
}

function startMarketTicker() {
  const bar = document.getElementById("mkt-bar");
  if (bar) {
    bar.addEventListener("mouseenter", () => { mktTickerPaused = true; });
    bar.addEventListener("mouseleave", () => { mktTickerPaused = false; });
  }
  if (mktTickerRafId) cancelAnimationFrame(mktTickerRafId);
  mktTickerLastTime = performance.now();
  triggerMarketTickerWait(5); // Wait 5 seconds after load/display before moving
  mktTickerRafId = requestAnimationFrame(mktTickerLoop);
}

/* SPOT */
async function fetchSpot(){
  const a=document.getElementById("f-asset").value;
  const u = document.getElementById("size-usd");
  if(u && SPOT_PRICE===0) u.innerHTML = '<div class="skeleton-box" style="width:45px;height:14px;border-radius:4px;vertical-align:middle"></div>';
  try{const r=await(await fetch("/api/spot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({asset:a})})).json();if(r.spot>0){SPOT_PRICE=r.spot;updateSizeUsd()}}catch(e){}}
function updateSizeUsd(){
  const cs=parseFloat(document.getElementById("f-size").value)||0;
  const el=document.getElementById("size-usd");
  if(SPOT_PRICE>0) rollOdometer(el, "≈ $"+fmt(cs*SPOT_PRICE), 500); else el.textContent="≈ $—";}

/* CHIPS with TOOLTIPS */
function renderChips(){
  document.getElementById("chips").setAttribute("role","radiogroup");
  document.getElementById("chips").setAttribute("aria-label","Strategy");
  document.getElementById("chips").innerHTML=STRATS.map(s=>{
    let tipLegs=s.legs.map(l=>{
      const isBuy=l.dir==="buy"||l.dir==="hold";
      const dCls=isBuy?"buy":"sell";const dLabel=isBuy?"BUY":"SELL";
      let desc=l.type==="underlying"?`Hold ${document.getElementById("f-asset").value}`:
        `${dLabel} ${l.type.charAt(0).toUpperCase()+l.type.slice(1)}`;
      return`<div class="tooltip-leg"><span class="tooltip-dir ${dCls}">${dLabel}</span><span>${desc}</span></div>`;
    }).join("");
    // title: on touch devices the hover tooltip never appears
    const plain = s.legs.map(l => `${(l.dir === "buy" || l.dir === "hold") ? "BUY" : "SELL"} ${l.type === "underlying" ? "underlying" : l.type}`).join("  •  ");
    const on = SEL.has(s.id);
    return`<div class="chip ${on?'on':''}" role="radio" aria-checked="${on}" tabindex="${on?0:-1}" data-sid="${s.id}" title="${s.name} — ${plain}" onclick="selectStrategy('${s.id}')" onkeydown="onChipKey(event,'${s.id}')">${s.emoji} ${s.name}<div class="tooltip">${tipLegs}</div></div>`;
  }).join("");
}

/* Exactly one strategy is analysed at a time — comparing unrelated strategies in
   one table was confusing, and a single choice keeps the combo list readable. */
function selectStrategy(id){
  if(SEL.has(id) && SEL.size === 1) return;   // already active
  SEL.clear(); SEL.add(id);
  document.querySelectorAll("#chips .chip").forEach(c=>{
    const active = c.dataset.sid === id;
    c.classList.toggle("on", active);
    c.setAttribute("aria-checked", String(active));
    c.tabIndex = active ? 0 : -1;
  });
  updBtn();
  if(DATA && document.getElementById("f-expiry").value) compute();
}

/* Keyboard support for the radio group: Enter/Space picks, arrows move */
function onChipKey(e, id){
  const chips = [...document.querySelectorAll("#chips .chip")];
  const i = chips.findIndex(c => c.dataset.sid === id);
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); selectStrategy(id); return; }
  let next = null;
  if(e.key === "ArrowRight" || e.key === "ArrowDown") next = chips[(i + 1) % chips.length];
  if(e.key === "ArrowLeft"  || e.key === "ArrowUp")   next = chips[(i - 1 + chips.length) % chips.length];
  if(next){ e.preventDefault(); selectStrategy(next.dataset.sid); next.focus(); }
}

/* EXPIRIES */
async function loadExp(){
  const a=document.getElementById("f-asset").value,s=document.getElementById("f-expiry");
  s.innerHTML='<option value="">Loading…</option>';s.disabled=true;
  if(window._glassDropdowns?.expiry){
    window._glassDropdowns.expiry.refresh();
    window._glassDropdowns.expiry.setEnabled(false);
    window._glassDropdowns.expiry.btn.innerHTML = `<div style="display:flex;align-items:center;gap:8px;width:100%"><span class="spin" style="width:12px;height:12px;border-width:2px;margin:0"></span><div class="skeleton-box" style="width:85px;height:14px;border-radius:4px"></div></div>`;
  }
  if(!document.getElementById("f-size").dataset.userSet)document.getElementById("f-size").value=defaultContractSize(a);
  try{const r=await(await fetch("/api/expiries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({asset:a})})).json();
    if(r.error)throw new Error(r.error);
    s.innerHTML='<option value="">— Select —</option>';
    r.expiries.forEach(e=>{const o=document.createElement("option");o.value=e.date;o.textContent=e.display;s.appendChild(o)});
    if(r.expiries.length){
        s.value=r.expiries[0].date;
        _cachedExpiry = r.expiries[0].date;  // cache for market data
      }
      s.disabled=false;updBtn();if(window._glassDropdowns?.expiry){window._glassDropdowns.expiry.refresh();window._glassDropdowns.expiry.setEnabled(true);}
      CMP_EXPIRIES=CMP_EXPIRIES.filter(e=>[...s.options].some(o=>o.value===e));
      renderCompareChips();
  }catch(e){s.innerHTML="<option>Failed</option>";showErr(e.message)}}
function updBtn(){document.getElementById("go-btn").disabled=!document.getElementById("f-expiry").value||SEL.size===0}
// Expiry change handled by GlassDropdown


/* COMPUTE WITH SHIMMER SKELETON */
function setSummaryBoxShimmer() {
  const box = document.getElementById("spot-box");
  if(box && box.style.display !== "none") {
    document.getElementById("s-pr").innerHTML = '<div class="skeleton-box" style="width:65px;height:16px;border-radius:4px;vertical-align:middle"></div>';
    document.getElementById("s-as").textContent = document.getElementById("f-asset").value;
    document.getElementById("s-exp").innerHTML = '<div class="skeleton-box" style="width:85px;height:14px;border-radius:4px;vertical-align:middle"></div>';
    document.getElementById("s-cs").innerHTML = '<div class="skeleton-box" style="width:55px;height:14px;border-radius:4px;vertical-align:middle"></div>';
  }
}

function getShimmerSkeletonHtml(count = 5) {
  const rowsCount = Math.min(8, Math.max(4, count * 2));
  let rowsHtml = '';
  for(let i = 0; i < rowsCount; i++) {
    rowsHtml += `
      <tr style="opacity:${1 - (i * 0.08)}">
        <td data-label="Strategy">
          <div class="skeleton-box" style="width:120px;height:16px;margin-bottom:6px"></div>
          <div class="skeleton-box" style="width:170px;height:12px"></div>
        </td>
        <td data-label="Legs">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:6px">
              <div class="skeleton-box" style="width:36px;height:16px;border-radius:4px"></div>
              <div class="skeleton-box" style="width:180px;height:14px"></div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="skeleton-box" style="width:36px;height:16px;border-radius:4px"></div>
              <div class="skeleton-box" style="width:150px;height:14px"></div>
            </div>
          </div>
        </td>
        <td data-label="Net Premium"><div class="skeleton-box" style="width:70px;height:18px"></div></td>
        <td data-label="Total Cost"><div class="skeleton-box" style="width:65px;height:18px"></div></td>
        <td data-label="Max Profit"><div class="skeleton-box" style="width:80px;height:18px"></div></td>
        <td data-label="Max Loss"><div class="skeleton-box" style="width:80px;height:18px"></div></td>
        <td data-label="PoP"><div class="skeleton-box" style="width:52px;height:18px"></div></td>
        <td data-label="Liquidity"><div class="skeleton-box" style="width:52px;height:18px"></div></td>
        <td data-label="Breakeven(s)"><div class="skeleton-box" style="width:90px;height:16px"></div></td>
        <td data-label="Distance to Profit"><div class="skeleton-box" style="width:60px;height:16px"></div></td>
        <td data-label="Payoff Chart"><div class="skeleton-box" style="width:75px;height:30px;border-radius:6px"></div></td>
      </tr>
    `;
  }
  return `
    <div class="rhdr">
      <div style="display:flex;align-items:center;gap:12px">
        <h2>Strategy Analysis</h2>
        <div class="skeleton-box" style="width:110px;height:22px;border-radius:12px"></div>
      </div>
      <div style="font-size:12px;color:var(--accent-l);display:flex;align-items:center;gap:8px">
        <span class="spin" style="width:14px;height:14px;border-width:2px;margin:0"></span>
        <span>Simulating option payoffs & Greeks…</span>
      </div>
    </div>
    <div class="tbl-wrap"><div class="tbl-scroll"><table>
      <thead>
        <tr>
          <th>Strategy</th><th>Contract Details</th><th>Net Premium</th><th>Total Cost</th>
          <th>Max Profit</th><th>Max Loss</th><th>PoP</th><th>Liq</th><th>Breakeven(s)</th><th>Distance</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table></div></div>
  `;
}

async function compute(){
  const asset=document.getElementById("f-asset").value,expiry=document.getElementById("f-expiry").value,
    cs=parseFloat(document.getElementById("f-size").value)||0.001,ids=[...SEL];
  if(!expiry||!ids.length)return;
  const btn=document.getElementById("go-btn"),box=document.getElementById("results");
  btn.disabled=true;btn.innerHTML='<span class="spin" style="width:14px;height:14px;border-width:2px;margin:0"></span> Analyzing…';
  hideErr();
  window._lastOdoValues = {}; // Clear odometer cache so new analysis spins from zero!
  // Reveal the summary box first — it starts hidden, so the "first load" shimmer
  // it is supposed to show never actually appeared.
  if (!DATA) { document.getElementById("spot-box").style.display = "flex"; setSummaryBoxShimmer(); }
  box.innerHTML = getShimmerSkeletonHtml(ids.length);
  try{
    const [r] = await Promise.all([
      (await fetch("/api/compute",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({asset,expiries:[expiry,...CMP_EXPIRIES.filter(e=>e!==expiry)],strategies:ids,contract_size:cs,include_fees:SETTINGS.includeFees!==undefined?SETTINGS.includeFees:true,fee_mode:SETTINGS.feeMode||"taker",max_combos:SETTINGS.maxCombos||30,
          max_spread_pct:SETTINGS.maxSpreadPct||0,min_open_interest:SETTINGS.minOpenInterest||0})})).json(),
      loadMarketData(),
      fetchSpot()
    ]);
    if(r.error)throw new Error(r.error);
    DATA=r;SPOT_PRICE=r.spot;updateSizeUsd();
    // When comparing tenors the rows would otherwise arrive grouped by expiry;
    // ranking by probability of profit makes the comparison readable at a glance.
    if(r.compare && !sortState.col) sortState={col:"pop",dir:-1};
    sortStrategies(r.strategies, sortState.col, sortState.dir);
    render(r);
  }catch(e){
    box.innerHTML=`<div class="empty"><div class="ic">⚠️</div><div class="tt">Failed to Analyze</div><div class="tx">${e.message}</div></div>`;
    showErr(e.message);
  }
  finally{btn.disabled=false;btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Analyze'}}

/* SORT */
/* Comparator shared by the header clicks and by every fresh compute(), so a
   re-analysis keeps the ordering the header claims to be showing. */
function sortStrategies(list, col, dir){
  if(!col || !dir) return list;
  return list.sort((a,b)=>{switch(col){
    case"strategy":return dir*a.name.localeCompare(b.name);
    case"premium":return dir*(a.net_premium-b.net_premium);
    case"cost":return dir*(a.total_cost-b.total_cost);
    case"maxp":return dir*((a.max_profit_inf?1e15:a.max_profit)-(b.max_profit_inf?1e15:b.max_profit));
    case"maxl":return dir*((a.max_loss_inf?-1e15:a.max_loss)-(b.max_loss_inf?-1e15:b.max_loss));
    case"pop":return dir*((a.pop??-1)-(b.pop??-1));
    case"liq":return dir*(((a.liquidity?.spread_pct)??999)-((b.liquidity?.spread_pct)??999));
    case"expiry":return dir*(((a.expiry_index??0)-(b.expiry_index??0))||((a.pop??-1)-(b.pop??-1)));
    default:return 0;}});
}

function sortTable(col){
  if(sortState.col===col){sortState.dir=sortState.dir===0?1:sortState.dir===1?-1:0}else{sortState.col=col;sortState.dir=1}
  if(sortState.dir===0){sortState.col=null;render(DATA);return}
  sortStrategies(DATA.strategies, sortState.col, sortState.dir);
  render(DATA);}
function sI(c){if(sortState.col!==c)return'<span class="si">↕</span>';return sortState.dir===1?'<span class="si">↑</span>':'<span class="si">↓</span>'}
function sC(c){return sortState.col===c?"sorted":""}

/* RENDER */
function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return "0.00";
  const num = typeof n === "number" ? n : parseFloat(n);
  const parts = num.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}
function fmtInt(n) {
  if (n === undefined || n === null || isNaN(n)) return "0";
  const num = typeof n === "number" ? n : parseFloat(n);
  return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtPct(p){return(p>=0?"+":"")+p.toFixed(2)+"%"}
const UNLIM='<span class="pct-unlim"><span class="inf">∞</span> Unlimited</span>';

/* UNIVERSAL VERTICAL SLOT-MACHINE ODOMETER ENGINE WITH STATE CACHE */
function rollOdometer(el, targetStr, duration = 700, cacheKey = null) {
  if (!el || targetStr === undefined || targetStr === null) return;
  targetStr = String(targetStr);

  if (!el.classList.contains("odo-container")) {
    el.classList.add("odo-container");
    el.style.display = "inline-flex";
    el.style.alignItems = "baseline";
    el.style.verticalAlign = "bottom";
    el.style.lineHeight = "1.15";
  }

  const oldStr = (cacheKey && window._lastOdoValues && window._lastOdoValues[cacheKey] !== undefined) ? String(window._lastOdoValues[cacheKey]) : null;
  if (cacheKey) {
    if (!window._lastOdoValues) window._lastOdoValues = {};
    window._lastOdoValues[cacheKey] = targetStr;
  }

  if (oldStr === targetStr) {
    el.textContent = targetStr;
    return;
  }

  el.innerHTML = "";
  let digitIdx = 0;
  let textBuf = "";

  const flushText = () => {
    if (textBuf) {
      const span = document.createElement("span");
      span.className = "odo-text";
      span.style.display = "inline";
      span.textContent = textBuf;
      el.appendChild(span);
      textBuf = "";
    }
  };

  for (let i = 0; i < targetStr.length; i++) {
    const char = targetStr[i];
    if (/^\d$/.test(char)) {
      flushText();
      const box = document.createElement("span");
      box.className = "odo-digit-box";
      box.style.cssText = "display:inline-block;overflow:hidden;height:1.15em;line-height:1.15em;vertical-align:bottom;position:relative;";
      
      const wheel = document.createElement("span");
      wheel.className = "odo-wheel";
      const delay = digitIdx * 45;
      wheel.style.cssText = `display:block;transition:transform ${duration}ms cubic-bezier(0.16,1,0.3,1) ${delay}ms;will-change:transform;`;
      
      for (let d = 0; d <= 9; d++) {
        const dSpan = document.createElement("span");
        dSpan.style.cssText = "display:block;height:1.15em;line-height:1.15em;text-align:center;";
        dSpan.textContent = d;
        wheel.appendChild(dSpan);
      }
      
      box.appendChild(wheel);
      el.appendChild(box);
      
      const digVal = parseInt(char, 10);
      let startDig = 0;
      if (oldStr && i < oldStr.length && /^\d$/.test(oldStr[i])) {
        startDig = parseInt(oldStr[i], 10);
      }
      wheel.style.transition = "none";
      wheel.style.transform = `translateY(-${startDig * 1.15}em)`;
      wheel.dataset.val = startDig;
      void wheel.offsetHeight;
      wheel.style.transition = `transform ${duration}ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`;
      wheel.style.transform = `translateY(-${digVal * 1.15}em)`;
      wheel.dataset.val = digVal;
      digitIdx++;
    } else {
      textBuf += char;
    }
  }
  flushText();
}

/* ═══ DERIVE FEE MODEL (mirror of app.py — https://docs.derive.xyz/reference/fees-1)
   taker : $0.50 flat base PER LEG (each leg is its own order) + min(0.03% notional, 12.5% premium)
   maker : min(0.01% notional, 12.5% premium), no base fee
   rfq   : taker rates with multi-leg group discounts + ONE $0.50 base fee
   Spot legs are always free.                                                     */
const DEFAULT_FEE_MODEL = { option_base: 0.50, option_notional_rate: 0.0003,
                            option_maker_rate: 0.0001, option_premium_cap: 0.125, spot_rate: 0 };
const FEE_MODE_LABELS = { taker: "Taker (orderbook)", maker: "Maker (resting limit)", rfq: "RFQ (multi-leg)" };
const round2 = v => Math.round((v + Number.EPSILON) * 100) / 100;

/* Values smaller than this are indistinguishable from zero for the traded size —
   mirrors `zero_eps` in app.py (an absolute $0.01 hid real P&L at small sizes). */
function zeroEps(d) {
  const data = d || DATA || {};
  return Math.max(1e-6, (data.spot || 0) * (data.contract_size || 0) * 1e-5);
}

function computeLegFees(legs, spot, cs, model, mode) {
  const m = Object.assign({}, DEFAULT_FEE_MODEL, model || {});
  const rate = mode === "maker" ? m.option_maker_rate : m.option_notional_rate;
  const raw = legs.map(l => l.opt_type === "underlying"
    ? m.spot_rate * spot * cs
    : Math.min(rate * spot * cs, m.option_premium_cap * (l.premium || 0) * cs));

  // RFQ groups: long/short x calls/puts
  const groups = {};
  legs.forEach((l, i) => {
    if (l.opt_type !== "underlying") groups[i] = (l.direction === "Buy" ? "long" : "short") + "_" + l.opt_type + "s";
  });

  const mult = {};
  if (mode === "rfq") {
    const totals = {};
    Object.entries(groups).forEach(([i, g]) => { totals[g] = (totals[g] || 0) + raw[i]; });
    const names = Object.keys(totals);
    if (names.length > 1) {
      // most expensive group pays full; then cheapest 100% off, 2nd/3rd 50% off
      const ranked = names.sort((a, b) => totals[a] - totals[b]).slice(0, -1);
      const disc = {};
      ranked.forEach((g, rank) => { disc[g] = rank === 0 ? 0 : (rank <= 2 ? 0.5 : 1); });
      Object.entries(groups).forEach(([i, g]) => { mult[i] = disc[g] !== undefined ? disc[g] : 1; });
    }
  }

  let baseTarget = null;
  const optionIdx = Object.keys(groups).map(Number);
  if (mode === "rfq" && optionIdx.length) {
    baseTarget = optionIdx.reduce((best, i) =>
      raw[i] * (mult[i] ?? 1) > raw[best] * (mult[best] ?? 1) ? i : best, optionIdx[0]);
  }

  return legs.map((l, i) => {
    let fee = raw[i] * (mult[i] ?? 1);
    if (mode === "taker" && l.opt_type !== "underlying") fee += m.option_base;
    if (i === baseTarget) fee += m.option_base;
    return { fee: round2(fee), discount: i in groups ? round2(1 - (mult[i] ?? 1)) : 0 };
  });
}

/* Chips for every other expiry, so a strategy can be compared across tenors. */
function renderCompareChips(){
  const row=document.getElementById("cmp-row"), box=document.getElementById("cmp-chips");
  const sel=document.getElementById("f-expiry");
  if(!row||!box||!sel) return;
  const current=sel.value;
  const others=[...sel.options].filter(o=>o.value&&o.value!==current);
  if(!current||!others.length){row.style.display="none";return;}
  row.style.display="flex";
  box.innerHTML=others.slice(0,8).map(o=>{
    const on=CMP_EXPIRIES.includes(o.value);
    const idx=on?CMP_EXPIRIES.indexOf(o.value)+1:0;
    const col=CMP_COLORS[idx]||CMP_COLORS[0];
    const label=o.textContent.replace(/\s*\(.*$/,"");
    const dte=(o.textContent.match(/\(([^)]*)\)/)||[])[1]||"";
    return `<span class="cmp-chip ${on?"on":""}" data-exp="${o.value}" onclick="toggleCompareExpiry('${o.value}')"
              style="${on?`background:${col};border-color:${col}`:""}" title="Compare this expiry side by side">
              <span class="dot"></span>${label} <span class="dte">${dte}</span></span>`;
  }).join("");
}

function toggleCompareExpiry(date){
  const i=CMP_EXPIRIES.indexOf(date);
  if(i>=0) CMP_EXPIRIES.splice(i,1);
  else{
    if(CMP_EXPIRIES.length>=MAX_COMPARE_EXPIRIES-1){ showToast(`Compare up to ${MAX_COMPARE_EXPIRIES} expiries`); return; }
    CMP_EXPIRIES.push(date);
  }
  renderCompareChips();
  if(DATA && document.getElementById("f-expiry").value) compute();
}

/* ═══ LIQUIDITY BADGE ═══
   A combination is only useful if it can be traded: a wide bid/ask eats the edge
   on entry and zero open interest means nobody to trade out with. */
const LIQ_STYLE = {
  good: { icon: "🟢", label: "Liquid",     bg: "var(--green-bg)", fg: "var(--green)" },
  fair: { icon: "🟡", label: "Thin",       bg: "var(--amber-bg)", fg: "var(--amber)" },
  poor: { icon: "🔴", label: "Illiquid",   bg: "var(--red-bg)",   fg: "var(--red)"   },
};
function liquidityBadge(liq) {
  if (!liq) return '<span style="color:var(--text-mute)">—</span>';
  const st = LIQ_STYLE[liq.rating] || LIQ_STYLE.poor;
  const spread = liq.spread_pct === null || liq.spread_pct === undefined ? "n/a" : liq.spread_pct.toFixed(1) + "%";
  const tip = `Worst leg spread ${spread} · min open interest ${fmtInt(liq.min_open_interest || 0)}`
            + (liq.quoted ? "" : " · not fully quoted");
  return `<span class="pct-tag" title="${tip}" style="background:${st.bg};color:${st.fg}">${st.icon} ${spread}</span>`;
}

/* ═══ PROBABILITY OF PROFIT (mirror of app.py) ═══
   Driftless lognormal: ln(S_T/S_0) ~ N(-σ²T/2, σ²T), the same assumption behind
   the Black-Scholes IVs the exchange quotes. */
function normCdf(x) {
  // Abramowitz & Stegun 26.2.17, |error| < 7.5e-8
  if (x < 0) return 1 - normCdf(-x);
  const b1=0.319381530,b2=-0.356563782,b3=1.781477937,b4=-1.821255978,b5=1.330274429,
        p=0.2316419,c=0.39894228,t=1/(1+p*x);
  return 1 - c*Math.exp(-x*x/2)*t*(t*(t*(t*(t*b5+b4)+b3)+b2)+b1);
}
function lognormalCdf(price, spot, sigma, tYears) {
  if (price <= 0) return 0;
  if (!isFinite(price)) return 1;
  const vol = sigma * Math.sqrt(tYears);
  if (vol <= 0) return price >= spot ? 1 : 0;
  return normCdf((Math.log(price / spot) + 0.5 * vol * vol) / vol);
}
function payoffAtPrice(legsDetail, spot, price, cs, fee) {
  let total = 0;
  for (const l of legsDetail) {
    const d = (l.direction === "Buy" || l.direction === "Long") ? 1 : -1;
    if (l.opt_type === "underlying") total += d * (price - spot);
    else if (l.opt_type === "call") total += d * (Math.max(price - l.strike, 0) - l.premium);
    else total += d * (Math.max(l.strike - price, 0) - l.premium);
  }
  return total * cs - fee;
}
function probabilityOfProfit(s, spot, cs) {
  const sigma = s.iv_avg, tYears = s.t_years;
  if (!sigma || sigma <= 0 || !tYears || tYears <= 0 || !s.legs_detail) return null;
  const edges = [0, ...[...(s.breakevens || [])].sort((a, b) => a - b), Infinity];
  let total = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const probe = isFinite(hi) ? (lo + hi) / 2 : spot * 3 + lo;
    if (payoffAtPrice(s.legs_detail, spot, probe, cs, s.total_fee || 0) > 0) {
      total += lognormalCdf(hi, spot, sigma, tYears) - lognormalCdf(lo, spot, sigma, tYears);
    }
  }
  return Math.round(Math.max(0, Math.min(1, total)) * 1000) / 10;
}

/* Recompute breakevens, distances and return percentages from the (fee-adjusted)
   payoff curve — needed because a flat fee changes them non-proportionally. */
function recalcDerivedMetrics(s, spot) {
  const chart = s.pnl_chart;
  if (chart && chart.prices && chart.pnl) {
    const prices = chart.prices, pnl = chart.pnl, bes = [];
    for (let i = 0; i < pnl.length - 1; i++) {
      if (pnl[i] * pnl[i + 1] < 0 && pnl[i + 1] !== pnl[i]) {
        bes.push(round2(prices[i] + (0 - pnl[i]) * (prices[i + 1] - prices[i]) / (pnl[i + 1] - pnl[i])));
      }
    }
    s.breakevens = bes;
    chart.breakevens = bes;
    s.distance = bes.map(be => {
      const pct = round2((be - spot) / spot * 100);
      return { price: be, pct: Math.abs(pct), label: pct > 0 ? "↑ to profit" : "↓ to profit" };
    });
  }
  const cap = s.total_cost;
  const eps = zeroEps();
  const clamp = v => Math.max(-999.9, Math.min(999.9, round2(v)));
  s.pop = probabilityOfProfit(s, (DATA || {}).spot, (DATA || {}).contract_size || 1);
  s.max_profit_pct = (s.max_profit_inf || !(cap > 0)) ? null : clamp(s.max_profit / cap * 100);
  if (s.max_loss_inf || !(cap > 0)) s.max_loss_pct = s.max_loss >= -eps ? 0.0 : null;
  else s.max_loss_pct = s.max_loss >= -eps ? 0.0 : clamp(s.max_loss / cap * 100);
}

function recomputeContractSize(newCS) {
  if (!DATA || !DATA.strategies || newCS <= 0) return;
  const oldCS = DATA.contract_size || 1;
  if (oldCS === newCS) return;
  const ratio = newCS / oldCS;
  const spot = DATA.spot;
  const feesOn = DATA.include_fees !== undefined ? DATA.include_fees : true;
  const model = DATA.fee_model;

  DATA.contract_size = newCS;
  DATA.strategies.forEach(s => {
    s.contract_size = newCS;
    const oldFee = s.total_fee || 0;
    let newFee = 0;
    if (s.legs_detail) {
      const computed = feesOn
        ? computeLegFees(s.legs_detail, spot, newCS, model, DATA.fee_mode || "taker")
        : s.legs_detail.map(() => ({ fee: 0, discount: 0 }));
      s.legs_detail.forEach((l, i) => { l.fee = computed[i].fee; l.fee_discount = computed[i].discount; newFee += l.fee; });
    }
    newFee = round2(newFee);

    // Everything except the flat part of the fee scales linearly with size.
    const rescale = v => (v + oldFee) * ratio - newFee;
    s.net_premium = round2(s.net_premium * ratio);
    s.total_cost = round2((s.total_cost - oldFee) * ratio + newFee);
    if (s.pnl_chart && s.pnl_chart.pnl) {
      s.pnl_chart.pnl = s.pnl_chart.pnl.map(v => rescale(v));
      // Re-read the extremes from the rescaled curve: the scalars coming from the
      // server may have been clamped to 0, which does not rescale correctly.
      // Unbounded extremes stay null — the UI renders them as ∞.
      s.max_profit = s.max_profit_inf ? null : round2(Math.max(...s.pnl_chart.pnl));
      s.max_loss = s.max_loss_inf ? null : round2(Math.min(...s.pnl_chart.pnl));
    } else {
      s.max_profit = s.max_profit_inf ? null : round2(rescale(s.max_profit));
      s.max_loss = s.max_loss_inf ? null : round2(rescale(s.max_loss));
    }
    const eps = zeroEps(DATA);
    if (!s.max_loss_inf && Math.abs(s.max_loss) <= eps) s.max_loss = 0;
    if (!s.max_profit_inf && Math.abs(s.max_profit) <= eps) s.max_profit = 0;
    s.total_fee = newFee;
    recalcDerivedMetrics(s, spot);
  });

  updateSizeUsd();
  render(DATA);
  if (CHART && CURR_STRAT) {
    drawChart(CURR_STRAT, parseInt(document.getElementById("chart-range")?.value) || SETTINGS.chartRange || 30);
  }
}

function render(d){
  document.getElementById("spot-box").style.display="flex";
  rollOdometer(document.getElementById("s-pr"), "$"+fmt(d.spot), 600, "spot_pr");
  document.getElementById("s-as").textContent=d.asset;
  rollOdometer(document.getElementById("s-exp"), d.expiry_display||d.expiry, 600, "spot_exp");
  rollOdometer(document.getElementById("s-cs"), d.contract_size+" "+d.asset, 500, "spot_cs");
  
  renderComparePanel(d);
  const comparing = !!d.compare;
  const maxLossLimit = parseFloat(document.getElementById("f-maxloss")?.value);
  let stratsToRender = d.strategies;
  if(!isNaN(maxLossLimit) && maxLossLimit > 0){
    stratsToRender = d.strategies.filter(s => {
      if(s.max_loss_inf) return false;                 // unlimited loss exceeds any limit
      if(s.max_loss === null || s.max_loss >= 0) return true;  // no loss at all
      if(s.max_loss_pct === null) return false;
      return Math.abs(s.max_loss_pct) <= maxLossLimit;
    });
  }

  const fltInfo = (!isNaN(maxLossLimit) && maxLossLimit > 0) ? `<span style="width:1px;height:14px;background:var(--border);margin:0 10px;opacity:.7"></span><span style="color:var(--text-dim);font-size:11px;font-weight:600">🛡️ ≤${maxLossLimit}% Loss Filter</span>` : "";
  let h=`<div class="rhdr"><h2>Strategy Analysis</h2><div class="combo-status-pill"><span class="odo-cell" data-key="header_cnt_s" data-val="${stratsToRender.length}" style="font-family:var(--font-mono);font-weight:800;color:var(--accent-l)">${stratsToRender.length}</span><span style="margin:0 4px;color:var(--text-mute)">/</span><span class="odo-cell" data-key="header_cnt_t" data-val="${d.strategies.length}" style="font-family:var(--font-mono);font-weight:800;color:var(--accent-l)">${d.strategies.length}</span><span style="margin-left:6px;color:var(--text);font-weight:700">Combos</span>${fltInfo}</div></div>`;
  if(!stratsToRender.length){
    h+=`<div class="empty" style="padding:40px 20px"><div class="ic">🛡️</div><div class="tt">No Combinations Pass Filter</div><div class="tx" style="margin-top:8px">None of the ${d.strategies.length} option combinations have a Max Loss ≤ <b>${maxLossLimit}%</b> of capital.<br>Try increasing your Max Loss limit or picking a different strategy.</div></div>`;
    document.getElementById("results").innerHTML=h;
    return;
  }

  h+=`<div class="tbl-wrap"><div class="tbl-scroll${stratsToRender.length > 12 ? " tall" : ""}"><table><thead><tr>
  ${comparing?`<th class="${sC('expiry')}" onclick="sortTable('expiry')">Expiry ${sI('expiry')}</th>`:""}
  <th class="${sC('strategy')}" onclick="sortTable('strategy')">Strategy ${sI('strategy')}</th><th>Contract Details</th>
  <th class="${sC('premium')}" onclick="sortTable('premium')">Net Premium ${sI('premium')}</th>
  <th class="${sC('cost')}" onclick="sortTable('cost')">Total Cost ${sI('cost')}</th>
  <th class="${sC('maxp')}" onclick="sortTable('maxp')">Max Profit ${sI('maxp')}</th>
  <th class="${sC('maxl')}" onclick="sortTable('maxl')">Max Loss ${sI('maxl')}</th>
  <th class="${sC('pop')}" onclick="sortTable('pop')" title="Chance the position expires profitable, from a lognormal model at the position's implied volatility">PoP ${sI('pop')}</th>
  <th class="${sC('liq')}" onclick="sortTable('liq')" title="Worst-leg bid/ask spread and open interest — how realistically this can be traded">Liq ${sI('liq')}</th>
  <th>Breakeven(s)</th><th>Distance</th><th></th></tr></thead><tbody>`;
  const rowsHtml = [];
  stratsToRender.forEach((s, idx)=>{
    const origIdx = d.strategies.indexOf(s);
    // Stable per-combo key: using the filtered row index made every number animate
    // from an unrelated row's previous value after sorting or filtering.
    const sKey = s.id + "#" + (s.legs_detail || []).map(l => (l.direction || "")[0] + (l.strike || "u")).join("_");
    let legsHtml='<div class="legs-col">';
    s.legs_detail.forEach(l=>{
      const isBuy=l.direction==="Buy"||l.direction==="Long";
      legsHtml+=`<div class="leg-line"><span class="leg-dir ${isBuy?"buy":"sell"}">${isBuy?"BUY":"SELL"}</span><span class="leg-contract">${l.description}</span>${l.opt_type!=="underlying"&&l.moneyness?`<span class="leg-mn ${l.moneyness.toLowerCase()}">${l.moneyness}</span>`:""}</div>`;
    });legsHtml+="</div>";
    let mnO=s.moneyness?`<span class="mn-badge ${s.moneyness.toLowerCase()}">${s.moneyness}</span>`:"";
    const pC=s.net_premium>=0?"m-negative":"m-positive";
    const pT=s.net_premium>=0?"-$"+fmt(Math.abs(s.net_premium)):"+$"+fmt(Math.abs(s.net_premium));
    const costStr = "$" + fmt(s.total_cost);
    // A combo can have a NEGATIVE max profit (it never pays off after crossing the
    // spread) — show it in red instead of pretending it breaks even.
    const mpNeg = !s.max_profit_inf && s.max_profit < 0;
    const mpVal = (mpNeg ? "-$" : "$") + fmt(Math.abs(s.max_profit));
    let mpH=s.max_profit_inf?UNLIM:`<span class="${mpNeg?"m-negative":"m-positive"} odo-cell" data-key="${sKey}_mp" data-val="${mpVal}">${mpVal}</span>${s.max_profit_pct!==null?`<span class="pct-tag ${mpNeg?"pct-neg":"pct-pos"} odo-cell" data-key="${sKey}_mppct" data-val="${fmtPct(s.max_profit_pct)}">${fmtPct(s.max_profit_pct)}</span>`:""}`;
    let mlH = s.max_loss_inf ? UNLIM : (s.max_loss >= -zeroEps(d) ? 
      `<span class="m-neutral odo-cell" style="color:var(--green)" data-key="${sKey}_ml" data-val="$0.00">$0.00</span><span class="pct-tag odo-cell" style="background:var(--green-bg);color:var(--green)" data-key="${sKey}_mlpct" data-val="0.00%">0.00%</span>` : 
      `<span class="m-negative odo-cell" data-key="${sKey}_ml" data-val="-$${fmt(Math.abs(s.max_loss))}">-$${fmt(Math.abs(s.max_loss))}</span>${s.max_loss_pct!==null?`<span class="pct-tag pct-neg odo-cell" data-key="${sKey}_mlpct" data-val="${fmtPct(s.max_loss_pct)}">${fmtPct(s.max_loss_pct)}</span>`:""}`);
    // Probability of profit — colour-scaled so a scan of the column is meaningful
    const popH = (s.pop === null || s.pop === undefined)
      ? '<span style="color:var(--text-mute)">—</span>'
      : `<span class="pct-tag odo-cell" data-key="${sKey}_pop" data-val="${s.pop.toFixed(1)}%" style="background:${s.pop>=60?"var(--green-bg)":s.pop>=40?"var(--amber-bg)":"var(--red-bg)"};color:${s.pop>=60?"var(--green)":s.pop>=40?"var(--amber)":"var(--red)"}">${s.pop.toFixed(1)}%</span>`;
    const bT=s.breakevens.length?s.breakevens.map((b, bi)=>`<span class="odo-cell" data-key="${sKey}_be_${bi}" data-val="$${fmt(b)}">${"$"+fmt(b)}</span>`).join(", "):" —";
    let dH=s.distance.length?s.distance.map((dd, di)=>`<div class="dist-item"><span class="dist-pct odo-cell" style="color:${dd.label.includes("profit")?"var(--green)":"var(--red)"}" data-key="${sKey}_dist_${di}" data-val="${dd.pct.toFixed(1)}%">${dd.pct.toFixed(1)}%</span><span class="dist-lb">${dd.label}</span></div>`).join(""):'<span class="dist-lb">—</span>';
    const delayMs = Math.min(idx * 180, 3600);
    rowsHtml.push(`<tr class="row-entry-anim" style="--row-delay:${delayMs}ms">
    ${comparing?`<td data-label="Expiry"><span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">
      <span style="width:8px;height:8px;border-radius:50%;background:${CMP_COLORS[(s.expiry_index||0)%CMP_COLORS.length]}"></span>
      <b>${s.expiry_display||s.expiry}</b><span style="color:var(--text-mute)">${s.expiry_days!==undefined?s.expiry_days+"d":""}</span></span></td>`:""}
    <td data-label="Strategy"><div style="display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap"><div style="text-align:left"><div class="strat-nm">${s.name}</div><div class="strat-dsc">${s.description}</div></div><div>${mnO}</div></div></td>
    <td data-label="Legs">${legsHtml}</td>
    <td data-label="Net Premium" class="${pC}"><span class="odo-cell" data-key="${sKey}_prem" data-val="${pT}">${pT}</span></td>
    <td data-label="Total Cost" class="m-neutral"><span class="odo-cell" data-key="${sKey}_cost" data-val="${costStr}">${costStr}</span></td>
    <td data-label="Max Profit">${mpH}</td>
    <td data-label="Max Loss">${mlH}</td>
    <td data-label="PoP">${popH}</td>
    <td data-label="Liquidity">${liquidityBadge(s.liquidity)}</td>
    <td data-label="Breakeven(s)">${bT}</td>
    <td data-label="Distance to Profit" class="dist-col">${dH}</td>
    <td data-label="Payoff Chart"><button class="chart-btn" onclick="openChart(${origIdx})">📈 P&L</button></td></tr>`);
  });
  h+="</tbody></table></div></div>";
  document.getElementById("results").innerHTML=h;
  mountRows(rowsHtml);
}

/* One payoff curve per expiry, overlaid: the best combination (highest PoP) of the
   selected strategy for each tenor, so the effect of time is visible at a glance. */
function renderComparePanel(d){
  const panel=document.getElementById("cmp-panel");
  if(!panel) return;
  if(!d.compare||!d.expiries||d.expiries.length<2){
    panel.style.display="none"; panel.innerHTML="";
    if(CMP_CHART){CMP_CHART.destroy();CMP_CHART=null;}
    return;
  }
  const best=d.expiries.map((e,i)=>{
    const pool=d.strategies.filter(s=>s.expiry===e.date);
    if(!pool.length) return null;
    const pick=pool.reduce((a,b)=>((b.pop??-1)>(a.pop??-1)?b:a));
    return {meta:e,strategy:pick,color:CMP_COLORS[i%CMP_COLORS.length]};
  }).filter(Boolean);
  if(best.length<2){panel.style.display="none";panel.innerHTML="";return;}

  const topPop=Math.max(...best.map(b=>b.strategy.pop??-1));
  panel.style.display="block";
  panel.innerHTML=`<div class="cmp-panel">
      <h3>📅 Expiry comparison — ${best[0].strategy.name}</h3>
      <div class="sub">Best combination by probability of profit for each expiry, at ${d.contract_size} ${d.asset} per contract.</div>
      <div class="cmp-chart"><canvas id="cmp-canvas"></canvas></div>
      <div class="cmp-legend">${best.map(b=>`<span class="item">
          <span class="swatch" style="background:${b.color}"></span>
          <b>${b.meta.display}</b> · ${b.meta.days}d · BE ${b.strategy.breakevens.length?"$"+fmt(b.strategy.breakevens[0]):"—"}
        </span>`).join("")}</div>
      <div class="cmp-metrics">${best.map(b=>{
        const s=b.strategy, isBest=(s.pop??-1)===topPop;
        return `<div class="cmp-metric ${isBest?"cmp-best":""}">
          <div class="hd" style="color:${b.color}">${b.meta.display} · ${b.meta.days}d ${isBest?'<span class="pct-tag pct-pos" style="margin-left:auto">Best PoP</span>':""}</div>
          <div class="rowline"><span>PoP</span><b>${s.pop===null||s.pop===undefined?"—":s.pop.toFixed(1)+"%"}</b></div>
          <div class="rowline"><span>${s.net_premium>=0?"Net debit":"Net credit"}</span><b>$${fmt(Math.abs(s.net_premium))}</b></div>
          <div class="rowline"><span>Capital</span><b>$${fmt(s.total_cost)}</b></div>
          <div class="rowline"><span>Max profit</span><b>${s.max_profit_inf?"∞":"$"+fmt(s.max_profit)}</b></div>
          <div class="rowline"><span>Max loss</span><b>${s.max_loss_inf?"∞":"-$"+fmt(Math.abs(s.max_loss||0))}</b></div>
          <div class="rowline"><span>Strikes</span><b>${(s.legs_detail||[]).filter(l=>l.opt_type!=="underlying").map(l=>fmtInt(l.strike)).join(" / ")||"—"}</b></div>
        </div>`;}).join("")}</div>
    </div>`;

  const cvs=document.getElementById("cmp-canvas");
  if(!cvs||typeof Chart==="undefined") return;
  if(CMP_CHART){CMP_CHART.destroy();CMP_CHART=null;}
  const spot=d.spot, cs=d.contract_size||1, range=CHART_RANGE||SETTINGS.chartRange||30;
  const grids=best.map(b=>{
    const legs=(b.strategy.legs_detail||[]).map(l=>({
      direction:(l.direction==="Buy"||l.direction==="Long")?1:-1,
      opt_type:l.opt_type,strike:l.strike,premium:l.premium}));
    return computePnL(legs,spot,range,200,cs,b.strategy.total_fee||0);
  });
  const labels=grids[0].prices.map(p=>"$"+fmtInt(p));
  const spotIdx=grids[0].prices.reduce((bi,p,i,arr)=>Math.abs(p-spot)<Math.abs(arr[bi]-spot)?i:bi,0);
  const spotColor=getComputedStyle(document.documentElement).getPropertyValue("--spot-marker").trim()||"#7c3aed";
  CMP_CHART=new Chart(cvs.getContext("2d"),{
    type:"line",
    data:{labels,datasets:[
      ...best.map((b,i)=>({label:`${b.meta.display} (${b.meta.days}d)`,data:grids[i].pnl,
        borderColor:b.color,borderWidth:2.5,pointRadius:0,pointHoverRadius:5,tension:.05,fill:false})),
      {label:"Zero",data:new Array(labels.length).fill(0),borderColor:"rgba(148,163,184,.3)",
        borderWidth:1.5,borderDash:[5,5],pointRadius:0,fill:false},
      {label:"Spot",data:labels.map((_,i)=>i===spotIdx?0:null),borderColor:"transparent",
        pointRadius:labels.map((_,i)=>i===spotIdx?7:0),pointBackgroundColor:spotColor,
        pointBorderColor:"#fff",pointBorderWidth:2,fill:false}
    ]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:300},
      interaction:{mode:"index",intersect:false},
      plugins:{legend:{display:false},
        tooltip:{backgroundColor:"rgba(15,23,42,.95)",displayColors:true,
          callbacks:{title:it=>"Price: $"+fmt(grids[0].prices[it[0].dataIndex]),
            label:it=>it.datasetIndex<best.length
              ? `${best[it.datasetIndex].meta.display}: ${it.raw>=0?"+$":"-$"}${fmt(Math.abs(it.raw))}` : null}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,color:"#94a3b8",font:{family:"'JetBrains Mono'",size:10}}},
              y:{grid:{color:"rgba(148,163,184,.08)"},ticks:{color:"#94a3b8",font:{family:"'JetBrains Mono'",size:10},
                 callback:v=>(v>=0?"$":"-$")+fmt(Math.abs(v))}}}}
  });
}

/* ═══ ROW RENDERING (windowed above VIRTUAL_ROW_THRESHOLD) ═══
   Large result sets used to put every row in the DOM at once. Above the
   threshold only the visible slice plus a buffer is materialised, with two
   spacer rows holding the scroll height, so raising MAX_COMBOS stays smooth. */
const VIRTUAL_ROW_THRESHOLD = 60;
const VIRTUAL_ROW_BUFFER = 8;
const FALLBACK_ROW_HEIGHT = 56;
let _virtual = null;

function animateRowNumbers(scope, offset = 0) {
  // Only the first rows get the digit-wheel treatment: each animated number
  // builds ~10 spans per digit, so animating hundreds of rows froze slow devices.
  scope.querySelectorAll("tr.row-entry-anim").forEach((row, i) => {
    const rowIdx = offset + i;
    const animate = rowIdx < ODO_MAX_ANIMATED_ROWS;
    const rowDelay = Math.min(rowIdx * 180, 3600);
    row.querySelectorAll(".odo-cell").forEach((el, cellIdx) => {
      if (!animate) {
        el.textContent = el.dataset.val;
        if (el.dataset.key) {
          if (!window._lastOdoValues) window._lastOdoValues = {};
          window._lastOdoValues[el.dataset.key] = el.dataset.val;
        }
        return;
      }
      setTimeout(() => rollOdometer(el, el.dataset.val, 850, el.dataset.key),
                 rowDelay + Math.min(cellIdx * 40, 300) + 120);
    });
  });
}

function mountRows(rowsHtml) {
  const tbody = document.querySelector("#results tbody");
  const scroller = document.querySelector("#results .tbl-scroll");
  if (!tbody) return;
  _virtual = null;

  if (rowsHtml.length <= VIRTUAL_ROW_THRESHOLD || !scroller) {
    tbody.innerHTML = rowsHtml.join("");
    animateRowNumbers(tbody);
    return;
  }

  // measure one real row, then window the rest
  tbody.innerHTML = rowsHtml[0];
  const probe = tbody.querySelector("tr");
  const measured = probe ? probe.getBoundingClientRect().height : 0;
  const rowHeight = measured > 4 ? measured : FALLBACK_ROW_HEIGHT;
  const viewport = scroller.clientHeight || Math.round(window.innerHeight * 0.75) || 600;

  _virtual = {
    rows: rowsHtml, tbody, scroller, rowHeight,
    visible: Math.max(6, Math.ceil(viewport / rowHeight) + VIRTUAL_ROW_BUFFER * 2),
    start: -1, ticking: false,
  };
  scroller.onscroll = () => {
    if (!_virtual || _virtual.ticking) return;
    _virtual.ticking = true;
    requestAnimationFrame(() => { _virtual.ticking = false; paintVirtualWindow(); });
  };
  paintVirtualWindow();
}

function paintVirtualWindow() {
  const v = _virtual;
  if (!v) return;
  // Clamp the window: an over-scrolled container (or a stale scrollTop) must never
  // slice past the end of the list, which would render an empty table.
  const maxStart = Math.max(0, v.rows.length - v.visible);
  const first = Math.min(maxStart,
    Math.max(0, Math.floor(v.scroller.scrollTop / v.rowHeight) - VIRTUAL_ROW_BUFFER));
  if (first === v.start) return;
  v.start = first;
  const last = Math.min(v.rows.length, first + v.visible);
  const above = first * v.rowHeight;
  const below = Math.max(0, (v.rows.length - last) * v.rowHeight);
  const spacer = px => `<tr class="v-spacer" aria-hidden="true"><td colspan="12" style="padding:0;border:none;height:${px}px"></td></tr>`;
  v.tbody.innerHTML = (above ? spacer(above) : "")
    + v.rows.slice(first, last).join("")
    + (below ? spacer(below) : "");
  animateRowNumbers(v.tbody, first);
}

/* Jump from the reference tab straight into the analyzer for that strategy */
function analyzeFromGuide(id){
  switchTab("analyzer");
  renderChips();
  selectStrategy(id);
  document.getElementById("chips")?.scrollIntoView({behavior:"smooth", block:"center"});
}

/* STRATEGIES GUIDE */
function renderStratsGuide(){
  let h='<h2 style="font-size:18px;font-weight:800;margin-bottom:4px">Strategies Reference</h2><p style="color:var(--text-dim);font-size:13px;margin-bottom:16px">Quick reference for all supported options strategies.</p><div class="strat-grid">';
  STRATS.forEach(s=>{
    let legsHtml=s.legs.map(l=>{
      const isBuy=l.dir==="buy"||l.dir==="hold";
      const dLabel=isBuy?"Buy":"Sell";
      const dCls=isBuy?"buy":"sell";
      let desc=l.type==="underlying"?"Underlying Asset":l.type.charAt(0).toUpperCase()+l.type.slice(1)+" Option";
      return`<div class="leg-row"><span class="dir ${dCls}">${dLabel}</span><span>${desc}</span></div>`;
    }).join("");
    let featuresHtml=s.features?s.features.map(f=>`<span class="feat">${f}</span>`).join(""):"";
    let miniChart=MINI_CHARTS[s.id]||"";
    h+=`<div class="strat-card" role="button" tabindex="0" title="Analyze this strategy" onclick="analyzeFromGuide('${s.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();analyzeFromGuide('${s.id}')}" style="cursor:pointer">
      <h3>${s.emoji} ${s.name}</h3>
      <div class="market">${s.market||s.risk}</div>
      <div class="desc">${s.description}</div>
      <div class="legs-label">Legs</div>${legsHtml}
      ${featuresHtml?`<div class="features">${featuresHtml}</div>`:""}
      ${miniChart?`<div class="mini-chart">${miniChart}</div>`:""}
    </div>`;
  });h+="</div>";
  document.getElementById("tab-strategies").innerHTML=h;
}

/* MODAL */
/* ═══ REAL EXCHANGE MARGIN (public/get_margin) ═══
   Our "Capital" figure is an estimate; Derive's own margin engine is usually much
   lower for defined-risk and credit strategies. Fetched on demand for the open
   strategy only, so one click = one upstream request (Derive allows 5 reads/s). */
async function fetchExchangeMargin(){
  const btn = document.getElementById("btn-margin");
  const card = document.getElementById("m-capital");
  if(!CURR_STRAT || !DATA || !card) return;
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spin" style="width:10px;height:10px;border-width:2px;margin:0"></span> …'; }
  try{
    const r = await (await fetch("/api/margin",{method:"POST",headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        asset: DATA.asset,
        contract_size: DATA.contract_size,
        margin_type: (document.getElementById("set-margintype")?.value || SETTINGS.marginType || "SM"),
        legs: (CURR_STRAT.legs_detail||[]).map(l=>({name:l.name, direction:l.direction, opt_type:l.opt_type}))
      })})).json();
    if(r.error) throw new Error(r.error);
    const diff = CURR_STRAT.total_cost - r.required_collateral;
    card.querySelector(".vl-pct").innerHTML =
      `<span title="Net initial margin $${fmt(r.net_initial_margin)} = mark-to-market minus requirement. Maintenance: $${fmt(r.maintenance_collateral)}">`
      + `⚖️ ${r.margin_type}: <b style="color:var(--accent-l)">$${fmt(r.required_collateral)}</b>`
      + (Math.abs(diff) > 0.01 ? ` <span style="color:var(--text-mute)">(${diff>0?"−":"+"}$${fmt(Math.abs(diff))} vs estimate)</span>` : "")
      + `</span>`;
  }catch(e){
    if(btn){ btn.innerHTML = "⚠️ " + String(e.message || "failed").slice(0,40); btn.disabled = false; }
  }
}

/* ═══ ORDER TICKET ═══
   What the trader actually has to do: side, quantity, the price that side of the
   book is showing, and the cash that moves for each leg. Previously the table only
   showed a per-unit premium (and nothing at all for a held underlying), so it was
   impossible to tell how much to buy or at what price. */
const PRICE_SOURCE_LABEL = { ask: "ask", bid: "bid", mark: "mark", index: "index", none: "—" };

function legOrderRows(s, cs, spot, asset) {
  return (s.legs_detail || []).map(l => {
    const isBuy = l.direction === "Buy" || l.direction === "Long";
    const isUnderlying = l.opt_type === "underlying";
    const price = isUnderlying ? spot : l.premium;
    const source = isUnderlying ? "index" : (l.premium_source || "mark");
    const cash = price * cs * (isBuy ? -1 : 1);          // negative = money out
    return {
      leg: l, isBuy, isUnderlying, price, source, cash,
      qty: cs,
      qtyLabel: isUnderlying ? `${cs} ${asset}` : `${cs}`,
      instrument: isUnderlying ? `${asset} spot` : l.name,
      fee: l.fee || 0,
    };
  });
}

function liqRatingFor(leg) {
  const l = leg.liquidity || {};
  if (!l.quoted || l.spread_pct === null || l.spread_pct === undefined) return "poor";
  if (l.spread_pct <= 5 && (l.open_interest || 0) >= 50) return "good";
  if (l.spread_pct <= 15 && (l.open_interest || 0) >= 5) return "fair";
  return "poor";
}

function renderOrderTicket(s, cs) {
  const ge = document.getElementById("m-greeks");
  if (!ge) return;
  if (!s.legs_detail || !s.legs_detail.length) { ge.innerHTML = ""; return; }

  const asset = DATA.asset, spot = DATA.spot;
  const rows = legOrderRows(s, cs, spot, asset);
  const netCash = rows.reduce((a, r) => a + r.cash, 0);
  const totalFee = rows.reduce((a, r) => a + r.fee, 0);
  const showFees = s.total_fee > 0;

  const money = v => (v < 0 ? "-$" : "$") + fmt(Math.abs(v));
  const cell = (label, html, extra = "") => `<td data-label="${label}"${extra}>${html}</td>`;

  let h = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:16px 0 10px">
      <h4 style="color:var(--text-dim);font-size:13px;font-weight:700;margin:0">
        🧾 Order Ticket — what to trade for ${cs} ${asset} per contract
      </h4>
      <button class="chart-btn" onclick="copyOrderTicket()" style="padding:3px 10px;font-size:11px" title="Copy the ticket as text">📋 Copy ticket</button>
    </div>
    <div class="tbl-scroll"><table class="g-tbl"><thead><tr>
      <th>Action</th><th>Instrument</th><th>Amount</th><th>Unit price</th><th>Book</th>
      <th>Cash</th>${showFees ? "<th>Fee</th>" : ""}
      <th title="Position greeks: per-unit value x amount x direction">Δ pos</th>
      <th>Γ pos</th><th>Θ /day</th><th>ν /1%</th><th>IV</th><th>Liquidity</th>
    </tr></thead><tbody>`;

  rows.forEach(r => {
    const g = r.leg.greeks || {};
    const sign = r.isBuy ? 1 : -1;
    const pos = (v, digits) => v === undefined ? "—" : (sign * v * cs).toFixed(digits);
    const mn = r.leg.moneyness
      ? `<span class="leg-mn ${r.leg.moneyness.toLowerCase()}">${r.leg.moneyness}</span>` : "";
    h += "<tr>"
      + cell("Action", `<span class="leg-dir ${r.isBuy ? "buy" : "sell"}">${r.isBuy ? "BUY" : "SELL"}</span>`)
      + cell("Instrument", `<span class="ln">${r.instrument}</span> ${mn}`)
      + cell("Amount", `<b>${r.qtyLabel}</b>${r.isUnderlying ? "" : ` <span style="color:var(--text-mute);font-size:10px">contracts</span>`}`)
      + cell("Price", `$${fmt(r.price)}`, ' style="font-weight:700"')
      + cell("Book", `<span style="color:var(--text-mute);font-size:11px">${PRICE_SOURCE_LABEL[r.source] || r.source}</span>`)
      + cell("Cash", `<span style="color:var(--${r.cash < 0 ? "red" : "green"});font-weight:700">${money(r.cash)}</span>`)
      + (showFees ? cell("Fee", r.isUnderlying
          ? `<span style="color:var(--green)">free</span>`
          : `<span style="color:var(--red)">-$${fmt(r.fee)}</span>`
            + (r.leg.fee_discount ? ` <span style="color:var(--green);font-size:10px">(-${Math.round(r.leg.fee_discount * 100)}%)</span>` : "")) : "")
      + cell("Δ pos", pos(g.delta, 4))
      + cell("Γ pos", r.isUnderlying ? "—" : pos(g.gamma, 6))
      + cell("Θ /day", r.isUnderlying ? "—" : pos(g.theta, 4))
      + cell("ν /1%", r.isUnderlying ? "—" : pos(g.vega, 4))
      + cell("IV", r.isUnderlying || g.iv === undefined ? "—" : (g.iv * 100).toFixed(1) + "%")
      + cell("Liquidity", r.isUnderlying ? "—" : liquidityBadge(Object.assign(
          { rating: liqRatingFor(r.leg), min_open_interest: (r.leg.liquidity || {}).open_interest },
          r.leg.liquidity || {})))
      + "</tr>";
  });

  const span = showFees ? 5 : 5;
  h += `<tr style="border-top:2px solid var(--border);font-weight:800;background:var(--bg-card2)">
      ${cell("Total", `<span style="color:var(--text)">Net</span>`)}
      <td colspan="${span - 1}" style="color:var(--text-dim)">${netCash < 0 ? "you pay" : "you receive"} for the whole structure</td>
      ${cell("Cash", `<span style="color:var(--${netCash < 0 ? "red" : "green"})">${money(netCash)}</span>`)}
      ${showFees ? cell("Fee", `<span style="color:var(--red)">-$${fmt(totalFee)}</span>`) : ""}
      <td colspan="5" style="color:var(--text-dim);font-weight:600">
        after fees ${money(netCash - totalFee)} • capital required ${"$" + fmt(s.total_cost)}
      </td>
    </tr>`;
  h += `</tbody></table></div>
    <div style="font-size:11px;color:var(--text-mute);margin-top:8px;line-height:1.7">
      Unit price is the executable side of the book (buys lift the <b>ask</b>, sells hit the <b>bid</b>;
      the underlying is priced at the <b>index</b>). <b>Cash = unit price × amount</b> for that leg —
      negative means money leaves your account. Greeks are position greeks: already multiplied by the
      amount and the direction.
    </div>`;
  if (s.liquidity && s.liquidity.rating === "poor") {
    h += `<div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:var(--red-bg);
           border:1px solid var(--red);color:var(--red);font-size:11px;font-weight:700">
           ⚠️ Thin market: worst leg spread ${s.liquidity.spread_pct === null ? "not quoted" : s.liquidity.spread_pct.toFixed(1) + "%"},
           minimum open interest ${fmtInt(s.liquidity.min_open_interest || 0)} — the fills above may not be achievable.
         </div>`;
  }
  ge.innerHTML = h;
}

function orderTicketText(s, cs) {
  const asset = DATA.asset;
  const rows = legOrderRows(s, cs, DATA.spot, asset);
  const lines = rows.map(r =>
    `${(r.isBuy ? "BUY " : "SELL")}  ${r.qtyLabel.padEnd(12)} ${r.instrument.padEnd(28)} @ $${fmt(r.price)} (${r.source})`
    + `   ${r.cash < 0 ? "-" : "+"}$${fmt(Math.abs(r.cash))}`);
  const netCash = rows.reduce((a, r) => a + r.cash, 0);
  return [
    `${s.name} — ${asset} ${DATA.expiry_display || DATA.expiry} — ${cs} ${asset} per contract`,
    ...lines,
    `Net ${netCash < 0 ? "debit" : "credit"}: $${fmt(Math.abs(netCash))}`
    + (s.total_fee > 0 ? `   Fees: $${fmt(s.total_fee)}` : "")
    + `   Capital: $${fmt(s.total_cost)}`,
  ].join("\n");
}

async function copyOrderTicket() {
  if (!CURR_STRAT || !DATA) return;
  const text = orderTicketText(CURR_STRAT, DATA.contract_size);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Order ticket copied");
  } catch (e) {
    showToast("Could not copy — select the table instead");
  }
}

function showToast(msg) {
  let t = document.getElementById("mini-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "mini-toast";
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10000;"
      + "background:var(--bg-card2);border:1px solid var(--accent);color:var(--text);padding:8px 16px;"
      + "border-radius:20px;font-size:12px;font-weight:700;box-shadow:0 8px 30px rgba(0,0,0,.45);"
      + "opacity:0;transition:opacity .2s";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => { t.style.opacity = "1"; });
  clearTimeout(t._hide);
  t._hide = setTimeout(() => { t.style.opacity = "0"; }, 2200);
}

function openChart(i){
  if(!DATA||!DATA.strategies[i])return;
  const s=DATA.strategies[i];document.getElementById("overlay").classList.add("on");
  document.getElementById("m-title").textContent=s.name+" — P&L at Expiration";
  const cs=DATA.contract_size,csLabel=cs+" "+DATA.asset;
  const mpVL=s.max_profit_inf?"∞ Unlimited":(s.max_profit<0?"-$"+fmt(Math.abs(s.max_profit)):"$"+fmt(s.max_profit));
  const mpPct=s.max_profit_pct!==null?fmtPct(s.max_profit_pct)+" return":"Unlimited";
  const isNoLoss = !s.max_loss_inf && s.max_loss >= -zeroEps();
  const mlVL = s.max_loss_inf ? "∞ Unlimited" : (isNoLoss ? "$0.00" : "-$"+fmt(Math.abs(s.max_loss)));
  const mlPct = s.max_loss_inf ? "Unlimited" : (isNoLoss ? "0.00% (No Loss)" : (s.max_loss_pct!==null?fmtPct(s.max_loss_pct):"Unlimited"));
  document.getElementById("m-metrics").innerHTML=`
    <div class="m-card ${(!s.max_profit_inf && s.max_profit < 0) ? 'loss' : 'profit'}"><div class="lb">Max Profit</div><div class="vl">${mpVL}</div><div class="vl-pct">${mpPct}</div></div>
    <div class="m-card ${isNoLoss ? 'profit' : 'loss'}"><div class="lb">Max Loss</div><div class="vl">${mlVL}</div><div class="vl-pct">${mlPct}</div></div>
    <div class="m-card neu"><div class="lb">Spot</div><div class="vl">$${fmt(DATA.spot)}</div></div>
    ${s.liquidity ? `<div class="m-card neu"><div class="lb">Liquidity</div><div class="vl" style="font-size:16px">${(LIQ_STYLE[s.liquidity.rating]||LIQ_STYLE.poor).icon} ${(LIQ_STYLE[s.liquidity.rating]||LIQ_STYLE.poor).label}</div><div class="vl-pct">${s.liquidity.spread_pct===null?"not quoted":s.liquidity.spread_pct.toFixed(1)+"% spread"} · OI ${fmtInt(s.liquidity.min_open_interest||0)}</div></div>` : ""}
    ${s.pop !== null && s.pop !== undefined ? `<div class="m-card ${s.pop>=60?'profit':s.pop>=40?'neu':'loss'}"><div class="lb">Prob. of Profit</div><div class="vl">${s.pop.toFixed(1)}%</div><div class="vl-pct">at ${(s.iv_avg*100).toFixed(1)}% IV, ${(s.t_years*365).toFixed(1)}d</div></div>` : ""}
    <div class="m-card ${s.net_premium>=0?'loss':'profit'}"><div class="lb">Premium (${csLabel})</div><div class="vl">${s.net_premium>=0?'-':'+'}$${fmt(Math.abs(s.net_premium))}</div><div class="vl-pct">${s.net_premium>=0?'Debit':'Credit'}</div></div>
    <div class="m-card neu" id="m-capital"><div class="lb">Capital</div><div class="vl">$${fmt(s.total_cost)}</div><div class="vl-pct" style="display:flex;align-items:center;gap:6px;justify-content:center;flex-wrap:wrap"><span>estimate</span><button class="chart-btn" id="btn-margin" onclick="fetchExchangeMargin()" title="Ask Derive's margin simulator what this position really requires" style="padding:2px 8px;font-size:10px">⚖️ Exchange margin</button></div></div>
    ${s.total_fee > 0 ? `<div class="m-card loss"><div class="lb">Trading Fees</div><div class="vl">-$${fmt(s.total_fee)}</div><div class="vl-pct">Derive Taker/Spot</div></div>` : ""}
    ${s.breakevens.map(be=>`<div class="m-card neu"><div class="lb">Breakeven</div><div class="vl">$${fmt(be)}</div></div>`).join("")}`;
  renderOrderTicket(s, cs);
  {const rv=document.getElementById("chart-range");if(rv){rv.value=CHART_RANGE||SETTINGS.chartRange||30;document.getElementById("range-val").textContent="±"+rv.value+"%"}}
  drawChart(s, parseInt(document.getElementById("chart-range")?.value) || SETTINGS.chartRange || 30);
}

function computePnL(legs, spot, rangePct = 30, steps = 300, cs = 1, totalFee = 0) {
  const lo = spot * (1 - rangePct / 100);
  const hi = spot * (1 + rangePct / 100);
  const step = (hi - lo) / (steps - 1);
  const prices = [];
  const pnl = [];
  for (let i = 0; i < steps; i++) {
    const price = lo + i * step;
    prices.push(price);
    let total = 0.0;
    for (const l of legs) {
      const d = l.direction;
      const ot = l.opt_type;
      const k = l.strike;
      const p = l.premium;
      if (ot === "underlying") total += d * (price - spot);
      else if (ot === "call") total += d * (Math.max(price - k, 0) - p);
      else if (ot === "put") total += d * (Math.max(k - price, 0) - p);
    }
    pnl.push((total * cs) - totalFee);
  }
  return { prices, pnl };
}

function onRangeChange(val) {
  const rv = document.getElementById("chart-range");
  const rVal = parseInt(rv ? rv.value : val) || 30;
  document.getElementById("range-val").textContent = "±" + rVal + "%";
  // Session-only: dragging the slider must not silently rewrite the user's saved
  // "Default Chart Range" setting (and must not hammer localStorage on every pixel).
  CHART_RANGE = rVal;
  if (CURR_STRAT) drawChart(CURR_STRAT, rVal);
}

function drawChart(s, rangePct = 30) {
  if (!s || !DATA) return;
  CURR_STRAT = s;
  const spot = DATA.spot;
  const cs = DATA.contract_size || 1;

  const legs = (s.legs_detail || []).map(l => ({
    direction: (l.direction === "Buy" || l.direction === "Long") ? 1 : -1,
    opt_type: l.opt_type,
    strike: l.strike,
    premium: l.premium
  }));

  // The ±range% slider now always plots exactly that window (previously the server's
  // strike-based grid was used at 30, so the chart spanned e.g. -32%..+53% while the
  // label said ±30%, and nudging the slider made the axis jump).
  // "Fit to strikes" opts into the strike-based window instead.
  const fitStrikes = document.getElementById("fit-strikes")?.checked;
  const slider = document.getElementById("chart-range");
  const rangeLabel = document.getElementById("range-val");
  let prices, pnl;
  if (fitStrikes && s.pnl_chart && s.pnl_chart.prices) {
    prices = s.pnl_chart.prices;
    pnl = s.pnl_chart.pnl;
    if (slider) slider.disabled = true;
    if (rangeLabel) rangeLabel.textContent = "Auto";
  } else {
    const res = computePnL(legs, spot, rangePct, 300, cs, s.total_fee || 0);
    prices = res.prices;
    pnl = res.pnl;
    if (slider) slider.disabled = false;
    if (rangeLabel) rangeLabel.textContent = "±" + rangePct + "%";
  }

  const labels = prices.map(p => "$" + fmtInt(p));

  let si = 0, md = Infinity;
  prices.forEach((p, i) => { if (Math.abs(p - spot) < md) { md = Math.abs(p - spot); si = i; } });

  const cvs = document.getElementById("pnl-canvas");
  if (!cvs) return;
  const ctx = cvs.getContext("2d");

  if (CHART) { CHART.destroy(); CHART = null; }

  const spotColor = getComputedStyle(document.documentElement).getPropertyValue('--spot-marker').trim() || '#8b5cf6';

  CHART = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "P&L",
          data: pnl,
          borderWidth: 3.5,
          segment: { borderColor: c => (c.p1.parsed.y >= 0 ? "#22c55e" : "#ef4444") },
          backgroundColor: "transparent",
          pointRadius: prices.map((p, i) => (i === si ? 8 : 0)),
          pointBackgroundColor: prices.map((p, i) => (i === si ? spotColor : "transparent")),
          pointBorderColor: prices.map((p, i) => (i === si ? "#ffffff" : "transparent")),
          pointBorderWidth: prices.map((p, i) => (i === si ? 2.5 : 0)),
          pointHoverRadius: 7,
          pointHoverBackgroundColor: "#ffffff",
          pointHoverBorderColor: c => (c.raw >= 0 ? "#22c55e" : "#ef4444"),
          pointHoverBorderWidth: 3,
          tension: 0.05,
          fill: false
        },
        {
          label: "Zero",
          data: new Array(prices.length).fill(0),
          borderColor: "rgba(148,163,184,0.25)",
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: "transparent",
          pointHoverBorderColor: "rgba(148,163,184,0.5)",
          pointHoverBorderWidth: 2,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#ffffff",
          titleFont: { family: "'JetBrains Mono', monospace", size: 14, weight: "800" },
          titleAlign: "left",
          titleMarginBottom: 10,
          bodyColor: "#cbd5e1",
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12, weight: "500", lineHeight: 1.6 },
          bodyAlign: "left",
          bodySpacing: 6,
          padding: { top: 14, right: 18, bottom: 14, left: 18 },
          cornerRadius: 10,
          borderColor: "rgba(255, 255, 255, 0.12)",
          borderWidth: 1,
          displayColors: false,
          caretSize: 8,
          caretPadding: 10,
          callbacks: {
            title: items => {
              const idx = items[0].dataIndex;
              const p = prices[idx];
              return "Price: $" + fmt(p);
            },
            label: item => {
              if (item.datasetIndex !== 0) return null;
              const idx = item.dataIndex;
              const p = prices[idx];
              const val = pnl[idx];
              const cap = s.total_cost || 1;
              const retPct = cap > 0 ? ((val / cap) * 100).toFixed(2) : "0.00";
              const movePct = (((p - spot) / spot) * 100).toFixed(2);
              const moveUsd = p - spot;

              const pnlStr = "P&L:  " + (val >= 0 ? "+$" : "-$") + fmt(Math.abs(val));
              const retStr = "Return:  " + (val >= 0 ? "+" : "") + retPct + "% of $" + fmt(cap) + " capital";
              const moveStr = "Asset Move:  " + (movePct >= 0 ? "+" : "") + movePct + "% (" + (moveUsd >= 0 ? "+$" : "-$") + fmt(Math.abs(moveUsd)) + ")";

              return [pnlStr, retStr, moveStr];
            }
          }
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#64748b",
            font: { family: "'JetBrains Mono'", size: 10 },
            maxRotation: 45,
            minRotation: 45,
            autoSkip: true,
            maxTicksLimit: 32
          }
        },
        y: {
          grid: { display: false },
          ticks: {
            color: "#64748b",
            font: { family: "'JetBrains Mono'", size: 11 },
            callback: val => val
          }
        }
      }
    }
  });
}

function closeModal(){
  document.getElementById("overlay").classList.remove("on");
  if(CHART){CHART.destroy();CHART=null}
}
document.getElementById("overlay").addEventListener("click",function(e){if(e.target===this)closeModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(document.getElementById("share-preview-modal")?.style.display!=="none"&&document.getElementById("share-preview-modal")?.classList.contains("on")){closeShareModal();}else{closeModal();}}});
function showErr(m){const e=document.getElementById("err");e.textContent=m;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),8000)}
function hideErr(){document.getElementById("err").classList.remove("show")}
if(SETTINGS.refreshInterval>0)startAutoRefresh();

/* STRATEGY CARD IMAGE GENERATOR & SOCIAL EXPORT ENGINE */
async function exportStrategyCard() {
  if (!CHART || !CURR_STRAT || !DATA) return;
  const btn = document.getElementById("btn-export");
  const oldText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" style="width:14px;height:14px;border-width:2px;margin:0"></span> Generating 1080p Card…';

  try {
    const s = CURR_STRAT;
    const spot = DATA.spot;
    const asset = DATA.asset;
    const cs = DATA.contract_size;
    const exp = DATA.expiry_display || DATA.expiry;

    // Create 1920 x 1080 Full-HD Retina Canvas (Exact Twitter/Telegram/LinkedIn Native Resolution)
    const cvs = document.createElement("canvas");
    cvs.width = 1920;
    cvs.height = 1080;
    const ctx = cvs.getContext("2d");

    // 1. Draw Background Gradient
    const theme = SETTINGS.theme || "dark";
    const pal = SETTINGS.palette || "default";
    let bgGrad = ctx.createLinearGradient(0, 0, 1920, 1080);
    if (theme === "oled" || theme === "contrast") {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 1920, 1080);
    } else if (pal === "emerald") {
      bgGrad.addColorStop(0, "#050c0a"); bgGrad.addColorStop(0.5, "#06110f"); bgGrad.addColorStop(1, "#050e0c");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 1920, 1080);
    } else if (pal === "sunset") {
      bgGrad.addColorStop(0, "#0d0712"); bgGrad.addColorStop(0.5, "#160818"); bgGrad.addColorStop(1, "#0f0714");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 1920, 1080);
    } else if (pal === "gold") {
      bgGrad.addColorStop(0, "#0c0a06"); bgGrad.addColorStop(0.5, "#120f08"); bgGrad.addColorStop(1, "#0a0805");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 1920, 1080);
    } else if (pal === "ocean") {
      bgGrad.addColorStop(0, "#050a12"); bgGrad.addColorStop(0.5, "#070f1a"); bgGrad.addColorStop(1, "#060c16");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 1920, 1080);
    } else if (pal === "cyberpunk") {
      bgGrad.addColorStop(0, "#090314"); bgGrad.addColorStop(0.5, "#0c041a"); bgGrad.addColorStop(1, "#0b0216");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 1920, 1080);
    } else {
      bgGrad.addColorStop(0, "#070b14"); bgGrad.addColorStop(0.5, "#0a0e1a"); bgGrad.addColorStop(1, "#080c16");
      ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 1920, 1080);
    }

    // 2. Draw Glowing Background Orbs (1.6x scaled)
    if (theme !== "contrast" && SETTINGS.orbs) {
      const getAccentHex = () => {
        if(pal==="emerald") return ["#10b981", "#06b6d4"];
        if(pal==="sunset") return ["#f43f5e", "#fb923c"];
        if(pal==="gold") return ["#f59e0b", "#d97706"];
        if(pal==="ocean") return ["#06b6d4", "#3b82f6"];
        if(pal==="cyberpunk") return ["#ec4899", "#22d3ee"];
        return ["#3b82f6", "#8b5cf6"];
      };
      const [acc1, acc2] = getAccentHex();
      const drawOrb = (cx, cy, r, color, alpha) => {
        const rad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        rad.addColorStop(0, color + (Math.round(alpha*255).toString(16).padStart(2,'0')));
        rad.addColorStop(1, color + "00");
        ctx.fillStyle = rad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      };
      drawOrb(240, 160, 720, acc1, theme==="oled"?0.12:0.25);
      drawOrb(1680, 880, 640, acc2, theme==="oled"?0.10:0.22);
    }

    // 3. Draw Top Header Bar (Delta Logo & Branding)
    const logoGrad = ctx.createLinearGradient(64, 52, 140, 128);
    logoGrad.addColorStop(0, "#2563eb"); logoGrad.addColorStop(1, "#7c3aed");
    ctx.fillStyle = logoGrad;
    ctx.beginPath(); ctx.roundRect(64, 52, 76, 76, 18); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 44px Inter, Arial, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Δ", 102, 90);

    ctx.textAlign = "left";
    ctx.font = "800 42px Inter, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Option Strategy Analyzer", 166, 76);
    ctx.font = "600 22px Inter, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("Powered by Derive.xyz — Institutional Onchain Options", 166, 114);

    // Right Date Badge
    ctx.fillStyle = "rgba(30, 41, 59, 0.85)";
    ctx.strokeStyle = "rgba(51, 65, 85, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(1560, 60, 296, 60, 16); ctx.fill(); ctx.stroke();
    ctx.font = "700 22px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#60a5fa";
    ctx.textAlign = "center";
    ctx.fillText(asset + " • " + new Date().toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}), 1708, 91);

    // 4. Draw Strategy Name & Details
    ctx.textAlign = "left";
    ctx.font = "900 54px Inter, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s.name, 64, 224);

    ctx.font = "600 24px Inter, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`Expiry: ${exp}   |   Contract Size: ${cs} ${asset}   |   Spot Price: $${fmt(spot)}`, 64, 268);

    // 5. Draw 5 Metrics Boxes
    const drawMetricBox = (x, y, w, h, label, val, subVal, valColor) => {
      ctx.fillStyle = "rgba(17, 24, 39, 0.75)";
      ctx.strokeStyle = "rgba(51, 65, 85, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.fill(); ctx.stroke();

      ctx.textAlign = "center";
      ctx.font = "800 18px Inter, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(label.toUpperCase(), x + w/2, y + 40);

      // Shrink to fit: two breakevens with cents are far wider than the box.
      const fitFont = (text, weight, startPx, family, maxW) => {
        let px = startPx;
        ctx.font = `${weight} ${px}px ${family}`;
        while (ctx.measureText(text).width > maxW && px > 12) {
          px -= 1;
          ctx.font = `${weight} ${px}px ${family}`;
        }
      };
      fitFont(val, 900, 35, "'JetBrains Mono', monospace", w - 28);
      ctx.fillStyle = valColor;
      ctx.fillText(val, x + w/2, y + 86);

      if (subVal) {
        fitFont(subVal, 600, 19, "Inter, sans-serif", w - 28);
        ctx.fillStyle = valColor === "#22c55e" ? "#86efac" : valColor === "#ef4444" ? "#fca5a5" : "#cbd5e1";
        ctx.fillText(subVal, x + w/2, y + 124);
      }
    };

    const mpNeg = !s.max_profit_inf && s.max_profit < 0;
    const mpVL = s.max_profit_inf ? "∞ Unlimited" : (mpNeg ? "-$" : "$") + fmt(Math.abs(s.max_profit));
    const mpPct = s.max_profit_pct !== null ? fmtPct(s.max_profit_pct) : "Unlimited";
    const isNoLoss = !s.max_loss_inf && s.max_loss >= -zeroEps();
    const mlVL = s.max_loss_inf ? "∞ Unlimited" : (isNoLoss ? "$0.00" : "-$" + fmt(Math.abs(s.max_loss)));
    const mlPct = s.max_loss_inf ? "Unlimited" : (isNoLoss ? "0.00% (No Loss)" : (s.max_loss_pct !== null ? fmtPct(s.max_loss_pct) : "Unlimited"));
    const premStr = (s.net_premium >= 0 ? "-" : "+") + "$" + fmt(Math.abs(s.net_premium));
    const premType = s.net_premium >= 0 ? "Debit" : "Credit";
    const beStr = s.breakevens.length ? s.breakevens.map(b => "$" + fmt(b)).join(", ") : "—";

    drawMetricBox(64, 312, 336, 148, "Max Profit", mpVL, mpPct, mpNeg ? "#ef4444" : "#22c55e");
    drawMetricBox(422, 312, 336, 148, "Max Loss", mlVL, mlPct, isNoLoss ? "#22c55e" : "#ef4444");
    drawMetricBox(780, 312, 336, 148, "Net Premium", premStr, premType, s.net_premium >= 0 ? "#ef4444" : "#22c55e");
    const capSub = s.total_fee > 0 ? `${cs} ${asset}  •  incl. $${fmt(s.total_fee)} fees` : `${cs} ${asset}`;
    drawMetricBox(1138, 312, 336, 148, "Total Capital", "$" + fmt(s.total_cost), capSub, "#60a5fa");
    drawMetricBox(1496, 312, 360, 148, "Breakeven(s)", beStr, s.distance[0] ? s.distance[0].pct.toFixed(1) + "% away" : "", "#f8fafc");

    // 6. Build Dedicated 1080p Offscreen Chart.js Instance
    const boxX = 64, boxY = 496, boxW = 1792, boxH = 504;
    
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.strokeStyle = "rgba(51, 65, 85, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 22); ctx.fill(); ctx.stroke();

    const offCvs = document.createElement("canvas");
    offCvs.width = boxW;
    offCvs.height = boxH;
    
    const cd = s.pnl_chart;
    const rPct = parseInt(document.getElementById("chart-range")?.value) || SETTINGS.chartRange || 30;
    const legs = (s.legs_detail || []).map(l => ({
      direction: (l.direction==="Buy"||l.direction==="Long") ? 1 : -1,
      opt_type: l.opt_type,
      strike: l.strike,
      premium: l.premium
    }));
    const result = computePnL(legs, spot, rPct, 300, cs, s.total_fee || 0);
    const prices = result.prices;
    const pnl = result.pnl;
    const labels = prices.map(p => "$" + fmtInt(p));
    const fillAbove = pnl.map(v => v >= 0 ? v : null);
    const fillBelow = pnl.map(v => v <= 0 ? v : null);
    let si = 0, md = Infinity;
    prices.forEach((p, i) => { if(Math.abs(p - spot) < md) { md = Math.abs(p - spot); si = i; } });

    const offCtx = offCvs.getContext("2d");
    const gG = offCtx.createLinearGradient(0, 0, 0, boxH);
    gG.addColorStop(0, "rgba(34,197,94,0.32)"); gG.addColorStop(1, "rgba(34,197,94,0.01)");
    const gR = offCtx.createLinearGradient(0, 0, 0, boxH);
    gR.addColorStop(0, "rgba(239,68,68,0.01)"); gR.addColorStop(1, "rgba(239,68,68,0.32)");
    const spotColor = getComputedStyle(document.documentElement).getPropertyValue('--spot-marker').trim() || '#7c3aed';

    const tempChart = new Chart(offCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "P&L",
            data: pnl,
            borderWidth: 5,
            segment: { borderColor: c => (c.p1.parsed.y >= 0 ? "#22c55e" : "#ef4444") },
            backgroundColor: "transparent",
            pointRadius: prices.map((p, i) => (i === si ? 12 : 0)),
            pointBackgroundColor: prices.map((p, i) => (i === si ? spotColor : "transparent")),
            pointBorderColor: prices.map((p, i) => (i === si ? "#ffffff" : "transparent")),
            pointBorderWidth: prices.map((p, i) => (i === si ? 3.5 : 0)),
            tension: 0.05,
            fill: false
          },
          {
            label: "Zero",
            data: new Array(prices.length).fill(0),
            borderColor: "rgba(148,163,184,0.35)",
            borderWidth: 2,
            borderDash: [8, 6],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        devicePixelRatio: 2.5,
        layout: { padding: { top: 30, right: 40, bottom: 15, left: 25 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: "#94a3b8",
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 24,
              font: { family: "'JetBrains Mono'", size: 16, weight: "700" }
            },
            title: { display: true, text: "Underlying Price at Expiration ($)", color: "#cbd5e1", font: { size: 19, weight: "800", family: "Inter" } }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: "#94a3b8",
              font: { family: "'JetBrains Mono'", size: 18, weight: "700" },
              callback: v => v
            },
            title: { display: true, text: "Profit / Loss ($)", color: "#cbd5e1", font: { size: 19, weight: "800", family: "Inter" } }
          }
        }
      }
    });

    ctx.drawImage(offCvs, boxX, boxY, boxW, boxH);
    tempChart.destroy();

    // 7. Footer
    ctx.textAlign = "center";
    ctx.font = "600 21px Inter, sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Generated with Option Strategy Analyzer • Powered by Derive.xyz Decentralized Exchange", 960, 1044);

    // 8. Output BOTH PNG (~750KB) and WebP (~220KB) for maximum social media flexibility!
    cvs.toBlob((webpBlob) => {
      cvs.toBlob((pngBlob) => {
        let dateFormatted = "26-07-31";
        if (DATA && DATA.expiry) {
          const rawExp = String(DATA.expiry).replace(/[^0-9]/g, "");
          if (rawExp.length === 8) {
            // dashes: a "/" in a download name is treated as a path separator
            dateFormatted = `${rawExp.slice(2, 4)}-${rawExp.slice(4, 6)}-${rawExp.slice(6, 8)}`;
          }
        }
        const cleanStratName = s.name.replace(/[^a-zA-Z0-9]/g, "");
        const fileName = `${asset}_${dateFormatted}__${cleanStratName}`;
        showSharePreviewModal(cvs.toDataURL("image/png"), pngBlob, webpBlob, fileName);
        btn.disabled = false;
        btn.innerHTML = oldText;
      }, "image/png");
    }, "image/webp", 0.94);

  } catch (err) {
    console.error("Export error:", err);
    btn.disabled = false;
    btn.innerHTML = oldText;
    showErr("Could not generate card image.");
  }
}

function closeShareModal() {
  const modal = document.getElementById("share-preview-modal");
  if (modal) {
    modal.classList.remove("on");
    modal.style.display = "none";
  }
}

function showSharePreviewModal(dataUrl, pngBlob, webpBlob, baseName) {
  let modal = document.getElementById("share-preview-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "share-preview-modal";
    modal.className = "settings-overlay on";
    modal.style.cssText = "z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
    document.body.appendChild(modal);
  } else {
    modal.style.display = "flex";
    modal.classList.add("on");
  }

  const canShare = navigator.share && navigator.canShare && navigator.canShare({ files: [new File([webpBlob || pngBlob], `${baseName}.webp`, { type: "image/webp" })] });
  const pngSizeKB = Math.round((pngBlob?.size || 0) / 1024);
  const webpSizeKB = Math.round((webpBlob?.size || 0) / 1024);

  modal.innerHTML = `
    <div class="settings-section" style="background:var(--bg-card);backdrop-filter:blur(24px);border:1px solid var(--border);border-radius:18px;padding:24px;max-width:850px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.8);display:flex;flex-direction:column;gap:18px;animation:ddIn .25s ease">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:14px">
        <h3 style="font-size:18px;font-weight:800;display:flex;align-items:center;gap:10px;margin:0">📸 1080p Strategy Card Ready!</h3>
        <button onclick="closeShareModal()" class="modal-close-btn" title="Close Preview">✕</button>
      </div>
      <div style="border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#000;display:flex;align-items:center;justify-content:center;max-height:420px">
        <img src="${dataUrl}" style="max-width:100%;max-height:420px;display:block;object-fit:contain">
      </div>
      <div style="font-size:12px;color:var(--text-dim);display:flex;justify-content:space-between;align-items:center;background:var(--bg-input);padding:8px 14px;border-radius:8px">
        <span>⚡ <b>WebP Size:</b> ~${webpSizeKB} KB (Instant Social Share)</span>
        <span>📥 <b>PNG Size:</b> ~${pngSizeKB} KB (Uncompressed Retina)</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-end">
        <button onclick="copyCardToClipboard()" id="btn-copy-img" class="chart-btn" style="background:var(--bg-input);border:1px solid var(--border);color:var(--text);padding:10px 16px;font-size:13px">📋 Copy Image</button>
        ${canShare ? `<button onclick="shareCardNative()" id="btn-native-share" class="chart-btn" style="background:var(--purple-bg);border:1px solid var(--purple);color:var(--purple);padding:10px 16px;font-size:13px">📤 Share via Apps…</button>` : ''}
        <button onclick="downloadCardWebP()" class="chart-btn" style="background:var(--bg-input);border:1px solid var(--accent);color:var(--accent-l);padding:10px 16px;font-size:13px;font-weight:700">⚡ Download WebP (~${webpSizeKB}KB)</button>
        <button onclick="downloadCardPng()" class="chart-btn" style="background:var(--accent-g);color:#fff;padding:10px 20px;font-size:13px;font-weight:800">📥 Download PNG (~${pngSizeKB}KB)</button>
      </div>
    </div>
  `;

  window._currentCardPngBlob = pngBlob;
  window._currentCardWebpBlob = webpBlob;
  window._currentCardBaseName = baseName;

  modal.onclick = (e) => {
    if (e.target === modal) closeShareModal();
  };
}

function downloadCardPng() {
  if (!window._currentCardPngBlob) return;
  const url = URL.createObjectURL(window._currentCardPngBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (window._currentCardBaseName || "Strategy_Card") + ".png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCardWebP() {
  if (!window._currentCardWebpBlob) return;
  const url = URL.createObjectURL(window._currentCardWebpBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (window._currentCardBaseName || "Strategy_Card") + ".webp";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyCardToClipboard() {
  const btn = document.getElementById("btn-copy-img");
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": window._currentCardPngBlob })]);
    if (btn) { btn.textContent = "✅ Copied!"; setTimeout(() => { btn.textContent = "📋 Copy Image"; }, 2000); }
  } catch (err) {
    if (btn) { btn.textContent = "❌ Failed"; setTimeout(() => { btn.textContent = "📋 Copy Image"; }, 2000); }
  }
}

async function shareCardNative() {
  if (!window._currentCardWebpBlob && !window._currentCardPngBlob) return;
  const blob = window._currentCardWebpBlob || window._currentCardPngBlob;
  const ext = window._currentCardWebpBlob ? "webp" : "png";
  const file = new File([blob], `${window._currentCardBaseName || "Strategy_Card"}.${ext}`, { type: `image/${ext}` });
  try {
    await navigator.share({
      files: [file],
      title: "Derive.xyz Option Strategy Card",
      text: `Check out my ${CURR_STRAT?.name || 'option strategy'} payoff analysis on Bitcoin/Ethereum options!`
    });
  } catch (err) {}
}

/* ═════════ inline block 2 of 3 (was in index.html) ═════════ */
// Enter key → save settings when panel is open
document.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    var panel = document.getElementById("settings-panel");
    if (panel && panel.classList.contains("on")) {
      e.preventDefault();
      saveSettings();
    }
  }
});

/* ═════════ inline block 3 of 3 (was in index.html) ═════════ */
window.addEventListener("scroll",()=>{document.getElementById("back-top").classList.toggle("show",window.scrollY>300)});
