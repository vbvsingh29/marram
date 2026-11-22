/* ---- skills ---- */
async function loadSk(box,id,cwd){
  const [pk,sg]=await Promise.all([api('/api/project-skills?cwd='+encodeURIComponent(cwd)),api('/api/suggest?id='+id+'&cwd='+encodeURIComponent(cwd))]);
  box.innerHTML=`<div class="mut">Skills apply to the whole folder ${esc(short(cwd))} and take effect when a session starts or resumes.</div>
  <div class="row"><b>Enabled here:</b> ${(pk.map(k=>`<span class="pill">${esc(k.name)} ${k.link?`<a href="#" data-rm="${esc(k.name)}">remove</a>`:''}</span>`).join(''))||'<span class="mut">none in this folder</span>'}</div>
  <div class="row"><b>Suggested:</b> ${(sg.map(k=>`<span class="pill" title="${esc(k.desc)}">${esc(k.name)} <span class="mut">(${esc(k.why)})</span> <a href="#" data-ad="${esc(k.name)}">add</a></span>`).join(''))||'<span class="mut">nothing matched</span>'}</div>
  <div class="row"><button data-defs="1">Apply my default skills to this folder</button></div>`;
  box.querySelectorAll('[data-rm]').forEach(a=>a.onclick=async e=>{e.preventDefault();await api('/api/skill-remove',{cwd,name:a.dataset.rm});loadSk(box,id,cwd)});
  box.querySelectorAll('[data-ad]').forEach(a=>a.onclick=async e=>{e.preventDefault();await api('/api/skill-add',{cwd,name:a.dataset.ad});loadSk(box,id,cwd)});
  box.querySelector('[data-defs]').onclick=async()=>{await api('/api/apply-defaults',{cwd});loadSk(box,id,cwd)};
}
let sq='',sf='all';
let libScope='global';
async function drawLib(){
  const el=$('#lib'),dirs=[...new Set(D.sessions.map(s=>s.repo||s.cwd))].filter(d=>!d.includes('/.gemini/')).sort();
  if(proj!=='ALL'&&libScope==='global'&&!el.dataset.init){libScope=proj}el.dataset.init=1;
  const g=libScope==='global',cwd=g?'':libScope;
  const [V,K,PK,R]=await Promise.all([api('/api/vault'),api('/api/skills'),g?[]:api('/api/project-skills?cwd='+encodeURIComponent(cwd)),g?api('/api/rules?cwd='+encodeURIComponent('/home'))
    :api('/api/rules?cwd='+encodeURIComponent(cwd))]);
  const gl=K.filter(k=>k.src==='global'),mine=V.filter(v=>v.scope===libScope),inh=g?[]:V.filter(v=>v.scope==='global');
  const rp=g?null:R.find(r=>r.path===cwd+'/CLAUDE.md'),gp=R.find(r=>r.path.endsWith('/.claude/CLAUDE.md'));
  const vrow=v=>`<div class="row" data-v="${v.id}"><b>${esc(v.name)}</b><code class="vv mut">${'•'.repeat(Math.min(v.len,16))}</code><span class="mut">${esc(v.note)}${v.scope==='global'&&!g?' (global, inherited)':''}</span><button data-a="show">show</button><button data-a="copy">copy</button><button data-a="edit">edit</button><button data-a="del">delete</button></div>`;
  el.innerHTML=`<h1>Library</h1><div class="mut">Global = applies everywhere. Project = only that folder. Project secrets override global ones with the same name.</div>
  <div class="bar"><select id="lsc"><option value="global">Global (all projects)</option>${dirs.map(d=>`<option value="${esc(d)}" ${d===libScope?'selected':''}>${esc(short(d))}</option>`).join('')}</select></div>
  <div class="card"><h3>Secrets <span class="badge">${mine.length}</span></h3>
   <div class="mut">Saved in <code>~/.claude/hub-vault.json</code> (owner-only file, plain text, same as ~/.git-credentials). Never shown in lists, never put in chats or git. Sessions started from this hub (terminal and New session) get them as environment variables, so Claude and its commands can use <code>$NAME</code>. A session you open yourself in another terminal does not; there use: <code>export BITBUCKET_TOKEN=$(node server.js --secret BITBUCKET_TOKEN)</code></div>
   ${mine.map(vrow).join('')||'<p class="mut">none yet</p>'}${inh.length?`<details><summary>${inh.length} inherited from global</summary>${inh.map(vrow).join('')}</details>`:''}
   <div class="row"><input id="vn" placeholder="NAME e.g. BITBUCKET_TOKEN" style="width:210px"><input id="vv" type="password" autocomplete="off" placeholder="value" style="flex:1;min-width:140px"><input id="vo" placeholder="note (optional)" style="width:170px"><button id="vs">Save secret</button><span class="mut" id="vm"></span></div></div>
  <div class="card"><h3>Rules (CLAUDE.md) <span class="badge">${g?'global':esc(short(cwd))}</span></h3>${(g?[gp]:[rp]).map(r=>{const rpth=r?r.path:(g?D.home+'/.claude':cwd)+'/CLAUDE.md';return `<div class="rule" data-p="${esc(rpth)}"><div class="mut">${esc(short(rpth))}${r?'':' (will be created)'}</div><textarea style="min-height:200px">${esc(r?r.content:'')}</textarea><div class="row"><button class="save">Save</button><span class="mut"></span></div></div>`}).join('')}</div>
  ${g?'':`<div class="card"><h3>Decisions note <span class="badge">${esc(short(cwd))}</span></h3><div class="mut">Short facts every session in this project should respect. Added to new sessions you start from Marram, so they survive fresh sessions and new worktrees. Stored in ~/.claude, not in the repo.</div><textarea id="dn" maxlength="4000" style="min-height:110px" placeholder="e.g. Use the repo's DB helper, never raw SQL. Orders are keyed by dms_ref."></textarea><div class="row"><button id="dns">Save note</button><span class="mut" id="dnm"></span></div></div>
  <div class="card"><h3>Fewer permission prompts</h3><div class="mut">Finds simple read-only commands you approved again and again in this project and suggests allow rules. It only shows them; nothing is changed.</div><div class="row"><button id="ps">Find repeated approvals</button></div><div id="pr"></div></div>`}
  <div class="card"><h3>Skills <span class="badge">${g?gl.length+' global':PK.length+' in project'}</span></h3>
   ${g?gl.map(k=>`<div class="row"><b>${esc(k.name)}</b><span class="mut">${esc(k.desc.slice(0,110))}</span></div>`).join('')||'<p class="mut">no global skills</p>'
   :PK.map(k=>`<div class="row"><b>${esc(k.name)}</b><span class="mut">${k.link?'linked by hub':'own folder'}</span>${k.link?`<button data-rs="${esc(k.name)}">remove</button>`:''}</div>`).join('')||'<p class="mut">no project skills</p>'}
   <div class="row"><select id="lsk" style="max-width:260px"><option value="">add an existing skill...</option>${K.filter(k=>k.src!=='global'&&!(g?false:PK.some(p=>p.name===k.name))).map(k=>`<option value="${esc(k.name)}">${esc(k.name)} (${esc(k.src)})</option>`).join('')}</select><button id="lska">Add to ${g?'global':'this project'}</button><span class="mut" id="lskm"></span></div>
   <div class="row"><input id="lsn" placeholder="new skill name, e.g. bitbucket-pr" style="width:210px"><input id="lsd" placeholder="when should Claude use it?" style="flex:1;min-width:140px"><button id="lskn">Create new</button></div>
   <div class="mut">All stored on this machine: ${g?'~/.claude/skills':esc(short(cwd))+'/.claude/skills'}. Skills from GitHub are copied once into ~/.claude/hub-skills (Hyped tab, install), then linked here. Nothing is fetched at run time.</div></div>`;
  $('#lsc').onchange=e=>{libScope=e.target.value;drawLib()};
  el.querySelectorAll('.rule .save').forEach(b=>b.onclick=async()=>{const d=b.closest('.rule');const r=await api('/api/rules',{path:d.dataset.p,content:d.querySelector('textarea').value});b.nextElementSibling.textContent=r.error?r.error:'saved'});
  el.querySelectorAll('[data-rs]').forEach(b=>b.onclick=async()=>{await api('/api/skill-remove',{cwd,name:b.dataset.rs});drawLib()});
  $('#lska').onclick=async()=>{const n=$('#lsk').value;if(!n)return;const r=await api(g?'/api/skill-global':'/api/skill-add',g?{name:n,on:1}:{cwd,name:n});if(r.error)$('#lskm').textContent=r.error;else drawLib()};
  $('#lskn').onclick=async()=>{const r=await api('/api/skill-new',{scope:libScope,name:$('#lsn').value.trim(),desc:$('#lsd').value});if(r.error)$('#lskm').textContent=r.error;else{$('#lskm').textContent='created '+r.path;setTimeout(drawLib,2500)}};
  if(!g){api('/api/note?cwd='+encodeURIComponent(cwd)).then(r=>{if($('#dn'))$('#dn').value=r.note||''});
    $('#dns').onclick=async()=>{const r=await api('/api/note',{cwd,text:$('#dn').value});$('#dnm').textContent=r.error||'saved'};
    $('#ps').onclick=async()=>{$('#pr').innerHTML='<p class="mut">reading transcripts...</p>';const r=await api('/api/perm-suggest?repo='+encodeURIComponent(cwd));
      $('#pr').innerHTML=r.rows.length?r.rows.map(x=>`<div class="row"><span class="badge">${x.n}x</span><code>${esc(x.rule)}</code></div>`).join('')+`<div class="row"><button id="pc">Copy as settings snippet</button><span class="mut">paste into .claude/settings.local.json</span></div>`:`<p class="mut">Nothing used 3+ times in ${r.sessions} sessions.</p>`;
      if($('#pc'))$('#pc').onclick=async e=>{try{await navigator.clipboard.writeText(r.snippet);e.target.textContent='copied'}catch{e.target.textContent='copy failed'}}}}
  let editId='';
  $('#vs').onclick=async()=>{const r=await api('/api/vault-set',{id:editId,name:$('#vn').value.trim(),value:$('#vv').value,note:$('#vo').value,scope:libScope});if(r.error){$('#vm').textContent=r.error;return}drawLib()};
  el.querySelectorAll('[data-v] button').forEach(b=>b.onclick=async()=>{const row=b.closest('[data-v]'),id=row.dataset.v,a=b.dataset.a;
    if(a==='del'){if(b.dataset.c!=='1'){b.dataset.c='1';b.textContent='really delete?';return}await api('/api/vault-del',{id});return drawLib()}
    if(a==='edit'){const v=V.find(x=>x.id===id);editId=id;$('#vn').value=v.name;$('#vo').value=v.note;$('#vv').placeholder='new value (blank = keep)';$('#vn').scrollIntoView({block:'center'});return}
    const r=await api('/api/vault-get',{id});if(r.error)return;
    if(a==='copy'){try{await navigator.clipboard.writeText(r.value);b.textContent='copied'}catch{b.textContent='copy failed'}setTimeout(()=>b.textContent='copy',1500);return}
    const c=row.querySelector('.vv');if(b.textContent==='show'){c.textContent=r.value;b.textContent='hide';setTimeout(()=>{c.textContent='•'.repeat(Math.min(r.value.length,16));b.textContent='show'},15000)}else{c.textContent='•'.repeat(Math.min(r.value.length,16));b.textContent='show'}});
}
async function drawSkills(){
  const el=$('#skl');el.innerHTML='<p class="mut">scanning skills and usage...</p>';
  const [K,pk]=await Promise.all([api('/api/skills'),proj==='ALL'?[]:api('/api/project-skills?cwd='+encodeURIComponent(proj))]);
  const on=new Set(pk.map(x=>x.name));
  const AU=proj==='ALL'?null:await api('/api/skill-audit?repo='+encodeURIComponent(proj));
  const SF={all:()=>1,global:k=>k.src==='global',plugin:k=>k.src==='plugin',library:k=>k.src==='library',defaults:k=>k.isDefault,used:k=>k.uses>0,never:k=>!k.uses,here:k=>on.has(k.name)};
  const L=K.filter(k=>(SF[sf]||SF.all)(k)&&(!sq||(k.name+' '+k.desc+' '+k.src).toLowerCase().includes(sq.toLowerCase()))).sort((a,b)=>b.isDefault-a.isDefault||b.uses-a.uses||a.name.localeCompare(b.name));
  el.innerHTML=(AU?`<div class="card"><h3>Skill usage in ${esc(short(proj))} <span class="badge">${AU.sessions} sessions</span></h3>${AU.rows.length?AU.rows.slice(0,12).map(r=>`<div class="row"><span class="badge">${r.uses} uses</span><b>${esc(r.name)}</b><span class="mut">${esc(r.src)}${r.enabledHere?' - enabled here':''}</span></div>`).join(''):'<div class="mut">no skills used here yet</div>'}${AU.unusedEnabled.length?`<div class="q">Enabled but never used here: ${AU.unusedEnabled.map(esc).join(', ')}. Consider disabling.</div>`:''}<details><summary>${AU.globalNeverUsed.length} global skills never used in any session</summary><div class="mut">${AU.globalNeverUsed.map(esc).join(', ')||'none'}. Every global skill adds its description to every session; moving unused ones out of ~/.claude/skills saves context.</div></details></div>`:'')+`<h1>All skills (${K.length})</h1><div class="mut">global = loaded in every session. library = installed by this hub, off until enabled per folder. plugin = from an installed plugin. Star = default (one-click apply to a folder). Uses = times Claude invoked it in your transcripts.</div>
  <div class="bar"><input id="sqi" placeholder="search skills" value="${esc(sq)}" style="flex:1;min-width:160px"><button id="top5">Set 5 most-used as defaults</button>${proj!=='ALL'?`<button id="apd">Apply defaults to ${esc(short(proj))}</button>`:'<span class="mut">pick a project in the sidebar to enable skills per folder</span>'}</div>`+
  `<div class="chips">${[['all','All'],['global','Global'],['plugin','Plugins'],['library','Installed'],['defaults','Defaults'],['used','Used'],['never','Never used'],...(proj!=='ALL'?[['here','Enabled here']]:[])].map(([k,l])=>`<button data-sf="${k}" class="${sf===k?'on':''}">${l} (${K.filter(SF[k]).length})</button>`).join('')}</div><div class="grid">`+L.map(k=>`<div class="card"><h3>${esc(k.name)} <span class="badge">${esc(k.src)}</span> ${k.uses?`<span class="badge">${k.uses} uses</span>`:''} ${k.from?`<a class="badge" href="https://github.com/${esc(k.from)}" target="_blank" rel="noopener">${esc(k.from)}</a>`:''}</h3><div class="q">${esc(k.desc)}</div>
   <div class="row">${k.src!=='global'?`<button data-star="${esc(k.name)}" class="${k.isDefault?'on':''}">${k.isDefault?'default':'make default'}</button>`:''}
   ${proj!=='ALL'&&k.src!=='global'?(on.has(k.name)?`<button data-off="${esc(k.name)}">disable in project</button>`:`<button data-on="${esc(k.name)}">enable in project</button>`):''}
   ${k.from?`<button data-un="${esc(k.name)}">uninstall</button>`:''}</div></div>`).join('')+'</div>';
  el.querySelectorAll('[data-sf]').forEach(b=>b.onclick=()=>{sf=b.dataset.sf;drawSkills()});
  $('#sqi').oninput=e=>{sq=e.target.value;clearTimeout(window._st);window._st=setTimeout(()=>{drawSkills().then(()=>{const i=$('#sqi');i.focus();i.setSelectionRange(sq.length,sq.length)})},350)};
  $('#top5').onclick=async()=>{await api('/api/skill-defaults-top',{});drawSkills()};
  if($('#apd'))$('#apd').onclick=async()=>{const r=await api('/api/apply-defaults',{cwd:proj});alert('added: '+((r.added||[]).join(', ')||'nothing new'));drawSkills()};
  el.querySelectorAll('[data-star]').forEach(b=>b.onclick=async()=>{await api('/api/skill-default',{name:b.dataset.star,on:!b.classList.contains('on')});drawSkills()});
  el.querySelectorAll('[data-on]').forEach(b=>b.onclick=async()=>{await api('/api/skill-add',{cwd:proj,name:b.dataset.on});drawSkills()});
  el.querySelectorAll('[data-off]').forEach(b=>b.onclick=async()=>{await api('/api/skill-remove',{cwd:proj,name:b.dataset.off});drawSkills()});
  el.querySelectorAll('[data-un]').forEach(b=>b.onclick=async()=>{if(confirm('Delete installed skill '+b.dataset.un+' from the hub library?')){await api('/api/skill-uninstall',{name:b.dataset.un});drawSkills()}});
}
