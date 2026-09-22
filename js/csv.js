/* Чтение опубликованного CSV Google-таблицы.

   Разбор ручной, а не split(','): в названиях товаров попадаются запятые и
   кавычки, и на них любой упрощённый парсер разваливает строку. */

export function parseCSV(text){
  var rows=[], row=[], field='', inQuotes=false;
  for(var i=0;i<text.length;i++){
    var c=text[i];
    if(inQuotes){
      if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else inQuotes=false; }
      else field+=c;
    } else {
      if(c==='"') inQuotes=true;
      else if(c===','){ row.push(field); field=''; }
      else if(c==='\n' || c==='\r'){
        if(c==='\r' && text[i+1]==='\n') i++;
        row.push(field); field=''; rows.push(row); row=[];
      } else field+=c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  if(!rows.length) return [];
  var headers=rows[0].map(function(h){ return h.trim(); });
  return rows.slice(1).filter(function(r){ return r.length>1 && r[0]!==''; }).map(function(r){
    var obj={};
    headers.forEach(function(h,idx){ obj[h]=(r[idx]!==undefined?r[idx]:'').trim(); });
    return obj;
  });
}

/* Опубликованный CSV Google отдаёт с длинным кешем, и Telegram-браузер держит
   его ещё и у себя. Из-за этого правка из админки уезжала в таблицу, а витрина
   показывала старое — казалось, что сохранение не работает. Уникальный
   параметр в адресе заставляет скачать заново; no-store к нему в запросе. */
export function fresh(url){
  return url + (url.indexOf('?')===-1 ? '?' : '&') + '_=' + Date.now();
}

export const NO_CACHE = { cache:'no-store' };
