/* ---- URL routing: #/<tab>?p=<project>&g=1&f=<filter>&v=<view>&chat=<session id> ---- */
let chatId='';
function curHash(){const p=new URLSearchParams();if(proj!=='ALL')p.set('p',proj);if(agent!=='all')p.set('a',agent);if(pg)p.set('g','1');if(flt!=='all')p.set('f',flt);if(view!=='cards')p.set('v',view);if(chatId)p.set('chat',chatId);const q=p.toString();return '#/'+tab+(q?'?'+q:'')}
function syncHash(){const h=curHash();if(h!==location.hash)history[location.hash?'pushState':'replaceState'](null,'',h)}
async function route(){
  const m=location.hash.match(/^#\/(\w+)(?:\?(.*))?$/);if(!m)return;const p=new URLSearchParams(m[2]||'');
  proj=p.get('p')||'ALL';const na=p.get('a')||'all';const agentChanged=na!==agent;agent=na;pg=p.get('g')==='1';flt=p.get('f')||'all';view=p.get('v')||'cards';
  const t=TABS.some(x=>x[0]===m[1])?m[1]:(m[1]==='tickets'?'work':'sessions');setTab(t,true);
  const c=p.get('chat');
  if(agentChanged&&D.sessions.length)await load();
  if(c){if(!D.sessions.length)await load();else draw();chatId=c;openChat(c,true)}else{chatId='';const o=$('#chatv');if(o)o.hidden=true;if(D.sessions.length)draw()}
  if(proj!=='ALL')loadRules();
}
addEventListener('popstate',route);
function closeChat(){const o=$('#chatv');if(o)o.hidden=true;chatId='';syncHash()}
