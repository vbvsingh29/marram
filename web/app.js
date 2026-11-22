const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ST=['active','later','revisit','done'];
let lim=50,limKey='',hc='',hq='',TK=[],TRE=null,openG=new Map(),pg=false,tab='sessions',D={sessions:[],liveProcs:0,jira:''},focusId='',proj='ALL',agent='all',flt='all',rulesCache={},view='cards';
const LSx={get:k=>{try{return localStorage.getItem('hub.'+k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem('hub.'+k,v)}catch{}}};
try{const t=LSx.get('theme');if(t)document.documentElement.dataset.theme=t;proj=LSx.get('proj')||'ALL';pg=LSx.get('pg')==='1';flt=LSx.get('flt')||'all';view=LSx.get('view')||'cards';openG=new Map(JSON.parse(LSx.get('open')||'[]'))}catch{}
const api=(p,b)=>fetch(p,b?{method:'POST',headers:{'content-type':'application/json','x-hub':'1'},body:JSON.stringify(b)}:{headers:{'x-hub':'1'}}).then(r=>r.json());
const ago=t=>{const s=(Date.now()-t)/1000;return s<60?'now':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':Math.floor(s/86400)+'d ago'};
const fmt=t=>t?new Date(t).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'?';
const link=s=>esc(s).replace(/(https?:\/\/[^\s<)]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(TRE?new RegExp(TRE.source,'g'):/$^/,(m,o,str)=>!D.jira||str.slice(Math.max(0,o-2),o)==='">'||str.slice(o-1,o)==='/'?m:`<a href="${D.jira}${m}" target="_blank" rel="noopener">${m}</a>`);
const capsOf=s=>((D.agents||[]).find(a=>a.id===(s.agent||'claude'))||{}).capabilities||{};
const tickets=s=>TRE?[...new Set(((s.name||'')+' '+s.title+' '+s.first+' '+s.last+' '+s.cwd).match(TRE)||[])]:[];
const short=c=>c.replace(/^\/home\/[^/]+\//,'~/');
// Only changes you would want to see count; a session merely being active (new messages) does not.
const rowSig=s=>s.status+':'+(s.running?1:0)+':'+(s.name||'')+':'+(s.note||'');
let lastSig='';
const sigOf=d=>d.sessions.map(s=>s.id+':'+rowSig(s)).join('|');
function showUpd(n){let b=$('#upd');if(!b){b=document.createElement('button');b.id='upd';b.className='primary';b.onclick=()=>{b.hidden=true;draw()};document.body.appendChild(b)}b.textContent=n+' session'+(n==1?'':'s')+' updated - click to refresh the list';b.hidden=false}
const sessUrl=()=>'/api/sessions'+(agent!=='all'?'?agent='+agent:'');
function drawAgents(){const A=D.agents||[],el=$('#agsel');el.innerHTML='<option value="all">All agents</option>'+A.map(a=>`<option value="${a.id}" ${a.installed?'':'disabled'}>${esc(a.label)}${a.experimental?' (experimental)':''}${a.installed?'':' (not installed)'}</option>`).join('');el.value=agent;el.onchange=()=>{agent=el.value;syncHash();load()}}
async function load(){D=await api(sessUrl());drawAgents();TK=D.tickets||[];TRE=TK.length?new RegExp('\\b(?:'+TK.join('|')+')-\\d+\\b','g'):null;lastSig=sigOf(D);const b=$('#upd');if(b)b.hidden=true;draw()}
// Background refresh never redraws the page under you: it only fetches, and offers a refresh button if something changed.
async function poll(){
  if(document.hidden)return;
  const d=await api(sessUrl()).catch(()=>null);if(!d||!d.sessions)return;
  const sg=sigOf(d);if(sg===lastSig){D=d;return}
  const old=new Map(D.sessions.map(s=>[s.id,rowSig(s)]));let n=0;for(const s of d.sessions)if(old.get(s.id)!==rowSig(s))n++;
  const added=d.sessions.filter(s=>!old.has(s.id)).length;D=d;lastSig=sg;if(n||added)showUpd(n)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});
function draw(){
  const S=D.sessions.filter(s=>!($('#hb').checked&&(/\/backup(\/|$)/.test(s.repo||s.cwd)||/backup-/.test(s.cwd)))),by={};S.forEach(s=>(by[s.cwd]??=[]).push(s));
  const run=S.filter(s=>s.running).length;
  $('#sum').textContent=`${S.length} sessions · ${Object.keys(by).length} projects · ${run} running · ${D.liveProcs} claude procs`;
  const gm={};S.forEach(s=>(gm[s.repo||s.cwd]??=[]).push(s));
  const G=Object.entries(gm).map(([r,l])=>{const dirs={};l.forEach(s=>(dirs[s.cwd]??=[]).push(s));return{r,l,dirs,t:Math.max(...l.map(s=>s.mtime))}}).sort((a,b)=>b.t-a.t);
  const kid=(r,d)=>{if(d===r)return 'main checkout';const b=d.split('/').pop(),rb=r.split('/').pop().toLowerCase().replace(/_/g,'-'),nb=b.toLowerCase().replace(/_/g,'-');return nb.startsWith(rb+'-')?b.slice(rb.length+1):b};
  $('#projs').innerHTML=`<div class="proj ${proj==='ALL'?'sel':''}" data-p="ALL"><span>All projects</span><span class="badge">${S.length}</span></div>`+G.map(g=>{
    const ds=Object.entries(g.dirs).sort((a,b)=>b[1][0].mtime-a[1][0].mtime),multi=ds.length>1||ds[0][0]!==g.r,live=g.l.some(s=>s.running);
    const open=multi&&(openG.has(g.r)?openG.get(g.r):(proj===g.r||ds.some(([d])=>d===proj)));
    return `<div class="proj grp ${proj===g.r&&pg?'sel':''}" data-p="${esc(g.r)}" data-g="1"><span>${multi?`<span class="car" data-car="${esc(g.r)}" data-open="${open?1:0}">${open?'&#9662;':'&#9656;'}</span> `:''}${esc(g.r.split('/').pop())}</span><span>${live?'<span class="badge run">live</span> ':''}<span class="badge">${g.l.length}</span></span></div>`+
     (open?ds.map(([d,l])=>`<div class="proj kid ${proj===d&&!pg?'sel':''}" data-p="${esc(d)}"><span>${esc(kid(g.r,d))}</span><span>${l.some(s=>s.running)?'<span class="badge run">live</span> ':''}<span class="badge">${l.length}</span></span></div>`).join(''):'')}).join('');
  document.querySelectorAll('#projs [data-p]').forEach(e=>e.onclick=ev=>{const c=ev.target.closest('[data-car]');if(c){ev.stopPropagation();const r=c.dataset.car,cur=c.dataset.open==='1';openG.set(r,!cur);draw();return}proj=e.dataset.p;pg=!!e.dataset.g;if(pg&&e.querySelector('[data-car]'))openG.set(proj,true);draw();loadRules();if(tab!=='sessions')setTab(tab)});
  const rs=[...S].sort((a,b)=>b.mtime-a.mtime).slice(0,15);
  $('#recent').innerHTML='<option value="">Recent chats...</option>'+rs.map(s=>`<option value="${s.id}">${esc((s.name||s.title||s.first.slice(0,50)||s.id).slice(0,60))} &middot; ${ago(s.mtime)}</option>`).join('');
  $('#recent').onchange=e=>{if(e.target.value)jump(e.target.value)};
  const cnt=k=>S.filter(s=>inProj(s)&&(k==='all'||(k==='running'?s.running:s.status===k))).length;
  $('#filters').innerHTML=['all','running',...ST].map(k=>`<button class="${flt===k?'on':''}" data-f="${k}">${k} (${cnt(k)})</button>`).join('')+`<button id="vw">${view==='board'?'card view':'board view'}</button><button id="ins">${LSx.get('ins')==='1'?'hide insights':'insights'}</button><button id="rf">refresh</button>`;
  document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{flt=b.dataset.f;draw()});$('#rf').onclick=load;$('#ins').onclick=()=>{LSx.set('ins',LSx.get('ins')==='1'?'0':'1');draw()};$('#vw').onclick=()=>{view=view==='board'?'cards':'board';draw()};
  const qq=($('#q').value||'').toLowerCase();
  const L=S.filter(s=>(!qq||(s.name+' '+s.title+' '+s.first+' '+s.last+' '+s.cwd+' '+s.id+' '+s.note).toLowerCase().includes(qq))&&inProj(s)&&(flt==='all'||(flt==='running'?s.running:s.status===flt)));
  const lk=proj+'|'+pg+'|'+flt+'|'+qq;if(lk!==limKey){limKey=lk;lim=50}
  if(focusId){const ix=L.findIndex(s=>s.id===focusId);if(ix>=lim)lim=ix+1}
  $('#list').innerHTML=L.slice(0,lim).map(card).join('')+(L.length>lim?`<div class="row"><button id="more">show ${Math.min(50,L.length-lim)} more</button><span class="mut">${L.length-lim} of ${L.length} not shown</span> <button id="all">show all</button></div>`:'')||'<p class="mut">none</p>';
  stats(S);if($('#more')){$('#more').onclick=()=>{lim+=50;draw()};$('#all').onclick=()=>{lim=1e9;draw()}}if(view==='board'){$('#list').innerHTML=board(L);bindBoard()}else bind();
  const fc=focusId&&document.querySelector('.card[data-id="'+focusId+'"]');if(fc)fc.classList.add('foc');focusId='';
  syncHash();LSx.set('proj',proj);LSx.set('pg',pg?1:0);LSx.set('flt',flt);LSx.set('view',view);LSx.set('open',JSON.stringify([...openG]));
}
const SC={active:'--s1',later:'--s2',revisit:'--s3',done:'--s4'};
function tipOn(el,t){el.onmousemove=e=>{const p=$('#tip');p.textContent=t;p.style.display='block';p.style.left=e.clientX+12+'px';p.style.top=e.clientY+12+'px'};el.onmouseleave=()=>$('#tip').style.display='none'}
function stats(S){
  const sc=S.filter(s=>inProj(s)),n=k=>sc.filter(s=>s.status===k).length,T=sc.length||1;
  const open=n('later')+n('revisit');
  const seg=ST.map(k=>({k,v:n(k)})).filter(x=>x.v);
  const days=[...Array(14)].map((_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(13-i));return d});
  const cnt=days.map(d=>sc.filter(s=>s.mtime>=d&&s.mtime<d.getTime()+864e5).length),mx=Math.max(1,...cnt);
  const W=420,H=110,bw=20,gap=(W-14*bw)/13,bars=days.map((d,i)=>{const h=cnt[i]/mx*80,x=i*(bw+gap);return `<g data-t="${d.toLocaleDateString([],{month:'short',day:'numeric'})}: ${cnt[i]} session${cnt[i]==1?'':'s'}"><rect x="${x}" y="0" width="${bw}" height="${H-14}" fill="transparent"/><path d="M${x} 96v${-h+3}a3 3 0 0 1 3-3h${bw-6}a3 3 0 0 1 3 3v${h-3}z" fill="var(--s1)" ${cnt[i]?'':'opacity=".25"'}/>${i%2==0?`<text x="${x+bw/2}" y="109" text-anchor="middle">${d.getDate()}</text>`:''}</g>`}).join('');
  $('#stats').innerHTML=`<div class="tile"><div class="n">${sc.length}</div><div class="l">sessions</div></div>
  <div class="tile"><div class="n">${sc.filter(s=>s.running).length}</div><div class="l">running now</div></div>
  <div class="tile"><div class="n">${open}</div><div class="l">to revisit or later</div></div>
  <div class="tile"><div class="n">${n('done')}</div><div class="l">done</div></div>
  <div class="tile wide"><div class="l">By status</div><div class="stack">${seg.map(x=>`<div data-t="${x.k}: ${x.v}" style="flex:${x.v};background:var(${SC[x.k]})"></div>`).join('')}</div><div class="leg">${ST.map(k=>`<span><i style="background:var(${SC[k]})"></i>${k} <b>${n(k)}</b></span>`).join('')}</div></div>
  <div class="tile wide"><div class="l">Sessions last touched, past 14 days</div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="sessions per day"><line x1="0" x2="${W}" y1="96" y2="96" stroke="var(--bd)"/><line x1="0" x2="${W}" y1="56" y2="56" stroke="var(--bd)" stroke-dasharray="2 4"/><text x="0" y="52">${Math.round(mx/2)||''}</text><text x="${W}" y="12" text-anchor="end">peak ${mx}</text>${bars}</svg></div>`;
  $('#stats').classList.toggle('min',LSx.get('ins')!=='1');
  document.querySelectorAll('#stats [data-t]').forEach(e=>tipOn(e,e.dataset.t));
}
function card(s){
  const cp=capsOf(s),nm=esc(s.name||s.title||s.first.slice(0,80)||s.id),tk=tickets(s);
  return `<div class="card" data-id="${s.id}"><h3><span class="tt" title="started: ${esc(s.first.slice(0,200))}">${nm}</span> ${s.running?'<span class="badge run">running</span>':''}${(D.agents||[]).filter(a=>a.installed).length>1?`<span class="badge">${esc(s.agent||'')}</span>`:''}${s.kind?`<span class="badge">${s.kind}</span>`:''} <select class="st" title="status" style="border-left:3px solid var(${SC[s.status]})">${ST.map(k=>`<option ${k===s.status?'selected':''}>${k}</option>`).join('')}</select> ${tk.map(k=>D.jira?`<a class="badge" href="${D.jira}${k}" target="_blank" rel="noopener">${k}</a>`:`<span class="badge">${k}</span>`).join(' ')}</h3>
  <div class="mut" title="id ${s.id} · created ${fmt(s.created)} · last interacted ${fmt(s.mtime)}">${esc(short(s.cwd))} · ${(s.size/1024).toFixed(0)} KB · ${ago(s.mtime)}</div>
  ${s.note?`<div class="q">&#128221; ${esc(s.note)}</div>`:''}
  ${s.last?`<div class="q c2"><b>last ask:</b> ${link(s.last)}</div>`:''}${s.lastAssistant?`<div class="q c2"><b>${s.agent==='antigravity'?'summary':'last reply'}:</b> ${link(s.lastAssistant)}</div>`:''}
  <div class="row">${cp.chat?`<button class="vc" title="read the full conversation here">view chat</button>`:''}${cp.resume?`<button class="ot" title="open this session as a live terminal">open in terminal</button>`:''}${cp.openFolder&&!s.cwd.includes('/.gemini/')?`<button class="of" title="open this folder in the agent">open folder</button>`:''}${cp.changes?`<button class="cc" title="files, commits and PRs from this session">changes</button>`:''}
   <span class="mw"><button class="mb" title="more actions">&#8943;</button><div class="mm" hidden><button class="rn">rename</button><button class="kd">type: ${s.kind||"none"}</button><button class="nt">edit note</button>${cp.changes?`<button class="cp" data-c="cd ${esc(s.cwd)} &amp;&amp; claude --resume ${s.id}">copy resume cmd</button><button class="ho">copy handoff</button>`:''}</div></span></div>
  ${cp.changes?`<details class="dt"><summary>details</summary><div class="tabs"><button data-dt="cd" class="on">code changes</button><button data-dt="sk">skills</button></div><div class="dtb mut"></div></details>`:''}</div>`}
function bind(){
  document.querySelectorAll('.card[data-id]').forEach(c=>{
    const id=c.dataset.id,S=()=>D.sessions.find(x=>x.id===id),q=sel=>c.querySelector(sel)||{};
    q('.of').onclick=async e=>{const s=S(),r=await api('/api/open-folder',{agent:s.agent,cwd:s.cwd});e.target.textContent=r.error?'failed':'opened'};
    q('.st').onchange=async e=>{const v=e.target.value;await api('/api/tag',{id,status:v});const s=S();if(s)s.status=v;e.target.style.borderLeft='3px solid var('+SC[v]+')'};
    q('.rn').onclick=async()=>{const s=S(),n=prompt('Rename session (empty = reset)',s.name||s.title||'');if(n===null)return;await api('/api/tag',{id,name:n.trim()});s.name=n.trim();c.querySelector('.tt').textContent=s.name||s.title||s.first.slice(0,80)||id};
    q('.nt').onclick=async()=>{const s=S(),n=prompt('Note',s.note||'');if(n===null)return;await api('/api/tag',{id,note:n.trim()});load()};
    q('.kd').onclick=async e=>{const s=S(),n=['',...KINDS][(['',...KINDS].indexOf(s.kind||'')+1)%4];await api('/api/tag',{id,kind:n});s.kind=n;e.target.textContent='type: '+(n||'none')};
    q('.vc').onclick=()=>openChat(id);
    q('.ot').onclick=()=>openTerm(id,S().cwd,undefined,S().agent);
    q('.ho').onclick=async e=>{const t=await fetch('/api/handoff?id='+id,{headers:{'x-hub':'1'}}).then(x=>x.text());try{await navigator.clipboard.writeText(t);e.target.textContent='copied'}catch{e.target.textContent='copy failed'}};
    q('.cp').onclick=e=>{navigator.clipboard.writeText(e.target.dataset.c.replace(/&amp;/g,'&'));e.target.textContent='copied'};
    q('.mb').onclick=e=>{e.stopPropagation();const m=c.querySelector('.mm'),was=m.hidden;document.querySelectorAll('.mm').forEach(x=>x.hidden=true);m.hidden=!was};
    const dt=c.querySelector('.dt')||document.createElement('details'),box=c.querySelector('.dtb')||document.createElement('div');
    const tab=k=>{dt.querySelectorAll('[data-dt]').forEach(x=>x.classList.toggle('on',x.dataset.dt===k));const s=S();box.className='dtb';
      if(k==='cd'){box.classList.add('mut');box.innerHTML='loading...';api('/api/changes?id='+id).then(r=>box.innerHTML=chHtml(r,''))}
      else if(k==='sk'){box.classList.add('mut');box.innerHTML='loading...';loadSk(box,id,s.cwd)}
      else{box.innerHTML=''}};
    q('.cc').onclick=()=>{dt.open=true;tab('cd');dt.dataset.l=1;dt.scrollIntoView({block:'nearest'})};
    dt.addEventListener('toggle',()=>{if(dt.open&&!dt.dataset.l){dt.dataset.l=1;tab('cd')}});
    dt.querySelectorAll('[data-dt]').forEach(x=>x.onclick=()=>tab(x.dataset.dt));
  });
}
function chHtml(c,remote){
  const f=c.files.map(x=>`<div class="mut">${x.writes?'new/overwritten':'edited'} x${x.edits+x.writes} - ${esc(short(x.path))}</div>`).join('')||'<div class="mut">no file edits</div>';
  const cm=c.commits.map(x=>`<div>${remote?`<a href="${esc(remote)}/commit/${esc(x.hash)}" target="_blank" rel="noopener">${x.hash}</a>`:x.hash} <span class="mut">${esc(x.branch)}</span> ${link(x.msg)}</div>`).join('')||'<div class="mut">no commits</div>';
  const pr=c.prs.map(u=>`<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/[^/]+\//,''))}</a></div>`).join('')||'<div class="mut">no PRs</div>';
  return `<b>Files (${c.files.length})</b>${f}<b>Commits (${c.commits.length})</b>${cm}<b>PRs (${c.prs.length})</b>${pr}`}
async function loadWtBanner(){
  const b=$('#wtb');b.innerHTML='';if(proj==='ALL'||pg)return;const mine=proj;
  const W=await api('/api/worktrees');if(mine!==proj)return;const r=W.rows.find(x=>x.path===mine);if(!r)return;
  const risky=r.dirty||r.unpushed;
  b.innerHTML=`<div class="card"><div class="row" style="margin:0"><b>Git worktree</b><span class="badge">${esc(r.branch||'')}</span><span class="mut">idle ${r.missing?'?':r.days+'d'}${r.dirty?' · '+r.dirty+' uncommitted':''}${r.unpushed?' · '+r.unpushed+' unpushed':''} · ${esc(r.state)}</span>
   ${r.state==='running'?'<span class="mut">a session is running here; close it to remove</span>':'<button id="wtbr">Remove this worktree</button>'}</div><div id="wtbc"></div></div>`;
  const rb=$('#wtbr');if(!rb)return;
  rb.onclick=()=>{$('#wtbc').innerHTML=`<div class="mut" style="margin-top:8px">Deletes the folder ${esc(short(r.path))}, including ignored files such as .env. The branch is kept, so committed work is not lost. Your chats stay in the hub.</div>
    ${risky?`<div class="mut" style="color:var(--err)">Uncommitted changes will be LOST.</div><label><input type="checkbox" id="wtbf"> I understand, force-remove</label>`:''}
    <div class="row"><label class="mut"><input type="checkbox" id="wtbd"> also delete branch (only if fully merged)</label><button class="primary" id="wtby">Yes, remove</button><button id="wtbn">cancel</button></div>`;
    $('#wtbn').onclick=()=>$('#wtbc').innerHTML='';
    $('#wtby').onclick=async()=>{const force=!!($('#wtbf')&&$('#wtbf').checked);if(risky&&!force){$('#wtbc').insertAdjacentHTML('beforeend','<div class="mut" style="color:var(--err)">tick the box to confirm</div>');return}
      $('#wtby').disabled=true;$('#wtby').textContent='removing...';
      const x=(await api('/api/wt-remove-many',{paths:[r.path],force,deleteBranch:$('#wtbd').checked}))[0];
      if(x.error){$('#wtbc').innerHTML='<div class="mut" style="color:var(--err)">'+esc(x.error)+'</div>';return}
      proj='ALL';pg=false;await load();setTab('sessions')}}
}
async function loadRules(){
  loadWtBanner();
  if(proj==='ALL'){$('#rules').innerHTML='';return}
  const R=await api('/api/rules?cwd='+encodeURIComponent(proj)),RA=await api('/api/rules-audit?cwd='+encodeURIComponent(proj));
  $('#rules').innerHTML=`<details><summary>Rules (CLAUDE.md) · ${R.length} file(s) apply to ${esc(short(proj))} · ${(RA.total/1024).toFixed(1)} KB loaded per session${RA.dups.length?` · ${RA.dups.length} duplicate line(s)`:''}</summary>${RA.dups.length?`<div class="q">Duplicated across files: ${RA.dups.slice(0,5).map(d=>esc(d.line)).join(' | ')}</div>`:''}`+
   (R.map((r,i)=>`<div class="rule" data-p="${esc(r.path)}"><div class="mut">${esc(short(r.path))}</div><textarea style="min-height:160px">${esc(r.content)}</textarea><div class="row"><button class="save">Save</button><span class="mut"></span></div></div>`).join('')||'<p class="mut">no CLAUDE.md found</p>')+
   `<div class="rule" data-p="${esc(proj+'/CLAUDE.md')}"><div class="mut">add a rule to ${esc(short(proj))}/CLAUDE.md (appended)</div><input class="add" style="width:100%" placeholder="new rule text"><div class="row"><button class="append">Append</button><span class="mut"></span></div></div></details>`;
  document.querySelectorAll('.save').forEach(b=>b.onclick=async()=>{const d=b.closest('.rule');await api('/api/rules',{path:d.dataset.p,content:d.querySelector('textarea').value});b.nextElementSibling.textContent='saved'});
  document.querySelectorAll('.append').forEach(b=>b.onclick=async()=>{const d=b.closest('.rule'),t=d.querySelector('.add').value.trim();if(!t)return;
    const ex=R.find(r=>r.path===d.dataset.p);await api('/api/rules',{path:d.dataset.p,content:(ex?ex.content.replace(/\n*$/,'\n\n'):'')+'- '+t+'\n'});b.nextElementSibling.textContent='appended';loadRules()});
}

const inProj=s=>proj==='ALL'||(pg?(s.repo||s.cwd)===proj:s.cwd===proj);
const mb=b=>(b/1048576).toFixed(0)+' MB';
const TABS=[['sessions','Sessions','sess'],['term','Terminal','trm'],['work','Work items','tkt'],['wt','Worktrees','wtp'],['search','Search','srp'],['lib','Library','lib'],['skills','Skills','skl'],['hyped','Hyped','hyp'],['opt','Optimize','opt']];
function setTab(t,nopush){tab=t;$('#tabs').innerHTML=TABS.map(x=>`<button data-t="${x[0]}" class="${t===x[0]?'on':''}">${x[1]}</button>`).join('')+'<button id="plus" class="primary" style="margin-left:auto" title="start a new session in a folder">+ New session</button>';
  $('#plus').onclick=()=>openNew();document.querySelectorAll('#tabs [data-t]').forEach(b=>b.onclick=()=>setTab(b.dataset.t));
  TABS.forEach(x=>$('#'+x[2]).hidden=x[0]!==t);
  ({term:()=>drawTerm(),work:drawTickets,wt:drawWt,search:()=>drawSearch(),skills:drawSkills,hyped:()=>drawHype(),opt:drawOpt,lib:drawLib})[t]?.();if(!nopush)syncHash()}



const acts=id=>{const s=D.sessions.find(x=>x.id===id),c=s?capsOf(s):{chat:1,resume:1};return `<span class="acts">${c.chat?`<a href="#" data-vc="${id}">view chat</a> `:''}${c.resume?`<a href="#" data-ot="${id}">open in terminal</a>`:''}</span>`};
document.addEventListener('click',e=>{const a=e.target.closest('[data-vc],[data-ot]');if(!a)return;e.preventDefault();e.stopPropagation();
  const id=a.dataset.vc||a.dataset.ot,s=D.sessions.find(x=>x.id===id);if(!s)return;a.dataset.vc?openChat(id):openTerm(id,s.cwd,undefined,s.agent)},true);
