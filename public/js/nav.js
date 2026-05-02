(function(){
var pages=[
  {href:'/',label:'Обзор',paths:['/','/index.html','index.html']},
  {href:'trading.html',label:'Торговля'},
  {href:'exchange.html',label:'Обмен'},
  {href:'wallet.html',label:'Активы'},
  {href:'deposit.html',label:'Депозит'},
  {href:'withdraw.html',label:'Вывод'},
  {href:'reviews.html',label:'Отзывы'},
  {href:'news.html',label:'Новости'},
  {href:'profile.html',label:'Профиль'}
];
var mobPages=[
  {href:'/',label:'Обзор',icon:'<svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',paths:['/','/index.html','index.html']},
  {href:'trading.html',label:'Торговля',icon:'<svg viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>'},
  {href:'exchange.html',label:'Обмен',icon:'<svg viewBox="0 0 24 24"><path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>'},
  {href:'wallet.html',label:'Активы',icon:'<svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>'},
  {href:'profile.html',label:'Профиль',icon:'<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}
];
function isActive(p){
  var path=location.pathname;
  var file=path.split('/').pop()||'index.html';
  if(p.paths)return p.paths.indexOf(file)!==-1||p.paths.indexOf(path)!==-1;
  return file===p.href;
}
function buildHeader(){
  var file=(location.pathname.split('/').pop()||'index.html');
  var isHome=(file==='index.html'||file==='');
  var backBtn=isHome?'':'<button class="back-btn" onclick="history.back()" title="\u041d\u0430\u0437\u0430\u0434"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button>';
  var h='<div class="header-in">'+backBtn+'<a href="/" class="logo"><div class="logo-m">T</div><div class="logo-t">Trust<span>Ex</span></div></a><div class="nav">';
  for(var i=0;i<pages.length;i++){
    var p=pages[i];
    h+='<a href="'+p.href+'"'+(isActive(p)?' class="act"':'')+'>'+p.label+'</a>';
  }
  h+='</div><div class="hdr-r"><span class="hdr-email" id="navUserEmail"></span><button class="hdr-out" onclick="Auth.logout()">Выйти</button></div></div>';
  return h;
}
function buildMobnav(){
  var h='';
  for(var i=0;i<mobPages.length;i++){
    var p=mobPages[i];
    h+='<a href="'+p.href+'"'+(isActive(p)?' class="act"':'')+'>'+p.icon+p.label+'</a>';
  }
  return h;
}
function buildFooter(){
  return '<div class="footer-inner"><div class="footer-cols">'
    +'<div class="footer-col"><div class="footer-logo"><span class="footer-logo-icon">T</span><span class="footer-logo-text">Trust<span>Ex</span></span></div>'
    +'<p class="footer-desc">Надёжная платформа для торговли криптовалютами. Мгновенные сделки, низкие комиссии, профессиональные инструменты.</p>'
    +'</div>'
    +'<div class="footer-col"><h4 class="footer-heading">Продукты</h4><ul class="footer-links">'
    +'<li><a href="exchange.html">Обмен валют</a></li><li><a href="trading.html">Торговля</a></li><li><a href="wallet.html">Кошелёк</a></li><li><a href="deposit.html">Пополнение</a></li><li><a href="withdraw.html">Вывод средств</a></li>'
    +'</ul></div>'
    +'<div class="footer-col"><h4 class="footer-heading">Поддержка</h4><ul class="footer-links">'
    +'<li><a href="support.html">Центр поддержки</a></li><li><a href="faq.html">Часто задаваемые вопросы</a></li><li><a href="guide.html">Руководство по торговле</a></li><li><a href="news.html">Новости</a></li>'
    +'</ul></div>'
    +'<div class="footer-col"><h4 class="footer-heading">Компания</h4><ul class="footer-links">'
    +'<li><a href="about.html">О нас</a></li><li><a href="reviews.html">Отзывы</a></li><li><a href="#" onclick="openAgreement();return false">Условия использования</a></li><li><a href="privacy.html">Политика конфиденциальности</a></li><li><a href="license.pdf" target="_blank">Лицензия</a></li>'
    +'</ul></div>'
    +'</div><div class="footer-divider"></div><div class="footer-bottom"><div class="footer-legal">'
    +'<p class="footer-disclaimer">Торговля криптовалютами сопряжена с высокими рисками. Стоимость активов может как расти, так и падать. Вы можете потерять часть или все инвестированные средства. Прошлые результаты не гарантируют будущую доходность.</p>'
    +'<p class="footer-disclaimer" style="margin-top:8px;font-size:11px;opacity:.7">TrustEx Switzerland operates in compliance with Swiss financial regulations and is subject to oversight by the Swiss Financial Market Supervisory Authority (FINMA).</p>'
    +'<div class="footer-badges">'
    +'<span class="footer-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg> SSL шифрование</span>'
    +'<span class="footer-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg> 2FA защита</span>'
    +'<span class="footer-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Верифицированная платформа</span>'
    +'</div></div><div class="footer-copy"><span>&copy; 2024\u20132026 TrustEx. Все права защищены.</span><span class="footer-version">v2.1.0</span></div></div></div>';
}
function init(){
  var hdr=document.querySelector('.header');
  if(hdr)hdr.innerHTML=buildHeader();
  var mob=document.querySelector('.mobnav');
  if(mob)mob.innerHTML=buildMobnav();
  if(!document.querySelector('.site-footer')){
    var f=document.createElement('footer');
    f.className='site-footer';
    f.innerHTML=buildFooter();
    var scripts=document.body.querySelectorAll('script');
    if(scripts.length)document.body.insertBefore(f,scripts[0]);
    else document.body.appendChild(f);
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();

// ── Agreement modal ──
var _agreementText=null;
var _agreement2Text=null;
function openAgreement(){
  var useAgr2 = !!window._useAgreement2;
  var ov=document.getElementById('agreementOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='agreementOverlay';
    ov.className='agreement-overlay';
    ov.innerHTML='<div class="agreement-modal"><div class="agreement-modal-head"><h3>Условия использования</h3><button class="agreement-close" onclick="closeAgreement()">&times;</button></div><div class="agreement-body" id="agreementBody">Загрузка...</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click',function(e){if(e.target===ov)closeAgreement();});
  }
  ov.classList.add('open');
  document.body.style.overflow='hidden';
  var body=document.getElementById('agreementBody');

  if(useAgr2){
    if(_agreement2Text){body.textContent=_agreement2Text;return;}
    body.textContent='Загрузка...';
    fetch('/agreement%202.txt').then(function(r){
      if(!r.ok)throw new Error(r.status);
      return r.text();
    }).then(function(t){
      _agreement2Text=t;
      document.getElementById('agreementBody').textContent=t;
    }).catch(function(e){
      console.error('Agreement2 fetch error:',e);
      document.getElementById('agreementBody').textContent='Не удалось загрузить условия. Попробуйте позже.';
    });
  } else {
    if(_agreementText){body.textContent=_agreementText;return;}
    body.textContent='Загрузка...';
    fetch('/agreement.txt').then(function(r){
      if(!r.ok)throw new Error(r.status);
      return r.text();
    }).then(function(t){
      _agreementText=t;
      document.getElementById('agreementBody').textContent=t;
    }).catch(function(e){
      console.error('Agreement fetch error:',e);
      document.getElementById('agreementBody').textContent='Не удалось загрузить условия. Попробуйте позже.';
    });
  }
}
function closeAgreement(){
  var ov=document.getElementById('agreementOverlay');
  if(ov)ov.classList.remove('open');
  document.body.style.overflow='';
}
