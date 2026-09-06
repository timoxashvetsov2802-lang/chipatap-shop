// БОЕВОЙ конфиг фронтенда. Файл в .gitignore — в репозиторий не попадает.
// Шаблон для репозитория — config.example.js.
//
// ВАЖНО: это НЕ секреты в строгом смысле — браузер обязан знать эти адреса,
// поэтому их видно в DevTools у любого посетителя. .gitignore защищает
// историю git (id таблицы не утечёт в публичный репозиторий), но не браузер.
// Настоящий барьер для Apps Script — валидация запросов на его стороне.
//
// ПРИ ДЕПЛОЕ на GitHub Pages этот файл нужно положить рядом с index.html
// вручную — иначе магазин не загрузит товары.
window.CHIPATAP_CONFIG = {
  // Лист товаров: File -> Share -> Publish to web -> CSV
  CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSZbkNfQpB7D6NgcWoCxegvLRwxSN6LfFfntwWhZjd2QB-JoCQ-vydkmpI-HLaGiSMfDqUBwSbcKSBB/pub?output=csv',
  // Вкладка «Баланс»
  BALANCE_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSZbkNfQpB7D6NgcWoCxegvLRwxSN6LfFfntwWhZjd2QB-JoCQ-vydkmpI-HLaGiSMfDqUBwSbcKSBB/pub?gid=400939981&single=true&output=csv',
  // Вкладка «Отзывы»
  REVIEWS_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSZbkNfQpB7D6NgcWoCxegvLRwxSN6LfFfntwWhZjd2QB-JoCQ-vydkmpI-HLaGiSMfDqUBwSbcKSBB/pub?gid=1034499079&single=true&output=csv',
  // Веб-приложение Google Apps Script — приём отзывов и идей без закрытия Mini App
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzu2RZJQTW-B10h8JDe3FDClWCgYmqRjI-_rjMqNWqjtkEFsk_1ckaiXjcojDcaZNix/exec'
};
