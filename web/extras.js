/* ---- saved prompts, read-only mode, backup, activity, auto-stop ---- */
window.SNIPS=[];
async function loadSnips(cwd){const r=await api('/api/snippets'+(cwd?'?cwd='+encodeURIComponent(cwd):'')).catch(()=>null);window.SNIPS=r&&!r.error?[...(r.project||[]),...(r.global||[])]:[];return r}
/* insert text into the open terminal as a paste (it is NOT sent: you press Enter yourself) */
function insertPrompt(text){if(!curT||!TM.has(curT))return false;const clean=String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,'');tpost('/api/term-in',{tid:curT,d:'\x1b[200~'+clean+'\x1b[201~'});const o=TM.get(curT);try{o.term.focus()}catch{}return true}
/* terminal bar: "Prompts" menu for the open terminal's folder */
async function paintPromptMenu(){
  const b=$('#tsn');if(!b)return;const o=TM.get(curT);await loadSnips(o&&o.cwd);
  b.innerHTML='<option value="">Prompts...</option>'+window.SNIPS.map((x,i)=>`<option value="${i}">${esc(x.name)}</option>`).join('');
  b.onchange=()=>{if(b.value!==''){insertPrompt(window.SNIPS[+b.value].text);b.value=''}};
}
/* read-only mode: banner + switch in the sidebar */
async function drawMode(){
  const m=await api('/api/mode').catch(()=>null);if(!m||m.error)return;window.MODE=m;
  let ban=$('#robanner');if(!ban){ban=document.createElement('div');ban.id='robanner';ban.className='ro';const mn=document.querySelector('main');mn.prepend(ban)}
  ban.hidden=!m.readOnly;ban.textContent='Read-only mode is on: nothing can be changed, and secrets cannot be shown.';
  let sw=$('#rosw');if(!sw){sw=document.createElement('label');sw.id='rosw';sw.className='mut';sw.style.cssText='display:block;margin:8px 0';sw.innerHTML='<input type="checkbox" id="roc" style="padding:0"> read-only mode';$('#projs').before(sw);
    $('#roc').onchange=async e=>{const r=await api('/api/readonly',{on:e.target.checked});if(r.error){alert(r.error);}drawMode()}}
  $('#roc').checked=m.readOnly;$('#roc').disabled=m.locked;
}
/* Library (global): prompts, backup, activity */
async function libGlobalExtras(el){
  const [S,M]=await Promise.all([loadSnips(''),api('/api/mode')]);
  el.insertAdjacentHTML('beforeend',`<div class="card"><h3>Saved prompts <span class="badge">${(S.global||[]).length}</span></h3><div class="mut">Prompts you reuse. Open one from the terminal's Prompts menu or Ctrl+K. It is inserted, never sent for you.</div>${snipRows(S.global||[],'global')}${snipForm()}</div>
   <div class="card"><h3>Backup</h3><div class="mut">One file with your session tags, notes, types, pins, decisions notes, saved prompts and settings. It never contains secrets or chat text. Import only adds what is missing.</div>
    <div class="row"><button id="bkx">Export backup</button><label class="mut">Import <input type="file" id="bki" accept="application/json" style="padding:0"></label><span class="mut" id="bkm"></span></div></div>
   <div class="card"><h3>Recent activity</h3>${(M.activity||[]).map(a=>`<div class="row"><span class="mut">${new Date(a.t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span>${esc(a.action)}</span><span class="mut">${esc(a.detail)}</span></div>`).join('')||'<div class="mut">Nothing yet. Deletions, automatic stops and imports are listed here.</div>'}</div>`);
  bindSnips(el,'global');
  $('#bkx').onclick=async()=>{const r=await fetch('/api/export',{headers:{'x-hub':'1'}}),b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='marram-backup.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)};
  $('#bki').onchange=async e=>{const f=e.target.files[0];if(!f)return;let data;try{data=JSON.parse(await f.text())}catch{$('#bkm').textContent='not a valid file';return}
    const d=await api('/api/import',{data,dryRun:true});if(d.error){$('#bkm').textContent=d.error;return}
    const P=d.preview;if(!d.added){$('#bkm').textContent='nothing new in this file';return}
    $('#bkm').innerHTML='';const box=document.createElement('div');box.className='q';box.innerHTML=`<b>Review before importing.</b> This file would add ${P.tags} session tags, ${P.notes.length} decisions notes and ${P.snippets.length} saved prompts. Decisions notes are added to the instructions of new sessions, so read them.`+
      P.notes.map(n=>`<div class="row"><b>${esc(short(n.path))}</b><span>${esc(n.text.slice(0,300))}</span></div>`).join('')+P.snippets.map(x=>`<div class="row"><b>${esc(x.name)}</b><span class="mut">${esc(x.scope==='global'?'global':short(x.scope))}</span><span>${esc(x.text.slice(0,200))}</span></div>`).join('')+`<div class="row"><button id="bkok" class="primary">Import these</button><button id="bkno">Cancel</button></div>`;
    $('#bkm').after(box);$('#bkno').onclick=()=>box.remove();$('#bkok').onclick=async()=>{const r=await api('/api/import',{data});box.remove();$('#bkm').textContent=r.error||('added '+r.added+' items');if(!r.error)load()}};
}
const snipRows=(arr,scope)=>arr.map(x=>`<div class="row"><b>${esc(x.name)}</b><span class="mut">${esc(x.text.slice(0,90))}${x.text.length>90?'...':''}</span><button data-sd="${x.id}" data-ss="${esc(scope)}">delete</button></div>`).join('')||'<p class="mut">none yet</p>';
const snipForm=()=>`<div class="row"><input data-sn placeholder="name, e.g. Review my diff" style="width:200px"><input data-st placeholder="the prompt" style="flex:1;min-width:200px"><button data-sa>Save prompt</button><span class="mut" data-sm></span></div>`;
function bindSnips(el,scope){
  el.querySelectorAll('[data-sd]').forEach(b=>b.onclick=async()=>{await api('/api/snippet-del',{scope:b.dataset.ss,id:b.dataset.sd});drawLib()});
  el.querySelectorAll('[data-sa]').forEach(b=>b.onclick=async()=>{const row=b.parentElement,r=await api('/api/snippet-set',{scope,name:row.querySelector('[data-sn]').value,text:row.querySelector('[data-st]').value});if(r.error){row.querySelector('[data-sm]').textContent=r.error;return}drawLib()});
}
/* Optimize > System: stop idle sessions automatically (off by default) */
async function autoStopCard(el){
  const m=await api('/api/mode');const v=m.autoStopMin||0;
  el.insertAdjacentHTML('beforeend',`<div class="card"><h3>Stop idle sessions automatically</h3><div class="mut">Ends Claude processes that have been idle this long. The chats stay on disk and resume later. Off by default. A process you are in the middle of reading can be ended too, so pick a long time.</div>
   <div class="row"><select id="asm">${[[0,'Off'],[60,'after 1 hour'],[120,'after 2 hours'],[240,'after 4 hours'],[480,'after 8 hours']].map(([x,l])=>`<option value="${x}" ${x===v?'selected':''}>${l}</option>`).join('')}</select><span class="mut" id="asx"></span></div>
   ${(m.activity||[]).filter(a=>a.action==='stopped idle process').slice(0,5).map(a=>`<div class="row"><span class="mut">${new Date(a.t).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span class="mut">${esc(a.detail)}</span></div>`).join('')}</div>`);
  $('#asm').onchange=async e=>{const r=await api('/api/auto-stop',{minutes:+e.target.value});$('#asx').textContent=r.error||'saved'};
}
/* pull request line inside a card's "code changes" */
async function paintPr(box,cwd){
  const el=box.querySelector('.prs');if(!el)return;const p=await api('/api/pr-status?cwd='+encodeURIComponent(cwd)).catch(()=>null);if(!p){el.textContent='';return}
  if(p.error){el.textContent=p.error;return}
  if(!p.pr){el.textContent='No pull request for branch '+p.branch;return}
  const x=p.pr;el.innerHTML=`<a href="${esc(x.url)}" target="_blank" rel="noopener">PR #${x.number}</a> ${esc(x.state)} · checks ${esc(x.checks)} <span class="mut">${esc(x.title)}</span>`;
}
drawMode();
