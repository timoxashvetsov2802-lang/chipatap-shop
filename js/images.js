/* Картинки товара и заглушка, когда картинки нет или она не доехала. */

import { esc, attr } from './format.js';

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

/* Первая буква или цифра названия: кавычки и скобки в начале имени
   встречаются регулярно, а буквой работать не могут. */
export function initialOf(name){
  var m=String(name==null?'':name).match(/[0-9A-Za-zЀ-ӿ]/);
  return m ? m[0].toUpperCase() : '•';
}

/* Заглушка вместо фото — первая буква названия. Эмодзи из таблицы рисовались
   чужим цветным шрифтом и на витрине складывались в случайный набор картинок;
   буква молчит и не спорит с товаром. Кегль в em: каждый контейнер миниатюры
   уже задал свой размер, и буква масштабируется вместе с ним. */
export function placeholderHTML(label){
  return '<span class="ph">'+esc(initialOf(label))+'</span>';
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
  ph.textContent=img.getAttribute('data-initial') || '•';
  img.replaceWith(ph);
};

/* label задаётся отдельно от товара там, где подпись карточки — имя линейки,
   а не имя вкуса: буква на плитке должна совпадать с тем, что подписано. */
export function thumbContent(p, label){
  var letter=initialOf(label || p.name);
  if(p.image){
    return '<img src="'+attr(p.image)+'" alt="" loading="lazy" decoding="async"'+
      ' data-initial="'+attr(letter)+'" data-direct="'+attr(p.rawImage)+'"'+
      ' style="width:100%;height:100%;object-fit:cover;" onerror="imgFallback(this)">';
  }
  return placeholderHTML(label || p.name);
}
