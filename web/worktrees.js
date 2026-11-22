/* ---- worktrees ---- */
async function drawWt(fresh){
  const el=$('#wtp');el.innerHTML='<p class="mut">scanning worktrees (git status on each, about 10-20 s)...</p>';
  const W=await api('/api/worktrees'+(fresh?'?fresh=1':'')),el2=W.rows.filter(r=>r.eligible),sk=r=>r.path.replace(/^\/home\/[^/]+\/projects\//,'');
  el.innerHTML=`<h1>Worktrees (${W.rows.length})</h1><div class="mut">Eligible = idle ${W.idleDays}+ days (last commit and last Claude session), clean, nothing unpushed, not running. Removal uses git worktree remove without --force; branches are kept.</div>
  <div class="bar"><button id="wre" ${el2.length?'':'disabled'}>Remove all eligible (${el2.length})</button><button id="wrf">rescan</button><span class="mut" id="wm"></span></div>
  ${W.orphans.length?`<div class="card"><h3>Orphans (${W.orphans.length}) <span class="mut">git link points at a deleted repo</span></h3>${W.orphans.map(o=>`<div class="row"><span>${esc(sk({path:o}))}</span><button data-o="${esc(o)}">delete folder</button></div>`).join('')}</div>`:''}
  <div class="bar"><select id="wsf"><option value="all">all states</option><option value="eligible">eligible</option><option value="recent">recent</option><option value="dirty">dirty</option><option value="unpushed">unpushed</option><option value="missing">missing</option><option value="running">running</option></select><input id="wsq" placeholder="filter by repo / name / branch" style="min-width:220px"><button id="wsa">select shown</button><button id="wsn">clear</button>
   <label class="mut"><input type="checkbox" id="wdb"> also delete branch (only if fully merged)</label><button id="wrs" class="primary" disabled>Remove selected (0)</button></div>
  <div id="wbox"></div><div class="tw"><table id="wtt"></table></div>`;
  $('#wrf').onclick=()=>drawWt(true);
  $('#wre').onclick=async()=>{if(!confirm('Remove '+el2.length+' eligible worktrees? Branches are kept; ignored files like .env in them are deleted.'))return;$('#wm').textContent='removing...';const r=await api('/api/wt-remove-eligible',{});alert('removed '+r.removed+', failed '+r.failed+(r.errors.length?'\n'+r.errors.join('\n'):''));drawWt(true)};
  const sel=new Set();
  const shown=()=>{const f=$('#wsf').value,q=$('#wsq').value.toLowerCase();return W.rows.filter(r=>(f==='all'||r.state===f)&&(!q||(r.repo+' '+r.path+' '+(r.branch||'')).toLowerCase().includes(q)))};
  const upd=()=>{const n=sel.size;$('#wrs').textContent='Remove selected ('+n+')';$('#wrs').disabled=!n};
  const paint=()=>{const R=shown();$('#wtt').innerHTML='<tr><th></th><th>repo</th><th>worktree</th><th>branch</th><th>idle</th><th>dirty</th><th>unpushed</th><th>size</th><th>state</th><th></th></tr>'+R.map(r=>`<tr><td><input type="checkbox" data-s="${esc(r.path)}" ${sel.has(r.path)?'checked':''} ${r.state==='running'?'disabled':''}></td><td>${esc(r.repo.split('/').pop())}</td><td title="${esc(r.path)}">${esc(sk(r).split('/').slice(-1)[0])}</td><td>${esc(r.branch||'')}</td><td>${r.missing?'':r.days+'d'}</td><td>${r.dirty||''}</td><td>${r.unpushed||''}</td><td data-sz="${esc(r.path)}"></td><td><span class="pill st-${r.eligible?'done':r.state==='running'?'active':'later'}"><i></i>${r.state}</span></td><td>${r.state==='running'?'':`<button class="rm1" data-r="${esc(r.path)}">remove</button>`}</td></tr>`).join('');
    $('#wtt').querySelectorAll('.rm1').forEach(b=>b.onclick=()=>ask([W.rows.find(r=>r.path===b.dataset.r)]));
    $('#wtt').querySelectorAll('[data-s]').forEach(c=>c.onchange=()=>{c.checked?sel.add(c.dataset.s):sel.delete(c.dataset.s);upd()});upd()};
  $('#wsf').onchange=paint;$('#wsq').oninput=paint;$('#wsa').onclick=()=>{shown().filter(r=>r.state!=='running').forEach(r=>sel.add(r.path));paint()};$('#wsn').onclick=()=>{sel.clear();paint()};
  $('#wrs').onclick=()=>ask(W.rows.filter(r=>sel.has(r.path)));
  const ask=rows=>{
    const risky=rows.filter(r=>r.dirty||r.unpushed),box=$('#wbox'),db=$('#wdb').checked;
    box.innerHTML=`<div class="card"><b>Remove ${rows.length} worktree(s)?</b>
      <div class="mut">The checked-out folder is deleted, including ignored files such as .env. ${db?'Branches are deleted only if fully merged.':'Branches are kept, so committed work is not lost.'}</div>
      ${risky.length?`<div class="mut" style="color:var(--err)">${risky.length} have uncommitted changes or unpushed commits: ${risky.slice(0,6).map(r=>esc(sk(r).split('/').pop())+' ('+(r.dirty?r.dirty+' dirty':'')+(r.dirty&&r.unpushed?', ':'')+(r.unpushed?r.unpushed+' unpushed':'')+')').join('; ')}${risky.length>6?' ...':''}. Uncommitted changes will be LOST.</div><label><input type="checkbox" id="wfc"> I understand, force-remove those too</label>`:''}
      <div class="row"><button class="primary" id="wgo">Yes, remove</button><button id="wno">cancel</button></div></div>`;
    box.scrollIntoView({block:'center'});$('#wno').onclick=()=>box.innerHTML='';
    $('#wgo').onclick=async()=>{const force=!!($('#wfc')&&$('#wfc').checked),paths=rows.filter(r=>force||!(r.dirty||r.unpushed)||r.eligible).map(r=>r.path);
      $('#wgo').disabled=true;$('#wgo').textContent='removing...';
      const res=await api('/api/wt-remove-many',{paths,force,deleteBranch:db});const ok=res.filter(x=>x.ok).length,bad=res.filter(x=>x.error);
      box.innerHTML=`<div class="card"><b>Removed ${ok} of ${rows.length}.</b>${rows.length-paths.length?`<div class="mut">${rows.length-paths.length} skipped (dirty/unpushed, force not ticked).</div>`:''}${bad.map(x=>`<div class="mut" style="color:var(--err)">${esc(sk({path:x.path}))}: ${esc(x.error)}</div>`).join('')}<div class="row"><button id="wdone">refresh list</button></div></div>`;
      $('#wdone').onclick=()=>drawWt(true)}};
  paint();
  el.querySelectorAll('[data-o]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete orphan folder '+b.dataset.o+'?'))return;const r=await api('/api/orphan-remove',{path:b.dataset.o});if(r.error)alert(r.error);drawWt(true)});
  for(const td of el.querySelectorAll('[data-sz]')){if(tab!=='wt')break;const r=await api('/api/du?path='+encodeURIComponent(td.dataset.sz));if(r.kb!=null)td.textContent=r.kb>1024?(r.kb/1024).toFixed(0)+' MB':r.kb+' KB'}
}
