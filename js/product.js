/* Модель товара: как строка таблицы превращается в товар, как товары
   собираются в линейки и что мы говорим про наличие.

   Ничего не рендерит и не знает про корзину — только про сам товар. */

import { normalizeImageUrl } from './images.js';

function mapBadge(raw){
  var b=(raw||'').trim().toUpperCase();
  if(b==='NEW') return 'new';
  if(b==='ХИТ' || b==='HIT') return 'hit';
  return '';
}

/* Количество на складе. null — не задано: тогда наличие решает старый флаг
   inStock, иначе товары, заведённые до появления колонки, разом «кончились». */
export function parseStock(raw){
  var s=String(raw==null?'':raw).trim().replace(',','.');
  if(!s) return null;
  var n=parseFloat(s);
  if(isNaN(n)) return null;
  return Math.max(0, Math.floor(n));
}

export function rawToProduct(r){
  var stock=parseStock(r.stock);
  var flag=String(r.inStock).trim().toUpperCase()==='TRUE';
  return {
    id:parseInt(r.id,10),
    name:r.name || 'Без названия',
    category:(r.category||'').trim(),
    subcategory:(r.subcategory||'').trim(),
    tag:r.desc || '',
    price:parseFloat(r.price)||0,
    badge:mapBadge(r.badge),
    icon:r.icon && r.icon.trim() ? r.icon.trim() : '📦',
    image:normalizeImageUrl(r.image||''),
    rawImage:(r.image||'').trim(),
    /* Обложка линейки для главной. Колонки cover может не быть вовсе —
       тогда всё работает по-старому, от фото первого вкуса. */
    cover:(r.cover||'').trim(),
    group:(r.group||'').trim(),
    stock:stock,
    added:(r.added||'').trim(),
    restocked:(r.restocked||'').trim(),
    inStock: stock!==null ? stock>0 : flag
  };
}

/* Про наличие пишем, только когда товара НЕТ. Есть в наличии — молчим:
   покупателя интересует не подтверждение нормы, а исключение из неё.
   Количество не показываем вовсе — единиц измерения на витрине нет. */
export function stockLabel(p){
  var available = (p.stock===null) ? p.inStock : p.stock>0;
  return available ? '' : 'Нет в наличии';
}

/* Цвет по остатку: нет — красный, последняя штука — оранжевый, дальше зелёный. */
export function stockClass(p){
  if(!p.inStock) return 'none';
  if(p.stock!==null && p.stock<=1) return 'low';
  return 'ok';
}

/* Пустую строку наличия не рисуем совсем: пустой элемент оставлял бы
   в карточке зазор ровно там, где раньше было «В наличии». */
export function stockLineHTML(p){
  var label = stockLabel(p);
  if(!label) return '';
  return '<span class="stock-line '+stockClass(p)+'" style="font-size:11px;">'+label+'</span>';
}

/* Товары одной линейки идут одной карточкой; одиночные — сами по себе. */
export function groupProducts(list){
  var groups={}, order=[];
  list.forEach(function(p){
    var key = p.group ? 'g:'+p.group : 's:'+p.id;
    if(!groups[key]){ groups[key]=[]; order.push(key); }
    groups[key].push(p);
  });
  return order.map(function(key){ return groups[key]; });
}

export function groupKeyOf(variants){
  var rep=variants[0];
  return variants.length>1 ? 'g:'+rep.group : 's:'+rep.id;
}

/* Что показать на главной за всю линейку: заданную обложку, если её выставили
   в админке, иначе — фото первого вкуса, как было раньше. */
export function coverOf(variants){
  var withCover=variants.find(function(v){ return v.cover; });
  if(!withCover) return variants[0];
  return {
    image:normalizeImageUrl(withCover.cover),
    rawImage:withCover.cover,
    icon:variants[0].icon
  };
}

/* Сначала то, что есть в наличии: кончившиеся вкусы уходят вниз, чтобы не
   приходилось выискивать доступное среди недоступного. Тот же порядок держит
   и листалка на экране вкуса, иначе «следующий» вёл бы не туда, куда
   показывает сетка. slice() — variants та же ссылка, что и в общем списке. */
export function orderedVariants(variants){
  return variants.slice().sort(function(a,b){
    return (b.inStock?1:0) - (a.inStock?1:0);
  });
}

/* Для подиков и картриджей — «видов», для остального — «вкусов».
   Множественное число у обоих слов кончается одинаково, поэтому ветвится
   только основа: раньше тут стояло isVid?'ов':'ов' — выбор без выбора. */
export function unitWord(rep, n){
  var cat = (rep.category||'').toLowerCase();
  var sub = (rep.subcategory||'').toLowerCase();
  var isVid = cat.indexOf('подик')!==-1 || cat.indexOf('картридж')!==-1 ||
              sub.indexOf('подик')!==-1 || sub.indexOf('картридж')!==-1;
  var base = isVid ? 'вид' : 'вкус';
  var mod10=n%10, mod100=n%100;
  if(mod10===1 && mod100!==11) return base;
  if([2,3,4].indexOf(mod10)!==-1 && [12,13,14].indexOf(mod100)===-1) return base+'а';
  return base+'ов';
}
