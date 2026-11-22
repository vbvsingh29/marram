/* ---- close for good: stops the process and deletes the chat; needs a typed confirmation ---- */
function openDestroy(s){
  let m=$('#dxm');if(!m){m=document.createElement('div');m.id='dxm';m.className='modal';document.body.appendChild(m);
    m.addEventListener('click',e=>{if(e.target===m)m.hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!m.hidden)m.hidden=true})}
  const mb=(s.size/1048576).toFixed(1),name=esc(s.name||s.title||s.first.slice(0,60)||s.id);
  m.hidden=false;
  m.innerHTML=`<div class="npb"><h1 style="margin:0">Close for good</h1><div><b>${name}</b><div class="mut">${esc(short(s.cwd))} · ${mb} MB</div></div>
  <ul class="q" style="margin:0;padding-left:18px"><li>${s.running?'<b>Stops it now</b>: its Claude process is running and will be ended (also in other terminals).':'Nothing is running for it now.'}</li><li>Closes its terminal here, if one is open.</li><li>Deletes the chat file and Claude's saved edits and todos for it. <b>It cannot be resumed, and this cannot be undone.</b></li><li>Afterwards nothing can use tokens for it in the background.</li></ul>
  <label class="mut">Type <b>DELETE</b> to confirm</label><input id="dxi" autocomplete="off" spellcheck="false" placeholder="DELETE">
  <div class="row" style="justify-content:flex-end"><span class="mut" id="dxm2"></span><button id="dxc">Cancel</button><button id="dxd" class="danger" disabled>Delete forever</button></div></div>`;
  const i=$('#dxi'),b=$('#dxd');i.focus();i.oninput=()=>{b.disabled=i.value!=='DELETE'};
  $('#dxc').onclick=()=>m.hidden=true;
  b.onclick=async()=>{b.disabled=true;$('#dxm2').textContent='deleting...';const r=await api('/api/session-destroy',{id:s.id,confirm:i.value});
    if(r.error){$('#dxm2').textContent=r.error;i.value='';return}
    D.sessions=D.sessions.filter(x=>x.id!==s.id);lastSig=sigOf(D);m.hidden=true;draw()};
}
