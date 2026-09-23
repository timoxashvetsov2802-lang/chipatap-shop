/* Точка входа витрины. Остальное растаскивается по модулям. */
import { esc, attr, fmt, plural, otzyv, starsSmall, starsHTML, parseStamp } from './format.js';
import { CSV_URL, BALANCE_CSV_URL, REVIEWS_CSV_URL, GAS_URL, ORDERS_URL,
         ORDERS_TOKEN, BOT_USERNAME, fetchProducts, fetchReviews, fetchBalance,
         postToGAS, sendToGAS } from './api.js';
import { normalizeImageUrl, placeholderHTML, thumbContent } from './images.js';
import { tg, inRealTelegram, openedFromKeyboardButton, MY_UID, MY_NAME,
         initTelegram, haptic, checkHomeScreen, addToHomeScreen,
         onHomeScreenAdded, openExternal } from './telegram.js';
import { parseStock, rawToProduct, stockLabel, stockClass, stockLineHTML,
         groupProducts, groupKeyOf, coverOf, orderedVariants, unitWord } from './product.js';

(function(){
  initTelegram();

  var myBalance = 0;
  var bonusToUse = 0;
  var reviews = [];

  var products = [];

  // Сколько ещё можно положить в корзину сверх уже добавленного
  function maxAddable(p){
    if(p.stock===null) return Infinity;
    return Math.max(0, p.stock-(cart[p.id]||0));
  }

  // Замок прокрутки. Шторок несколько и они умеют открываться поверх друг
  // друга, поэтому считаем открытые по ключам: снимаем замок, только когда
  // закрылась последняя. Иначе, закрыв верхнюю, мы разблокировали бы фон
  // под ещё открытой нижней.
  var scrollLocks={}, lockedAt=0;
  function setScrollLock(key, on){
    if(on) scrollLocks[key]=1; else delete scrollLocks[key];
    var any=Object.keys(scrollLocks).length>0;
    var body=document.body;
    var locked=body.classList.contains('scroll-locked');
    if(any && !locked){
      lockedAt=window.pageYOffset||document.documentElement.scrollTop||0;
      body.style.top=(-lockedAt)+'px';
      body.classList.add('scroll-locked');
    } else if(!any && locked){
      body.classList.remove('scroll-locked');
      body.style.top='';
      window.scrollTo(0, lockedAt);
    }
  }

  async function loadBalance(){
    if(!MY_UID || !BALANCE_CSV_URL) return;
    try{
      myBalance = await fetchBalance(MY_UID);
    }catch(e){
      console.error('Не удалось загрузить баланс', e);
      myBalance=0;
    }
    updateBalanceUI();
  }

  async function loadReviews(){
    if(!REVIEWS_CSV_URL) return;
    try{
      reviews = await fetchReviews();
    }catch(e){
      console.error('Не удалось загрузить отзывы', e);
      reviews=[];
    }
    renderGrid();
  }

  async function loadProducts(){
    if(!CSV_URL){
      // Чаще всего это значит, что при деплое забыли положить config.js рядом с index.html
      console.error('CHIPATAP_CONFIG.CSV_URL пуст — проверь config.js');
      toast('Магазин не настроен: нет config.js');
      products=[];
      countNote='нет соединения с таблицей';
      firstLoad=false;
      buildChips();
      renderGrid();
      return;
    }
    try{
      products = await fetchProducts();
      countNote='';
    }catch(e){
      console.error('Не удалось загрузить товары', e);
      toast('Не удалось загрузить товары — проверь ссылку публикации таблицы');
      products=[];
      countNote='нет соединения с таблицей';
    }
    firstLoad=false;
    buildChips();
    renderGrid();
    renderAdminList();
    openDeepLinked();
  }

  // Открыть товар, на который вела кнопка из канала (?p=<id>).
  // Срабатывает один раз: если человек закрыл карточку и пошёл смотреть
  // магазин, повторная загрузка списка не должна выкидывать его обратно.
  // Товар приходит двумя путями: ?p=<id> — когда магазин открыт кнопкой из
  // чата с ботом; start_param — когда открыт прямой ссылкой t.me/<bot>/shop
  // из поста канала (там ?startapp=p<id>, и Telegram кладёт «p<id>» сюда).
  var startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
  var deepLinkId = new URLSearchParams(location.search).get('p')
                || (/^p\d+$/.test(startParam) ? startParam.slice(1) : '')
                || '';
  function openDeepLinked(){
    if(!deepLinkId) return;
    var id=+deepLinkId;
    deepLinkId='';
    var p=products.find(function(pr){ return pr.id===id; });
    if(!p){ toast('Этой позиции больше нет в магазине'); return; }
    // Через линейку, а не сразу карточкой: если у товара есть соседние вкусы,
    // человек увидит их, а не только тот, что был в посте.
    var group=groupProducts(products).find(function(g){
      return g.some(function(v){ return v.id===id; });
    });
    if(group && group.length>1){
      openProductModal(groupKeyOf(group));
      openVariantSheet(id);
    } else {
      openVariantSheet(id);
    }
  }

  var activeCat='Все';
  var quickFilter='all';   // all | new | hit — быстрый фильтр из панели
  var countNote='';        // что показать вместо счётчика, когда таблица не отвечает
  var firstLoad=true;      // пока труе — вместо пустого экрана показываем скелетоны
  var query='';
  var cart={};

  // --- theme ---
  var root=document.documentElement;
  var sunIcon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var moonIcon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';

  function getSystemTheme(){
    try{ if(tg && tg.colorScheme) return tg.colorScheme; }catch(e){}
    return 'light';
  }
  var theme=getSystemTheme();
  function applyTheme(){
    root.setAttribute('data-theme',theme);
    document.getElementById('themeBtn').innerHTML = theme==='light' ? moonIcon : sunIcon;
  }
  document.getElementById('themeBtn').addEventListener('click',function(){
    theme = theme==='light' ? 'dark' : 'light';
    applyTheme();
    haptic('light');
  });
  applyTheme();

  // --- chips: категории строятся из того, что реально есть в таблице ---
  var chipsEl=document.getElementById('chips');
  function buildChips(){
    var seen={};
    var cats=['Все'];
    products.forEach(function(p){
      // Распроданная целиком категория в меню не нужна: её товары скрыты
      // с витрины, и пункт вёл бы на «Ничего не найдено».
      if(!p.inStock) return;
      if(p.category && !seen[p.category]){
        seen[p.category]=true;
        cats.push(p.category);
      }
    });
    if(cats.indexOf(activeCat)===-1) activeCat='Все';
    chipsEl.innerHTML='';
    cats.forEach(function(cat){
      var b=document.createElement('button');
      b.className='chip'+(cat===activeCat?' active':'');
      b.dataset.cat=cat;
      b.textContent=cat;
      b.onclick=function(){
        activeCat=cat; haptic('light');
        renderChips(); renderGrid();
        closeDrawer();   // выбрал категорию — панель уезжает, товары на весь экран
      };
      chipsEl.appendChild(b);
    });
    buildDrawerExtras();
  }

  // Пункта «Только в наличии» здесь больше нет: кончившееся и так не попадает
  // на витрину, и кнопка ничего бы не меняла.
  var QUICK=[
    {key:'new',   label:'Новинки'},
    {key:'hit',   label:'Хиты'}
  ];
  function buildDrawerExtras(){
    // В админке панель работает фильтром склада — витринные пункты там лишние
    var inAdmin = adminSheet && adminSheet.classList.contains('show');
    document.getElementById('drawerExtras').style.display = inAdmin ? 'none' : '';
    if(inAdmin) return;

    var box=document.getElementById('quickFilters');
    box.innerHTML=QUICK.map(function(f){
      return '<button type="button" data-quick="'+f.key+'"'+
        (quickFilter===f.key?' class="active"':'')+'>'+f.label+'</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-quick]'),function(b){
      b.onclick=function(){
        // Кнопки «Все товары» больше нет, поэтому фильтр снимается повторным
        // нажатием: нажал «Новинки» ещё раз — снова весь магазин
        quickFilter = (quickFilter===b.dataset.quick) ? 'all' : b.dataset.quick;
        haptic('light');
        buildDrawerExtras(); renderGrid();
        closeDrawer();
      };
    });
  }
  document.getElementById('drawerCartBtn').onclick=function(){
    closeDrawer();
    if(!Object.keys(cart).length){ toast('Корзина пуста'); return; }
    openCartOverAll();
  };
  /* Сервис-воркер. Нужен ради установки приложением: без него браузер
     установку не предлагает, а установленная витрина показывает ошибку сети
     вместо магазина, когда связь моргнула. Регистрируем после загрузки, чтобы
     не отбирать канал у товаров. */
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){});
    });
  }

  /* Установка витрины приложением. В отличие от ярлыка Telegram, такое
     приложение открывается сразу в магазин, без захода в Telegram.

     Внутри Telegram установить нельзя — его встроенный браузер этого не умеет.
     Поэтому оттуда кнопка уводит в настоящий браузер, и адрес несёт с собой
     uid: установленная витрина запускается без Telegram, и аккаунт ей больше
     узнать неоткуда (см. MY_UID в telegram.js). */
  (function(){
    var btn=document.getElementById('drawerPwaBtn');
    if(!btn) return;
    var standalone=false;
    try{
      standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches)
                || window.navigator.standalone === true;
    }catch(e){}
    if(standalone) return;           // уже установлено — предлагать нечего

    var deferred=null;
    window.addEventListener('beforeinstallprompt', function(e){
      e.preventDefault();
      deferred=e;
    });
    btn.style.display='';

    btn.onclick=function(){
      haptic('light');
      closeDrawer();
      if(deferred){ deferred.prompt(); deferred=null; return; }
      if(inRealTelegram){
        var url=location.origin+location.pathname+(MY_UID ? ('?uid='+encodeURIComponent(MY_UID)) : '');
        if(openExternal(url)) toast('Открыл в браузере — там «Установить приложение»');
        return;
      }
      // Safari на iPhone установку сам не предлагает — там это делается руками
      toast('Меню браузера → «Установить приложение» или «На экран «Домой»»');
    };
    window.addEventListener('appinstalled', function(){
      btn.style.display='none';
      toast('Готово — приложение установлено');
    });
  })();

  /* Ярлык магазина на домашнем экране: одно нажатие — и Telegram ставит
     иконку, которая открывает витрину сразу, минуя чат с ботом.

     Кнопка появляется, только если клиент это умеет и ярлыка ещё нет:
     на iOS и на Telegram до 8.0 метода нет вовсе. */
  (function(){
    var btn=document.getElementById('drawerInstallBtn');
    if(!btn) return;
    checkHomeScreen(function(status){
      if(status==='missed' || status==='unknown') btn.style.display='';
    });
    btn.onclick=function(){
      haptic('light');
      closeDrawer();
      addToHomeScreen();
    };
    onHomeScreenAdded(function(){
      btn.style.display='none';
      toast('Готово — ярлык на домашнем экране');
    });
  })();

  document.getElementById('drawerBonusBtn').onclick=function(){
    closeDrawer();
    openReferral();
  };
  function renderChips(){
    Array.prototype.forEach.call(chipsEl.children,function(b){
      b.classList.toggle('active', b.dataset.cat===activeCat);
    });
  }

  // === Выдвижная панель категорий ===
  // Одна панель на два экрана: на витрине фильтрует товары, в админке —
  // список склада. Так она не занимает место ни там, ни там.
  var drawer=document.getElementById('drawer');
  var drawerBackdrop=document.getElementById('drawerBackdrop');
  var drawerTab=document.getElementById('drawerTab');

  function openDrawer(){
    // Наполнение зависит от того, что сейчас открыто
    var inAdmin = adminSheet && adminSheet.classList.contains('show');
    document.getElementById('drawerSupply').style.display = inAdmin ? '' : 'none';
    if(inAdmin){
      document.getElementById('drawerTitle').textContent='Фильтр склада';
      renderAdminFilters();
      updateSupplyReadiness();
      buildDrawerExtras();   // сам спрячет витринные пункты, пока открыт склад
    } else {
      document.getElementById('drawerTitle').textContent='Категории';
      buildChips();
    }
    drawer.classList.add('show'); setScrollLock('drawer',true);
    drawerBackdrop.classList.add('show');
    pushNav('drawer', closeDrawer);
    haptic('light');
  }
  function closeDrawer(){
    drawer.classList.remove('show'); setScrollLock('drawer',false);
    drawerBackdrop.classList.remove('show');
    dropNav('drawer');
  }
  drawerTab.onclick=openDrawer;
  document.getElementById('burgerBtn').onclick=openDrawer;
  drawerBackdrop.onclick=closeDrawer;

  // Свайп от левого края открывает панель, свайп по панели — закрывает
  (function(){
    var x0=null, y0=null, tracking=false;
    document.addEventListener('touchstart', function(e){
      var t=e.touches[0];
      if(drawer.classList.contains('show')) return;
      if(t.clientX>28) return;                 // тянуть можно только от края
      if(lightbox.classList.contains('show')) return;
      x0=t.clientX; y0=t.clientY; tracking=true;
    }, {passive:true});
    document.addEventListener('touchmove', function(e){
      if(!tracking) return;
      var t=e.touches[0];
      if(Math.abs(t.clientY-y0)>40){ tracking=false; return; }  // это вертикальная прокрутка
      if(t.clientX-x0>46){ tracking=false; openDrawer(); }
    }, {passive:true});
    document.addEventListener('touchend', function(){ tracking=false; }, {passive:true});

    var dx0=null;
    drawer.addEventListener('touchstart', function(e){ dx0=e.touches[0].clientX; }, {passive:true});
    drawer.addEventListener('touchmove', function(e){
      if(dx0!==null && dx0-e.touches[0].clientX>50){ dx0=null; closeDrawer(); }
    }, {passive:true});
  })();

  // --- grid ---
  var gridEl=document.getElementById('grid');
  /* Считаем то, что реально лежит на витрине: кончившееся с неё скрыто,
     и «56 товаров» над списком из сорока сбивало бы с толку. Зовётся из renderGrid,
     чтобы цифра обновлялась и после правки наличия на складе. */
  function updateItemCount(){
    var el=document.getElementById('itemCount');
    if(!el) return;
    if(countNote){ el.textContent=countNote; return; }
    // Пока товары едут, «0 товаров» над скелетонами читается как пустой магазин.
    if(firstLoad && !products.length){ el.textContent='загружаем…'; return; }
    var n=products.filter(function(p){ return p.inStock; }).length;
    el.textContent = n+' '+plural(n,'товар','товара','товаров');
  }
  function renderGrid(){
    updateItemCount();
    var q=query.trim().toLowerCase();
    var groups=groupProducts(products).filter(function(variants){
      var rep=variants[0];
      var multi=variants.length>1;
      // Линейка, в которой кончились все вкусы, с витрины уходит: купить её
      // нельзя, а место в сетке она занимает. Частично распроданная остаётся —
      // кончившиеся вкусы видны внутри линейки. На складе видно всё: там свой
      // фильтр, иначе товар было бы нечем вернуть в продажу.
      if(!variants.some(function(v){ return v.inStock; })) return false;
      var matchesCat = activeCat==='Все' || rep.category===activeCat;
      var matchesQuick =
        quickFilter==='all'   ? true :
        quickFilter==='new'   ? variants.some(function(v){ return v.badge==='new'; }) :
        quickFilter==='hit'   ? variants.some(function(v){ return v.badge==='hit'; }) : true;
      if(!matchesQuick) return false;
      var displayName = multi ? rep.group : rep.name;
      var matchesQuery = !q ||
        displayName.toLowerCase().indexOf(q)!==-1 ||
        (rep.category||'').toLowerCase().indexOf(q)!==-1 ||
        (rep.subcategory||'').toLowerCase().indexOf(q)!==-1 ||
        variants.some(function(v){
          return v.name.toLowerCase().indexOf(q)!==-1 ||
                 (v.category||'').toLowerCase().indexOf(q)!==-1 ||
                 (v.subcategory||'').toLowerCase().indexOf(q)!==-1;
        });
      return matchesCat && matchesQuery;
    });
    gridEl.innerHTML='';
    // Первая загрузка ещё идёт — рисуем скелетоны, а не «ничего нет»:
    // пустой экран на медленном интернете читается как сломанный магазин.
    if(firstLoad && !products.length){
      for(var sk=0; sk<6; sk++){
        var box=document.createElement('div');
        box.className='skeleton';
        box.innerHTML='<div class="sk-thumb"></div><div class="sk-body">'+
          '<div class="sk-line"></div><div class="sk-line short"></div></div>';
        gridEl.appendChild(box);
      }
      return;
    }
    if(!groups.length){
      var empty=document.createElement('div');
      empty.className='empty-state';
      // Разные причины пустоты требуют разных действий от человека,
      // и одно «Ничего не найдено» на все случаи ни о чём не говорит.
      if(countNote){
        empty.innerHTML='<b>Магазин не отвечает</b>Проверь связь и открой заново';
      } else if(q){
        empty.innerHTML='<b>Ничего не нашлось</b>Попробуй короче или другими словами';
      } else if(quickFilter!=='all' || activeCat!=='Все'){
        empty.innerHTML='<b>Здесь пусто</b>В этом разделе сейчас ничего нет';
      } else {
        empty.innerHTML='<b>Товар кончился</b>Загляни позже — скоро будет поставка';
      }
      gridEl.appendChild(empty);
      return;
    }
    // Раскладываем по категориям: раньше товары шли подряд в том порядке,
    // в каком их заводили, и жидкости перемешивались с одноразками.
    // Порядок категорий — как в мастере товара, незнакомые уходят в конец.
    var order=(TYPES||[]).map(function(t){ return t.cat; });
    var byCat={}, catOrder=[];
    groups.forEach(function(variants){
      var cat=variants[0].category || 'Другое';
      if(!byCat[cat]){ byCat[cat]=[]; catOrder.push(cat); }
      byCat[cat].push(variants);
    });
    catOrder.sort(function(a,b){
      var ia=order.indexOf(a), ib=order.indexOf(b);
      if(ia===-1) ia=order.length;
      if(ib===-1) ib=order.length;
      return ia-ib;
    });

    // Когда категория выбрана, заголовок над ней один и тот же — не нужен
    var withHeads = catOrder.length>1;

    catOrder.forEach(function(cat){
      if(withHeads){
        var head=document.createElement('div');
        head.className='cat-head';
        head.textContent=cat;
        gridEl.appendChild(head);
      }
      byCat[cat].forEach(function(variants){
      var rep=variants[0];
      var multi=variants.length>1;
      var displayName = multi ? rep.group : rep.name;
      var anyInStock = variants.some(function(v){ return v.inStock; });
      var card=document.createElement('div');
      card.className='card'+(anyInStock?'':' out');
      card.dataset.open=groupKeyOf(variants);

      var priceLabel, actionHTML;
      if(multi){
        var prices=variants.map(function(v){ return v.price; });
        var minP=Math.min.apply(null,prices), maxP=Math.max.apply(null,prices);
        priceLabel = minP===maxP ? fmt(minP) : ('от '+fmt(minP));
        actionHTML = '<span class="ctl-slot"><button class="add-btn" aria-label="Выбрать вкус">›</button></span>';
      } else {
        priceLabel = fmt(rep.price);
        actionHTML = '<span class="ctl-slot" data-ctl="'+rep.id+'">'+cartControlHTML(rep, cart[rep.id]||0)+'</span>';
      }

      // Только количество: «3 вкуса». Сколько из них кончилось — видно внутри
      // линейки, на витрине это лишний шум.
      var subLine = multi
        ? variants.length+' '+unitWord(rep, variants.length)
        : (rep.tag || '');

      card.innerHTML =
        '<div class="thumb">'+
          (rep.badge?'<span class="badge '+rep.badge+'">'+(rep.badge==='new'?'NEW':'ХИТ')+'</span>':'')+
          thumbContent(coverOf(variants), displayName)+
        '</div>'+
        '<div class="info">'+
          '<div class="name">'+esc(displayName)+'</div>'+
          '<div class="tag">'+esc(subLine)+'</div>'+
          '<div class="meta-line">'+
            ratingHTML(variants)+
            (!multi ? stockLineHTML(rep) : '')+
          '</div>'+
          '<div class="row-bottom">'+
            '<span class="price">'+priceLabel+'</span>'+
            actionHTML+
          '</div>'+
        '</div>';
      gridEl.appendChild(card);
    });
    });
    attachCardHandlers();
  }
  function getRatingFor(variants){
    var ids=variants.map(function(v){ return String(v.id); });
    var relevant=reviews.filter(function(r){ return ids.indexOf(r.product_id)!==-1; });
    if(!relevant.length) return {avg:0, count:0};
    var avg=relevant.reduce(function(s,r){ return s+r.rating; },0)/relevant.length;
    return {avg:avg, count:relevant.length};
  }
  /* Без отзывов звезда не рисуется вовсе: «★0.0» на каждой карточке
     читалось как плохая оценка и топило те товары, у которых оценка есть.
     Строка держит высоту через min-height, поэтому ряды не едут. */
  function ratingHTML(variants){
    var r=getRatingFor(variants);
    if(!r.count) return '';
    return '<span class="rating"><span class="star">★</span>'+r.avg.toFixed(1)+'</span>';
  }
  function cartControlHTML(p,qty){
    if(!p.inStock) return '<button class="add-btn" style="opacity:.35" disabled aria-label="Нет в наличии">+</button>';
    if(qty>0) return qtyControlHTML(p.id,qty,false);
    return '<button class="add-btn" data-id="'+p.id+'" aria-label="Добавить в корзину">+</button>';
  }
  function attachCardHandlers(){
    Array.prototype.forEach.call(gridEl.querySelectorAll('.card'),function(card){
      card.onclick=function(e){
        if(e.target.closest('[data-id]')) return;
        openProductModal(card.dataset.open);
      };
    });
    Array.prototype.forEach.call(gridEl.querySelectorAll('.add-btn[data-id]'),function(btn){
      btn.onclick=function(e){ e.stopPropagation(); addToCart(+btn.dataset.id); };
    });
    bindQtyHandlers(gridEl);
  }

  // --- модалка товара (описание крупно, как карточка на Авито; поддержка групп вкусов) ---
  var productSheet=document.getElementById('productSheet');
  var productBackdrop=document.getElementById('productBackdrop');
  var currentModalKey=null;

  // Большой вариант — тот же контрол, только крупнее: раньше он собирался
  // из инлайновых стилей и выглядел чужеродно на фоне карточек.
  function qtyControlHTML(id, qty, big){
    return '<div class="qty'+(big?' qty-big':'')+'" data-id="'+id+'">'+
      '<button class="dec" aria-label="Убрать">−</button>'+
      '<span>'+qty+'</span>'+
      '<button class="inc" aria-label="Добавить">+</button>'+
    '</div>';
  }
  function bindQtyHandlers(container, after){
    Array.prototype.forEach.call(container.querySelectorAll('.qty'),function(el){
      var id=+el.dataset.id;
      el.querySelector('.inc').onclick=function(e){ if(e.stopPropagation) e.stopPropagation(); changeQty(id,1); if(after) after(); };
      el.querySelector('.dec').onclick=function(e){ if(e.stopPropagation) e.stopPropagation(); changeQty(id,-1); if(after) after(); };
    });
  }

  // === Экран линейки: сетка вкусов ===
  function renderLineSheet(){
    var variants=groupProducts(products).find(function(g){ return groupKeyOf(g)===currentModalKey; });
    if(!variants) return;
    var rep=variants[0];
    document.getElementById('lineName').textContent = rep.group || rep.name;
    document.getElementById('lineTag').textContent = [rep.category,rep.subcategory].filter(Boolean).join(' \u00b7 ');
    // Только количество, без «в наличии N» — как и на карточке в списке.
    document.getElementById('lineCount').textContent =
      variants.length+' '+unitWord(rep,variants.length);

    var gridEl=document.getElementById('flavorGrid');
    var ordered = orderedVariants(variants);
    gridEl.innerHTML = ordered.map(function(v){
      var r=getRatingFor([v]);
      var q=cart[v.id]||0;
      return '<div class="flavor-card'+(v.inStock?'':' out')+'" data-flavor="'+v.id+'">'+
        '<div class="fthumb">'+
          (v.badge?'<span class="badge '+v.badge+'">'+(v.badge==='new'?'NEW':'ХИТ')+'</span>':'')+
          thumbContent(v)+
        '</div>'+
        '<div class="fbody">'+
          '<div class="fname">'+esc(v.name)+'</div>'+
          '<div class="meta-line">'+
            (r.count?'<span class="rating"><span class="star">★</span>'+r.avg.toFixed(1)+
              ' <span style="opacity:.7; font-weight:400;">('+r.count+')</span></span>':'')+
            stockLineHTML(v)+
          '</div>'+
          '<div class="frow">'+
            '<span class="fprice">'+fmt(v.price)+'</span>'+
            '<span class="ctl-slot" data-ctl="'+v.id+'">'+cartControlHTML(v, q)+'</span>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');

    // Обработчики вешаем через paintSlot: он же и перерисовывает только
    // свой слот, поэтому сетка вкусов не пересобирается на каждый «+».
    Array.prototype.forEach.call(gridEl.querySelectorAll('.ctl-slot[data-ctl]'), paintSlot);
    Array.prototype.forEach.call(gridEl.querySelectorAll('[data-flavor]'),function(card){
      card.onclick=function(e){
        if(e.target.closest('[data-id]') || e.target.closest('.qty')) return;
        openVariantSheet(+card.dataset.flavor);
      };
    });
  }

  // === Экран одного вкуса ===
  var variantSheet=document.getElementById('variantSheet');
  var variantBackdrop=document.getElementById('variantBackdrop');
  var currentVariantId=null;

  function currentVariant(){
    return products.find(function(p){ return p.id===currentVariantId; });
  }

  function renderVariantSheet(){
    var v=currentVariant();
    if(!v) return;
    var thumbEl=document.getElementById('vThumb');
    if(thumbEl.dataset.for!==String(v.id)){
      thumbEl.innerHTML=thumbContent(v);
      thumbEl.dataset.for=String(v.id);
      thumbEl.onclick=function(){ if(v.image) openLightbox(v.image); };
    }
    document.getElementById('vBadge').innerHTML = v.badge
      ? '<span class="badge '+v.badge+'" style="position:static; display:inline-block; margin-bottom:8px;">'+(v.badge==='new'?'NEW':'ХИТ')+'</span>' : '';
    document.getElementById('vName').textContent=v.name;
    document.getElementById('vTag').textContent=[v.category,v.subcategory,v.group].filter(Boolean).join(' \u00b7 ');
    var stockEl=document.getElementById('vStock');
    var stockText=stockLabel(v);
    stockEl.className='stock-line '+stockClass(v);
    stockEl.textContent=stockText;
    stockEl.style.display = stockText ? '' : 'none';
    document.getElementById('vDesc').textContent = v.tag || 'Без описания';
    document.getElementById('vPrice').textContent = fmt(v.price);

    var actionEl=document.getElementById('vAction');
    var q=cart[v.id]||0;
    actionEl.innerHTML =
      !v.inStock ? '<button class="checkout-btn" disabled style="opacity:.4">Нет в наличии</button>' :
      q>0 ? qtyControlHTML(v.id,q,true) :
      '<button class="checkout-btn" id="vAddBtn">Добавить в корзину</button>';
    var addBtn=actionEl.querySelector('#vAddBtn');
    if(addBtn) addBtn.onclick=function(){ addToCart(v.id); };
    bindQtyHandlers(actionEl);

    renderVariantNav();
    renderReviews([v]);
  }

  /* Листание по вкусам одной линейки. Список считаем от самого вкуса, а не от
     открытой линейки: экран вкуса открывается и по прямой ссылке, когда сетки позади нет. */
  function currentLineVariants(){
    var v=currentVariant();
    if(!v) return [];
    var g=groupProducts(products).find(function(list){
      return list.some(function(x){ return x.id===v.id; });
    });
    return orderedVariants(g || [v]);
  }
  function renderVariantNav(){
    var navEl=document.getElementById('vNav');
    if(!navEl) return;
    var list=currentLineVariants();
    // Одиночному товару листать нечего
    navEl.hidden = list.length<2;
    if(list.length<2) return;
    var i=0;
    list.forEach(function(x,k){ if(x.id===currentVariantId) i=k; });
    document.getElementById('vPos').textContent=(i+1)+' / '+list.length;
  }
  var swapping=false;
  function gotoVariant(dir){
    var list=currentLineVariants();
    if(list.length<2 || swapping) return;
    var i=0;
    list.forEach(function(x,k){ if(x.id===currentVariantId) i=k; });
    // По кругу: на краях кнопка иначе молча ничего не делает
    var next=list[(i+dir+list.length)%list.length];
    if(!next || next.id===currentVariantId) return;
    swapping=true;
    var box=document.getElementById('vSwap');
    var outCls = dir>0 ? 'swap-out-left' : 'swap-out-right';
    var inCls  = dir>0 ? 'swap-in-right' : 'swap-in-left';
    haptic('light');
    box.classList.add(outCls);
    setTimeout(function(){
      currentVariantId=next.id;
      document.getElementById('vThumb').dataset.for='';   // фото обязано перерисоваться
      renderVariantSheet();
      variantSheet.scrollTop=0;   // новый вкус начинается с фото, а не с середины отзывов
      box.classList.remove(outCls);
      box.classList.add(inCls);
      // Чтение offsetWidth заставляет браузер применить стартовую точку немедленно,
      // и снятие класса даёт переход именно с неё. Через requestAnimationFrame
      // было нельзя: в фоновой вкладке кадры не идут, и вкус так и оставался прозрачным.
      void box.offsetWidth;
      box.classList.remove(inCls);
      setTimeout(function(){ swapping=false; }, 120);
    }, 160);
  }
  document.getElementById('vPrev').onclick=function(){ gotoVariant(-1); };
  document.getElementById('vNext').onclick=function(){ gotoVariant(1); };
  /* Свайп по содержимому. Вертикаль отдаём прокрутке: шторка длинная,
     и перехватывать косой жест значит мешать читать. */
  (function(){
    var box=document.getElementById('vSwap');
    var x0=null, y0=null, live=false;
    box.addEventListener('touchstart', function(e){
      if(e.touches.length!==1){ live=false; return; }
      x0=e.touches[0].clientX; y0=e.touches[0].clientY; live=true;
    }, {passive:true});
    box.addEventListener('touchmove', function(e){
      if(!live) return;
      if(Math.abs(e.touches[0].clientY-y0)>30) live=false;   // это прокрутка
    }, {passive:true});
    box.addEventListener('touchend', function(e){
      if(!live) return;
      live=false;
      var dx=e.changedTouches[0].clientX-x0;
      if(Math.abs(dx)<50) return;
      gotoVariant(dx<0 ? 1 : -1);   // тянем влево — следующий, как в галерее
    }, {passive:true});
  })();

  function openVariantSheet(id){
    currentVariantId=id;
    swapping=false;
    document.getElementById('vSwap').className='';   // если закрыли посреди перехода
    document.getElementById('vThumb').dataset.for='';
    renderVariantSheet();
    variantSheet.classList.add('show'); setScrollLock('variant',true);
    variantBackdrop.classList.add('show');
    pushNav('variant', closeVariantSheet);
    updateCartBar();
    haptic('light');
  }
  function closeVariantSheet(){
    variantSheet.classList.remove('show'); setScrollLock('variant',false);
    variantBackdrop.classList.remove('show');
    currentVariantId=null;
    dropNav('variant');
    // Полную перерисовку грида НЕ делаем — она перезагружает все фото
    // и страница «моргает». Достаточно освежить видимые счётчики.
    refreshVisibleQty();
    updateCartBar();
  }
  document.getElementById('variantBack').onclick=closeVariantSheet;
  variantBackdrop.onclick=closeVariantSheet;
  enableSwipeToClose(variantSheet, closeVariantSheet);

  // === Просмотр фото во весь экран ===
  var lightbox=document.getElementById('lightbox');
  var lightboxImg=document.getElementById('lightboxImg');
  function openLightbox(src){
    lightboxImg.src=src;
    lightboxImg.classList.remove('zoomed');
    lightbox.classList.add('show'); setScrollLock('lightbox',true);
    // Без этого кнопка «Назад» Telegram не знала о фото и переставала работать
    pushNav('lightbox', closeLightbox);
    haptic('light');
  }
  function closeLightbox(){
    lightbox.classList.remove('show'); setScrollLock('lightbox',false);
    lightboxImg.src='';
    dropNav('lightbox');
  }
  document.getElementById('lightboxClose').onclick=closeLightbox;
  lightboxImg.onclick=function(){ lightboxImg.classList.toggle('zoomed'); };
  lightbox.onclick=function(e){ if(e.target===lightbox) closeLightbox(); };

  var selectedRating=5;
  function renderStarPicker(){
    var el=document.getElementById('starPicker');
    el.innerHTML='';
    for(var i=1;i<=5;i++){
      (function(i){
        var s=document.createElement('span');
        s.textContent = i<=selectedRating ? '★' : '☆';
        s.style.color='var(--hit)';
        s.style.cursor='pointer';
        s.onclick=function(){ selectedRating=i; renderStarPicker(); };
        el.appendChild(s);
      })(i);
    }
  }
  renderStarPicker();

  function renderReviews(variants){
    var ids=variants.map(function(v){ return String(v.id); });
    var relevant=reviews.filter(function(r){ return ids.indexOf(r.product_id)!==-1; });
    var squareEl=document.getElementById('reviewsSquare');
    var listEl=document.getElementById('reviewsList');
    if(!relevant.length){
      squareEl.innerHTML='<span style="color:var(--hit); font-size:26px; font-weight:700;">0.0</span>'+
        '<span style="color:var(--hint); font-size:12px; margin-top:4px;">пока нет отзывов</span>';
      listEl.innerHTML='';
    } else {
      var avg=relevant.reduce(function(s,r){ return s+r.rating; },0)/relevant.length;
      squareEl.innerHTML='<span style="color:var(--hit); font-size:26px; font-weight:700;">★ '+avg.toFixed(1)+'</span>'+
        '<span style="color:var(--hint); font-size:12px; margin-top:4px;">'+relevant.length+' '+otzyv(relevant.length)+'</span>';
      listEl.innerHTML=relevant.map(function(r){
        return '<div style="background:var(--bg); border-radius:12px; padding:10px 12px;">'+
          '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">'+
            '<b style="font-size:13px;">'+r.name+'</b>'+starsHTML(r.rating,13)+
          '</div>'+
          (r.text ? '<div style="font-size:13px; color:var(--hint); line-height:1.4;">'+r.text+'</div>' : '')+
        '</div>';
      }).join('');
    }
  }

  document.getElementById('submitReviewBtn').onclick=function(){
    // Отзыв ставится на КОНКРЕТНЫЙ вкус, а не на всю линейку:
    // человек пробовал один вкус, оценивать за остальные он не может.
    var v=currentVariant();
    if(!v){ toast('Сначала открой вкус'); return; }
    var text=document.getElementById('reviewText').value.trim();
    if(!sendToGAS({action:'review', type:'review', product_id: v.id, rating: selectedRating, text: text, name: MY_NAME, user_id: MY_UID})){ toast('Отправка не настроена'); return; }
    document.getElementById('reviewText').value='';
    selectedRating=5;
    renderStarPicker();
    haptic('medium');
    toast('Спасибо за отзыв!');
  };

  document.getElementById('reviewsSquare').onclick=function(){
    document.getElementById('reviewsList').scrollIntoView({behavior:'smooth', block:'start'});
  };
  document.getElementById('suggestBtn').onclick=function(){
    var box=document.getElementById('suggestBox');
    box.style.display = box.style.display==='none' ? 'block' : 'none';
  };
  document.getElementById('submitSuggestBtn').onclick=function(){
    var text=document.getElementById('suggestText').value.trim();
    if(!text){ toast('Напиши хотя бы пару слов'); return; }
    if(!sendToGAS({action:'suggestion', type:'suggestion', text:text, name: MY_NAME, user_id: MY_UID})){ toast('Отправка не настроена'); return; }
    document.getElementById('suggestText').value='';
    document.getElementById('suggestBox').style.display='none';
    haptic('medium');
    toast('Спасибо за идею!');
  };

  function openProductModal(key){
    var variants=groupProducts(products).find(function(g){ return groupKeyOf(g)===key; });
    if(!variants) return;
    // Одиночный товар — линейку показывать не из чего, открываем сразу карточку
    if(variants.length===1){ openVariantSheet(variants[0].id); return; }
    currentModalKey=key;
    renderLineSheet();
    productSheet.classList.add('show'); setScrollLock('product',true);
    productBackdrop.classList.add('show');
    pushNav('line', closeProductModal);
    updateCartBar();
    haptic('light');
  }
  function closeProductModal(){
    productSheet.classList.remove('show'); setScrollLock('product',false);
    productBackdrop.classList.remove('show');
    currentModalKey=null;
    dropNav('line');
    refreshVisibleQty();
    updateCartBar();
  }
  document.getElementById('productClose').onclick=closeProductModal;
  productBackdrop.onclick=closeProductModal;
  enableSwipeToClose(productSheet, closeProductModal);

  // Копирование с запасным путём: navigator.clipboard есть не во всех
  // webview Telegram и отваливается асинхронно, поэтому обычный try/catch
  // вокруг него ничего не ловит — нужен и промис-catch, и execCommand.
  function copyText(text, okMsg){
    function fallback(){
      try{
        var ta=document.createElement('textarea');
        ta.value=text;
        ta.setAttribute('readonly','');
        ta.style.cssText='position:fixed; top:-1000px; opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok=document.execCommand('copy');
        document.body.removeChild(ta);
        toast(ok ? okMsg : 'Не удалось скопировать');
      }catch(e){ toast('Не удалось скопировать'); }
    }
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){ toast(okMsg); }, fallback);
      } else {
        fallback();
      }
    }catch(e){ fallback(); }
    haptic('light');
  }

  // === Навигация родной кнопкой «Назад» Telegram ===
  // Свои «✕ Закрыть» прячем: Telegram и так рисует поверх страницы свои
  // кнопки, две подряд мешают друг другу.
  var navStack=[];
  var hasNativeBack = !!(tg && tg.BackButton && tg.BackButton.show);
  if(hasNativeBack) document.body.classList.add('tg-native-back');

  function syncBackButton(){
    // Язычок панели не должен висеть поверх открытых экранов
    var tab=document.getElementById('drawerTab');
    if(tab) tab.classList.toggle('hidden', navStack.length>0);
    if(!hasNativeBack) return;
    try{
      if(navStack.length) tg.BackButton.show();
      else tg.BackButton.hide();
    }catch(e){}
  }
  function pushNav(name, closeFn){
    navStack.push({name:name, close:closeFn});
    syncBackButton();
  }
  function dropNav(name){
    navStack=navStack.filter(function(e){ return e.name!==name; });
    syncBackButton();
  }
  function popNav(){
    var top=navStack[navStack.length-1];
    if(top) top.close();
  }
  if(hasNativeBack){
    try{ tg.BackButton.onClick(popNav); }catch(e){}
  }
  // Единая точка добавления: дальше склада не пускаем
  function addToCart(id){
    var p=products.find(function(pr){ return pr.id===+id; });
    if(!p) return;
    if(!p.inStock){ toast('Этого вкуса нет в наличии'); return; }
    if(maxAddable(p)<=0){
      toast('Больше нет: на складе '+p.stock+' шт.');
      haptic('light');
      return;
    }
    changeQty(+id,1);
    // Корзину НЕ открываем: человек обычно набирает несколько вкусов подряд,
    // и выбрасывать его из линейки после каждого — мешать покупать.
    toast('Добавлено в корзину');
  }
  function changeQty(id,delta){
    var p=products.find(function(pr){ return pr.id===+id; });
    // Не даём набрать в корзину больше, чем есть на складе
    if(delta>0 && p && p.stock!==null && (cart[id]||0)+delta>p.stock){
      toast('На складе только '+p.stock+' шт.');
      return;
    }
    cart[id]=(cart[id]||0)+delta;
    if(cart[id]<=0) delete cart[id];
    haptic('light');
    refreshQtyControls(id);
    updateCartBar();
    // Корзину пересобираем, только если она открыта — иначе это была
    // холостая перерисовка на каждый «+».
    if(sheet.classList.contains('show')) renderCartSheet();
  }
  // Обновляем ТОЛЬКО слот с кнопками у нужного товара. Полная перерисовка
  // грида заставляла браузер заново тянуть все фото — отсюда и «страница
  // обновляется» при добавлении в корзину.
  function paintSlot(slot){
    var id=+slot.dataset.ctl;
    var p=products.find(function(pr){ return pr.id===id; });
    if(!p) return;
    slot.innerHTML=cartControlHTML(p, cart[id]||0);
    var addb=slot.querySelector('.add-btn[data-id]');
    if(addb){
      addb.onclick=function(e){ e.stopPropagation(); addToCart(id); };
    }
    var qtyEl=slot.querySelector('.qty');
    if(qtyEl){
      qtyEl.querySelector('.inc').onclick=function(e){ e.stopPropagation(); changeQty(id,1); };
      qtyEl.querySelector('.dec').onclick=function(e){ e.stopPropagation(); changeQty(id,-1); };
    }
  }
  function refreshQtyControls(id){
    Array.prototype.forEach.call(
      document.querySelectorAll('.ctl-slot[data-ctl="'+id+'"]'), paintSlot);
    // Экран вкуса: там своя большая кнопка, точечно обновим только её
    if(variantSheet.classList.contains('show') && currentVariantId===+id){
      paintVariantAction();
    }
  }
  // Освежить все видимые счётчики разом (после закрытия экранов),
  // не трогая картинки и не пересобирая разметку карточек.
  function refreshVisibleQty(){
    Array.prototype.forEach.call(document.querySelectorAll('.ctl-slot[data-ctl]'), paintSlot);
  }
  function paintVariantAction(){
    var v=currentVariant();
    if(!v) return;
    var actionEl=document.getElementById('vAction');
    var q=cart[v.id]||0;
    actionEl.innerHTML =
      !v.inStock ? '<button class="checkout-btn" disabled style="opacity:.4">Нет в наличии</button>' :
      q>0 ? qtyControlHTML(v.id,q,true) :
      '<button class="checkout-btn" id="vAddBtn">Добавить в корзину</button>';
    var addBtn=actionEl.querySelector('#vAddBtn');
    if(addBtn) addBtn.onclick=function(){ addToCart(v.id); };
    bindQtyHandlers(actionEl);
  }

  function cartCount(){
    return Object.keys(cart).reduce(function(sum,id){ return sum+cart[id]; },0);
  }
  function cartTotal(){
    return Object.keys(cart).reduce(function(sum,id){
      var p=products.find(function(p){ return p.id===+id; });
      return sum + (p ? p.price*cart[id] : 0);
    },0);
  }
  function updateCartBar(){
    var bar=document.getElementById('cartBar');
    var c=cartCount();
    document.getElementById('cartBarTotal').textContent=fmt(cartTotal());
    document.getElementById('cartBarCount').textContent=c+' '+plural(c,'товар','товара','товаров');
    var cartSheetOpen = document.getElementById('sheet').classList.contains('show');
    if(c>0 && !cartSheetOpen){ bar.classList.remove('cart-hidden'); }
    else{ bar.classList.add('cart-hidden'); }
  }
  function renderCartSheet(){
    var wrap=document.getElementById('cartItems');
    var ids=Object.keys(cart);
    if(!ids.length){
      wrap.innerHTML='<div class="empty-cart">Корзина пуста</div>';
    } else {
      wrap.innerHTML = ids.map(function(id){
        var p=products.find(function(p){ return p.id===+id; });
        var q=cart[id];
        // Только название вкуса: линейка уже названа выше по экрану,
        // второй раз в каждой строке она лишняя.
        return '<div class="cart-item">'+
          '<div class="thumb-sm">'+thumbContent(p)+'</div>'+
          '<div class="meta"><div class="name">'+p.name+'</div><div class="price">'+fmt(p.price)+' × '+q+'</div></div>'+
          qtyControlHTML(p.id,q,false)+
        '</div>';
      }).join('');
      bindQtyHandlers(wrap);
    }
    document.getElementById('sheetTotal').textContent=fmt(cartTotal());
  }

  // --- sheet ---
  var sheet=document.getElementById('sheet');
  var backdrop=document.getElementById('backdrop');
  // Доставки нет: клиент подходит на фиксированное место. Адрес показываем
  // сразу на оформлении — время встречи без него назначить невозможно.
  // При переезде править ЗДЕСЬ и в bot.py (MEETING_PLACE).
  var MEETING_PLACE = 'Маршала Жукова 20';
  document.getElementById('meetPlace').textContent = MEETING_PLACE;

  // Адрес нужно унести в карты, а выделять текст внутри Mini App неудобно —
  // и с телефона, и с ПК. Копируем одной кнопкой.
  document.getElementById('copyPlace').onclick=function(){
    copyText(MEETING_PLACE, 'Адрес скопирован');
  };

  var steps=['cartView','orderView'];
  function showStep(name){
    steps.forEach(function(id){
      document.getElementById(id).style.display = (id===name) ? '' : 'none';
    });
  }
  // pushNav/dropNav не только включают родную кнопку «Назад», но и прячут
  // язычок панели категорий у левого края: без этого его можно было вытянуть
  // прямо поверх открытой корзины.
  function openSheet(){
    renderCartSheet(); showStep('cartView');
    sheet.classList.add('show'); backdrop.classList.add('show');
    setScrollLock('cart',true); pushNav('cart', closeSheet); updateCartBar();
  }
  function closeSheet(){
    sheet.classList.remove('show'); backdrop.classList.remove('show');
    setScrollLock('cart',false); dropNav('cart'); updateCartBar();
  }
  enableSwipeToClose(sheet, closeSheet);
  /* Корзина и линейка с вкусом — одинаковые шторки на одном слое, и та, что
     объявлена в разметке позже, перекрывает предыдущую. Корзина в разметке
     первая, поэтому открытый вкус оставался поверх неё: нажимаешь «в корзину»,
     а на экране ничего не меняется — она «пропадает». Поэтому перед открытием
     закрываем всё, что выше. */
  function openCartOverAll(){
    closeVariantSheet();
    closeProductModal();
    openSheet();
  }
  document.getElementById('cartBar').onclick=openCartOverAll;
  backdrop.onclick=closeSheet;

  function getBonusToUse(){
    var check=document.getElementById('useBonusCheck');
    return check.checked ? Math.min(myBalance, cartTotal()) : 0;
  }

  // Пересчёт итога на экране оформления: бонусы — единственное, что его меняет
  function renderOrderTotal(){
    var used=getBonusToUse();
    document.getElementById('orderTotal').textContent =
      fmt(Math.max(0, cartTotal()-used)) + (used ? ' (−'+used+' бонусов)' : '');
  }

  document.getElementById('checkoutBtn').onclick=function(){
    if(!Object.keys(cart).length){ toast('Корзина пуста'); return; }

    // Состав заказа тут не повторяем: он только что был на экране корзины,
    // с которого сюда и пришли.
    var maxBonus=Math.min(myBalance, cartTotal());
    var bonusRow=document.getElementById('bonusRow');
    if(maxBonus>0){
      bonusRow.style.display='flex';
      document.getElementById('bonusAvailable').textContent=maxBonus;
      document.getElementById('useBonusCheck').checked=false;
    } else {
      bonusRow.style.display='none';
    }

    renderOrderTotal();
    renderMeetTimePicker();
    showStep('orderView');
    haptic('light');
  };

  document.getElementById('useBonusCheck').onchange=renderOrderTotal;

  // --- выбор времени встречи ---
  // Часов работы у магазина нет: клиент называет любое время, а подходит оно
  // или нет — решает админ, подтверждая заказ или отклоняя его с причиной.
  // Прятать слоты «неудобного» времени в витрине значит терять заказы, о
  // которых он бы и так договорился.
  var WORK_FROM = 0;
  var WORK_TO = 23;
  var SLOT_STEP_MIN = 30;  // шаг между слотами
  var SLOT_LEAD_MIN = 40;  // ближайший слот не раньше чем через столько минут:
                           // и товар собрать, и дойти до места

  var pickedDay = '';      // 'today' | 'tomorrow'
  var pickedTime = '';     // 'HH:MM'

  function slotsForDay(day){
    var out=[];
    var now=new Date();
    var earliest=new Date(now.getTime() + SLOT_LEAD_MIN*60000);
    for(var h=WORK_FROM; h<=WORK_TO; h++){
      for(var m=0; m<60; m+=SLOT_STEP_MIN){
        if(day==='today'){
          var t=new Date();
          t.setHours(h,m,0,0);
          if(t < earliest) continue;    // время уже прошло или слишком впритык
        }
        out.push((h<10?'0':'')+h+':'+(m<10?'0':'')+m);
      }
    }
    return out;
  }

  function setMeetTime(){
    var el=document.getElementById('orderTime');
    if(pickedDay && pickedTime){
      // Дату пишем рядом со словом: заказ живёт в таблице, и через сутки
      // «сегодня в 18:00» уже ничего не означает.
      var d=new Date();
      if(pickedDay==='tomorrow') d.setDate(d.getDate()+1);
      var dd=(d.getDate()<10?'0':'')+d.getDate();
      var mm=(d.getMonth()+1<10?'0':'')+(d.getMonth()+1);
      el.value=(pickedDay==='today'?'сегодня':'завтра')+' '+dd+'.'+mm+' в '+pickedTime;
    } else {
      el.value='';
    }
    document.getElementById('daySlots').classList.remove('invalid');
    document.getElementById('timeSlots').classList.remove('invalid');
  }

  function renderTimeSlots(){
    var box=document.getElementById('timeSlots');
    var hint=document.getElementById('timeHint');
    box.innerHTML='';
    if(!pickedDay){
      hint.textContent='Сначала выбери день.';
      return;
    }
    var slots=slotsForDay(pickedDay);
    if(!slots.length){
      // Единственный случай, когда на сегодня не осталось ничего: поздний вечер.
      hint.textContent='На сегодня время закончилось — выбери «Завтра».';
      return;
    }
    hint.textContent='';
    slots.forEach(function(t){
      var b=document.createElement('button');
      b.type='button';
      b.className='slot'+(t===pickedTime?' active':'');
      b.textContent=t;
      b.onclick=function(){
        pickedTime=t;
        renderTimeSlots();
        setMeetTime();
        haptic('light');
      };
      box.appendChild(b);
    });
  }

  function renderDaySlots(){
    var box=document.getElementById('daySlots');
    box.innerHTML='';
    var days=[];
    if(slotsForDay('today').length) days.push(['today','Сегодня']);
    days.push(['tomorrow','Завтра']);
    days.forEach(function(d){
      var b=document.createElement('button');
      b.type='button';
      b.className='slot'+(d[0]===pickedDay?' active':'');
      b.textContent=d[1];
      b.onclick=function(){
        if(pickedDay!==d[0]){ pickedDay=d[0]; pickedTime=''; }
        renderDaySlots();
        renderTimeSlots();
        setMeetTime();
        haptic('light');
      };
      box.appendChild(b);
    });
  }

  function renderMeetTimePicker(){
    // Пересобираем при каждом открытии корзины: приложение могут держать
    // открытым часами, и слоты, актуальные утром, к вечеру уже прошли.
    if(pickedDay==='today' && slotsForDay('today').indexOf(pickedTime)===-1){
      pickedTime='';
    }
    renderDaySlots();
    renderTimeSlots();
    setMeetTime();
  }

  renderMeetTimePicker();

  Array.prototype.forEach.call(document.querySelectorAll('.back-btn[data-back]'),function(btn){
    btn.onclick=function(){
      showStep('cartView');
      haptic('light');
    };
  });

  document.getElementById('orderSendBtn').onclick=function(){
    var timeEl=document.getElementById('orderTime');
    if(!timeEl.value.trim()){
      // Подсвечиваем именно тот ряд, где человек не дошёл до конца: день не
      // выбран — верхний, выбран, но без времени — нижний.
      var row=document.getElementById(pickedDay ? 'timeSlots' : 'daySlots');
      toast(pickedDay ? 'Выбери время' : 'Выбери день встречи');
      row.classList.add('invalid');
      row.scrollIntoView({behavior:'smooth', block:'center'});
      haptic('heavy');
      return;
    }
    document.getElementById('orderProblem').style.display='none';
    bonusToUse=getBonusToUse();
    submitOrder();
  };

  var COMMUNITY_CHAT_URL = 'https://t.me/chipatap_baraholka40';
  document.getElementById('communityLink').href = COMMUNITY_CHAT_URL;

  // --- отправка заказа боту ---
  // ВАЖНО: sendData работает ТОЛЬКО если магазин открыт с клавиатурной
  // web_app-кнопки. Открыт с inline-кнопки — sendData молча ничего не делает:
  // ни ошибки, ни исключения, заказ просто исчезает. Поэтому ниже стоит
  // проверка «приложение всё ещё открыто» — иначе клиент уверен, что заказал.
  function submitOrder(){
    var order={
      type:'checkout',
      items:Object.keys(cart).map(function(id){ return {id:+id, qty:cart[id]}; }),
      total:cartTotal(),
      bonus_used:bonusToUse,
      meet_time:document.getElementById('orderTime').value.trim(),
      contact:document.getElementById('orderContact').value.trim()
    };
    // Транспорта два, и выбор не косметический. sendData работает только у
    // приложения, открытого клавиатурной кнопкой из чата с ботом; у открытого
    // прямой ссылкой из канала (t.me/<bot>/shop) или кнопкой меню заказ уходит
    // в Apps Script, откуда его забирает бот. Раньше здесь стоял отказ «открой
    // другой кнопкой» — человек проходил весь путь до оформления и упирался в
    // стену; теперь заказать можно откуда угодно.
    //
    // Способ отправки определяет ТИП ЗАПУСКА, а не наличие метода. Сам
    // tg.sendData есть всегда, в любом запуске Mini App — просто у открытого
    // прямой ссылкой или кнопкой меню он молча ничего не делает. Проверка «а
    // есть ли sendData» на это и напоролась: заказ из канала уходил в никуда,
    // приложение не закрывалось, и человек получал «заказ не отправился».
    // Надёжный признак запуска с клавиатурной кнопки — пустой initData:
    // именно такому запуску Telegram не отдаёт данные пользователя.
    var fromKeyboard = openedFromKeyboardButton;

    if(fromKeyboard){
      var sent=false;
      try{
        if(tg.sendData){
          tg.sendData(JSON.stringify(order));
          sent=true;
        }
      }catch(e){}
      if(sent){
        // Удачная отправка закрывает приложение мгновенно. Если через две
        // секунды мы всё ещё здесь — данные не ушли, и молчать об этом нельзя.
        setTimeout(function(){
          showOrderProblem('Заказ не ушёл. Попробуй ещё раз или напиши в поддержку.');
        }, 2000);
        haptic('medium');
        return;
      }
    }

    // Запасной путь. Без user_id бот не поймёт, кому отвечать и кому начислять
    // бонусы, а initData у запуска прямой ссылкой заполнен — значит id есть.
    if(!MY_UID){
      showOrderProblem('Не удалось определить твой аккаунт Telegram. Открой магазин кнопкой «🛒 Открыть магазин» в чате с ботом.');
      return;
    }
    // Приёмник заказов не настроен — молчать нельзя: ответ Apps Script всё
    // равно не прочитать (no-cors), и без этой проверки человек увидел бы
    // «заказ отправлен» там, где заказ уходит в никуда.
    if(!ORDERS_URL){
      showOrderProblem('Отсюда заказ пока не оформить. Открой магазин кнопкой «🛒 Открыть магазин» в чате с ботом — там оформление работает.');
      return;
    }
    order.action='order';
    order.token=ORDERS_TOKEN;
    order.user_id=MY_UID;
    order.name=MY_NAME;
    try{
      postToGAS(ORDERS_URL, order);
    }catch(e){
      showOrderProblem('Заказ не отправился. Открой магазин кнопкой «🛒 Открыть магазин» в чате с ботом и попробуй ещё раз.');
      return;
    }
    // Ответ Apps Script прочитать нельзя (no-cors), поэтому подтверждаем на
    // месте, а настоящее подтверждение с деталями встречи придёт от бота в чат.
    cart={};
    updateCartBar();
    closeSheet();
    haptic('medium');
    toast('Заказ отправлен — бот напишет в чат');
  }

  function showOrderProblem(msg){
    var box=document.getElementById('orderProblem');
    box.textContent=msg;
    box.style.display='block';
    toast('Заказ не отправился');
    haptic('heavy');
  }

  // --- search ---
  document.getElementById('searchInput').addEventListener('input',function(e){
    query=e.target.value;
    // при активном поиске ищем по всему магазину, не ограничиваясь категорией
    if(query.trim() && activeCat!=='Все'){
      activeCat='Все';
      renderChips();
    }
    renderGrid();
  });

  // --- toast ---
  var toastTimer;
  function toast(msg){
    var el=document.getElementById('toast');
    el.textContent=msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){ el.classList.remove('show'); },1800);
  }

  // --- haptics ---

  // --- свайп вниз для закрытия шторки (тянуть за "ручку" наверху) ---
  function enableSwipeToClose(sheetEl, closeFn){
    var handle=sheetEl.querySelector('.handle-zone');
    if(!handle) return;
    var startY=0, deltaY=0, dragging=false;
    handle.addEventListener('touchstart', function(e){
      dragging=true;
      startY=e.touches[0].clientY;
      sheetEl.style.transition='none';
    }, {passive:true});
    handle.addEventListener('touchmove', function(e){
      if(!dragging) return;
      deltaY=Math.max(0, e.touches[0].clientY-startY);
      sheetEl.style.transform='translateY('+deltaY+'px)';
    }, {passive:true});
    function endDrag(){
      if(!dragging) return;
      dragging=false;
      sheetEl.style.transition='';
      sheetEl.style.transform='';
      if(deltaY>80) closeFn();
      deltaY=0;
    }
    handle.addEventListener('touchend', endDrag);
    handle.addEventListener('touchcancel', endDrag);
  }

  // --- админка ---
  var adminSheet=document.getElementById('adminSheet');
  var adminBackdrop=document.getElementById('adminBackdrop');
  var adminSteps=['adminListView','adminFormView','adminSupplyView'];
  var editingId=null;
  var adminQuery='';
  var adminCat='Все';
  var pendingStock={};   // id -> новое количество, пока не сохранено

  // Держит поле над клавиатурой. visualViewport даёт реальную высоту
  // видимой области после её появления — обычный innerHeight про неё не знает.
  function keepAboveKeyboard(el){
    var vv=window.visualViewport;
    // Без запаса снизу последние строки просто некуда прокручивать —
    // они так и остаются под клавиатурой. Спейсер даёт этот запас.
    var spacer=document.getElementById('adminSpacer');
    if(spacer) spacer.style.height='70vh';
    var run=function(){
      var visH = vv ? vv.height : window.innerHeight;
      var rect = el.getBoundingClientRect();
      var target = visH*0.22;               // строка встаёт под самой шапкой
      var delta = rect.top - target;
      if(Math.abs(delta)>10) adminSheet.scrollTop += delta;
    };
    // Клавиатура появляется не мгновенно: ждём события, иначе замер врёт
    if(vv){
      var once=function(){ run(); vv.removeEventListener('resize', once); };
      vv.addEventListener('resize', once);
    }
    setTimeout(run, 120);
    setTimeout(run, 360);
    var release=function(){
      if(spacer) spacer.style.height='0';
      el.removeEventListener('blur', release);
    };
    el.addEventListener('blur', release);
  }

  function showAdminStep(name){
    adminSteps.forEach(function(id){
      document.getElementById(id).style.display = (id===name) ? '' : 'none';
    });
  }
  function openAdmin(){
    renderAdminList();
    showAdminStep('adminListView');
    adminSheet.classList.add('show');
    setScrollLock('admin', true);   // фон под страницей не скроллим
    pushNav('admin', closeAdmin);
    updateCartBar();
  }
  // Родное окно Telegram, если оно есть: confirm() в Mini App блокирует
  // страницу и на части клиентов не показывается вовсе.
  function ask(text, onYes){
    try{
      if(tg && tg.showConfirm){
        tg.showConfirm(text, function(ok){ if(ok) onYes(); });
        return;
      }
    }catch(e){}
    if(confirm(text)) onYes();
  }

  function closeAdmin(){
    // Несохранённые остатки живут только в приложении: уйдёшь — пропадут
    var pendingCount=Object.keys(pendingStock).length;
    if(pendingCount && document.getElementById('adminListView').style.display!=='none'){
      ask('Не сохранено правок: '+pendingCount+'. Выйти и потерять их?', function(){
        pendingStock={};
        forceCloseAdmin();
      });
      return;
    }
    forceCloseAdmin();
  }

  function forceCloseAdmin(){
    // Внутри мастера «назад» — это шаг назад, а не выход из админки
    if(document.getElementById('adminFormView').style.display!=='none'){
      if(wizIndex>0){ showWizStep(wizIndex-1); return; }
      showAdminStep('adminListView');
      document.getElementById('adminHeadTitle').textContent='Склад';
      renderAdminList();
      return;
    }
    if(document.getElementById('adminSupplyView').style.display!=='none'){
      showAdminStep('adminListView');
      document.getElementById('adminHeadTitle').textContent='Склад';
      return;
    }
    adminSheet.classList.remove('show');
    setScrollLock('admin', false);
    dropNav('admin');
    updateCartBar();
  }
  document.getElementById('adminBtn').onclick=openAdmin;
  document.getElementById('adminCloseBtn').onclick=closeAdmin;
  document.getElementById('adminDrawerBtn').onclick=openDrawer;

  // --- рефералка ---
  var referralSheet=document.getElementById('referralSheet');
  var referralBackdrop=document.getElementById('referralBackdrop');
  function updateBalanceUI(){
    document.getElementById('balanceLabel').textContent=myBalance;
    document.getElementById('referralBalance').textContent=fmt(myBalance);
  }
  function openReferral(){
    var link = MY_UID ? ('https://t.me/'+BOT_USERNAME+'?start=ref'+MY_UID) : 'Открой магазин из Telegram, чтобы получить свою ссылку';
    document.getElementById('referralLink').textContent=link;
    updateBalanceUI();
    referralSheet.classList.add('show'); setScrollLock('referral',true);
    referralBackdrop.classList.add('show');
    updateCartBar();
  }
  function closeReferral(){
    referralSheet.classList.remove('show'); setScrollLock('referral',false);
    referralBackdrop.classList.remove('show');
    updateCartBar();
  }
  document.getElementById('referralBtn').onclick=openReferral;
  document.getElementById('referralClose').onclick=closeReferral;
  referralBackdrop.onclick=closeReferral;
  enableSwipeToClose(referralSheet, closeReferral);
  document.getElementById('copyReferral').onclick=function(){
    copyText(document.getElementById('referralLink').textContent, 'Ссылка скопирована');
  };

  var SHARE_TEXT='Магазин Chipatap — заходи по моей ссылке, обоим капнут бонусы';
  document.getElementById('shareReferral').onclick=function(){
    if(!MY_UID){ toast('Открой магазин из Telegram, чтобы получить ссылку'); return; }
    var link='https://t.me/'+BOT_USERNAME+'?start=ref'+MY_UID;
    haptic('medium');
    // t.me/share/url — родной выбор получателя в Telegram: список контактов
    // открывается сразу, ссылка уходит одним касанием
    var share='https://t.me/share/url?url='+encodeURIComponent(link)+
              '&text='+encodeURIComponent(SHARE_TEXT);
    try{
      if(tg && tg.openTelegramLink){ tg.openTelegramLink(share); return; }
    }catch(e){}
    // Вне Telegram — системное «Поделиться», а если и его нет, копируем
    try{
      if(navigator.share){
        navigator.share({title:'Chipatap', text:SHARE_TEXT, url:link});
        return;
      }
    }catch(e){}
    try{ navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
    catch(e){ toast('Не удалось поделиться'); }
  };

  // Текущее количество с учётом несохранённых правок
  function effStock(p){
    return Object.prototype.hasOwnProperty.call(pendingStock,p.id) ? pendingStock[p.id] : p.stock;
  }
  function setPendingStock(id, value){
    var p=products.find(function(pr){ return pr.id===id; });
    if(!p) return;
    if(value===null || value==='' || isNaN(value)){ delete pendingStock[id]; }
    else {
      var n=Math.max(0, Math.floor(value));
      if(n===p.stock) delete pendingStock[id];   // вернули как было — правка не нужна
      else pendingStock[id]=n;
    }
    // Полный renderAdminList() здесь пересобирал весь список и сбрасывал
    // фокус с поля ввода — из-за этого при наборе «кидало» по странице.
    // Обновляем только эту строку.
    updateAdminRow(id);
    renderPendingBar();
    renderAdminSummary();
  }
  function updateAdminRow(id){
    var inp=document.querySelector('[data-stock="'+id+'"]');
    if(!inp) return;
    var row=inp.closest('.admin-row');
    var p=products.find(function(pr){ return pr.id===id; });
    if(!p || !row) return;
    var s=effStock(p);
    var changed=Object.prototype.hasOwnProperty.call(pendingStock,p.id);
    var avail = s!==null ? s>0 : p.inStock;
    row.classList.toggle('changed', changed && avail);
    row.classList.toggle('changed-out', changed && !avail);
    // Значение в поле трогаем, только если пользователь сейчас не печатает в нём
    if(document.activeElement!==inp) inp.value = (s===null?'':s);
    var sub=row.querySelector('.sub');
    if(sub) sub.innerHTML='#'+p.id+' · '+esc(fmt(p.price))+' · '+stockSub(s, avail);
  }

  // «кончилось» всегда красным — по списку видно, что уже выбрано под ноль
  function stockSub(s, avail){
    if(s===null) return 'учёт не ведётся';
    return avail ? s+' шт.' : '<span class="out">кончилось</span>';
  }

  function adminFilteredProducts(){
    var q=adminQuery.trim().toLowerCase();
    return products.filter(function(p){
      if(adminCat!=='Все' && p.category!==adminCat) return false;
      if(!q) return true;
      return (p.name||'').toLowerCase().indexOf(q)!==-1 ||
             (p.group||'').toLowerCase().indexOf(q)!==-1 ||
             (p.category||'').toLowerCase().indexOf(q)!==-1 ||
             (p.subcategory||'').toLowerCase().indexOf(q)!==-1 ||
             String(p.id)===q;
    });
  }

  // Фильтр склада рисуется в той же выдвижной панели, что и категории
  // витрины — на самой странице места он больше не занимает.
  function renderAdminFilters(){
    var box=document.getElementById('chips');
    var cats=['Все'].concat(products.map(function(p){ return p.category; })
      .filter(function(c,i,a){ return c && a.indexOf(c)===i; }));
    box.innerHTML=cats.map(function(c){
      return '<button'+(c===adminCat?' class="active"':'')+' data-acat="'+esc(c)+'">'+esc(c)+'</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-acat]'),function(b){
      b.onclick=function(){
        adminCat=b.dataset.acat;
        renderAdminList();
        closeDrawer();
      };
    });
  }

  function renderAdminSummary(){
    var total=products.length;
    var out=products.filter(function(p){ var s=effStock(p); return s!==null ? s<=0 : !p.inStock; }).length;
    var low=products.filter(function(p){ var s=effStock(p); return s!==null && s>0 && s<=3; }).length;
    var untracked=products.filter(function(p){ return effStock(p)===null; }).length;
    document.getElementById('adminSummary').innerHTML =
      '<span>всего <b>'+total+'</b></span>'+
      '<span>кончилось <b>'+out+'</b></span>'+
      '<span>мало (до 3) <b>'+low+'</b></span>'+
      '<span>без учёта <b>'+untracked+'</b></span>';
  }

  function renderAdminList(){
    var list=document.getElementById('adminList');
    if(!list) return;
    renderAdminFilters();
    renderAdminSummary();

    var items=adminFilteredProducts();
    if(!items.length){
      list.innerHTML='<div class="empty-cart">Ничего не найдено</div>';
      renderPendingBar();
      return;
    }

    // Группируем по линейке — так склад читается так же, как он лежит в жизни
    var groups={}, order=[];
    items.forEach(function(p){
      var key=p.group || 'Без линейки';
      if(!groups[key]){ groups[key]=[]; order.push(key); }
      groups[key].push(p);
    });

    list.innerHTML=order.map(function(key){
      var rows=groups[key].map(function(p){
        var s=effStock(p);
        var changed=Object.prototype.hasOwnProperty.call(pendingStock,p.id);
        var avail = s!==null ? s>0 : p.inStock;
        var mark = changed ? (avail ? ' changed' : ' changed-out') : '';
        return '<div class="admin-row'+mark+'">'+
          '<div class="thumb-sm">'+thumbContent(p)+'</div>'+
          '<div class="meta">'+
            '<div class="name">'+esc(p.name)+'</div>'+
            '<div class="sub">#'+p.id+' · '+esc(fmt(p.price))+' · '+stockSub(s, avail)+'</div>'+
          '</div>'+
          '<div class="stock-box">'+
            '<button data-dec="'+p.id+'" aria-label="Меньше">−</button>'+
            '<input type="number" inputmode="numeric" min="0" data-stock="'+p.id+'" value="'+(s===null?'':s)+'" placeholder="—">'+
            '<button data-inc="'+p.id+'" aria-label="Больше">+</button>'+
          '</div>'+
          '<button class="icon-btn" data-edit="'+p.id+'" aria-label="Редактировать">✏️</button>'+
        '</div>';
      }).join('');
      var items=groups[key];
      var outCount=items.filter(function(p){
        var s=effStock(p); return s!==null ? s<=0 : !p.inStock;
      }).length;
      return '<div class="admin-group">'+
        '<div class="admin-group-title">'+
          esc(key)+
          '<span class="count">'+items.length+' '+plural(items.length,'товар','товара','товаров')+
            (outCount ? ' · '+outCount+' нет' : '')+
          '</span>'+
        '</div>'+
        '<div class="admin-group-rows">'+rows+'</div>'+
      '</div>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('[data-inc]'),function(b){
      b.onclick=function(){
        var id=+b.dataset.inc;
        var p=products.find(function(pr){ return pr.id===id; });
        var cur=effStock(p);
        setPendingStock(id, (cur===null?0:cur)+1);
        haptic('light');
      };
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-dec]'),function(b){
      b.onclick=function(){
        var id=+b.dataset.dec;
        var p=products.find(function(pr){ return pr.id===id; });
        var cur=effStock(p);
        setPendingStock(id, Math.max(0,(cur===null?0:cur)-1));
        haptic('light');
      };
    });
    // В самом списке поле только показывает число: тап открывает редактор
    // сверху экрана. Клавиатура снизу — перекрыть его нечем.
    Array.prototype.forEach.call(list.querySelectorAll('[data-stock]'),function(inp){
      inp.readOnly=true;   // в списке не печатаем — только показываем
      inp.onclick=function(){ openQtyEditor(+inp.dataset.stock); };
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-edit]'),function(btn){
      btn.onclick=function(){ openAdminForm(+btn.dataset.edit); };
    });

    renderPendingBar();
    updateSupplyReadiness();
  }

  // === Редактор количества (закреплён сверху) ===
  var qed=document.getElementById('qed');
  var qedBackdrop=document.getElementById('qedBackdrop');
  var qedInput=document.getElementById('qedInput');
  var qedId=null;

  function openQtyEditor(id){
    var p=products.find(function(pr){ return pr.id===id; });
    if(!p) return;
    qedId=id;
    var s=effStock(p);
    document.getElementById('qedName').textContent=p.name+(p.group?' · '+p.group:'');
    qedInput.value = (s===null?'':s);
    qed.classList.add('show');
    qedBackdrop.classList.add('show');
    pushNav('qed', closeQtyEditor);
    haptic('light');
    // Фокус только после анимации, иначе клавиатура успевает дёрнуть вёрстку
    setTimeout(function(){ try{ qedInput.focus(); qedInput.select(); }catch(e){} }, 260);
  }
  function closeQtyEditor(){
    applyQtyEditor();
    qed.classList.remove('show');
    qedBackdrop.classList.remove('show');
    try{ qedInput.blur(); }catch(e){}
    dropNav('qed');
    qedId=null;
  }
  function applyQtyEditor(){
    if(qedId===null) return;
    var v=qedInput.value.trim();
    setPendingStock(qedId, v===''?null:parseInt(v,10));
  }
  function qedBump(delta){
    var cur=parseInt(qedInput.value,10);
    if(isNaN(cur)) cur=0;
    qedInput.value=Math.max(0, cur+delta);
    applyQtyEditor();
    haptic('light');
  }
  Array.prototype.forEach.call(qed.querySelectorAll('[data-qd]'),function(b){
    b.onclick=function(){ qedBump(parseInt(b.dataset.qd,10)); };
  });
  Array.prototype.forEach.call(qed.querySelectorAll('[data-qs]'),function(b){
    b.onclick=function(){ qedInput.value=b.dataset.qs; applyQtyEditor(); haptic('light'); };
  });
  qedInput.oninput=applyQtyEditor;
  qedInput.onkeydown=function(e){ if(e.key==='Enter'){ e.preventDefault(); closeQtyEditor(); } };
  document.getElementById('qedDone').onclick=closeQtyEditor;
  qedBackdrop.onclick=closeQtyEditor;

  function renderPendingBar(){
    var n=Object.keys(pendingStock).length;
    // visibility, а не display: кнопка появлялась при первой же правке,
    // раздвигала шапку, и весь список дёргался вбок на пару пикселей.
    // Место под неё держим всегда — тогда ничего не смещается.
    document.getElementById('adminBatchSaveBtn').style.visibility = n>0 ? '' : 'hidden';
    document.getElementById('adminPendingCount').textContent = n;
  }

  // Поиска по названию в админке больше нет — фильтр по категориям
  // и группировка по линейкам справляются, а места он занимал много.
  document.getElementById('adminBatchSaveBtn').onclick=function(){
    var changes=Object.keys(pendingStock).map(function(id){
      return {id:+id, stock:pendingStock[id]};
    });
    if(!changes.length){ toast('Нечего сохранять'); return; }
    sendAdminAction('admin_batch', {changes:changes});
  };

  // --- объявление о поставке ---
  // В рассылку идёт ТОЛЬКО свежее: добавленное или пополненное за последние
  // сутки. Иначе люди каждый раз получали бы список всего склада.
  var SUPPLY_WINDOW_H = 24;

  function isRecent(p){
    var limit=Date.now()-SUPPLY_WINDOW_H*3600*1000;
    var a=parseStamp(p.added), r=parseStamp(p.restocked);
    return !!((a && a.getTime()>=limit) || (r && r.getTime()>=limit));
  }
  function recentSupplyItems(){
    return products.filter(function(p){
      if(!isRecent(p)) return false;
      var s=effStock(p);
      return s===null ? p.inStock : s>0;   // объявлять то, чего нет, незачем
    });
  }
  function buildSupplyText(){
    var fresh=recentSupplyItems();
    if(!fresh.length) return '';
    var byGroup={}, order=[];
    fresh.forEach(function(p){
      var k=p.group||p.name;
      if(!byGroup[k]){ byGroup[k]=[]; order.push(k); }
      byGroup[k].push(p);
    });
    var lines=order.slice(0,25).map(function(k){
      var vs=byGroup[k];
      return vs.length>1
        ? '- '+k+' — '+vs.length+' '+unitWord(vs[0],vs.length)
        : '- '+k+(vs[0].group?'':'');
    });
    return 'Приехала поставка! Уже можно заказать:\n\n'+lines.join('\n')+
           (order.length>25 ? '\n...и другое' : '')+
           '\n\nЗаходи и забирай, пока есть';
  }
  function updateSupplyReadiness(){
    var el=document.getElementById('supplyReady');
    if(!el) return;
    var n=recentSupplyItems().length;
    var btn=document.getElementById('adminSupplyBtn');
    if(n){
      el.textContent='Свежего за сутки: '+n+' поз. — есть что объявить';
      btn.style.opacity='';
    } else {
      el.textContent='За сутки ничего нового не добавлено и не пополнено';
      btn.style.opacity='.5';
    }
  }
  document.getElementById('adminSupplyBtn').onclick=function(){
    var text=buildSupplyText();
    if(!text){
      toast('За сутки нет новых поступлений — объявлять нечего');
      return;
    }
    if(Object.keys(pendingStock).length){
      toast('Сначала сохрани приход, потом объявляй');
      return;
    }
    document.getElementById('supplyText').value=text;
    document.getElementById('supplyAudience').textContent='всем '+'пользователям бота';
    showAdminStep('adminSupplyView');
  };
  document.getElementById('adminSupplyBack').onclick=function(){ showAdminStep('adminListView'); };
  document.getElementById('supplyRefillBtn').onclick=function(){
    var t=buildSupplyText();
    if(!t){ toast('Свежих поступлений за сутки нет'); return; }
    document.getElementById('supplyText').value=t;
    toast('Текст обновлён');
  };
  document.getElementById('supplySendBtn').onclick=function(){
    var text=document.getElementById('supplyText').value.trim();
    if(!text){ toast('Текст пустой'); return; }
    if(!confirm('Разослать это сообщение всем пользователям бота?')) return;
    sendAdminAction('broadcast', {text:text});
  };

  // === Пошаговое добавление/редактирование товара ===
  // Шаги зависят от типа: у жидкости спрашиваем линейку и вкус,
  // у картриджа — вид, у одноразки — затяжки. Меньше пустых полей.
  var TYPES=[
    {cat:'Жидкости',  em:'🧪', kindQ:'Какая линейка?',   kindLabel:'Линейка жидкости',
     nameQ:'Какой вкус?',     nameLabel:'Название вкуса',
     kinds:['Анархия','CS','Злая монашка','Самоубийца'], groupHint:true},
    {cat:'Одноразки', em:'💨', kindQ:'Сколько затяжек?', kindLabel:'Количество затяжек',
     nameQ:'Какой вкус?',     nameLabel:'Название вкуса',
     kinds:['6000','9000','12000','16000'], groupHint:true},
    {cat:'Картриджы', em:'🔌', kindQ:'Какой вид?',       kindLabel:'Вид картриджа',
     nameQ:'Название',        nameLabel:'Название',
     kinds:['На испарителе','На картридже','Сменный'], groupHint:true},
    {cat:'Снюс',      em:'🥫', kindQ:'Какая крепость?',  kindLabel:'Крепость',
     nameQ:'Какой вкус?',     nameLabel:'Название вкуса',
     kinds:['Лёгкий','Средний','Крепкий'], groupHint:false},
    {cat:'Подики',    em:'🔋', kindQ:'Какой вид?',       kindLabel:'Вид',
     nameQ:'Название',        nameLabel:'Название',
     kinds:['Устройство','Картридж'], groupHint:true},
    {cat:'Никобустер',em:'⚗️', kindQ:'Какой?',          kindLabel:'Тип',
     nameQ:'Название',        nameLabel:'Название',
     kinds:['Никобустер'], groupHint:false},
    {cat:'Другое',    em:'📦', kindQ:'Подкатегория',     kindLabel:'Подкатегория',
     nameQ:'Название',        nameLabel:'Название',
     kinds:[], groupHint:false}
  ];
  var WIZ_STEPS=['type','kind','name','price','photo'];
  var wizIndex=0;
  var wizType=null;

  function typeByCat(cat){
    for(var i=0;i<TYPES.length;i++){ if(TYPES[i].cat===cat) return TYPES[i]; }
    return null;
  }
  function showWizStep(i){
    wizIndex=Math.max(0, Math.min(WIZ_STEPS.length-1, i));
    var name=WIZ_STEPS[wizIndex];
    Array.prototype.forEach.call(document.querySelectorAll('.wiz-step'),function(el){
      el.style.display = el.dataset.step===name ? '' : 'none';
    });
    document.getElementById('wizSteps').innerHTML =
      WIZ_STEPS.map(function(_,k){ return '<i class="'+(k<=wizIndex?'done':'')+'"></i>'; }).join('');
    var last = wizIndex===WIZ_STEPS.length-1;
    document.getElementById('wizNext').style.display = last ? 'none' : '';
    document.getElementById('adminSaveBtn').style.display = last ? '' : 'none';
    document.getElementById('wizBack').style.display = wizIndex===0 ? 'none' : '';
    document.getElementById('adminDeleteBtn').style.display = (last && editingId) ? '' : 'none';
    document.getElementById('adminHeadTitle').textContent =
      (editingId ? 'Правка: ' : 'Новый товар: ') + (wizIndex+1) + '/' + WIZ_STEPS.length;
    // Линейку вводят на шаге раньше, поэтому решаем про обложку здесь
    if(name==='photo') refreshCoverBlock();
    adminSheet.scrollTop = 0;
  }
  function renderTypeGrid(){
    document.getElementById('typeGrid').innerHTML = TYPES.map(function(t){
      return '<button type="button" data-type="'+esc(t.cat)+'"'+
             (wizType && wizType.cat===t.cat ? ' class="active"' : '')+'>'+
             '<span class="em">'+t.em+'</span><span>'+esc(t.cat)+'</span></button>';
    }).join('');
    Array.prototype.forEach.call(document.getElementById('typeGrid').querySelectorAll('[data-type]'),function(b){
      b.onclick=function(){
        wizType=typeByCat(b.dataset.type);
        renderTypeGrid();
        renderKindStep();
        haptic('light');
        showWizStep(1);   // выбрал тип — сразу дальше, лишний тап не нужен
      };
    });
  }
  function renderKindStep(){
    if(!wizType) return;
    document.getElementById('kindQuestion').textContent=wizType.kindQ;
    document.getElementById('kindOwnLabel').textContent=wizType.kindLabel;
    var cur=document.getElementById('f_subcategory').value.trim();
    // К заранее заданным вариантам добавляем то, что уже есть в таблице
    var fromData=products.filter(function(p){ return p.category===wizType.cat; })
      .map(function(p){ return p.subcategory; })
      .filter(function(s,i,a){ return s && a.indexOf(s)===i; });
    var kinds=wizType.kinds.concat(fromData).filter(function(s,i,a){ return a.indexOf(s)===i; });
    document.getElementById('kindGrid').innerHTML = kinds.map(function(k){
      return '<button type="button" data-kind="'+esc(k)+'"'+(k===cur?' class="active"':'')+'>'+
             '<span>'+esc(k)+'</span></button>';
    }).join('');
    Array.prototype.forEach.call(document.getElementById('kindGrid').querySelectorAll('[data-kind]'),function(b){
      b.onclick=function(){
        document.getElementById('f_subcategory').value=b.dataset.kind;
        renderKindStep();
        haptic('light');
      };
    });
    document.getElementById('nameQuestion').textContent=wizType.nameQ;
    document.getElementById('nameLabel').textContent=wizType.nameLabel;
    // Подсказки линеек берём из того, что уже заведено
    document.getElementById('groupList').innerHTML =
      products.map(function(p){ return p.group; })
        .filter(function(g,i,a){ return g && a.indexOf(g)===i; })
        .map(function(g){ return '<option value="'+esc(g)+'">'; }).join('');
  }

  function setSeg(segId, hiddenId, value){
    var seg=document.getElementById(segId);
    Array.prototype.forEach.call(seg.querySelectorAll('button'),function(b){
      b.classList.toggle('active', b.dataset.val===value);
    });
    document.getElementById(hiddenId).value=value;
  }
  function bindSeg(segId, hiddenId){
    var seg=document.getElementById(segId);
    Array.prototype.forEach.call(seg.querySelectorAll('button'),function(b){
      b.onclick=function(){ setSeg(segId, hiddenId, b.dataset.val); haptic('light'); };
    });
  }
  bindSeg('segStock','f_instock');
  bindSeg('segBadge','f_badge');

  document.getElementById('wizNext').onclick=function(){
    var step=WIZ_STEPS[wizIndex];
    if(step==='type' && !wizType){ toast('Выбери, что добавляем'); return; }
    if(step==='name' && !document.getElementById('f_name').value.trim()){
      toast('Без названия никак'); return;
    }
    if(step==='price' && !document.getElementById('f_price').value.trim()){
      toast('Укажи цену'); return;
    }
    showWizStep(wizIndex+1);
  };
  document.getElementById('wizBack').onclick=function(){ showWizStep(wizIndex-1); };

  // --- фото ---
  // Ключ imgbb во фронтенде не живёт: config.js уезжает на GitHub Pages и
  // читается любым посетителем. Загружает фото бот («📷 Фото товара»), ключ
  // лежит только в его .env; сюда админ вставляет готовую ссылку.
  function setPreview(boxId, url, emptyText){
    var el=document.getElementById(boxId);
    el.innerHTML = url ? '<img src="'+esc(url)+'" alt="">' : emptyText;
  }
  function setPhotoPreview(url){ setPreview('photoPreview', url, 'Фото пока нет'); }
  function setCoverPreview(url){ setPreview('coverPreview', url, 'Обложки нет'); }

  // Превью обновляется прямо по мере ввода ссылки — видно, что вставили верную
  function wirePhotoField(fieldId, setPreviewFn){
    document.getElementById(fieldId).addEventListener('input', function(e){
      setPreviewFn(e.target.value.trim());
    });
  }
  wirePhotoField('f_image', setPhotoPreview);
  wirePhotoField('f_cover', setCoverPreview);

  // Обложку спрашиваем, только когда линейка уже не пустая: у первого товара
  // обложкой становится его собственное фото, спрашивать нечего.
  function refreshCoverBlock(){
    var group=document.getElementById('f_group').value.trim();
    var siblings=group ? products.filter(function(p){
      return p.group===group && p.id!==editingId;
    }) : [];
    var show=siblings.length>0;
    document.getElementById('coverBlock').style.display = show ? '' : 'none';
    if(show) document.getElementById('coverGroupName').textContent=group;
  }

  // Поля мастера тоже держим над клавиатурой
  ['f_name','f_group','f_desc','f_price','f_stock','f_subcategory','f_image'].forEach(function(id){
    var el=document.getElementById(id);
    if(el) el.addEventListener('focus', function(){ keepAboveKeyboard(el); });
  });

  function openAdminForm(id){
    editingId=id;
    var f={name:'',category:'',subcategory:'',price:'',desc:'',badge:'',icon:'',image:'',group:'',inStock:'TRUE',stock:'',cover:''};
    if(id){
      var p=products.find(function(p){ return p.id===id; });
      // В форму кладём исходную ссылку, а не прокси-адрес картинки
      if(p){ f={name:p.name,category:p.category,subcategory:p.subcategory,price:p.price,
                desc:p.tag,badge:p.badge==='new'?'NEW':(p.badge==='hit'?'ХИТ':''),
                icon:p.icon,image:p.rawImage||'',group:p.group||'',
                inStock:p.inStock?'TRUE':'FALSE',
                stock:(effStock(p)===null?'':effStock(p)),
                cover:p.cover||''}; }
    }
    wizType = typeByCat(f.category) || (f.category ? {cat:f.category, em:'📦', kindQ:'Подкатегория',
      kindLabel:'Подкатегория', nameQ:'Название', nameLabel:'Название', kinds:[]} : null);

    document.getElementById('f_name').value=f.name;
    document.getElementById('f_group').value=f.group;
    document.getElementById('f_subcategory').value=f.subcategory;
    document.getElementById('f_price').value=f.price;
    document.getElementById('f_desc').value=f.desc;
    document.getElementById('f_icon').value=f.icon;
    document.getElementById('f_image').value=f.image;
    document.getElementById('f_stock').value=f.stock;
    setSeg('segStock','f_instock', f.inStock);
    setSeg('segBadge','f_badge', f.badge);
    setPhotoPreview(f.image);
    document.getElementById('photoStatus').textContent = f.image ? 'Фото уже есть' : 'Можно пропустить и добавить позже';
    document.getElementById('f_cover').value=f.cover;
    setCoverPreview(f.cover);
    document.getElementById('coverStatus').textContent = f.cover
      ? 'Обложка уже задана' : 'Пусто — на главной останется фото первого вкуса';

    renderTypeGrid();
    renderKindStep();
    showAdminStep('adminFormView');
    // При правке сразу к сути — тип уже известен
    showWizStep(id ? 2 : 0);
  }

  document.getElementById('adminAddBtn').onclick=function(){ openAdminForm(null); };

  document.getElementById('adminSaveBtn').onclick=function(){
    var payload={
      name:document.getElementById('f_name').value.trim(),
      category:wizType ? wizType.cat : '',
      subcategory:document.getElementById('f_subcategory').value.trim(),
      group:document.getElementById('f_group').value.trim(),
      price:document.getElementById('f_price').value.trim(),
      desc:document.getElementById('f_desc').value.trim(),
      badge:document.getElementById('f_badge').value.trim(),
      icon:document.getElementById('f_icon').value.trim() || (wizType ? wizType.em : '📦'),
      image:document.getElementById('f_image').value.trim(),
      cover:document.getElementById('f_cover').value.trim(),
      stock:document.getElementById('f_stock').value.trim(),
      inStock:document.getElementById('f_instock').value
    };
    // Количество главнее переключателя: задал число — оно и решает наличие
    if(payload.stock!==''){
      payload.inStock = parseInt(payload.stock,10)>0 ? 'TRUE' : 'FALSE';
    }
    if(!payload.name || !payload.price){ toast('Нужны название и цена'); return; }
    if(editingId){
      payload.id=editingId;
      sendAdminAction('admin_edit', payload);
    } else {
      sendAdminAction('admin_add', payload);
    }
  };
  document.getElementById('adminDeleteBtn').onclick=function(){
    if(!editingId) return;
    if(!confirm('Удалить товар?')) return;
    sendAdminAction('admin_delete', {id:editingId});
  };

  function sendAdminAction(type, payload){
    var action=Object.assign({type:type}, payload);
    var inTelegram=inRealTelegram;
    try{
      if(inTelegram && tg.sendData){
        tg.sendData(JSON.stringify(action));
      } else {
        toast('Действие отправится боту, когда открыто из Telegram');
      }
    }catch(e){
      toast('Действие отправится боту, когда открыто из Telegram');
    }
    haptic('medium');
  }

  // --- initial render ---
  // initDataUnsafe.user тоже пуст для keyboard-кнопки, поэтому админку
  // показываем по параметру в ссылке (?admin=1), которую бот даёт только
  // тебе через admin_kb(). Настоящая проверка прав — всё равно на боте.
  var isAdmin = new URLSearchParams(location.search).get('admin') === '1';
  if(isAdmin){ document.getElementById('adminBtnWrap').style.display=''; }
  // Рисуем сетку до загрузки, иначе скелетоны некому показать: renderGrid
  // звался только по приходу данных, и до этого момента экран просто пустовал.
  renderGrid();
  loadProducts();
  loadReviews();
  loadBalance();
  updateCartBar();
})();
