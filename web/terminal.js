/* ---- live terminal (real claude in a pty, rendered with xterm.js) ---- */
const TM=new Map();let curT=null;const HDR={'content-type':'application/json','x-hub':'1'};
const tpost=(u,b)=>fetch(u,{method:'POST',headers:HDR,body:JSON.stringify(b)});
function termTheme(){const d=getComputedStyle(document.documentElement);return{background:d.getPropertyValue('--bg').trim()||'#111418',foreground:d.getPropertyValue('--fg').trim()||'#e8eaee',cursor:'#d97757'}}
async function openTerm(id,cwd,fallback,agentId){
  if(typeof Terminal==='undefined'){alert('xterm.js failed to load (needs internet for the CDN)');return}
  setTab('term');await new Promise(r=>setTimeout(r,50));
  const pre=mkTerm();pre.el.hidden=false;TM.forEach(o=>o.el.hidden=true);try{pre.fit.fit()}catch{}
  const r=await fetch('/api/term-start',{method:'POST',headers:HDR,body:JSON.stringify({id,cwd,fallback,agent:agentId||'claude',cols:pre.term.cols,rows:pre.term.rows})}).then(x=>x.json());
  if(r.error){pre.term.dispose();pre.el.remove();
    const m=document.createElement('div');m.className='card';m.innerHTML='<b>'+esc(r.error)+'</b>'+(r.suggest?`<p class="mut">You can still read the chat. To continue it, the hub can resume it from <code>${esc(short(r.suggest))}</code> instead (it copies the saved chat file into that folder's history; the original is untouched).</p><div class="row"><button class="primary" id="tfb">Resume from ${esc(short(r.suggest))}</button><button id="tvc">view chat</button></div>`:'');
    $('#tmain').prepend(m);if(r.suggest){m.querySelector('#tfb').onclick=()=>{m.remove();openTerm(id,cwd,r.suggest,agentId)}}m.querySelector('#tvc')&&(m.querySelector('#tvc').onclick=()=>openChat(id));return}
  if(TM.has(r.tid)){pre.term.dispose();pre.el.remove()}else attachTerm(r.tid,r.sid,cwd,pre);
  showTerm(r.tid);
}
function mkTerm(){
  const el=document.createElement('div');el.className='tv';el.hidden=true;$('#tmain').appendChild(el);
  const term=new Terminal({fontFamily:'"JetBrains Mono",ui-monospace,Menlo,monospace',fontSize:13,cursorBlink:true,scrollback:5000,theme:termTheme(),allowProposedApi:true});
  const fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(el);return{el,term,fit};
}
function attachTerm(tid,sid,cwd,pre){
  if(TM.has(tid))return;
  const {el,term,fit}=pre||mkTerm();
  const o={tid,sid,cwd,term,fit,el,alive:true};TM.set(tid,o);
  let q=Promise.resolve();term.onData(d=>{q=q.then(()=>tpost('/api/term-in',{tid,d})).catch(()=>{})});
  term.onResize(({cols,rows})=>tpost('/api/term-resize',{tid,cols,rows}));
  new ResizeObserver(()=>{if(!el.hidden)try{fit.fit()}catch{}}).observe(el);
  if(!pre)setTimeout(async()=>{try{el.hidden=false;fit.fit()}catch{};await tpost('/api/term-resize',{tid,cols:Math.max(20,term.cols-1),rows:term.rows});setTimeout(()=>tpost('/api/term-resize',{tid,cols:term.cols,rows:term.rows}),150)},300);
  (async()=>{try{const r=await fetch('/api/term-out',{method:'POST',headers:HDR,body:JSON.stringify({tid})});const rd=r.body.getReader();
    for(;;){const {done,value}=await rd.read();if(done)break;term.write(value)}}catch{}
    o.alive=false;term.write('\r\n\x1b[2m[process ended - press "open in terminal" to resume this session]\x1b[0m\r\n');drawChips();poll()})();
}
function showTerm(tid){
  curT=tid;TM.forEach(o=>o.el.hidden=o.tid!==tid);const o=TM.get(tid);drawChips();
  if(o){setTimeout(()=>{try{o.fit.fit()}catch{};o.term.focus()},30)}
}
function drawChips(){const c=$('#tchips');if(!c)return;
  c.innerHTML=[...TM.values()].map(o=>`<span class="chip ${o.tid===curT?'on':''}" data-t="${o.tid}">${o.alive?'●':'○'} ${esc(short(o.cwd))} <span class="mut">${o.sid.slice(0,6)}</span> <a href="#" data-x="${o.tid}" title="${o.alive?'stop & close':'close'}">✕</a></span>`).join('')||'<span class="mut">no terminals open. Use "open in terminal" on a session card, or New session → Start Claude here.</span>';
  c.querySelectorAll('.chip').forEach(x=>x.onclick=e=>{if(e.target.dataset.x)return;showTerm(x.dataset.t)});
  c.querySelectorAll('[data-x]').forEach(a=>a.onclick=e=>{e.preventDefault();e.stopPropagation();const o=TM.get(a.dataset.x);tpost('/api/term-kill',{tid:o.tid,forget:1});o.term.dispose();o.el.remove();TM.delete(o.tid);if(curT===o.tid){curT=[...TM.keys()][0]||null;if(curT)showTerm(curT)}drawChips();poll()})}
async function drawTerm(){
  const root=$('#trm');
  if(!$('#tmain')){root.innerHTML='<div class="bar"><div id="tchips" class="bar" style="margin:0"></div></div><div id="tmain"></div>'}
  const L=await fetch('/api/terms',{headers:{'x-hub':'1'}}).then(r=>r.json()).catch(()=>[]);
  for(const t of L)if(t.alive&&!TM.has(t.tid)){attachTerm(t.tid,t.sid,t.cwd)}
  if(!curT||!TM.has(curT))curT=[...TM.keys()][0]||null;
  drawChips();if(curT)showTerm(curT);
}
/* ---- new session: "+" button opens a folder + agent popup, then the real terminal ---- */
let nd='';
function newAgents(){return (D.agents||[]).filter(a=>a.installed&&a.capabilities.newSession)}
async function openNew(dir){
  let m=$('#npm');if(!m){m=document.createElement('div');m.id='npm';m.hidden=true;document.body.appendChild(m);
    m.addEventListener('click',e=>{if(e.target===m)m.hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!m.hidden)m.hidden=true})}
  const r=await api('/api/ls?dir='+encodeURIComponent(dir??(nd||(proj!=='ALL'?proj:LSx.get('lastdir')||''))));
  m.hidden=false;
  if(r.error){m.innerHTML=`<div class="npb"><p class="mut">${esc(r.error)}</p><button id="npg">go home</button></div>`;$('#npg').onclick=()=>openNew('');return}
  nd=r.dir;const rel=r.dir.slice(r.home.length).split('/').filter(Boolean);let acc=r.home;
  const crumbs=[`<a href="#" data-d="${esc(r.home)}">~</a>`,...rel.map(p=>{acc+='/'+p;return `<a href="#" data-d="${esc(acc)}">${esc(p)}</a>`})].join(' / ');
  const AG=newAgents(),cur=m.dataset.ag&&AG.some(a=>a.id===m.dataset.ag)?m.dataset.ag:(AG.find(a=>a.id===agent)||AG[0]||{}).id;
  m.innerHTML=`<div class="npb"><div class="row" style="justify-content:space-between"><h1 style="margin:0">New session</h1><button id="npx">close</button></div>
  <div class="row"><label class="mut">Agent</label><select id="npa">${AG.map(a=>`<option value="${a.id}" ${a.id===cur?'selected':''}>${esc(a.label)}</option>`).join('')||'<option value="">no agent can start sessions</option>'}</select></div>
  <div class="q">${crumbs}</div>
  <div class="npl">${r.parent?`<div class="proj" data-d="${esc(r.parent)}"><span>.. (up)</span></div>`:''}${r.dirs.map(d=>`<div class="proj" data-d="${esc(r.dir+'/'+d.name)}"><span>${esc(d.name)}</span><span>${d.git?'<span class="badge">git</span> ':''}${d.claudemd?'<span class="badge">rules</span> ':''}${d.sessions?`<span class="badge">${d.sessions}</span>`:''}</span></div>`).join('')||'<p class="mut">no subfolders</p>'}</div>
  <div class="row"><input id="mk" placeholder="new folder name" style="width:200px"><button id="mkb">Create here</button><span class="mut" id="mkm"></span></div>
  <div class="row" style="justify-content:space-between"><span class="mut">${esc(short(r.dir))} ${r.git?'· git':''} · ${r.sessions} sessions</span><button id="tnew" class="primary" ${cur?'':'disabled'}>Open terminal here</button></div></div>`;
  m.querySelectorAll('[data-d]').forEach(a=>a.onclick=e=>{e.preventDefault();m.dataset.ag=$('#npa').value;openNew(a.dataset.d)});
  $('#npx').onclick=()=>m.hidden=true;
  $('#tnew').onclick=()=>{LSx.set('lastdir',r.dir);const a=$('#npa').value;m.hidden=true;openTerm('',r.dir,undefined,a)};
  $('#mkb').onclick=async()=>{const x=await api('/api/mkdir',{parent:r.dir,name:$('#mk').value.trim()});if(x.error)$('#mkm').textContent=x.error;else{m.dataset.ag=$('#npa').value;openNew(x.dir)}};
}
