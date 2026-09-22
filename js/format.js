/* Текст, числа, даты. Ничего не знает ни про DOM, ни про состояние магазина —
   поэтому импортируется откуда угодно и тестируется в отрыве. */

export function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

/* Для значения, которое подставляется в атрибут, а не в текст узла. */
export function attr(s){ return String(s==null?'':s).replace(/"/g,'&quot;'); }

/* Неразрывный пробел перед ₽: иначе символ валюты срывается на вторую строку. */
export function fmt(n){ return n.toLocaleString('ru-RU')+' ₽'; }

export function plural(n, one, few, many){
  var mod10=n%10, mod100=n%100;
  if(mod10===1 && mod100!==11) return one;
  if([2,3,4].indexOf(mod10)!==-1 && [12,13,14].indexOf(mod100)===-1) return few;
  return many;
}

/* Раньше рядом жила отдельная pluralOtziv с теми же тремя правилами —
   склонение у неё ровно то же, что у plural, только формы зашиты внутрь. */
export function otzyv(n){ return plural(n,'отзыв','отзыва','отзывов'); }

export function starsSmall(n){
  var s='';
  for(var i=1;i<=5;i++){ s += (i<=n ? '★' : '☆'); }
  return s;
}

export function starsHTML(n, size){
  return '<span style="color:var(--hit);'+(size?'font-size:'+size+'px;':'')+'">'+
    starsSmall(n)+'</span>';
}

/* «2026-08-09 00:12:33» — Safari не понимает такой формат без T. */
export function parseStamp(s){
  s=String(s||'').trim();
  if(!s) return null;
  var d=new Date(s.replace(' ','T'));
  return isNaN(d.getTime()) ? null : d;
}
