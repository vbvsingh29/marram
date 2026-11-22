/* ---- command palette (Ctrl+K / Cmd+K): jump to any session, project or tab, or run an action ---- */
let palItems=[],palSel=0;
function palBuild(){
  const A=[{l:'New session',h:'action',run:()=>openNew()},{l:'Daily update (copy for Slack)',h:'action',run:()=>openReport()},
    {l:'Switch theme',h:'action',run:()=>$('#th').click()},{l:'Select several sessions',h:'action',run:()=>{setTab('sessions');selMode=true;draw()}}];
  const T=TABS.map(t=>({l:'Go to '+t[1],h:'tab',run:()=>setTab(t[0])}));
  const seen=new Set(),P=[];D.sessions.forEach(s=>{const r=s.repo||s.cwd;if(!seen.has(r)){seen.add(r);P.push({l:'Project: '+short(r).split('/').pop(),h:short(r),run:()=>{setTab('sessions');proj=r;pg=true;draw();loadRules()}})}});
  const S=[...D.sessions].sort((a,b)=>b.mtime-a.mtime).slice(0,300).map(s=>({l:s.name||s.title||(s.first||'').slice(0,70)||s.id,h:short(s.cwd).split('/').pop()+' · '+ago(s.mtime)+(s.pin?' · pinned':''),run:()=>jump(s.id)}));
  const R=[];if(curT&&TM.has(curT))(window.SNIPS||[]).forEach(x=>R.push({l:'Insert prompt: '+x.name,h:'into the open terminal',run:()=>insertPrompt(x.text)}));
  return [...A,...R,...T,...P,...S];
}
function palFilter(q){
  const w=q.toLowerCase().split(/\s+/).filter(Boolean);if(!w.length)return palItems.slice(0,12);
  return palItems.map(i=>{const t=(i.l+' '+i.h).toLowerCase();return w.every(x=>t.includes(x))?{i,s:(i.l.toLowerCase().startsWith(w[0])?0:1)+(i.h==='action'?-1:0)}:null}).filter(Boolean).sort((a,b)=>a.s-b.s).slice(0,12).map(x=>x.i);
}
function openPalette(){
  let m=$('#pal');if(!m){m=document.createElement('div');m.id='pal';m.className='modal';m.style.alignItems='flex-start';document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)m.hidden=true})}
  palItems=palBuild();palSel=0;m.hidden=false;
  m.innerHTML=`<div class="npb" style="margin-top:12vh"><input id="pq" placeholder="Type to find a session, project, tab or action" autocomplete="off" spellcheck="false"><div id="pl" class="npl" style="max-height:50vh"></div><div class="mut">&uarr;&darr; to move, Enter to open, Esc to close</div></div>`;
  const q=$('#pq'),paint=()=>{const L=palFilter(q.value);if(palSel>=L.length)palSel=Math.max(0,L.length-1);$('#pl').innerHTML=L.map((i,k)=>`<div class="proj ${k===palSel?'sel':''}" data-k="${k}"><span>${esc(i.l)}</span><span class="mut">${esc(i.h)}</span></div>`).join('')||'<p class="mut" style="padding:8px">nothing matches</p>';
    $('#pl').querySelectorAll('[data-k]').forEach(e=>e.onclick=()=>{m.hidden=true;L[+e.dataset.k].run()});palFilter.cur=L};
  q.oninput=()=>{palSel=0;paint()};
  q.onkeydown=e=>{const L=palFilter.cur||[];if(e.key==='ArrowDown'){e.preventDefault();palSel=Math.min(L.length-1,palSel+1);paint()}else if(e.key==='ArrowUp'){e.preventDefault();palSel=Math.max(0,palSel-1);paint()}else if(e.key==='Enter'&&L[palSel]){m.hidden=true;L[palSel].run()}else if(e.key==='Escape'){m.hidden=true}};
  paint();q.focus();
}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();const m=$('#pal');m&&!m.hidden?m.hidden=true:openPalette()}});
