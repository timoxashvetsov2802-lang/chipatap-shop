/* Склейка корзины в одну картинку для заказа через личку.

   Прикрепить фото к сообщению ссылкой t.me/<ник>?text= нельзя — туда идёт
   только текст. Поэтому все товары рисуются на одном холсте, картинка
   уходит на imgbb (через Apps Script — ключ живёт там, а не на витрине), и в
   сообщение встаёт одна ссылка. Telegram разворачивает её превью, и продавец
   видит весь заказ разом, а не только первый товар.

   Здесь только рисование: что делать, если не вышло, решает вызывающий. */

import { fmt } from './format.js';

var W = 1080;          // ширина холста: превью Telegram всё равно ужмёт
var PAD = 36, GAP = 24;
var MAX_TILES = 12;    // больше — последняя плитка «+N», иначе плитки крошатся
var BG = '#fcc101', INK = '#14120b', HINT = '#8a7663';
var FONT = "'Monocraft', ui-monospace, monospace";

function columnsFor(n){
  if(n <= 1) return 1;
  if(n <= 4) return 2;
  return 3;
}

/* Картинку берём через тот же прокси weserv, что и витрина: он отдаёт
   CORS-заголовок, без которого холст «пачкается» и не выгружается. */
function loadImage(src){
  return new Promise(function(resolve){
    if(!src){ resolve(null); return; }
    var img = new Image();
    var done = false;
    function finish(v){ if(!done){ done = true; resolve(v); } }
    img.crossOrigin = 'anonymous';
    img.onload = function(){ finish(img); };
    img.onerror = function(){ finish(null); };
    setTimeout(function(){ finish(null); }, 6000);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Обрезка «по центру» под квадрат — как object-fit:cover на витрине */
function drawCover(ctx, img, x, y, s){
  var k = Math.max(s / img.width, s / img.height);
  var w = img.width * k, h = img.height * k;
  ctx.drawImage(img, x + (s - w) / 2, y + (s - h) / 2, w, h);
}

/* Строка, которая не влезает, обрезается многоточием, а не вылезает за плитку */
function fitText(ctx, text, maxW){
  if(ctx.measureText(text).width <= maxW) return text;
  while(text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

/* items: [{ name, group, qty, price, image }] — name это вкус, group линейка,
   image уже адрес через прокси.
   Возвращает JPEG в base64 без префикса data:. */
export async function buildCollage(items, total){
  try{ await Promise.all([document.fonts.load('700 30px Monocraft'), document.fonts.load('400 30px Monocraft')]); }catch(e){}

  var shown = items.slice(0, MAX_TILES);
  var extra = items.length - shown.length;
  if(extra > 0){ shown = shown.slice(0, MAX_TILES - 1); extra += 1; }

  var tiles = shown.length + (extra > 0 ? 1 : 0);
  var cols = columnsFor(tiles);
  var rows = Math.ceil(tiles / cols);
  var tw = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  var capH = Math.round(Math.min(150, Math.max(96, tw * 0.24)));
  var th = tw + capH;
  var footH = 110;
  var H = PAD + rows * th + (rows - 1) * GAP + footH;

  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  var images = await Promise.all(shown.map(function(it){ return loadImage(it.image); }));

  var nameSize = Math.min(40, Math.round(capH * 0.26)), subSize = Math.min(30, Math.round(capH * 0.22));
  function tileXY(i){
    return { x: PAD + (i % cols) * (tw + GAP), y: PAD + Math.floor(i / cols) * (th + GAP) };
  }

  shown.forEach(function(it, i){
    var p = tileXY(i);
    ctx.save();
    roundRect(ctx, p.x, p.y, tw, th, 28);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.clip();

    // Фото — квадрат над подписью; без фото — кремовая подложка с надписью
    if(images[i]){
      drawCover(ctx, images[i], p.x, p.y, tw);
    } else {
      ctx.fillStyle = '#f3e8cc';
      ctx.fillRect(p.x, p.y, tw, tw);
      ctx.fillStyle = HINT;
      ctx.font = '400 ' + subSize + 'px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('нет фото', p.x + tw / 2, p.y + tw / 2);
    }

    // Количество — жирной плашкой на фото: это первое, что надо увидеть
    var badge = '×' + it.qty;
    ctx.font = '700 ' + Math.round(nameSize * 1.25) + 'px ' + FONT;
    var bw = ctx.measureText(badge).width + 28, bh = Math.round(nameSize * 1.25) + 22;
    roundRect(ctx, p.x + tw - bw - 14, p.y + 14, bw, bh, bh / 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.fillStyle = BG;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badge, p.x + tw - bw / 2 - 14, p.y + 14 + bh / 2 + 1);

    // Подпись: вкус — главное, жирным; линейка и цена — второй строкой.
    // Длинный вкус сперва ужимается шрифтом и только потом многоточием.
    var tx = p.x + 18, maxW = tw - 36;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    var ns = nameSize;
    ctx.font = '700 ' + ns + 'px ' + FONT;
    while(ns > nameSize * 0.72 && ctx.measureText(it.name).width > maxW){
      ns -= 1; ctx.font = '700 ' + ns + 'px ' + FONT;
    }
    ctx.fillText(fitText(ctx, it.name, maxW), tx, p.y + tw + capH * 0.44);
    ctx.fillStyle = HINT;
    ctx.font = '400 ' + subSize + 'px ' + FONT;
    var sub = (it.group ? it.group + ' · ' : '') + fmt(it.price);
    ctx.fillText(fitText(ctx, sub, maxW), tx, p.y + tw + capH * 0.8);
    ctx.restore();
  });

  if(extra > 0){
    var p = tileXY(shown.length);
    roundRect(ctx, p.x, p.y, tw, th, 28);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = '700 ' + Math.round(tw * 0.2) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+' + extra, p.x + tw / 2, p.y + th / 2);
  }

  // Подвал: знак магазина и итог — те же белые буквы с тенью, что на заставке
  var fy = H - footH / 2 + 4;
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px ' + FONT;
  ctx.fillStyle = 'rgba(90,60,0,.25)';
  ctx.textAlign = 'left';  ctx.fillText('Chipatap', PAD + 3, fy + 3);
  ctx.textAlign = 'right'; ctx.fillText('Итого ' + fmt(total), W - PAD + 3, fy + 3);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';  ctx.fillText('Chipatap', PAD, fy);
  ctx.textAlign = 'right'; ctx.fillText('Итого ' + fmt(total), W - PAD, fy);

  return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
}
