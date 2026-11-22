/* ---- transcript search ---- */
let lastQ='';
async function drawSearch(){
  const el=$('#srp');if($('#q').value)lastQ=$('#q').value;
  el.innerHTML=`<div class="bar"><input id="sq2" value="${esc(lastQ)}" placeholder="text to find inside all chats (3+ chars)" style="flex:1"><button id="sg">Search</button></div><div id="sr"></div>`;
  const go=async()=>{lastQ=$('#sq2').value;if(lastQ.trim().length<3){$('#sr').innerHTML='<p class="mut">type at least 3 characters</p>';return}$('#sr').innerHTML='<p class="mut">searching all transcripts...</p>';
    const R=await api('/api/search?q='+encodeURIComponent(lastQ)),re=new RegExp('('+lastQ.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');
    $('#sr').innerHTML=R.length?`<div class="mut">${R.length} session(s) matched${R.length>=40?' (showing 40 most recent)':''}</div>`+R.map(r=>`<div class="card"><h3><a href="#" data-j="${r.id}">${esc(r.title)}</a> <span class="badge">${esc(r.repo.split('/').pop())}</span> <span class="mut">${ago(r.mtime)}</span> ${acts(r.id)}</h3>${r.hits.map(x=>`<div class="q"><b>${x.who==='user'?'you':'claude'}:</b> ${esc(x.text).replace(re,'<span class="hl">$1</span>')}</div>`).join('')}</div>`).join(''):'<p class="mut">no matches</p>';
    $('#sr').querySelectorAll('[data-j]').forEach(a=>a.onclick=e=>{e.preventDefault();jump(a.dataset.j)})};
  $('#sg').onclick=go;$('#sq2').onkeydown=e=>{if(e.key==='Enter')go()};if(lastQ.length>=3)go();
}
$('#qs').onclick=()=>setTab('search');
