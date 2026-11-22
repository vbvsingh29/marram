/* ---- watch: what needs you (quiet sessions, collisions, secrets pasted in chats, heavy context) ---- */
let WF={},WR=null;
const HEAVY=150000;
const isHeavy=f=>f&&(f.ctx>=HEAVY||f.compacts>=2);
async function loadWatch(){const r=await api('/api/watch').catch(()=>null);if(!r||r.error)return;WR=r;WF=r.flags||{};applyFlags();updTitle();if(tab==='watch')drawWatch(true)}
function quietSessions(){const now=Date.now();return D.sessions.filter(s=>s.running&&now-s.mtime>120000)}
function updTitle(){const q=quietSessions().length,n=q+(WR?WR.secrets.length+WR.collisions.files.length+WR.collisions.folders.length:0);document.title=(q?'('+q+') ':'')+'Marram';const b=document.querySelector('#tabs [data-t=watch]');if(b)b.textContent='Watch'+(n?' ('+n+')':'')}
function applyFlags(){document.querySelectorAll('.card[data-id]').forEach(c=>{
  const f=WF[c.dataset.id],h=c.querySelector('h3');if(!h)return;let b=h.querySelector('.fl');
  if(!f||(!f.secret&&!isHeavy(f))){if(b)b.remove();return}
  if(!b){b=document.createElement('span');b.className='badge fl warn';h.appendChild(b)}
  b.textContent=[f.secret?'secret in chat':'',isHeavy(f)?'context '+fmtN(f.ctx):''].filter(Boolean).join(' · ');b.title='See the Watch tab'})}
const _bind=bind;bind=function(){_bind();applyFlags()};
/* desktop alert when a running session ends (opt-in) */
function notifyDone(oldD,newD){
  if(!('Notification' in window)||Notification.permission!=='granted'||LSx.get('notify')!=='1')return;
  const was=new Set(oldD.sessions.filter(s=>s.running).map(s=>s.id));
  for(const s of newD.sessions)if(was.has(s.id)&&!s.running)new Notification('Session finished',{body:(s.name||s.title||s.first||'').slice(0,90),tag:s.id})}
const wrow=(s,extra)=>`<div class="row"><a href="#" data-j="${s.id}">${esc(s.name||s.title||(s.first||'').slice(0,60)||s.id)}</a><span class="mut">${esc(short(s.cwd||'').split('/').pop())}</span>${extra||''}</div>`;
async function drawWatch(quiet){
  const el=$('#wch');if(!WR&&!quiet){el.innerHTML='<p class="mut">checking sessions...</p>';await loadWatch();if(!WR){el.innerHTML='<p class="mut">could not read watch data</p>';return}}
  const R=WR||{secrets:[],context:[],collisions:{files:[],folders:[]}},C=R.collisions||{files:[],folders:[]},Q=quietSessions(),
    now=Date.now(),FIN=D.sessions.filter(s=>!s.running&&s.status==='active'&&now-s.mtime<3*3600e3&&(!s.agent||s.agent==='claude')).slice(0,8);
  const can='Notification' in window,on=can&&Notification.permission==='granted'&&LSx.get('notify')==='1';
  const sec=(t,n,body)=>n?`<div class="card"><h3>${t} <span class="badge warn">${n}</span></h3>${body}</div>`:'';
  const html=
    sec('Waiting for you',Q.length,`<div class="mut">Running, but nothing written for 2+ minutes. Probably asking you something.</div>`+Q.map(s=>wrow(s,`<span class="mut">quiet ${Math.round((now-s.mtime)/60000)} min</span>${acts(s.id)}`)).join(''))+
    sec('Collisions',C.files.length+C.folders.length,C.files.map(f=>`<div class="q">Two sessions edited <code>${esc(short(f.path))}</code>: ${f.sessions.map(s=>`<a href="#" data-j="${s.id}">${esc(s.title)}</a>`).join(', ')}</div>`).join('')+C.folders.map(f=>`<div class="q">${f.sessions.length} running sessions share one folder <code>${esc(short(f.cwd))}</code>: ${f.sessions.map(s=>`<a href="#" data-j="${s.id}">${esc(s.title)}</a>`).join(', ')}. Use separate worktrees.</div>`).join(''))+
    sec('Secrets in chats',R.secrets.length,`<div class="mut">A key, token or password was pasted into these chats or printed by a command. Revoke it at its provider. The text stays in the transcript file on disk.</div>`+R.secrets.map(s=>wrow(s,`<span class="mut">${Object.entries(s.kinds).map(([k,n])=>esc(k)+' ×'+n).join(', ')}</span>${acts(s.id)}`)).join(''))+
    sec('Heavy context',R.context.length,`<div class="mut">Long sessions get slower, costlier and less accurate. Hand off to a fresh session.</div>`+R.context.slice(0,10).map(s=>wrow(s,`<span class="mut">context ${fmtN(s.ctx)}${s.compacts?` · compacted ${s.compacts}×`:''}</span><button data-ho="${s.id}">copy handoff</button>`)).join(''))+
    sec('Finished recently',FIN.length,FIN.map(s=>wrow(s,`<span class="mut">${ago(s.mtime)}</span>${acts(s.id)}`)).join(''));
  el.innerHTML=`<div class="bar" style="justify-content:space-between"><h1 style="margin:0">Watch</h1>${can?`<button id="wn">${on?'Desktop alerts: on':'Turn on desktop alerts'}</button>`:''}</div>`+
    (html||'<div class="card"><b>All clear.</b><div class="mut">Nothing is waiting, colliding or leaking.</div></div>')+(R.scanning?`<p class="mut">still scanning chats (${R.progress.done}/${R.progress.total})...</p>`:'');
  el.querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();jump(a.dataset.j)});
  el.querySelectorAll('[data-ho]').forEach(b=>b.onclick=async()=>{const t=await fetch('/api/handoff?id='+b.dataset.ho,{headers:{'x-hub':'1'}}).then(x=>x.text());try{await navigator.clipboard.writeText(t);b.textContent='copied'}catch{b.textContent='copy failed'}});
  if($('#wn'))$('#wn').onclick=async()=>{if(on){LSx.set('notify','0')}else{const p=await Notification.requestPermission();if(p==='granted')LSx.set('notify','1')}drawWatch(true)};
}
setTimeout(loadWatch,3000);setInterval(()=>{if(!document.hidden)loadWatch()},60000);
