/* ---- pinned strip, several-at-once selection, and in-place counters ---- */
let selMode=false;const sel=new Set();
function visibleSessions(){return D.sessions.filter(s=>!($('#hb').checked&&(/\/backup(\/|$)/.test(s.repo||s.cwd)||/backup-/.test(s.cwd))))}
/* top strip: pinned sessions first, then what you touched last (only on the unfiltered all-projects view) */
function drawStrip(S){
  const el=$('#strip');if(!el)return;const qq=($('#q').value||'').trim();
  if(proj!=='ALL'||flt!=='all'||qq||view==='board'){el.innerHTML='';return}
  const now=Date.now(),pin=S.filter(s=>s.pin).slice(0,6),rest=S.filter(s=>!s.pin&&s.status!=='done'&&s.status!=='closed'&&now-s.mtime<2*864e5).slice(0,Math.max(0,5-pin.length));
  if(!pin.length&&!rest.length){el.innerHTML='';return}
  const chip=(s,p)=>`<button class="chip ${p?'on':''}" data-j="${s.id}" title="${esc((s.name||s.title||'')+' · '+ago(s.mtime))}">${s.running?'● ':''}${esc((s.name||s.title||(s.first||'').slice(0,40)||s.id).slice(0,38))}</button>`;
  el.innerHTML=`<div class="bar" style="margin:0 0 8px"><span class="mut">${pin.length?'Pinned':'Pick up'}</span>${pin.map(s=>chip(s,1)).join('')}${pin.length&&rest.length?'<span class="mut">Recent</span>':''}${rest.map(s=>chip(s,0)).join('')}</div>`;
  el.querySelectorAll('[data-j]').forEach(b=>b.onclick=()=>jump(b.dataset.j));
}
/* several at once: checkboxes appear on cards, a bar applies a status or type to all ticked */
function selUI(){
  const f=$('#filters');if(f&&!$('#selb')){f.insertAdjacentHTML('beforeend',`<button id="selb">${selMode?'done selecting':'select'}</button>`);$('#selb').onclick=()=>{selMode=!selMode;if(!selMode)sel.clear();draw()}}
  let bar=$('#bulk');if(!selMode){if(bar)bar.hidden=true;return}
  document.querySelectorAll('.card[data-id]').forEach(c=>{const h=c.querySelector('h3');if(!h||h.querySelector('.sk'))return;const k=document.createElement('input');k.type='checkbox';k.className='sk';k.style.padding='0';k.checked=sel.has(c.dataset.id);k.onchange=()=>{k.checked?sel.add(c.dataset.id):sel.delete(c.dataset.id);paintBulk()};h.prepend(k)});
  if(!bar){bar=document.createElement('div');bar.id='bulk';document.body.appendChild(bar)}
  bar.hidden=false;paintBulk();
}
function paintBulk(){
  const bar=$('#bulk');if(!bar)return;const n=sel.size;
  bar.innerHTML=`<b>${n} selected</b><button id="bsa">select all shown</button><select id="bst"><option value="">set status...</option>${ST.map(k=>`<option>${k}</option>`).join('')}</select><select id="bkd"><option value="">set type...</option><option value="feature">feature</option><option value="bug">bug</option><option value="chore">chore</option><option value="none">no type</option></select><button id="bcl">clear</button>`;
  $('#bsa').onclick=()=>{document.querySelectorAll('.card[data-id]').forEach(c=>sel.add(c.dataset.id));document.querySelectorAll('.sk').forEach(k=>k.checked=true);paintBulk()};
  $('#bcl').onclick=()=>{sel.clear();document.querySelectorAll('.sk').forEach(k=>k.checked=false);paintBulk()};
  const apply=async(o)=>{if(!n)return;const r=await api('/api/tag-many',{ids:[...sel],...o});if(r.error){alert(r.error);return}D.sessions.forEach(s=>{if(sel.has(s.id)){if(o.status)s.status=o.status;if(o.kind!==undefined)s.kind=o.kind}});sel.clear();lastSig=sigOf(D);draw()};
  $('#bst').onchange=e=>{if(e.target.value)apply({status:e.target.value})};
  $('#bkd').onchange=e=>{if(e.target.value)apply({kind:e.target.value==='none'?'':e.target.value})};
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selMode&&!document.querySelector('.modal:not([hidden]),#chatv:not([hidden])')){selMode=false;sel.clear();draw()}});
/* sidebar counts, filter counts, tiles and the quiet-session count update in place when a refresh finds changes (no redraw of the list) */
function patchLive(){
  const S=visibleSessions(),gm={};S.forEach(s=>(gm[s.repo||s.cwd]??=[]).push(s));
  const run=S.filter(s=>s.running).length,pr=new Set(S.map(s=>s.cwd)).size;$('#sum').textContent=`${S.length} sessions · ${pr} projects · ${run} running · ${D.liveProcs} claude procs`;
  document.querySelectorAll('#projs .proj[data-p]').forEach(e=>{const p=e.dataset.p,l=p==='ALL'?S:(e.dataset.g?gm[p]:S.filter(s=>s.cwd===p));if(!l)return;
    const b=[...e.querySelectorAll('.badge:not(.run)')].pop();if(b)b.textContent=l.length;const lv=e.querySelector('.badge.run'),live=p!=='ALL'&&l.some(s=>s.running);
    if(live&&!lv&&b)b.insertAdjacentHTML('beforebegin','<span class="badge run">live</span> ');else if(!live&&lv)lv.remove()});
  const cnt=k=>S.filter(s=>inProj(s)&&(k==='all'||(k==='running'?s.running:s.status===k))).length;
  document.querySelectorAll('#filters [data-f]').forEach(b=>{b.textContent=b.dataset.f+' ('+cnt(b.dataset.f)+')'});
  stats(S);if(typeof updTitle==='function')updTitle();
}
const _draw=draw;draw=function(){_draw();drawStrip(visibleSessions());selUI()};
