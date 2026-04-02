(function(){
var pages=[
  {href:'/',label:'Обзор',paths:['/','/index.html','index.html']},
  {href:'trading.html',label:'Торговля'},
  {href:'exchange.html',label:'Обмен'},
  {href:'wallet.html',label:'Активы'},
  {href:'deposit.html',label:'Депозит'},
  {href:'withdraw.html',label:'Вывод'},
  {href:'reviews.html',label:'Отзывы'},
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
  var h='<div class="header-in"><a href="/" class="logo"><div class="logo-m">T</div><div class="logo-t">Trust<span>Ex</span></div></a><div class="nav">';
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
    +'<div class="footer-socials">'
    +'<a href="#" class="footer-social" title="Telegram"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg></a>'
    +'<a href="#" class="footer-social" title="Twitter"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>'
    +'<a href="#" class="footer-social" title="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg></a>'
    +'</div></div>'
    +'<div class="footer-col"><h4 class="footer-heading">Продукты</h4><ul class="footer-links">'
    +'<li><a href="exchange.html">Обмен валют</a></li><li><a href="trading.html">Торговля</a></li><li><a href="wallet.html">Кошелёк</a></li><li><a href="deposit.html">Пополнение</a></li><li><a href="withdraw.html">Вывод средств</a></li>'
    +'</ul></div>'
    +'<div class="footer-col"><h4 class="footer-heading">Поддержка</h4><ul class="footer-links">'
    +'<li><a href="support.html">Центр поддержки</a></li><li><a href="#">Часто задаваемые вопросы</a></li><li><a href="#">Руководство по торговле</a></li><li><a href="#">API документация</a></li>'
    +'</ul></div>'
    +'<div class="footer-col"><h4 class="footer-heading">Компания</h4><ul class="footer-links">'
    +'<li><a href="#">О нас</a></li><li><a href="reviews.html">Отзывы</a></li><li><a href="#" onclick="openAgreement();return false">Условия использования</a></li><li><a href="#">Политика конфиденциальности</a></li>'
    +'</ul></div>'
    +'</div><div class="footer-divider"></div><div class="footer-bottom"><div class="footer-legal">'
    +'<p class="footer-disclaimer">Торговля криптовалютами сопряжена с высокими рисками. Стоимость активов может как расти, так и падать. Вы можете потерять часть или все инвестированные средства. Прошлые результаты не гарантируют будущую доходность.</p>'
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
