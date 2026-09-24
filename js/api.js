/* Связь с бэкендом.

   Адреса берутся из config.js (он вне git). Товары, баланс и отзывы читаются
   из опубликованных CSV Google-таблицы (File → Share → Publish to web),
   отзывы и идеи уходят в Apps Script.

   Функции здесь только достают данные и отдают их наверх: присваивание в
   состояние и перерисовка — не их дело. Поэтому ошибку они бросают, а не
   гасят: решать, что показать человеку, должен вызывающий. */

import { parseCSV, fresh, NO_CACHE } from './csv.js';
import { rawToProduct } from './product.js';
import { tg, inRealTelegram } from './telegram.js';

const CFG = window.CHIPATAP_CONFIG || {};

export const CSV_URL         = CFG.CSV_URL || '';
export const BALANCE_CSV_URL = CFG.BALANCE_CSV_URL || '';
export const REVIEWS_CSV_URL = CFG.REVIEWS_CSV_URL || '';
export const GAS_URL         = CFG.GAS_URL || '';

/* Отдельный адрес для заказов: у отзывов и заказов разные скрипты, чтобы
   переразвёртывание одного не роняло приём другого. */
export const ORDERS_URL   = CFG.ORDERS_GAS_URL || '';
export const ORDERS_TOKEN = CFG.ORDERS_TOKEN || '';

export const BOT_USERNAME = 'chipatapa_bot';

/* Ник продавца (без @): заказ уходит ему в личку готовым сообщением. */
export const ADMIN_USERNAME = String(CFG.ADMIN_USERNAME || '').replace(/^@/, '').trim();

async function loadCSV(url){
  var res = await fetch(fresh(url), NO_CACHE);
  if(!res.ok) throw new Error('HTTP '+res.status);
  return parseCSV(await res.text());
}

export async function fetchProducts(){
  var raw = await loadCSV(CSV_URL);
  return raw.map(rawToProduct).filter(function(p){ return !isNaN(p.id); });
}

export async function fetchReviews(){
  var rows = await loadCSV(REVIEWS_CSV_URL);
  return rows.map(function(r){
    return {
      product_id:String(r.product_id||''),
      name:r.name || 'Аноним',
      rating:parseInt(r.rating,10)||5,
      text:r.text||''
    };
  });
}

export async function fetchBalance(uid){
  var rows = await loadCSV(BALANCE_CSV_URL);
  var mine = rows.find(function(r){ return String(r.user_id)===String(uid); });
  return mine ? (parseInt(mine.balance,10)||0) : 0;
}

/* Ответ Apps Script прочитать нельзя (no-cors), поэтому здесь возвращается
   только «отправка началась», а не «дошло». */
export function postToGAS(url, payload){
  fetch(url, {
    method:'POST',
    mode:'no-cors',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify(payload)
  }).catch(function(e){ console.error('GAS error', e); });
}

/* Склейку корзины выгружаем через Apps Script заказов: он кладёт её на imgbb
   своим ключом и возвращает прямую ссылку. Здесь ответ нужен, поэтому не
   no-cors, как у postToGAS: Apps Script отвечает с CORS-заголовком. */
export async function uploadCollage(base64){
  if(!ORDERS_URL) throw new Error('ORDERS_GAS_URL не задан');
  var res = await fetch(ORDERS_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({ action:'collage', token:ORDERS_TOKEN, image:base64 })
  });
  var data = await res.json();
  if(!data.ok || !data.url) throw new Error(data.error || 'нет ссылки');
  return data.url;
}

/* Отзывы и идеи. Если Apps Script не настроен — фолбэк на старый способ
   (через бота, он закроет приложение). Вернёт false, если не ушло никуда. */
export function sendToGAS(payload){
  if(!GAS_URL){
    try{
      if(inRealTelegram && tg.sendData){ tg.sendData(JSON.stringify(payload)); return true; }
    }catch(e){}
    return false;
  }
  postToGAS(GAS_URL, payload);
  return true;
}
