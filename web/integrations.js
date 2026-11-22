/* ---- messaging (Slack, Teams, Discord, any webhook) and custom agents ---- */
const SLACK_SCOPES='chat:write, channels:read, groups:read, users:read, users:read.email, im:write (and chat:write.public to post in channels the app has not joined)';
const KIND_LABEL={slack:'Slack webhook',teams:'Teams webhook',discord:'Discord webhook',generic:'Other webhook'};
async function libIntegrations(el){
  const I=await api('/api/integrations');if(I.error)return;
  el.insertAdjacentHTML('beforeend',`<div class="card" id="msgcard"><h3>Messaging ${I.slack.connected?'<span class="badge">Slack connected</span>':''}</h3>
   <div class="conn">${(()=>{const k={};I.hooks.forEach(h=>k[h.kind]=(k[h.kind]||0)+1);const hk=Object.entries(k).map(([a,n])=>n+' '+(KIND_LABEL[a]||a).replace(' webhook','')).join(', ');
     const r=(on,n,t)=>`<div class="row" style="margin:3px 0"><span class="dot ${on?'on':''}"></span><b style="min-width:110px">${n}</b><span class="mut">${esc(t)}</span></div>`;
     return r(I.slack.connected,'Slack',I.slack.connected?'connected: send to channels and to people (direct messages)':'not connected: add a bot token below')+r(I.hooks.length,'Webhooks',I.hooks.length?hk+': post to the channel each one was made for':'none saved')+r(true,'Teams chat','ready: opens a chat with your message in Teams')+r(true,'Email','ready: opens a draft in Gmail, Outlook, Outlook.com or your mail app')+r(I.custom.length,'Custom agents',I.custom.length?I.custom.length+' added':'none added')})()}</div>
   <div class="mut">Send a message to Slack (a channel or a person) or to any webhook. You always see who it goes to and confirm before anything is sent. Tokens and webhook addresses stay in a private file on this computer and are never shown again.</div>
   <details ${I.slack.connected?'':'open'}><summary>Slack: ${I.slack.connected?'connected':'connect with a bot token'}</summary>
    <div class="mut">Create a Slack app at api.slack.com/apps, add these bot permissions: ${esc(SLACK_SCOPES)}. Install it to your workspace, then paste the Bot User OAuth Token (xoxb-...).</div>
    <div class="row">${I.slack.connected?`<button id="slt">Test connection</button><button id="slx">Disconnect</button>`:`<input id="slk" type="password" autocomplete="off" placeholder="xoxb-..." style="flex:1;min-width:220px"><button id="sls">Save token</button>`}<span class="mut" id="slm"></span></div></details>
   <details><summary>Webhooks (${I.hooks.length})</summary>
    <div class="mut">Slack, Teams, Discord and most chat tools give you an incoming-webhook address. A webhook posts to the one channel it was made for. Teams works through webhooks only.</div>
    ${I.hooks.map(h=>`<div class="row"><b>${esc(h.label)}</b><span class="badge">${esc(KIND_LABEL[h.kind]||h.kind)}</span><span class="mut">${esc(h.host)}</span><button data-hd="${h.id}">delete</button></div>`).join('')}
    <div class="row"><select id="hk">${Object.entries(KIND_LABEL).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select><input id="hl" placeholder="name, e.g. Team standup" style="width:190px"><input id="hu" type="password" autocomplete="off" placeholder="https://..." style="flex:1;min-width:200px"><button id="ha">Add webhook</button><span class="mut" id="hm"></span></div></details>
   <div class="row"><button id="smsg">Send a message...</button></div></div>
   <div class="card"><h3>Custom agents <span class="badge">${I.custom.length}</span></h3><div class="mut">Add any command-line tool (aider, gemini, opencode, your own script). It appears in "+ New session" and runs in the real terminal, with your secrets available. No session history is kept for these.</div>
    ${I.custom.map(a=>`<div class="row"><b>${esc(a.label)}</b><code class="mut">${esc(a.command)}</code><button data-cd="${esc(a.id)}">remove</button></div>`).join('')}
    <div class="row"><input id="cl" placeholder="name, e.g. Aider" style="width:170px"><input id="cc" placeholder="command, e.g. aider --model sonnet" style="flex:1;min-width:220px"><button id="ca">Add agent</button><span class="mut" id="cm"></span></div></div>`);
  if($('#sls'))$('#sls').onclick=async()=>{const r=await api('/api/slack-token',{token:$('#slk').value});if(r.error){$('#slm').textContent=r.error;return}drawLib()};
  if($('#slx'))$('#slx').onclick=async()=>{await api('/api/slack-clear',{});drawLib()};
  if($('#slt'))$('#slt').onclick=async()=>{$('#slm').textContent='checking...';const r=await api('/api/slack-test',{});$('#slm').textContent=r.error?('Not working: '+r.error):('Connected to '+r.workspace+' as '+r.as)};
  el.querySelectorAll('[data-hd]').forEach(b=>b.onclick=async()=>{await api('/api/hook-del',{id:b.dataset.hd});drawLib()});
  $('#ha').onclick=async()=>{const r=await api('/api/hook-add',{kind:$('#hk').value,label:$('#hl').value,url:$('#hu').value});if(r.error){$('#hm').textContent=r.error;return}drawLib()};
  $('#smsg').onclick=()=>openSend('');
  el.querySelectorAll('[data-cd]').forEach(b=>b.onclick=async()=>{await api('/api/custom-agent-del',{id:b.dataset.cd});drawLib()});
  $('#ca').onclick=async()=>{const r=await api('/api/custom-agent-set',{label:$('#cl').value,command:$('#cc').value});if(r.error){$('#cm').textContent=r.error;return}drawLib()};
}
/* the send dialog: pick where it goes, read it, confirm, then see exactly what happened.
   Slack person/channel and webhooks are sent by Marram. Email and Teams chat open a ready draft in YOUR app; you press Send there. */
const PROV={gmail:'Gmail',outlook:'Outlook (work or school)',outlookcom:'Outlook.com (personal)',mailto:'your mail app'};
async function openSend(text){
  let m=$('#sdm');if(!m){m=document.createElement('div');m.id='sdm';m.className='modal';document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)m.hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!m.hidden)m.hidden=true})}
  m.hidden=false;m.innerHTML='<div class="npb"><p class="mut">loading...</p></div>';
  const I=await api('/api/integrations');if(I.error){m.innerHTML=`<div class="npb"><p>${esc(I.error)}</p><button id="sdx">close</button></div>`;$('#sdx').onclick=()=>m.hidden=true;return}
  let via=I.slack.connected?'person':(I.hooks.length?'hook':'email'),pick=null,found=[],timer=null,body=text||'',to='',subject='',tpl=false,prov=(()=>{try{return localStorage.getItem('hub.mailprov')||'gmail'}catch{return 'gmail'}})();
  const draft=via=>via==='email'||via==='teams';
  const target=()=>{
    if(draft(via)){if(!to.trim())return null;const p=via==='teams'?'Teams':PROV[prov];return {label:p+' to '+to.trim().replace(/\s*[,;]\s*/g,', ')}}
    if(!pick)return null;
    return via==='hook'?{via:'hook',hookId:pick.id,label:pick.label}:{via:'slack',label:pick.label,to:{id:pick.id,type:via==='person'?'person':'channel',label:pick.label}}};
  const enterEmail=()=>{if(tpl)return;tpl=true;const first=(body.split('\n').find(l=>l.trim())||'').replace(/^[#*•\s-]+/,'').trim();if(!subject)subject=first.slice(0,80);body='Hi all,\n\n'+body.trim()+'\n\nThanks'};
  const paint=(stage,res)=>{
    const t=target(),needSlack=(via==='person'||via==='channel')&&!I.slack.connected;
    m.innerHTML=`<div class="npb" style="width:min(660px,100%)"><div class="row" style="justify-content:space-between;margin:0"><h1 style="margin:0">Send a message</h1><button id="sdx">close</button></div>
     <div class="chips" style="margin:0">${[['person','Slack person'],['channel','Slack channel'],['hook','Webhook'],['email','Email'],['teams','Teams chat']].map(([k,l])=>`<button data-sv="${k}" class="${via===k?'on':''}">${l}</button>`).join('')}</div>
     ${needSlack?`<p class="mut">Slack is not connected yet. Connect it in Library, Messaging.</p>`:via==='hook'?(I.hooks.length?`<select id="shk"><option value="">choose a webhook...</option>${I.hooks.map(h=>`<option value="${h.id}" ${pick&&pick.id===h.id?'selected':''}>${esc(h.label)} (${esc(KIND_LABEL[h.kind]||h.kind)})</option>`).join('')}</select><div class="mut">A webhook posts to the one channel it was made for (this is how Teams channels work).</div>`:'<p class="mut">No webhooks saved yet. Add one in Library, Messaging.</p>'):
       draft(via)?`<div class="mut">${via==='teams'?'Opens Teams with a chat to these people and your message ready. You press Send in Teams. Use their work email addresses.':'Opens a draft in your own mail. You press Send there; Marram stores no sign-in and cannot see whether it was sent.'}</div>
         ${via==='email'?`<div class="row" style="margin:0"><select id="mpv">${Object.entries(PROV).map(([k,l])=>`<option value="${k}" ${prov===k?'selected':''}>${l}</option>`).join('')}</select></div>`:''}
         <input id="mto" placeholder="${via==='teams'?'Who to chat with: email addresses, comma separated':'To: email addresses, comma separated'}" value="${esc(to)}" autocomplete="off">${via==='email'?`<input id="msj" placeholder="Subject" value="${esc(subject)}" maxlength="150">`:''}`:
       `<input id="sq" placeholder="${via==='person'?'Search a person by name or email':'Search a channel'}" autocomplete="off" value="${esc(m.dataset.q||'')}"><div id="sr" class="npl" style="max-height:170px"></div>`}
     ${pick&&!draft(via)?`<div class="q"><b>To:</b> ${esc(pick.label)}</div>`:''}
     <textarea id="smt" style="min-height:${via==='email'?210:160}px;font-family:var(--ui);font-size:14px" maxlength="3500" placeholder="What do you want to say?">${esc(body)}</textarea>
     ${stage==='confirm'?`<div class="q" style="border:1px solid var(--ac2);border-radius:8px;padding:8px"><b>Check before ${draft(via)?'opening':'sending'}.</b> ${draft(via)?`This opens a draft addressed to <b>${esc(to.trim())}</b> in ${via==='teams'?'Teams':esc(PROV[prov])}. Nothing is sent until you press Send there.`:`This will post ${body.trim().length} characters to <b>${esc(t.label)}</b>${via==='person'?' as a direct message':''}. It cannot be unsent from here.`}</div><div class="row" style="justify-content:flex-end"><button id="sdb">Back</button><button id="sdy" class="primary">${draft(via)?'Open the draft':'Yes, send it'}</button></div>`:
       res?`<div class="q" style="border:1px solid ${res.ok?'var(--ac)':'var(--err)'};border-radius:8px;padding:8px">${res.ok?(res.draft?`<b>Draft opened.</b> Nothing has been sent yet: press Send in ${via==='teams'?'Teams':esc(PROV[prov])}.${res.shortened?' The message was long, so the draft has the beginning only. The full text is on your clipboard: paste it into the draft.':''}`:`<b>Sent</b> to ${esc(t.label)} at ${new Date(res.at).toLocaleTimeString()}.${res.link?` <a href="${esc(res.link)}" target="_blank" rel="noopener">Open the message</a>`:''}`):`<b>${draft(via)?'Could not open the draft.':'Not sent.'}</b> ${esc(res.error)}`}</div><div class="row" style="justify-content:flex-end">${res.ok?'':'<button id="sdb">Edit and try again</button>'}<button id="sdd" class="${res.ok?'primary':''}">Done</button></div>`:
       `<div class="row" style="justify-content:flex-end"><span class="mut" id="sdm2"></span><button id="sdr" class="primary">${draft(via)?'Review and open draft':'Review and send'}</button></div>`}</div>`;
    $('#sdx').onclick=()=>m.hidden=true;if($('#sdd'))$('#sdd').onclick=()=>m.hidden=true;
    const keep=()=>{const x=$('#smt');if(x)body=x.value;if($('#mto'))to=$('#mto').value;if($('#msj'))subject=$('#msj').value};
    m.querySelectorAll('[data-sv]').forEach(b=>b.onclick=()=>{keep();via=b.dataset.sv;pick=null;found=[];m.dataset.q='';if(via==='email')enterEmail();paint()});
    if($('#mpv'))$('#mpv').onchange=e=>{keep();prov=e.target.value;try{localStorage.setItem('hub.mailprov',prov)}catch{}};
    if($('#shk'))$('#shk').onchange=e=>{keep();const h=I.hooks.find(x=>x.id===e.target.value);pick=h?{id:h.id,label:h.label+' ('+(KIND_LABEL[h.kind]||h.kind)+')'}:null;paint()};
    if($('#sq')){const q=$('#sq');const list=()=>{$('#sr').innerHTML=found.map((f,i)=>`<div class="proj" data-i="${i}"><span>${via==='person'?esc(f.name)+(f.handle?` <span class="mut">@${esc(f.handle)}</span>`:''):'#'+esc(f.name)+(f.private?' <span class="mut">private</span>':'')}</span><span class="mut">${via==='person'?esc([f.email,f.title].filter(Boolean).join(' · ')):esc(f.members+' members')}${f.sameName?' <span class="badge warn">same name as another person</span>':''}</span></div>`).join('')||(q.value.trim()?'<p class="mut" style="padding:8px">no match</p>':'');
        const dup=via==='person'&&found.length>1&&found.some(f=>f.sameName);if(dup)$('#sr').insertAdjacentHTML('afterbegin','<div class="q" style="padding:6px 8px"><b>More than one person has this name.</b> Pick the right one by email or title.</div>');
        $('#sr').querySelectorAll('[data-i]').forEach(r=>r.onclick=()=>{keep();const f=found[+r.dataset.i];pick={id:f.id,label:via==='person'?f.name+(f.email?' ('+f.email+')':''):'#'+f.name};m.dataset.q=q.value;paint()})};
      list();q.oninput=()=>{clearTimeout(timer);m.dataset.q=q.value;timer=setTimeout(async()=>{const r=await api('/api/slack-find?kind='+(via==='person'?'person':'channel')+'&q='+encodeURIComponent(q.value));if(r.error){$('#sr').innerHTML=`<p class="mut" style="padding:8px">${esc(r.error)}</p>`;return}found=r;list()},300)};q.focus()}
    if($('#sdr'))$('#sdr').onclick=()=>{keep();if(!target()){$('#sdm2').textContent=draft(via)?'Add at least one email address':'Choose who it goes to first';return}if(!body.trim()){$('#sdm2').textContent='Write a message first';return}paint('confirm')};
    if($('#sdb'))$('#sdb').onclick=()=>paint();
    if($('#sdy'))$('#sdy').onclick=async()=>{$('#sdy').disabled=true;$('#sdy').textContent=draft(via)?'opening...':'sending...';
      if(draft(via)){const r=await api('/api/compose',{kind:via==='teams'?'teams':prov,to,subject,body});if(r.error){paint('done',{ok:false,error:r.error});return}
        if(r.shortened){try{await navigator.clipboard.writeText(body)}catch{}}
        if(r.url.startsWith('mailto:'))location.href=r.url;else window.open(r.url,'_blank','noopener');paint('done',{ok:true,draft:true,shortened:r.shortened});return}
      const r=await api('/api/send',{...target(),text:body,confirm:true});paint('done',r.error?{ok:false,error:r.error}:{ok:true,link:r.link,at:r.at||Date.now()})};
  };
  if(via==='email')enterEmail();paint();
}
