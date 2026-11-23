/* ---- daily update: plain-language summary of what you worked on, ready to paste into a team meeting or Slack ---- */
const RANGES={today:'Today',yesterday:'Yesterday',week:'Last 7 days'};
function rangeBounds(k){const d=new Date();d.setHours(0,0,0,0);const t=d.getTime();return k==='today'?[t,Date.now()+1]:k==='yesterday'?[t-864e5,t]:[t-6*864e5,Date.now()+1]}
/* make a session title read like a person wrote it: no ticket ids, code, paths or file names */
function plainTitle(s){
  let t=(s.name||s.title||(s.first||'').split('\n')[0]||'').replace(/`[^`]*`/g,'').replace(/\b[A-Z][A-Z0-9]+-\d+\b/g,'').replace(/(?:^|\s)#\d+\b/g,'').replace(/\b[\w./-]+\.(?:js|ts|py|sql|md|json|sh|tf|yml|yaml)\b/gi,'').replace(/\/[\w./-]+/g,'')
    .replace(/^(task|bug|fix|feat|chore)\s*\d*\s*[:\-–]?\s*/i,'').replace(/[_]+/g,' ').replace(/\s+/g,' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g,'');
  if(t.length>80)t=t.slice(0,80).replace(/\s+\S*$/,'')+'...';
  return t?t[0].toUpperCase()+t.slice(1):'Untitled work';
}
function buildReport(k,list){ // list = freshly fetched sessions of every agent; a closed session you touched in the period counts as finished work
  const [a,b]=rangeBounds(k),L=(list||D.sessions).filter(s=>s.mtime>=a&&s.mtime<b);
  const G=new Map();
  for(const s of L){const key=(tickets(s)[0])||(ghRefs(s)[0])||('s:'+s.id); /* only sessions on the same ticket or issue are merged; every other session keeps its own line */(G.get(key)||G.set(key,[]).get(key)).push(s)}
  const rows=[...G].map(([key,l])=>{const top=l.sort((x,y)=>y.mtime-x.mtime)[0],open=l.some(s=>(s.status==='active'||s.running)),parked=!open&&l.some(s=>s.status==='later'||s.status==='revisit'),id=key.startsWith('s:')?'':key,proj=short(top.repo||top.cwd).split('/').pop();
    return{state:open?'progress':parked?'parked':'done',t:(id?id+' – ':'')+plainTitle(top)+(id?'':' ('+proj+')'),mt:top.mtime}}).sort((x,y)=>y.mt-x.mt);
  const sec=(h,st)=>{const r=rows.filter(x=>x.state===st);if(!r.length)return '';return h+'\n'+r.slice(0,6).map(x=>'• '+x.t).join('\n')+(r.length>6?`\n• and ${r.length-6} smaller items`:'')+'\n\n'};
  const d=new Date(),day=d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'long'});
  const head=k==='today'?`Update – ${day}`:k==='yesterday'?`Update – yesterday`:`Update – last 7 days`;
  return rows.length?head+'\n\n'+sec('Done:','done')+sec('In progress:','progress')+sec('Parked for later:','parked').trimEnd():head+'\n\nNothing recorded in this period.';
}
async function openReport(){
  let m=$('#rpm');if(!m){m=document.createElement('div');m.id='rpm';m.className='modal';document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)m.hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!m.hidden)m.hidden=true})}
  m.hidden=false;let k=m.dataset.k||'today',list=null;
  const fresh=async()=>{const r=await api('/api/sessions').catch(()=>null);list=r&&r.sessions?r.sessions:D.sessions}; // always the latest, all agents, whatever the page was showing
  const paint=()=>{m.dataset.k=k;m.innerHTML=`<div class="npb" style="width:min(640px,100%)"><div class="row" style="justify-content:space-between;margin:0"><h1 style="margin:0">Daily update</h1><button id="rpx">close</button></div>
    <div class="chips" style="margin:0">${Object.entries(RANGES).map(([x,l])=>`<button data-rk="${x}" class="${k===x?'on':''}">${l}</button>`).join('')}<button id="rpf" title="read the latest sessions again">refresh</button></div>
    <textarea id="rpt" style="min-height:260px;font-family:var(--ui);font-size:14px">${esc(buildReport(k,list))}</textarea>
    <div class="row" style="justify-content:space-between"><span class="mut">Built from your session titles and tickets as of ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}. Edit freely before you send it.</span><span><button id="rps">Send...</button> <button id="rpc" class="primary">Copy</button></span></div></div>`;
    $('#rpx').onclick=()=>m.hidden=true;m.querySelectorAll('[data-rk]').forEach(b=>b.onclick=async()=>{k=b.dataset.rk;await fresh();paint()});
    $('#rpf').onclick=async()=>{await fresh();paint()};
    $('#rps').onclick=()=>{const t=$('#rpt').value;m.hidden=true;openSend(t)};
    $('#rpc').onclick=async e=>{try{await navigator.clipboard.writeText($('#rpt').value);e.target.textContent='copied'}catch{$('#rpt').select();e.target.textContent='press Ctrl+C'}}};
  m.innerHTML='<div class="npb"><p class="mut">reading your latest sessions...</p></div>';await fresh();paint();
}
