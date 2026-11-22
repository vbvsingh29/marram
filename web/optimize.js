/* ---- optimize ---- */
let ol='session';
const fmtN=n=>n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'k':String(n);
const OLD={session:'Which sessions are big, old or forgotten: the ones to finish, hand off or close.',token:'Where the tokens go, read from your Claude transcripts. Counts only (no prices); numbers are estimates.',system:'What is running on this machine: Claude processes and memory.'};
async function drawOpt(){
  const el=$('#opt');
  el.innerHTML=`<div class="bar">${[['session','Session'],['token','Token'],['system','System']].map(([k,l])=>`<button data-ol="${k}" class="${ol===k?'on':''}">${l}</button>`).join('')}</div><div class="mut">${OLD[ol]}</div><div id="ob"></div>`;
  el.querySelectorAll('[data-ol]').forEach(b=>b.onclick=()=>{ol=b.dataset.ol;drawOpt()});
  const b=$('#ob');if(ol==='system')return drawOptSystem(b);if(ol==='token')return drawOptTokens(b);drawOptSessions(b);
}
async function drawOptSessions(el){
  const L=D.sessions.filter(s=>s.status!=='done').sort((a,b)=>b.size-a.size).slice(0,15),p=await api('/api/auto-close-preview');
  el.innerHTML=`<div class="card"><h3>Biggest open sessions</h3><div class="mut">A big session carries a lot of context into every turn. Finish it, copy a handoff, start fresh, or mark it done.</div>${L.map(s=>`<div class="row"><b>${s.size>1048576?(s.size/1048576).toFixed(1)+' MB':(s.size/1024).toFixed(0)+' KB'}</b><a href="#" data-j="${s.id}">${esc(s.name||s.title||s.first.slice(0,60)||s.id)}</a><span class="mut">${esc(short(s.cwd).split('/').pop())} · ${ago(s.mtime)}</span>${s.running?'<span class="badge run">running</span>':''}<button data-done="${s.id}">mark done</button></div>`).join('')}</div>
  <div class="card"><h3>Forgotten</h3><div class="mut">${p.n} session(s) idle ${p.days}+ days with no tag are marked done automatically every 6 hours.</div></div>`;
  el.querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();jump(a.dataset.j)});
  el.querySelectorAll('[data-done]').forEach(b=>b.onclick=async()=>{await api('/api/tag',{id:b.dataset.done,status:'done'});const s=D.sessions.find(x=>x.id===b.dataset.done);if(s)s.status='done';drawOptSessions(el)});
}
async function drawOptTokens(el){
  el.innerHTML='<p class="mut">reading transcripts (first run can take a few seconds)...</p>';
  const R=await api('/api/optimize-tokens'),T=R.projects.reduce((a,p)=>({in:a.in+p.in,out:a.out+p.out,cr:a.cr+p.cr,cc:a.cc+p.cc}),{in:0,out:0,cr:0,cc:0}),tot=x=>x.in+x.out+x.cr+x.cc;
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:8px 0 14px"><div class="tile"><div class="n">${fmtN(T.out)}</div><div class="l">output tokens</div></div><div class="tile"><div class="n">${fmtN(T.in+T.cc)}</div><div class="l">fresh input (incl. cache writes)</div></div><div class="tile"><div class="n">${fmtN(T.cr)}</div><div class="l">cache reads</div></div><div class="tile"><div class="n">~${fmtN(R.skillContext.approxTokens)}</div><div class="l">skill list loaded into every session</div></div></div>
  <div class="grid"><div class="card"><h3>Skills add context to every session <span class="badge">${R.skillContext.skills} skills</span></h3><div class="mut">Each global or plugin skill puts its name and description in every session (about ${fmtN(R.skillContext.approxTokens)} tokens in total). Turning off ones you never use saves that on every turn.</div>${R.skillContext.biggest.map(k=>`<div class="row"><span class="badge">~${k.approxTokens}</span><b>${esc(k.name)}</b><span class="mut">${esc(k.src)}</span></div>`).join('')}</div>
  <div class="card"><h3>By project</h3>${R.projects.slice(0,10).map(p=>`<div class="row"><b>${fmtN(tot(p))}</b><span>${esc(short(p.repo))}</span><span class="mut">${p.sessions} sessions · out ${fmtN(p.out)}</span></div>`).join('')||'<p class="mut">no usage data</p>'}</div>
  <div class="card"><h3>Heaviest sessions</h3>${R.top.slice(0,10).map(s=>`<div class="row"><b>${fmtN(tot(s))}</b><a href="#" data-j="${s.id}">${esc(s.title)}</a><span class="mut">${s.turns} turns</span></div>`).join('')}</div></div>`;
  el.querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();jump(a.dataset.j)});
}
async function drawOptSystem(el){
  el.innerHTML='<p class="mut">reading processes...</p>';
  const R=await api('/api/procs'),idle=R.procs.filter(p=>!p.busy),fr=idle.reduce((a,p)=>a+p.rss,0);
  el.innerHTML=`<div id="stats2" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:4px 0 14px"><div class="tile"><div class="n">${R.procs.length}</div><div class="l">claude processes</div></div><div class="tile"><div class="n">${mb(R.total)}</div><div class="l">memory used by claude</div></div><div class="tile"><div class="n">${mb(R.mem.avail)}</div><div class="l">free of ${mb(R.mem.total)} RAM</div></div></div>
  <div class="bar"><button id="ci" ${idle.length?'':'disabled'}>Close all idle (${idle.length}, frees ~${mb(fr)})</button><button id="rfo">refresh</button></div>
  <div class="mut">Idle = no activity in that folder for 15+ minutes. Closing sends SIGTERM; transcripts stay on disk and resume with claude --resume. Unsaved terminal state is lost.</div>
  <h1 style="margin-top:12px">Quick wins</h1>${R.tips.map(t=>`<div class="q">- ${esc(t)}</div>`).join('')}
  <h1 style="margin-top:12px">Auto-close</h1><div class="q" id="acx">checking...</div><h1 style="margin-top:12px">Heaviest transcripts</h1><div class="mut">Big transcripts load a lot of context when resumed. For new work, start fresh and hand off with the handoff button.</div>${[...D.sessions].sort((a,b)=>b.size-a.size).slice(0,8).map(s=>`<div class="row"><span class="badge">${(s.size/1048576).toFixed(1)} MB</span><a href="#" data-j="${s.id}">${esc(s.name||s.title||s.first.slice(0,70)||s.id)}</a><span class="mut">${esc(short(s.cwd).split('/').pop())} - ${ago(s.mtime)}</span></div>`).join('')}
  <h1 style="margin-top:12px">Processes</h1>`+R.procs.map(p=>`<div class="card"><h3>${esc(short(p.cwd))} <span class="pill st-${p.busy?'active':'later'}"><i></i>${p.busy?'busy':'idle'}</span> <span class="badge">${mb(p.rss)}</span></h3><div class="mut">pid ${p.pid} - running ${Math.round(p.age/60)} min - last activity ${p.lastActive?ago(p.lastActive):'unknown'}</div><div class="row"><button data-k="${p.pid}" data-b="${p.busy?1:''}">Close</button></div></div>`).join('');
  $('#rfo').onclick=drawOpt;
  el.querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();jump(a.dataset.j)});
  api('/api/auto-close-preview').then(p=>{$('#acx').innerHTML=`${p.n} session(s) idle ${p.days}+ days with no tag. They are marked done automatically every 6 hours (running sessions and ones you tagged are never touched). Tags are backed up daily to ~/.claude/hub-backups. <button id="acn" ${p.n?'':'disabled'}>Close them now</button>`;$('#acn').onclick=async()=>{const r=await api('/api/auto-close',{});await load();drawOpt()}});
  $('#ci').onclick=async()=>{if(!confirm('Close '+idle.length+' idle claude process(es)?'))return;await api('/api/kill-idle',{});drawOpt()};
  el.querySelectorAll('[data-k]').forEach(b=>b.onclick=async()=>{if(b.dataset.b&&!confirm('This one was active in the last 15 minutes. Close it anyway?'))return;const r=await api('/api/kill',{pid:b.dataset.k,force:!!b.dataset.b});if(r.error)alert(r.error);drawOpt()});
}
