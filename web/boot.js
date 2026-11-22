/* ---- theme + shortcuts ---- */
$('#navb').onclick=()=>document.body.classList.toggle('nav');
$('#th').onclick=()=>{const d=document.documentElement,cur=d.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'),n=cur==='dark'?'light':'dark';d.dataset.theme=n;LSx.set('theme',n)};
document.body.insertAdjacentHTML('beforeend','<div id="help"><b>Shortcuts</b><br>/ search &nbsp; j / k next / previous card<br>a active &nbsp; l later &nbsp; r revisit &nbsp; d done<br>b board / cards &nbsp; ? this help</div>');
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey)return;const t=e.target.tagName;if(/INPUT|TEXTAREA|SELECT/.test(t))return;
  const cards=[...document.querySelectorAll('#list .card')];let i=cards.findIndex(c=>c.classList.contains('foc'));
  if(e.key==='/'){e.preventDefault();setTab('sessions');$('#q').focus()}
  else if(e.key==='?')$('#help').style.display=$('#help').style.display==='block'?'none':'block';
  else if(e.key==='b'){view=view==='board'?'cards':'board';draw()}
  else if((e.key==='j'||e.key==='k')&&cards.length){if(i>=0)cards[i].classList.remove('foc');i=e.key==='j'?Math.min(cards.length-1,i+1):Math.max(0,i-1);cards[i].classList.add('foc');cards[i].scrollIntoView({block:'center'})}
  else if('alrd'.includes(e.key)&&i>=0){const k={a:'active',l:'later',r:'revisit',d:'done'}[e.key],id=cards[i].dataset.id;api('/api/tag',{id,status:k}).then(()=>{focusId=id;load()})}
});
if(/^#\/\w+/.test(location.hash))route();else setTab('sessions');
$('#q').oninput=draw;$('#hb').onchange=draw;
load().then(()=>{if(proj!=='ALL')loadRules()});setInterval(poll,10000);
