'use strict';
const menuButton=document.querySelector('.menu-toggle');
const nav=document.querySelector('#global-nav');
function closeMenu(){nav.classList.remove('is-open');menuButton.setAttribute('aria-expanded','false');}
menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';menuButton.setAttribute('aria-expanded',String(open));nav.classList.toggle('is-open',open);});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('is-open')){closeMenu();menuButton.focus();}});

// All measurements stay local unless the production site explicitly supplies gtag.
function track(name,values={}){if(typeof window.gtag==='function')window.gtag('event',name,values);}
document.querySelectorAll('a[href="#contact"]').forEach(link=>link.addEventListener('click',()=>track('cta_click',{location:link.closest('section,header,aside')?.id||link.closest('section,header,aside')?.className||'page'})));
document.querySelectorAll('[data-line-cta]').forEach(link=>link.addEventListener('click',()=>track('line_consult_click',{location:link.dataset.lineCta})));
const topButton=document.querySelector('.back-to-top');
new IntersectionObserver(entries=>topButton.classList.toggle('is-visible',!entries[0].isIntersecting),{threshold:0}).observe(document.querySelector('.hero'));

const floating=document.querySelector('.floating-cta');
let contactInView=false;
function updateFloating(){floating.classList.toggle('is-visible',!contactInView);}
new IntersectionObserver(entries=>{contactInView=entries[0].isIntersecting;updateFloating();},{threshold:0}).observe(document.querySelector('#contact'));

const caseTrack=document.querySelector('#case-track');
const prev=document.querySelector('#case-prev'),next=document.querySelector('#case-next');
const caseCards=[...caseTrack.children];
const caseDots=[...document.querySelectorAll('[data-case]')];
function caseStep(){return caseCards[1].offsetLeft-caseCards[0].offsetLeft;}
function updateCases(){const max=caseTrack.scrollWidth-caseTrack.clientWidth;const atEnd=caseTrack.scrollLeft>=max-4;const index=Math.min(caseCards.length-1,Math.max(0,Math.round(caseTrack.scrollLeft/caseStep())));document.querySelector('#case-count').textContent=`${index+1} / ${caseCards.length}`;prev.disabled=caseTrack.scrollLeft<=4;next.disabled=atEnd;caseCards.forEach((card,i)=>card.classList.toggle('is-active',i===index));caseDots.forEach((dot,i)=>dot.setAttribute('aria-current',String(i===index)));}
caseDots.forEach((dot,index)=>dot.addEventListener('click',()=>caseTrack.scrollTo({left:index*caseStep(),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})));
prev.addEventListener('click',()=>caseTrack.scrollBy({left:-caseStep(),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
next.addEventListener('click',()=>caseTrack.scrollBy({left:caseStep(),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
caseTrack.addEventListener('scroll',updateCases,{passive:true});
caseTrack.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();next.click();}if(event.key==='ArrowLeft'){event.preventDefault();prev.click();}});
window.addEventListener('resize',updateCases);updateCases();

const form=document.querySelector('#contact-form'),result=document.querySelector('#form-result'),preview=document.querySelector('#email-preview');
form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form);const body=`株式会社LAYR ご担当者様\n\nオンラインスクールの売上導線診断を希望します。\n\n会社名・スクール名：${data.get('company')}\nお名前：${data.get('name')}\nメールアドレス：${data.get('email')}\nURL：${data.get('url')||'未記入'}\nご相談内容：${data.get('consultation')}\n\n現状・お困りごと：\n${data.get('message')||'未記入'}\n\nよろしくお願いいたします。`;preview.value=body;document.querySelector('#mail-link').href=`mailto:info@layr.co.jp?subject=${encodeURIComponent('【無料診断】オンラインスクールLINE支援のご相談')}&body=${encodeURIComponent(body)}`;result.hidden=false;result.focus();track('contact_draft_created');});
form.addEventListener('input',()=>{if(!result.hidden){result.hidden=true;document.querySelector('#copy-status').textContent='';}});
document.querySelector('#copy-email').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(preview.value);document.querySelector('#copy-status').textContent='相談内容をコピーしました。送信はまだ行われていません。';}catch{preview.focus();preview.select();document.querySelector('#copy-status').textContent='本文を選択しました。コピーしてメールに貼り付けてください。';}});
document.querySelector('#mail-link').addEventListener('click',()=>track('contact_mail_app_open'));
// Enable only after the draft handler is registered; no-JS must never submit PII via GET.
form.querySelector('.form-submit').disabled=false;
// No generate_lead event: a draft/mailto does not verify actual inquiry delivery.
