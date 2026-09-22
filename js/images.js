/* Картинки товара и заглушка, когда картинки нет или она не доехала. */

import { attr } from './format.js';

/* Telegram-браузер часто блокирует прямые запросы к imgbb, поэтому отдаём ВСЕ
   картинки через image-прокси images.weserv.nl (его домен не режется). Прокси
   сам скачает картинку по исходной ссылке, СЖИМАЕТ (w=600, q=80) и отдаёт со
   своего домена — это заметно ускоряет загрузку. */
export function normalizeImageUrl(url){
  if(!url) return '';
  url = url.trim();
  if(!url) return '';
  var clean = url.replace(/^https?:\/\//i, '');
  return 'https://images.weserv.nl/?url=' + encodeURIComponent(clean) + '&w=600&q=80&output=webp';
}

/* Заглушка вместо фото — полупрозрачное облако со знака (рисуется в CSS).
   Раньше здесь была первая буква названия, а до неё эмодзи из таблицы: и то и
   другое складывалось на витрине в случайный набор значков. Облако одно на
   всех и не спорит с товаром. Подпись остаётся в aria-label: для читалки
   «нет фото» полезнее, чем молчащая картинка. */
export function placeholderHTML(label){
  return '<span class="ph" role="img" aria-label="Фото товара нет"></span>';
}

/* Прокси images.weserv.nl иногда не отдаёт картинку (сам не достучался до
   imgbb, таймаут). Раньше на любую осечку мы сразу ставили заглушку, и фото
   «пропадало» насовсем. Теперь сначала пробуем исходную ссылку.

   Живёт на window: её зовёт inline-атрибут onerror, а он не видит область
   видимости модуля. */
window.imgFallback = function(img){
  var direct=img.getAttribute('data-direct');
  if(direct && !img.getAttribute('data-tried')){
    img.setAttribute('data-tried','1');
    img.src = /^https?:\/\//i.test(direct) ? direct : 'https://'+direct;
    return;
  }
  var ph=document.createElement('span');
  ph.className='ph';
  ph.setAttribute('role','img');
  ph.setAttribute('aria-label','Фото товара нет');
  img.replaceWith(ph);
};

/* label раньше задавал букву на плитке и потому передавался отдельно от
   товара; заглушка теперь одна для всех, и параметр остался только ради
   совместимости с местами вызова. */
export function thumbContent(p, label){
  if(p.image){
    return '<img src="'+attr(p.image)+'" alt="" loading="lazy" decoding="async"'+
      ' data-direct="'+attr(p.rawImage)+'"'+
      ' style="width:100%;height:100%;object-fit:cover;" onerror="imgFallback(this)">';
  }
  return placeholderHTML();
}
