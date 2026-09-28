/**
 * Headless UI checks (no browser required).
 *
 *   npm install jsdom          # once, anywhere on the PATH of this folder
 *   node tests/ui_checks.js    # with the app running on :5000
 *
 * Loads the real page in jsdom, stubs Chart.js, drives the analyzer end to end and
 * verifies the rendering, the payoff chart window and the settings side effects.
 */
const {JSDOM, VirtualConsole}=require('jsdom');
(async()=>{
  let html=await (await fetch('http://127.0.0.1:5000/')).text();
  const cdnScripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]);
  html=html.replace(/<script src="https:\/\/cdn[^>]*><\/script>/g,'');
  const vc=new VirtualConsole(); const errs=[];
  vc.on('jsdomError',e=>{ if(!/scrollTo|Not implemented/.test(e.message)) errs.push(e.message.slice(0,120)); });
  vc.on('error',(...a)=>errs.push('console.error: '+a.join(' ').slice(0,120)));
  const dom=new JSDOM(html,{url:'http://127.0.0.1:5000/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;
  w.fetch=(u,o)=>fetch(u.startsWith('http')?u:'http://127.0.0.1:5000'+u,o);
  const charts=[];
  class C{constructor(ctx,cfg){this.cfg=cfg;charts.push(this);}destroy(){}update(){}}
  C.register=()=>{}; w.Chart=C;
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>{},set:()=>true});
  w.document.dispatchEvent(new w.Event('DOMContentLoaded',{bubbles:true}));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await sleep(1800);
  console.log('CDN scripts left in page:', cdnScripts);
  const exp=w.document.getElementById('f-expiry').options[3].value;
  w.document.getElementById('f-expiry').value=exp;
  w.eval("SEL.clear();['long_call','covered_call','iron_condor','bull_put_spread','bear_put_spread'].forEach(x=>SEL.add(x));document.getElementById('f-maxloss').value='0';");
  await w.eval('compute()'); await sleep(2500);
  const rows=w.document.querySelectorAll('#results tbody tr');
  console.log('rows:',rows.length,'| tall class applied:', !!w.document.querySelector('.tbl-scroll.tall'));
  console.log('data-labels on first row:', [...rows[0].children].map(td=>td.getAttribute('data-label')).join('|'));
  const ids=w.eval("JSON.stringify(DATA.strategies.map(s=>s.id).filter((v,i,a)=>a.indexOf(v)===i))");
  console.log('strategies present:', ids);
  console.log('covered_call unlimited?', w.eval("JSON.stringify(DATA.strategies.filter(s=>s.id==='covered_call').map(s=>s.max_loss_inf))"));
  // open modal & chart at default and at 60%
  w.eval('openChart(0)'); await sleep(400);
  const c1=charts[charts.length-1];
  const p1=c1.cfg.data.labels;
  const lo=+p1[0].replace(/[$,]/g,''), hi=+p1[p1.length-1].replace(/[$,]/g,''), spot=w.eval('DATA.spot');
  console.log(`chart @±30%: ${((lo/spot-1)*100).toFixed(1)}% .. +${((hi/spot-1)*100).toFixed(1)}%  (label ${w.document.getElementById('range-val').textContent})`);
  const before=w.eval('JSON.parse(localStorage.getItem("d_settings")||"{}").chartRange');
  const rv=w.document.getElementById('chart-range'); rv.value='60'; w.eval('onRangeChange(60)'); await sleep(300);
  const c2=charts[charts.length-1]; const p2=c2.cfg.data.labels;
  const lo2=+p2[0].replace(/[$,]/g,''), hi2=+p2[p2.length-1].replace(/[$,]/g,'');
  console.log(`chart @±60%: ${((lo2/spot-1)*100).toFixed(1)}% .. +${((hi2/spot-1)*100).toFixed(1)}%  (label ${w.document.getElementById('range-val').textContent})`);
  const after=w.eval('JSON.parse(localStorage.getItem("d_settings")||"{}").chartRange');
  console.log('saved default chartRange untouched by slider:', before===after, `(${before} -> ${after})`);
  // fit-to-strikes
  w.document.getElementById('fit-strikes').checked=true; w.eval("onRangeChange(60)"); await sleep(300);
  console.log('fit-to-strikes label:', w.document.getElementById('range-val').textContent, '| slider disabled:', rv.disabled);
  // negative max profit rendering
  console.log('greeks table has Fee column:', /(<th>Fee<\/th>)/.test(w.document.getElementById('m-greeks').innerHTML));
  console.log('runtime errors:', errs.length?errs:'none');
  process.exit(0);
})();
