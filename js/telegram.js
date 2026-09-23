/* Слой Telegram: инициализация Mini App, безопасные отступы, тема, тактильный
   отклик и то, как мы узнаём пользователя.

   Всё здесь обёрнуто в try/catch намеренно. Методы Bot API появлялись в разных
   версиях клиента, и на старом Telegram половины из них просто нет — падать
   из-за этого магазин не должен. */

export let tg = null;
try{
  tg = (window.Telegram && window.Telegram.WebApp) || null;
}catch(e){ tg = null; }

/* initData ВСЕГДА пустой для keyboard-button web apps — это норма Telegram,
   а не баг. Проверяем платформу вместо initData. */
export const inRealTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');

/* Надёжный признак запуска с клавиатурной кнопки — именно пустой initData:
   такому запуску Telegram не отдаёт данные пользователя. От этого зависит,
   каким путём уедет заказ, поэтому признак считается один раз и здесь.
   Вне Telegram он всегда false: там пустой initData ничего не означает. */
export const openedFromKeyboardButton =
  inRealTelegram && !(tg.initData && tg.initData.length);

const TG_USER = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;

/* uid обычно приходит параметром от бота — у приложения, открытого
   КЛАВИАТУРНОЙ кнопкой, initData пустой и взять id больше неоткуда. А вот
   у открытого синей кнопкой меню initData как раз заполнен: оттуда и берём
   запасной вариант, иначе бонусы и реф-ссылка молча не работают. */
export const MY_UID = new URLSearchParams(location.search).get('uid')
                   || (TG_USER && TG_USER.id ? String(TG_USER.id) : '');
export const MY_NAME = (TG_USER && TG_USER.first_name) || 'Аноним';

export function initTelegram(){
  if(!tg) return;
  try{
    tg.ready();
    tg.expand();
    try{ tg.disableVerticalSwipes && tg.disableVerticalSwipes(); }catch(e){}
    /* Фуллскрин (Bot API 8.0+). На старых клиентах метода нет — там остаётся
       обычный expand(), приложение просто не разворачивается на весь экран. */
    try{ tg.requestFullscreen && tg.requestFullscreen(); }catch(e){}
    /* Свайп вниз больше не должен закрывать приложение случайно */
    try{ tg.enableClosingConfirmation && tg.enableClosingConfirmation(); }catch(e){}
    applyInsets();
    ['safeAreaChanged','contentSafeAreaChanged','fullscreenChanged','viewportChanged']
      .forEach(function(ev){ try{ tg.onEvent && tg.onEvent(ev, applyInsets); }catch(e){} });
  }catch(e){}
}

/* Отступ сверху = вырез устройства + шапка самого Telegram. В фуллскрине
   Telegram рисует поверх страницы свои кнопки (закрыть, свернуть) в правом
   верхнем углу — под них нужно освободить место, иначе они лягут на нашу
   шапку. */
function applyInsets(){
  try{
    var dev  = (tg.safeAreaInset && tg.safeAreaInset.top) || 0;
    var cont = (tg.contentSafeAreaInset && tg.contentSafeAreaInset.top) || 0;
    var top  = dev + cont;
    /* В фуллскрине кнопки Telegram высокие — добавляем запас, если клиент
       не сообщил свой отступ. */
    if(tg.isFullscreen && cont===0) top += 48;
    document.documentElement.style.setProperty('--safe-top', top+'px');
    document.body.classList.toggle('tg-fullscreen', !!tg.isFullscreen);
  }catch(e){}
}

export function haptic(style){
  try{
    if(tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style||'light');
  }catch(e){}
}

/* --- Ярлык мини-аппы на домашнем экране (Bot API 8.0) ---

   Ставит именно ярлык Telegram: он открывает наш магазин внутри Telegram, со
   всем, что от этого зависит — кто пользователь, бонусы, отправка заказа.
   Установка «как обычный сайт» (PWA) выглядела бы так же, но открывала бы
   витрину в браузере, где Telegram не сообщает, кто пришёл: заказ оттуда
   некому приписать. Поэтому её и не делаем.

   Метода нет на iOS и на клиентах до 8.0 — там кнопку показывать нельзя,
   мёртвая кнопка в панели только мешает. */
export function homeScreenSupported(){
  try{
    return !!(tg && tg.addToHomeScreen &&
              (!tg.isVersionAtLeast || tg.isVersionAtLeast('8.0')));
  }catch(e){ return false; }
}

/* Статусы Telegram: added | missed | unknown | unsupported.
   unknown приходит, когда клиент не может проверить (Android без разрешения
   читать домашний экран) — кнопку в этом случае показываем: хуже лишнего
   предложения только его отсутствие. */
export function checkHomeScreen(cb){
  if(!homeScreenSupported()){ cb('unsupported'); return; }
  try{
    if(typeof tg.checkHomeScreenStatus === 'function'){
      tg.checkHomeScreenStatus(function(status){ cb(status || 'unknown'); });
    } else {
      cb('unknown');
    }
  }catch(e){ cb('unsupported'); }
}

export function addToHomeScreen(){
  try{ tg.addToHomeScreen(); }catch(e){}
}

export function onHomeScreenAdded(fn){
  try{ tg.onEvent && tg.onEvent('homeScreenAdded', fn); }catch(e){}
}
