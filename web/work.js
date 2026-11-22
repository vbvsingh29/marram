/* ---- board ---- */
function board(L){return `<div class="board">`+ST.map(k=>{const l=L.filter(s=>s.status===k);return `<div class="col" data-col="${k}"><div class="colh"><i style="background:var(${SC[k]})"></i>${k} <span class="badge">${l.length}</span></div>`+l.map(s=>`<div class="bc" draggable="true" data-id="${s.id}"><div class="bt">${esc(s.name||s.title||s.first.slice(0,60)||s.id)}</div><div class="mut">${esc(short(s.cwd).split('/').pop())} - ${ago(s.mtime)} ${s.running?'<span class="badge run">running</span>':''}</div>${acts(s.id)} ${tickets(s).slice(0,2).map(t=>`${D.jira?`<a class="badge" href="${D.jira}${t}" target="_blank" rel="noopener">${t}</a>`:`<span class="badge">${t}</span>`}`).join(' ')}</div>`).join('')+`</div>`}).join('')+`</div><div class="mut">Drag a card to another column to change its status.</div>`}
function bindBoard(){
  document.querySelectorAll('.bc').forEach(c=>c.ondragstart=e=>e.dataTransfer.setData('text/plain',c.dataset.id));
  document.querySelectorAll('.col').forEach(c=>{c.ondragover=e=>{e.preventDefault();c.classList.add('over')};c.ondragleave=()=>c.classList.remove('over');
    c.ondrop=async e=>{e.preventDefault();c.classList.remove('over');const id=e.dataTransfer.getData('text/plain');if(id){await api('/api/tag',{id,status:c.dataset.col});load()}}});
}
function jump(id){focusId=id;proj='ALL';pg=false;flt='all';$('#q').value='';setTab('sessions');draw();const c=document.querySelector(`.card[data-id="${id}"]`);if(c){c.scrollIntoView({block:'center'});c.classList.add('foc')}}
/* ---- tickets ---- */
/* ---- work items: sessions grouped by ticket id, GitHub issue/PR, or a feature/bug/chore tag ---- */
let wk='',wkind='all';
const KINDS=['feature','bug','chore'];
const ghRefs=s=>{const out=new Set(),txt=(s.name||'')+' '+s.title+' '+s.first;
  for(const m of txt.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g))out.add(m[1]+'#'+m[2]);
  const rn=(s.repo||s.cwd).split('/').pop();for(const m of ((s.name||'')+' '+s.title).matchAll(/(?:^|\s)#(\d{1,6})\b/g))out.add(rn+'#'+m[1]);return [...out]};
const itemLink=k=>/^[\w.-]+\/[\w.-]+#\d+$/.test(k)?'https://github.com/'+k.replace('#','/issues/'):(D.jira&&TRE&&/^[A-Z][A-Z0-9]*-\d+$/.test(k)?D.jira+k:'');
function drawTickets(){
  const m={};D.sessions.forEach(s=>[...tickets(s),...ghRefs(s)].forEach(k=>(m[k]??=[]).push(s)));
  const E=Object.entries(m).filter(([k,l])=>wkind==='all'||l.some(s=>s.kind===wkind)).sort((a,b)=>Math.max(...b[1].map(x=>x.mtime))-Math.max(...a[1].map(x=>x.mtime)));
  const loose=D.sessions.filter(s=>s.kind&&!tickets(s).length&&!ghRefs(s).length&&(wkind==='all'||s.kind===wkind));
  const row=s=>`<div class="row"><span class="pill st-${s.status}"><i></i>${s.status}</span>${s.kind?`<span class="badge">${s.kind}</span>`:''}<a href="#" data-j="${s.id}">${esc(s.name||s.title||s.first.slice(0,70)||s.id)}</a><span class="mut">${esc(short(s.cwd).split('/').pop())} - ${ago(s.mtime)}</span> ${acts(s.id)}</div>`;
  $('#tkt').innerHTML=`<h1>Work items</h1><div class="mut">Sessions grouped by what they are for: a ticket id${TK.length?'':' (set TICKET_PREFIXES to enable, JIRA_BASE to link)'}, a GitHub issue or PR (a github.com link, or #123 in the session name), or a feature / bug / chore tag you set from the card menu.</div>
  <div class="bar"><button data-wk="all" class="${wkind==='all'?'on':''}">all</button>${KINDS.map(k=>`<button data-wk="${k}" class="${wkind===k?'on':''}">${k}</button>`).join('')}<input id="tq" placeholder="filter by id or text" style="flex:1;min-width:160px" value="${esc(wk)}"></div><div id="tl"></div>`;
  const draw2=()=>{const q=wk.toLowerCase();
    const g=E.filter(([k,l])=>!q||k.toLowerCase().includes(q)||l.some(s=>(s.name+' '+s.title).toLowerCase().includes(q))).map(([k,l])=>{const repos=[...new Set(l.map(s=>(s.repo||s.cwd).split('/').pop()))],u=itemLink(k);return `<div class="card"><h3>${u?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(k)}</a>`:esc(k)} <span class="badge">${l.length} sessions</span> ${repos.map(r=>`<span class="badge">${esc(r)}</span>`).join(' ')}</h3>`+l.sort((a,b)=>b.mtime-a.mtime).slice(0,8).map(row).join('')+`</div>`}).join('');
    const lo=loose.filter(s=>!q||(s.name+' '+s.title).toLowerCase().includes(q));
    $('#tl').innerHTML=(g||'')+(lo.length?`<div class="card"><h3>Tagged, no ticket <span class="badge">${lo.length}</span></h3>${lo.sort((a,b)=>b.mtime-a.mtime).slice(0,30).map(row).join('')}</div>`:'')||'<p class="mut">nothing yet. Tag a session as feature, bug or chore from its card menu, or put a ticket id or #123 in its name.</p>';
    $('#tl').querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();jump(a.dataset.j)})};
  $('#tq').oninput=e=>{wk=e.target.value;draw2()};
  $('#tkt').querySelectorAll('[data-wk]').forEach(b=>b.onclick=()=>{wkind=b.dataset.wk;drawTickets()});draw2();
}
