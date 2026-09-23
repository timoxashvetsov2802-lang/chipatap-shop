/* Сервис-воркер витрины.

   Нужен ради двух вещей: без него браузер не предлагает установку («приложение»
   на домашнем экране), и без него установленное приложение показывает ошибку
   сети вместо витрины, когда связь моргнула.

   Стратегия — сеть вперёд, кеш как запасной. Наоборот (кеш вперёд) нельзя:
   витрина обновляется деплоем по нескольку раз в день, и покупатель месяцами
   видел бы старые цены. Кеш здесь только на случай «сети нет вовсе».

   Чужие домены не трогаем совсем: товары, баланс и заказы ходят в Google, и
   кешировать ответы с ценами и остатками — верный способ показать вчерашнее
   наличие. */

const CACHE = 'chipatap-shell-v1';

self.addEventListener('install', function(){
  // Новый воркер не ждёт, пока закроют все вкладки: иначе правка доезжает
  // до телефона через сутки.
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys()
      .then(function(names){
        return Promise.all(names.map(function(n){
          return n === CACHE ? null : caches.delete(n);
        }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;

  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(url.origin !== self.location.origin) return;   // Google и прокси картинок — мимо

  event.respondWith(
    fetch(req)
      .then(function(res){
        if(res && res.ok){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
        }
        return res;
      })
      .catch(function(){
        return caches.match(req).then(function(hit){
          if(hit) return hit;
          // Переход на страницу без сети — отдаём последнюю сохранённую витрину
          if(req.mode === 'navigate') return caches.match('./index.html');
          return Promise.reject(new Error('offline'));
        });
      })
  );
});
