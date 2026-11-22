/* ---- chat viewer (read-only transcript) ---- */
const fmtT=ts=>ts?new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
function mdLite(t){let h=esc(t);h=h.replace(/```([\s\S]*?)```/g,(m,c)=>'<pre>'+c.replace(/^\w*\n/,'')+'</pre>').replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');return h}
function chatMsg(m){
  if(m.r==='u')return `<div class="cm cu"><div class="cw">you · ${fmtT(m.ts)}</div><div class="cb">${mdLite(m.t)}</div></div>`;
  if(m.r==='a')return `<div class="cm ca"><div class="cw">claude · ${fmtT(m.ts)}</div><div class="cb">${mdLite(m.t)}</div></div>`;
  if(m.r==='t')return `<div class="cm ct">⏺ ${esc(m.t)}</div>`;
  return `<details class="cm co ${m.r==='e'?'ce':''}"><summary>⎿ ${m.r==='e'?'error':'result'} <span class="mut">${esc(m.t.slice(0,90).replace(/\n/g,' '))}</span></summary><pre>${esc(m.t)}</pre></details>`}
async function openChat(id,fromRoute){
  const s=D.sessions.find(x=>x.id===id);if(!s){chatId='';return}chatId=id;if(!fromRoute)syncHash();let ov=$('#chatv');if(!ov){ov=document.createElement('div');ov.id='chatv';document.body.appendChild(ov)}
  ov.innerHTML=`<div class="chd"><div><b>${esc(s.name||s.title||s.first.slice(0,80)||id)}</b><div class="mut">${esc(short(s.cwd))} · ${id.slice(0,8)}</div></div><div class="row" style="margin:0"><label class="mut"><input type="checkbox" id="cvt" checked> tool calls</label><button id="cvo" class="primary">resume in terminal</button><button id="cvx">close</button></div></div><div class="cbody" id="cvb"><p class="mut">loading...</p></div>`;
  ov.hidden=false;$('#cvx').onclick=closeChat;$('#cvo').onclick=()=>{ov.hidden=true;chatId='';openTerm(id,s.cwd)};
  const tg=()=>$('#cvb').classList.toggle('notools',!$('#cvt').checked);$('#cvt').onchange=tg;
  const r=await api('/api/transcript?id='+id+'&agent='+((D.sessions.find(x=>x.id===id)||{}).agent||'claude'));const b=$('#cvb');
  if(r.error){b.innerHTML='<p class="mut">'+esc(r.error)+'</p>';return}
  let start=r.start;b.innerHTML=(start>0?`<button id="cvm">load ${start} earlier messages</button>`:'')+'<div id="cvl">'+r.msgs.map(chatMsg).join('')+'</div>';
  b.scrollTop=b.scrollHeight;
  const more=$('#cvm');if(more)more.onclick=async()=>{const q=await api('/api/transcript?id='+id+'&agent='+((D.sessions.find(x=>x.id===id)||{}).agent||'claude')+'&before='+start);const h=b.scrollHeight;$('#cvl').insertAdjacentHTML('afterbegin',q.msgs.map(chatMsg).join(''));start=q.start;if(start>0)more.textContent='load '+start+' earlier messages';else more.remove();b.scrollTop=b.scrollHeight-h}
}
document.addEventListener('click',()=>document.querySelectorAll('.mm').forEach(x=>x.hidden=true));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#chatv')&&!$('#chatv').hidden)closeChat()});
