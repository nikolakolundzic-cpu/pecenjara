/* Evidencija pečenja: aplikacija (učitava je shim.js nakon prijave). */
(function(){
  var COL = 'porudzbine', LSKEY = 'pecenjara-evidencija-v1';
  /* Prekidači za nove prikaze: false sakriva prikaz (podaci se i dalje bilježe). */
  var FEAT = { iskidao: true, radnici: true };
  var DANI = ['nedjelja','ponedjeljak','utorak','srijeda','četvrtak','petak','subota'];
  var MJESECI = ['januar','februar','mart','april','maj','jun','jul','avgust','septembar','oktobar','novembar','decembar'];
  var TYPE = {jagnje:'Jagnje', prase:'Prase', drugo:'Drugo'};
  var ORDER = {jagnje:0, prase:1, drugo:2};

  function $(id){ return document.getElementById(id); }
  function setHTML(el, h){ if (el.__h !== h) { el.innerHTML = h; el.__h = h; } }
  var dataVer = 0;
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function fmt(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function todayStr(){ return fmt(new Date()); }
  function parse(s){ var p = s.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
  function shift(s, n){ var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function fmtTime(ts){ var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtWhen(ts){
    var d = new Date(ts), s = d.getDate() + '.' + (d.getMonth()+1) + '.';
    if (d.getFullYear() !== new Date().getFullYear()) s += d.getFullYear() + '.';
    return s + ' u ' + fmtTime(ts);
  }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  /* pretraga bez razlike u slovima: č, ć, š, ž i đ/dj se izjednačavaju */
  function norm(s){
    return String(s == null ? '' : s).toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function lbl(o){ return o.vrsta === 'drugo' ? (o.opis || 'Drugo') : (TYPE[o.vrsta] || o.vrsta); }

  var S = {
    vrsta: 'jagnje', kid: 'odmah', filter: 'sve', editing: null, touched: false, confirmId: null,
    loaded: false, mode: 'loading', view: 'upis', kfilter: 'sve', q: '',
    worker: '', staffConfirm: null, staffLoaded: false, changing: false,
    sesija: null, sesLoaded: false, histLimit: 150, histFull: true
  };
  var orders = [];
  var ME = { id: null, name: '', isOwner: false, canWrite: null, ready: false };
  var NAMES = {};
  var userNs = null;
  var STAFF = [], staffRef = null, staffTimer = null;
  var SESIJE = [], sesRef = null;
  var LSSES = 'pecenjara-sesija', LSSL = 'pecenjara-sesije-v1';
  var LSW = 'pecenjara-radnik', LSS = 'pecenjara-osoblje-v1';
  var dbRef = null, DB = null, histUnsub = null;
  var HOLDER = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var HIST = [], histRef = null, LSH = 'pecenjara-istorija-v1';
  function loadHistLocal(){ try { return JSON.parse(localStorage.getItem(LSH) || '[]'); } catch(e){ return []; } }
  function saveHistLocal(){ try { localStorage.setItem(LSH, JSON.stringify(HIST.slice(-3000))); } catch(e){} }
  function actOf(patch){
    if ('preuzeto' in patch) return patch.preuzeto ? 'preuzeto' : 'preuzimanje poništeno';
    if ('iskidano' in patch && !('vrsta' in patch)) return patch.iskidano ? 'iskidano' + (patch.iskidaoIme ? ' (' + patch.iskidaoIme + ')' : '') : 'iskidano poništeno';
    if ('mjesto' in patch && Object.keys(patch).length === 1) { var mf = mjFind(patch.mjesto); return patch.mjesto ? 'mjesto: ' + (mf ? mf[1] : patch.mjesto) : 'mjesto uklonjeno'; }
    return 'izmijenjeno';
  }
  function logEvt(akcija, o){
    try {
      var rec = { t: Date.now(), radnik: S.worker || '', akcija: akcija, opis: o ? (lbl(o) + ' ' + o.broj + (o.ime ? ' · ' + o.ime : '')) : '', sesija: (o && o.sesija) || '' };
      if (akcija === 'obrisano' && o) rec.snimak = JSON.stringify(o);
      if (S.mode === 'db' && histRef) { Promise.resolve(histRef.add(rec)).catch(function(){}); }
      else { HIST.push(rec); saveHistLocal(); renderHist(); }
    } catch(e){}
  }
  function renderHist(){
    var ul = $('histList'); if (!ul || !$('histAdmin').open) return;
    var all = HIST.slice().sort(function(a, b){ return (b.t || 0) - (a.t || 0); });
    var arr = S.mode === 'db' ? all : all.slice(0, S.histN || 150);
    var more = S.mode === 'db' ? !S.histFull : all.length > arr.length;
    ul.innerHTML = arr.length ? arr.map(function(h){
      var s = SESIJE.filter(function(x){ return x.id === h.sesija; })[0];
      return '<li class="hrow"><span><em>' + esc(h.akcija) + '</em> · ' + esc(h.opis) + '</span><small>' + esc(fmtWhen(h.t)) + (h.radnik ? ' · ' + esc(h.radnik) : '') + (s ? ' · ' + esc(s.ime) : '') + '</small>' +
        (h.akcija === 'obrisano' && h.snimak && !h.vraceno ? '<button class="ghost" type="button" data-hv="' + esc(h.id || String(h.t)) + '">Vrati</button>' : (h.vraceno ? '<small>vraćeno</small>' : '')) + '</li>';
    }).join('') : '<li class="note">Još nema zapisa.</li>';
    if (more) ul.innerHTML += '<li class="hrow"><button class="ghost" type="button" id="histMore">Prikaži starije</button></li>';
    var pa = pruneAllowed();
    $('pruneBox').hidden = !pa;
    $('pruneNote').textContent = pa ? '' : 'Stare zapise može brisati samo vlasnik.';
  }
  $('histAdmin').addEventListener('toggle', function(){ if (this.open) renderHist(); });
  /* telefon pamti da li su podešavanja otvorena */
  try { if (localStorage.getItem('pecenje-podesavanja') === '1') $('setLabel').open = true; } catch(e){}
  $('setLabel').addEventListener('toggle', function(){ try { localStorage.setItem('pecenje-podesavanja', this.open ? '1' : '0'); } catch(e){} });
  $('histList').addEventListener('click', function(e){
    if (e.target.closest('#histMore')) {
      if (S.mode === 'db') { S.histLimit += 150; subHist(); }
      else { S.histN = (S.histN || 150) + 150; renderHist(); }
      return;
    }
    var hv = e.target.closest('[data-hv]');
    if (hv) restoreOrder(hv.getAttribute('data-hv'), hv);
  });
  var confirmTimer = null, undoTimer = null;
  var lastUndo = null;

  /* ---------- kidanje helpers ---------- */
  function kidMode(o){
    var m = o.kidanje || (o.zaKidanje ? 'odmah' : 'ne');
    return m === 'ne' ? 'ne' : 'odmah';
  }
  function isPending(o){ return kidMode(o) !== 'ne' && !o.iskidano; }
  function kidPatch(on, ime){
    return on ? { iskidano: true, iskidanoU: Date.now(), iskidao: ME.id || '', iskidaoIme: ime || S.worker, oznacioKid: S.worker }
              : { iskidano: false, iskidanoU: 0, iskidao: '', iskidaoIme: '', oznacioKid: '' };
  }
  /* kidači: lista imena koja se nudi kad se označi iskidano */
  var KD_DEF = ['Nikola', 'Stevan', 'Željko'], KIDACI = KD_DEF.slice(), kdRef = null, LSKD = 'pecenjara-kidaci-v1';
  function setKdList(l){ KIDACI = Array.isArray(l) ? l.filter(function(x){ return typeof x === 'string' && x.trim(); }) : KD_DEF.slice(); }

  /* ---------- storage ---------- */
  function loadLocal(){ try { return JSON.parse(localStorage.getItem(LSKEY) || '[]'); } catch(e){ return []; } }
  function saveLocal(){ dataVer++; try { localStorage.setItem(LSKEY, JSON.stringify(orders)); } catch(e){} }

  function setMsg(text, isErr){
    var m = $('msg'); m.textContent = text || ''; m.className = 'msg full' + (isErr ? ' err' : '');
  }
  function setMsg2(text, isErr){
    var m = $('msg2'); m.textContent = text || ''; m.className = 'msg' + (isErr ? ' err' : '');
  }
  function writeFailed(e){
    var t = failText(e), code = e && e.code;
    setMsg(t, true); setMsg2(t, true);
    if (code === 'no_worker') { try { $('staffBar').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(x){} }
  }
  function failText(e){
    var code = e && e.code;
    var t;
    if (code === 'dup_no') t = lbl(e.o) + ' broj ' + e.o.broj + ' je trenutno kod kupca' + (e.other && e.other.ime ? ' ' + e.other.ime : '') +
      ' koji ga još nije preuzeo. Broj se može dati ponovo tek kad prethodni kupac preuzme pečenje.';
    else if (code === 'busy_no') t = 'Neko drugi upravo upisuje. Pokušaj ponovo za par sekundi.';
    else if (code === 'no_session') t = 'Prvo napravi događaj (traka „Događaj“ iznad).';
    else if (code === 'no_worker') t = 'Prvo izaberi ko radi (iznad forme).';
    else if (code === 'quota_exceeded') t ='Baza je puna. Obriši stare upise pa pokušaj ponovo.';
    else if (code === 'invalid_argument') t = 'Nemaš dozvolu da mijenjaš upise. Zamoli vlasnika da ti dâ pravo izmjene.';
    else t = 'Upis nije sačuvan. Provjeri internet vezu i pokušaj ponovo.';
    return t;
  }

  async function addOrder(o){
    var cs = curSession();
    if (!cs || cs.virtual) throw { code: 'no_session' };
    if (needWorker()) throw { code: 'no_worker' };
    if (S.mode === 'db') { await addUnique(o); }
    else { o.id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); orders.push(o); saveLocal(); render(); }
    logEvt('dodato', o);
  }
  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  /* Dva telefona ne smiju upisati isti broj: kratko zaključamo vrstu u događaju,
     provjerimo bazu (ne samo ovaj telefon) pa tek onda upišemo. */
  async function addUnique(o){
    var slot = DB.collection('brojevi').doc(String(o.sesija) + '_' + o.vrsta);
    var got = false;
    for (var i = 0; i < 6 && !got; i++) {
      var r = await slot.acquire({ holder: HOLDER, ttlMs: 3000 });
      if (r && r.acquired) { got = true; break; }
      var until = r && r.expiresAt ? Date.parse(r.expiresAt) - Date.now() : 800;
      await wait(Math.min(Math.max(until + 150, 300), 3200));
    }
    if (!got) throw { code: 'busy_no' };
    var snap = await dbRef.where('sesija', '==', o.sesija).where('vrsta', '==', o.vrsta).where('broj', '==', o.broj).get();
    var act = snap.docs.filter(function(d){ var x = d.data(); return x && !x.preuzeto; });
    if (act.length) throw { code: 'dup_no', o: o, other: act[0].data() };
    await dbRef.add(o);
  }
  /* Broj je zauzet samo dok pečenje nije preuzeto. Kad kupac preuzme i vrati broj, isti broj se daje sljedećem. */
  function activeHolder(v, b, ses, exceptId){
    return orders.filter(function(x){
      return (x.sesija || '_') === (ses || '_') && x.vrsta === v && +x.broj === +b && !x.preuzeto && x.id !== exceptId;
    })[0] || null;
  }
  async function updateOrder(id, patch){
    if (needWorker()) throw { code: 'no_worker' };
    var o0 = orders.filter(function(x){ return x.id === id; })[0];
    if (o0 && (('preuzeto' in patch && !patch.preuzeto) || 'broj' in patch || 'vrsta' in patch)) {
      var m = Object.assign({}, o0, patch);
      var h = m.preuzeto ? null : activeHolder(m.vrsta, m.broj, m.sesija, id);
      if (h) throw { code: 'dup_no', o: m, other: h };
    }
    if (S.mode === 'db') { await dbRef.doc(id).update(patch); }
    else {
      for (var i = 0; i < orders.length; i++) if (orders[i].id === id) { Object.assign(orders[i], patch); break; }
      saveLocal(); render();
    }
    if (o0) logEvt(actOf(patch), Object.assign({}, o0, patch));
  }
  async function removeOrder(id){
    if (needWorker()) throw { code: 'no_worker' };
    var o0 = orders.filter(function(x){ return x.id === id; })[0];
    if (S.mode === 'db') { await dbRef.doc(id).delete(); }
    else { orders = orders.filter(function(o){ return o.id !== id; }); saveLocal(); render(); }
    if (o0) logEvt('obrisano', o0);
  }

  /* ---------- derived ---------- */
  var dayKey = null, dayVal = [];
  function dayOrders(){
    var c = curSession();
    if (!c) return [];
    var k = dataVer + '|' + c.id;
    if (k !== dayKey) { dayKey = k; dayVal = orders.filter(function(o){ return (o.sesija || '_') === c.id; }); }
    return dayVal;
  }
  function sortRows(a, b){
    if (a.vrsta !== b.vrsta) return (ORDER[a.vrsta] || 0) - (ORDER[b.vrsta] || 0);
    return (+a.broj || 0) - (+b.broj || 0) || (a.kreirano || 0) - (b.kreirano || 0);
  }
  function kidTag(o){
    var m = kidMode(o);
    if (m === 'ne') return '<span class="tag r">Bez kidanja</span>';
    if (o.iskidano) return '<span class="tag ok">✓ Iskidano</span>';
    return '<span class="tag d">Za kidanje</span>';
  }
  var MJ_DEF = [{ k: 'hodnik', ime: 'Hodnik' }, { k: 'prodavnica', ime: 'Prodavnica' }, { k: 'prijavnica', ime: 'Prijavnica' }];
  var MJLIST = [], MJESTA = [], mjRef = null, LSMJ = 'pecenjara-mjesta-v1';
  /* obrisana mjesta ostaju u listi (obrisano: true) da stara pečenja zadrže natpis */
  function setMjList(l){
    MJLIST = Array.isArray(l) && l.length ? l.filter(function(x){ return x && x.k && x.ime; }) : MJ_DEF.slice();
    MJESTA = MJLIST.filter(function(x){ return !x.obrisano; }).map(function(x){ return [x.k, x.ime]; });
  }
  function mjFind(k){
    if (!k) return undefined;
    var x = MJLIST.filter(function(y){ return y.k === k; })[0];
    return x ? [x.k, x.ime] : undefined;
  }
  function mjOpts(o){
    var list = MJESTA.slice();
    if (o.mjesto && !list.some(function(x){ return x[0] === o.mjesto; })) { var f = mjFind(o.mjesto); if (f) list.push(f); }
    return list;
  }
  setMjList(null);
  function mjestoTag(o){
    var m = mjFind(o.mjesto);
    return m ? '<span class="tag d">' + m[1] + '</span>' : '';
  }
  function mjestoPick(o){
    var opts = mjOpts(o);
    if (ro() || !opts.length) return '';
    return '<div class="loc" role="group" aria-label="Gdje se nalazi pečenje"><span class="l">Gdje je</span>' + opts.map(function(x){
      return '<button class="locb" type="button" data-act="loc" data-v="' + x[0] + '" aria-pressed="' + (o.mjesto === x[0]) + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function fmtShort(s){ var d = parse(s); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
  /* dolazak: sat bez dana znači dan kad je pečenje upisano */
  function hasArr(o){ return !!(o.dolazi || o.dolaziDatum); }
  function arrDate(o){ return o.dolaziDatum || (o.kreirano > 0 ? fmt(new Date(o.kreirano)) : todayStr()); }
  function arrKey(o){ return hasArr(o) ? arrDate(o) + ' ' + (o.dolazi || '99:99') : '9999'; }
  function arrTime(o){
    if (!hasArr(o)) return Infinity;
    var d = parse(arrDate(o));
    if (o.dolazi) { var p = String(o.dolazi).split(':'); d.setHours(+p[0] || 0, +p[1] || 0, 0, 0); }
    else d.setHours(23, 59, 0, 0);
    return d.getTime();
  }
  function isLate(o){ return !o.preuzeto && hasArr(o) && arrTime(o) < Date.now(); }
  function isSoon(o){ var t = arrTime(o), n = Date.now(); return !o.preuzeto && hasArr(o) && t >= n && t <= n + 3600000; }
  function arrText(o){
    return (fmtShort(arrDate(o)) + ' ' + (o.dolazi || '')).trim();
  }
  function dolTag(o){
    if (!hasArr(o)) return '';
    return '<span class="tag d">Dolazi ' + esc(arrText(o)) + '</span>' + (isLate(o) ? '<span class="tag r">Kasni</span>' : '');
  }
  function fillDays(keep){
    var sel = $('dolaziDan'); if (!sel) return;
    if (keep === undefined) keep = sel.value;
    var t = todayStr();
    var dl = function(d){ return fmtShort(d) + ' (' + DANI[parse(d).getDay()] + ')'; };
    var opts = [['', '—'], [t, dl(t)], [shift(t, 1), dl(shift(t, 1))], [shift(t, 2), dl(shift(t, 2))]];
    if (keep && !opts.some(function(x){ return x[0] === keep; })) opts.push([keep, dl(keep)]);
    sel.innerHTML = opts.map(function(x){ return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('');
    sel.value = keep || '';
  }
  function callHtml(o){
    if (ro()) return '';
    var t = (o.telefon || '').trim(); if (!t) return '';
    var num = t.replace(/[^\d+]/g, '');
    var what = o.vrsta === 'jagnje' ? 'jagnje' : (o.vrsta === 'prase' ? 'prase' : 'pečenje' + (o.opis ? ' (' + o.opis + ')' : ''));
    var sms = 'Poštovani, Vaše ' + what + ' broj ' + o.broj + ' je spremno za preuzimanje.';
    var smsSep = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? '&' : '?';
    return '<div class="copy">' + (num ? '<button class="cpb" type="button" data-call="' + esc(num) + '" data-tel="' + esc(t) + '" data-who="' + esc(o.ime || '') + '" aria-label="Pozovi ' + esc(t) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5l2.6.4 1.3 3.7-1.9 1.4a12 12 0 0 0 6.4 6.4l1.4-1.9 3.7 1.3.4 2.6c-.2 1.3-1.3 2.3-2.7 2.2C9.6 19.1 4.9 14.4 4.4 6.2c-.1-1.4.9-2.5 2.2-2.7z" fill="currentColor"/></svg>' + esc(t) + '</button>' : '<span class="cpb">' + esc(t) + '</span>') +
      (o.preuzeto || !num ? '' : '<a class="cpb" href="sms:' + esc(num) + smsSep + 'body=' + esc(encodeURIComponent(sms)) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Pošalji SMS</a>') + '</div>';
  }
  /* gost: samo pregled (bez upisa, zbirova, istorije i podešavanja) */
  function ro(){ return ME.canWrite === false || window.__pecenjeGost === true; }
  function needWorker(){ return STAFF.length > 0 && !S.worker; }
  function nameOf(id){
    if (!id) return '';
    var n = NAMES[id];
    return n ? (n.name || (n.guest ? 'Gost' : '')) : '';
  }
  function preTag(o){
    return o.preuzeto ? '<span class="tag ok">Preuzeto</span>' : '<span class="tag k">Nije preuzeto</span>';
  }
  function whenHtml(o){
    var up = o.upisaoIme || nameOf(o.upisao), pr = o.preuzeoIme || nameOf(o.preuzeo);
    var out = '';
    if (o.kreirano > 0) out += '<p class="when">Upisano ' + esc(fmtWhen(o.kreirano)) + (up ? ' · ' + esc(up) : '') + '</p>';
    if (FEAT.iskidao && o.iskidano && kidMode(o) !== 'ne') {
      var ik = o.iskidaoIme || nameOf(o.iskidao);
      if (o.iskidanoU > 0 || ik) out += '<p class="when ok">Iskidano' + (o.iskidanoU > 0 ? ' ' + esc(fmtWhen(o.iskidanoU)) : '') + (ik ? ' · ' + esc(ik) : '') + '</p>';
    }
    if (o.preuzeto) {
      out += '<p class="when ok">' + (o.preuzetoU > 0 ? 'Preuzeto ' + esc(fmtWhen(o.preuzetoU)) : 'Preuzeto (vrijeme nije zabilježeno)') + (pr ? ' · ' + esc(pr) : '') + '</p>';
    }
    return out;
  }
  function rowTop(o, tags, extra){
    var note = '';
    if (o.vrsta === 'drugo' && o.opis) note = '<strong>' + esc(o.opis) + '</strong>' + (o.napomena ? ' · ' + esc(o.napomena) : '');
    else if (o.napomena) note = esc(o.napomena);
    return '<div class="stub"><span class="stub-l">' + esc(TYPE[o.vrsta] || o.vrsta) + '</span><span class="stub-n">' + esc(o.broj) + '</span></div>' +
      '<div class="who"><div class="nm"><p class="name">' + (o.ime ? esc(o.ime) : 'Bez imena') + '</p>' + (tags || '') + '</div>' +
      (note ? '<p class="note">' + note + '</p>' : '') +
      (extra || '') + '</div>';
  }

  /* ---------- render ---------- */
  function renderShell(day){
    if (ro() && S.view !== 'kidanje') S.view = 'kidanje';
    var cv = canView();
    if (!cv && S.staffLoaded && S.mode === 'db') {
      if (S.view === 'sesije') S.view = 'upis';
      if (S.sesija) { S.sesija = null; try { localStorage.removeItem(LSSES); } catch(e){} }
    }
    $('sesBar').classList.toggle('nolink', !cv);
    $('sesBar').setAttribute('aria-disabled', String(!cv));
    renderSes();
    var mb = $('meBar');
    if (ME.ready && S.mode === 'db') {
      mb.textContent = 'Prijavljen: ' + (ME.name || (ro() ? 'Gost' : 'Korisnik')) + ' · ' + (ro() ? 'samo pregled' : (ME.isOwner ? 'vlasnik' : 'može da upisuje'));
      mb.hidden = false;
    } else { mb.hidden = true; }
    var nt = $('notice');
    if (S.mode === 'local') {
      nt.textContent = 'Zajednička baza nije dostupna (možda nisi prijavljen). Upisi se čuvaju samo na ovom uređaju i drugi ih ne vide.';
      nt.hidden = false;
    } else { nt.hidden = true; }
    $('viewUpis').hidden = S.view !== 'upis';
    $('viewKidanje').hidden = S.view !== 'kidanje';
    $('viewSesije').hidden = S.view !== 'sesije';
    [['upis', 'tabUpis'], ['kidanje', 'tabKidanje'], ['sesije', 'sesBar']].forEach(function(t){
      if (S.view === t[0]) $(t[1]).setAttribute('aria-current', 'page'); else $(t[1]).removeAttribute('aria-current');
    });
    var pend = day.filter(isPending).length;
    $('navN').textContent = pend; $('navN').hidden = pend === 0;
    $('foot').textContent = S.mode === 'db'
      ? 'Upisi se čuvaju u bazi i vide ih svi prijavljeni radnici.'
      : (S.mode === 'local' ? 'Upisi se čuvaju samo u ovom pretraživaču na ovom uređaju.' : '');
  }

  function renderUpis(day){
    var cj = day.filter(function(o){ return o.vrsta === 'jagnje'; }).length;
    var cp = day.filter(function(o){ return o.vrsta === 'prase'; }).length;
    var cd = day.filter(function(o){ return o.vrsta === 'drugo'; }).length;
    var cw = day.filter(function(o){ return !o.preuzeto; }).length;
    $('cJ').textContent = cj; $('cP').textContent = cp; $('cD').textContent = cd; $('cW').textContent = cw;
    $('fSve').textContent = day.length; $('fJ').textContent = cj; $('fP').textContent = cp; $('fD').textContent = cd; $('fW').textContent = cw; $('fPr').textContent = day.length - cw;

    Array.prototype.forEach.call($('filters').querySelectorAll('.chip'), function(b){
      b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === S.filter && (b.getAttribute('data-f') !== 'sve' || S.kfilter === 'sve')));
    });

    var cs = curSession();
    $('f').hidden = ro() || !cs || !!cs.virtual;
    $('roNote').hidden = !ro();
    var ns = $('noSes');
    ns.hidden = ro() || (!!cs && !cs.virtual) || !S.sesLoaded;
    ns.textContent = (!cs ? 'Još nema događaja. ' : 'Ovo su stari upisi bez događaja. ') +
      (canManageSes() ? 'Otvori traku „Događaj“ i počni novi događaj.' : 'Zamoli vlasnika da napravi novi događaj.');
    fillDays();
    renderKupci();
    $('extraWrap').hidden = !!S.editing;

  }

  function matchQ(o, nq){
    if (!nq) return true;
    var tel = String(o.telefon || '').replace(/\D/g, '');
    if (/^\d+$/.test(nq)) return String(o.broj).indexOf(nq) === 0 || norm(o.ime).indexOf(nq) !== -1 || (nq.length >= 3 && tel.indexOf(nq) !== -1);
    var m = mjFind(o.mjesto);
    return norm(o.ime).indexOf(nq) !== -1 || norm(o.opis).indexOf(nq) !== -1 || norm(o.napomena).indexOf(nq) !== -1 || (m && norm(m[1]).indexOf(nq) !== -1);
  }

  function renderKidanje(day){
    var kd = day.filter(function(o){ return kidMode(o) !== 'ne'; });
    var bez = day.length - kd.length;
    var pend = kd.filter(isPending).length;
    var done = kd.length - pend;
    $('kW').textContent = pend; $('kD').textContent = done; $('kT').textContent = bez;
    $('kfCeka').textContent = pend; $('kfIsk').textContent = done; $('kfBez').textContent = bez;
    $('fSat').textContent = day.filter(function(o){ return !o.preuzeto && hasArr(o); }).length;

    var q = S.q.trim();
    var nq = norm(q);
    var bySat = S.filter === 'sati' && !q;
    Array.prototype.forEach.call($('kfilters').querySelectorAll('.chip'), function(b){
      b.setAttribute('aria-pressed', String(!q && b.getAttribute('data-kf') === S.kfilter));
    });

    var rows = day.filter(function(o){
      if (q) return matchQ(o, nq);
      if (S.filter === 'jagnje' || S.filter === 'prase' || S.filter === 'drugo') { if (o.vrsta !== S.filter) return false; }
      else if (S.filter === 'ceka') { if (o.preuzeto) return false; }
      else if (S.filter === 'preuzeto') { if (!o.preuzeto) return false; }
      else if (S.filter === 'sati') { if (o.preuzeto || !hasArr(o)) return false; }
      if (S.kfilter === 'ceka') return isPending(o);
      if (S.kfilter === 'iskidano') return kidMode(o) !== 'ne' && !!o.iskidano;
      if (S.kfilter === 'bez') return kidMode(o) === 'ne';
      return true;
    }).sort(function(a, b){
      if (/^\d+$/.test(nq)) {
        var ea = String(a.broj) === nq ? 0 : 1, eb = String(b.broj) === nq ? 0 : 1;
        if (ea !== eb) return ea - eb;
        if (!!a.preuzeto !== !!b.preuzeto) return a.preuzeto ? 1 : -1;
      }
      if ((S.filter === 'ceka' || S.filter === 'sati') && !q) {
        var ta = arrKey(a), tb = arrKey(b);
        if (ta !== tb) return ta < tb ? -1 : 1;
        if (bySat) return (a.kreirano || 0) - (b.kreirano || 0) || sortRows(a, b);
      }
      if (S.filter === 'preuzeto' && !q && (a.preuzetoU || 0) !== (b.preuzetoU || 0)) return (b.preuzetoU || 0) - (a.preuzetoU || 0);
      return (b.kreirano || 0) - (a.kreirano || 0) || sortRows(a, b);
    });

    var html = '';
    if (!S.loaded) {
      html = '<li class="empty"><strong>Učitavam upise…</strong>Samo trenutak.</li>';
    } else if (!day.length) {
      html = '<li class="empty"><strong>Još nema upisa u ovom događaju</strong>Upiši pečenje na stranici Upis, pa će se pojaviti ovdje.</li>';
    } else if (!rows.length) {
      if (q) html = '<li class="empty"><strong>Nema rezultata za „' + esc(q) + '“</strong>Probaj drugi broj ili ime. Pretraga gleda sva pečenja ovog događaja, sa i bez kidanja.</li>';
      else if (bySat) html = '<li class="empty"><strong>Niko nije najavio dolazak</strong>Ovdje se vide nepreuzeta pečenja kojima je upisano kad kupac dolazi.</li>';
      else html = '<li class="empty"><strong>Nema upisa u ovom filteru</strong>Izaberi „Sve“ da vidiš cijelu listu.</li>';
    } else if (bySat) {
      var soon = rows.filter(isSoon).length, late = rows.filter(isLate).length;
      html = '<li class="hsum">U narednih sat vremena: <b>' + soon + '</b> · Kasni: <b>' + late + '</b></li>';
      var last = '';
      rows.forEach(function(o){
        var d = arrDate(o), h = o.dolazi ? String(o.dolazi).slice(0, 2) : '';
        var g = d + ' ' + h;
        if (g !== last) {
          last = g;
          var cls = isLate(o) ? ' late' : (isSoon(o) ? ' soon' : '');
          html += '<li class="hhead' + cls + '"><span>' + esc(fmtShort(d) + (h ? ' u ' + h + ' h' : ' bez sata')) + '</span>' +
            (cls === ' late' ? '<span>kasni</span>' : (cls === ' soon' ? '<span>uskoro</span>' : '')) + '</li>';
        }
        html += rowHtml(o);
      });
    } else {
      html = rows.map(rowHtml).join('');
    }
    setHTML($('list2'), html);
  }

  function rowHtml(o){
    var done = !!o.preuzeto, d = !!o.iskidano;
    var conf = S.confirmId === o.id;
    var tags = kidTag(o) + dolTag(o) + (ro() ? preTag(o) + mjestoTag(o) : '');
    var acts = '';
    if (!ro()) {
      acts = '<div class="acts">' +
        '<button class="status" type="button" data-act="toggle" aria-pressed="' + done + '">' + (done ? '✓ Preuzeto' : 'Označi preuzeto') + '</button>' +
        (kidMode(o) === 'ne' ? '' : '<button class="status" type="button" data-act="kid" aria-pressed="' + d + '">' + (d ? '✓ Iskidano' : 'Označi iskidano') + '</button>') +
        (canEditOrders() ? '<span class="acts-r"><button class="ghost" type="button" data-act="edit">Izmijeni</button>' +
        '<button class="ghost danger' + (conf ? ' confirm' : '') + '" type="button" data-act="del">' + (conf ? 'Potvrdi brisanje' : 'Obriši') + '</button></span>' : '') +
      '</div>';
    }
    return '<li class="row t-' + esc(o.vrsta) + (done ? ' done' : '') + '" data-id="' + esc(o.id) + '">' +
      rowTop(o, tags, '') + callHtml(o) + mjestoPick(o) + '<div class="whenrow">' + whenHtml(o) + '</div>' + acts + '</li>';
  }

  function syncOpis(){
    var isD = S.vrsta === 'drugo';
    $('opisWrap').hidden = !isD;
  }

  var renderPending = false;
  function render(){
    if (renderPending) return;
    renderPending = true;
    (window.requestAnimationFrame || setTimeout)(function(){ renderPending = false; renderNow(); });
  }
  function renderNow(){
    var day = dayOrders();
    renderStaff();
    renderShell(day);
    renderUpis(day);
    renderKidanje(day);
  }

  function resetForm(){
    S.editing = null; S.touched = false;
    hideSugg(); $('broj').value = ''; $('ime').value = ''; $('napomena').value = ''; $('opis').value = '';
    $('telefon').value = ''; $('dolazi').value = ''; $('dolaziDan').value = '';
    $('submit').textContent = 'Dodaj'; $('cancel').hidden = true; $('extras').innerHTML = '';
    render();
  }
  function hideUndo(){ clearTimeout(undoTimer); lastUndo = null; $('undoBar').hidden = true; }

  /* ---------- navigation ---------- */
  function setView(v){
    S.view = (v === 'kidanje' || (v === 'sesije' && canView())) ? v : 'upis';
    if (ro()) S.view = 'kidanje';
    render();
  }
  function viewFromHash(){
    var h = ''; try { h = location.hash; } catch(e){}
    return h === '#kidanje' ? 'kidanje' : (h === '#sesije' ? 'sesije' : 'upis');
  }
  function go(v){
    try { location.hash = '#' + v; } catch(e){}
    setView(v);
  }
  $('tabUpis').addEventListener('click', function(e){ e.preventDefault(); go('upis'); });
  $('tabKidanje').addEventListener('click', function(e){ e.preventDefault(); go('kidanje'); });
  $('sesBar').addEventListener('click', function(e){ e.preventDefault(); if (canView()) go('sesije'); });
  window.addEventListener('hashchange', function(){ setView(viewFromHash()); });

  /* Raniji kupci: iz svih događaja, da se isti čovjek izabere sa liste dok se kuca ime. */
  var KUPCI = {};
  var kupciVer = -1;
  function renderKupci(){
    if (kupciVer === dataVer) return;
    kupciVer = dataVer;
    var m = {}, sesName = {};
    SESIJE.forEach(function(x){ sesName[x.id] = x.ime; });
    orders.slice().sort(function(a, b){ return (a.kreirano || 0) - (b.kreirano || 0); }).forEach(function(o){
      var ime = String(o.ime || '').trim(); if (!ime) return;
      var k = norm(ime).replace(/\s+/g, ' ');
      var c = m[k] || (m[k] = { ime: '', tel: '', n: 0, ses: {}, last: 0, lastSes: '', lastV: '' });
      c.ime = ime; if (o.telefon) c.tel = o.telefon; c.n++;
      c.ses[o.sesija || '_'] = 1;
      c.last = o.kreirano || c.last; c.lastSes = sesName[o.sesija] || ''; c.lastV = lbl(o).toLowerCase();
    });
    KUPCI = m;
  }
  function kupacKey(ime){ return norm(String(ime || '').trim()).replace(/\s+/g, ' '); }
  /* Kupci sklonjeni sa liste (npr. probni). Ako isti kupac kasnije opet donese pečenje, vraća se na listu. */
  var KH = {}, khRef = null, LSKH = 'pecenjara-kupci-skriveni-v1', skrijArm = null, skrijT = null;
  function khLoadLocal(){ try { return JSON.parse(localStorage.getItem(LSKH) || '{}') || {}; } catch(e){ return {}; } }
  function isHidden(c){ var t = KH[kupacKey(c.ime)]; return !!t && (c.last || 0) <= t; }
  async function hideKupac(k){
    var next = Object.assign({}, KH); next[k] = Date.now();
    if (S.mode === 'db' && khRef) await khRef.set({ skriveni: next });
    else { try { localStorage.setItem(LSKH, JSON.stringify(next)); } catch(e){} }
    KH = next;
  }
  function hideSugg(){ $('sugg').hidden = true; $('ime').setAttribute('aria-expanded', 'false'); }
  function renderSugg(){
    var raw = $('ime').value.trim(), q = kupacKey(raw), digits = raw.replace(/\D/g, '');
    if (q.length < 2 || S.editing) { hideSugg(); return; }
    var list = Object.keys(KUPCI).map(function(k){ return KUPCI[k]; }).filter(function(c){
      var nk = kupacKey(c.ime);
      if (isHidden(c)) return false;
      if (nk === q && (!c.tel || $('telefon').value.trim())) return false;
      return nk.indexOf(q) === 0 || nk.split(' ').some(function(w){ return w.indexOf(q) === 0; }) ||
        (q.indexOf(' ') > 0 && nk.indexOf(q) !== -1) || (digits.length >= 3 && c.tel.replace(/\D/g, '').indexOf(digits) !== -1);
    }).sort(function(a, b){ return b.n - a.n || b.last - a.last; }).slice(0, 6);
    if (!list.length) { hideSugg(); return; }
    $('sugg').innerHTML = '<li class="sh">Raniji kupci</li>' + list.map(function(c){
      var dog = Object.keys(c.ses).length;
      var meta = 'donio ' + (c.n === 1 ? '1 put' : c.n + ' puta') + (dog > 1 ? ' na ' + dog + ' događaja' : '') +
        (c.lastSes ? ' · zadnje: ' + c.lastSes + (c.lastV ? ', ' + c.lastV : '') : '');
      var key = kupacKey(c.ime), arm = skrijArm === key;
      return '<li class="sgi"><button class="sgp" type="button" role="option" data-kupac="' + esc(key) + '"><span class="sn">' + esc(c.ime) +
        (c.tel ? ' <span class="st">' + esc(c.tel) + '</span>' : '') + '</span><span class="sm">' + esc(meta) + '</span></button>' +
        '<button class="sgx' + (arm ? ' arm' : '') + '" type="button" data-skrij="' + esc(key) + '" aria-label="' + (arm ? 'Potvrdi uklanjanje sa liste' : 'Ukloni ' + esc(c.ime) + ' sa liste') + '">' + (arm ? 'Ukloni?' : '✕') + '</button></li>';
    }).join('');
    $('sugg').hidden = false; $('ime').setAttribute('aria-expanded', 'true');
  }
  $('sugg').addEventListener('mousedown', function(e){ e.preventDefault(); });
  $('sugg').addEventListener('click', async function(e){
    var x = e.target.closest('[data-skrij]');
    if (x) {
      var k = x.getAttribute('data-skrij'), c0 = KUPCI[k];
      clearTimeout(skrijT);
      if (skrijArm !== k) { skrijArm = k; renderSugg(); skrijT = setTimeout(function(){ skrijArm = null; if (!$('sugg').hidden) renderSugg(); }, 4000); return; }
      skrijArm = null;
      try { await hideKupac(k); showToast('Uklonjen sa liste: ' + (c0 ? c0.ime : k)); }
      catch(err){ setMsg('Nije uklonjeno. Samo vlasnik i urednici mogu da uklanjaju kupce sa liste.', true); }
      renderSugg();
      try { $('ime').focus(); } catch(e2){}
      return;
    }
    var b = e.target.closest('[data-kupac]'); if (!b) return;
    var c = KUPCI[b.getAttribute('data-kupac')]; if (!c) return;
    $('ime').value = c.ime;
    if (c.tel) $('telefon').value = c.tel;
    hideSugg(); setMsg('');
  });
  $('ime').addEventListener('input', renderSugg);
  $('ime').addEventListener('focus', renderSugg);
  $('ime').addEventListener('blur', function(){ setTimeout(hideSugg, 200); });
  $('ime').addEventListener('keydown', function(e){ if (e.key === 'Escape') hideSugg(); });
  $('ime').addEventListener('change', function(){
    var k = kupacKey($('ime').value);
    if (k && KUPCI[k] && !isHidden(KUPCI[k]) && KUPCI[k].tel && !$('telefon').value.trim()) $('telefon').value = KUPCI[k].tel;
  });
  function setHistMsg(t, isErr){ var m = $('histMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  async function restoreOrder(key, btn){
    var h = HIST.filter(function(x){ return (x.id || String(x.t)) === key; })[0];
    if (!h || !h.snimak) return;
    var o; try { o = JSON.parse(h.snimak); } catch(e){ return; }
    delete o.id;
    btn.disabled = true;
    try {
      if (needWorker()) throw { code: 'no_worker' };
      var dh = o.preuzeto ? null : activeHolder(o.vrsta, o.broj, o.sesija, null);
      if (dh) { setHistMsg(lbl(o) + ' broj ' + o.broj + ' je sada kod kupca' + (dh.ime ? ' ' + dh.ime : '') + ', pa se ne može vratiti dok on ne preuzme.', true); btn.disabled = false; return; }
      if (S.mode === 'db') { await dbRef.add(o); }
      else { o.id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); orders.push(o); saveLocal(); render(); }
      if (S.mode === 'db' && h.id) { await histRef.doc(h.id).update({ vraceno: true }); }
      else { h.vraceno = true; saveHistLocal(); }
      logEvt('vraćeno', o);
      setHistMsg('Vraćeno: ' + lbl(o) + ' broj ' + o.broj + (o.ime ? ' · ' + o.ime : '') + '.');
      renderHist();
    } catch(err){ btn.disabled = false; setHistMsg('Nije vraćeno. Pokušaj opet.', true); writeFailed(err); }
  }
  function evKey(s){ return norm(String(s || '')).replace(/[\d.\-\/]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function prevRows(cur){
    var k = evKey(cur.ime); if (!k) return [];
    var others = sessionsAll().filter(function(x){ return !x.virtual && x.id !== cur.id && evKey(x.ime) === k; })
      .sort(function(a, b){ return (b.kreirano || 0) - (a.kreirano || 0); });
    if (!others.length) return [];
    var out = [null, ['Isti događaj ranije', '']];
    others.forEach(function(x){
      var d = orders.filter(function(o){ return (o.sesija || '_') === x.id; });
      var j = d.filter(function(o){ return o.vrsta === 'jagnje'; }).length, p = d.filter(function(o){ return o.vrsta === 'prase'; }).length;
      var y = x.kreirano ? new Date(x.kreirano).getFullYear() : '';
      out.push([(y ? y + ' · ' : '') + x.ime, j + ' jagn. · ' + p + ' pras. · ' + d.length + ' ukupno']);
    });
    return out;
  }
  function readExtras(){
    return Array.prototype.map.call($('extras').querySelectorAll('.xrow'), function(row){
      return { el: row, v: row.querySelector('.xv').value, b: parseInt(row.querySelector('.xb').value, 10), o: row.querySelector('.xo').value.trim() };
    });
  }
  $('addExtra').addEventListener('click', function(){
    var v = S.vrsta === 'drugo' ? 'jagnje' : S.vrsta;
    var row = document.createElement('div');
    row.className = 'xrow';
    row.innerHTML = '<select class="field xv" aria-label="Vrsta"><option value="jagnje">Jagnje</option><option value="prase">Prase</option><option value="drugo">Drugo</option></select>' +
      '<input class="field num xb" type="number" inputmode="numeric" min="1" step="1" placeholder="Broj" aria-label="Broj">' +
      '<input class="field xo" type="text" maxlength="40" placeholder="npr. but, plećka, ćurka" aria-label="Šta je došlo" hidden>' +
      '<button class="ghost xdel" type="button" aria-label="Ukloni">✕</button>';
    row.querySelector('.xv').value = v;
    $('extras').appendChild(row);
    setMsg('');
  });
  $('extras').addEventListener('click', function(e){
    var d = e.target.closest('.xdel'); if (d) d.closest('.xrow').remove();
  });
  $('extras').addEventListener('change', function(e){
    var s = e.target.closest('.xv'); if (!s) return;
    var row = s.closest('.xrow');
    row.querySelector('.xo').hidden = s.value !== 'drugo';
  });

  /* ---------- events: Upis ---------- */
  document.querySelectorAll('input[name="vrsta"]').forEach(function(r){
    r.addEventListener('change', function(){
      S.vrsta = r.value;
      if (!S.editing) { S.touched = false; }
      syncOpis();
      render();
      if (S.vrsta === 'drugo') { try { $('opis').focus(); } catch(e){} }
    });
  });
  document.querySelectorAll('input[name="kidanje"]').forEach(function(r){
    r.addEventListener('change', function(){ S.kid = r.value; });
  });
  $('broj').addEventListener('input', function(){ S.touched = true; setMsg(''); });
  $('ime').addEventListener('input', function(){ setMsg(''); });
  $('opis').addEventListener('input', function(){ setMsg(''); });


  $('filters').addEventListener('click', function(e){
    var b = e.target.closest('.chip'); if (!b) return;
    var f = b.getAttribute('data-f');
    S.filter = (f === S.filter && f !== 'sve') ? 'sve' : f;
    if (f === 'sve') S.kfilter = 'sve';
    if (S.q) { S.q = ''; $('q').value = ''; }
    render();
  });

  $('cancel').addEventListener('click', function(){ setMsg(''); resetForm(); });

  $('f').addEventListener('submit', async function(e){
    e.preventDefault();
    var ime = $('ime').value.trim();
    var napomena = $('napomena').value.trim();
    var telefon = $('telefon').value.trim(), dolazi = $('dolazi').value || '', dolaziDatum = $('dolaziDan').value || '';
    var broj = parseInt($('broj').value, 10);
    var vrsta = S.vrsta;
    var opis = vrsta === 'drugo' ? $('opis').value.trim() : '';
    var kid = S.kid;

    if (vrsta === 'drugo' && !opis) { setMsg('Napiši šta je donešeno (npr. ćurka).', true); $('opis').focus(); return; }
    if (!(broj >= 1)) { setMsg('Upiši broj pečenja.', true); $('broj').focus(); return; }
    var eo = S.editing ? orders.filter(function(x){ return x.id === S.editing; })[0] : null;
    var cs0 = curSession();
    var hold = (eo && eo.preuzeto) ? null : activeHolder(vrsta, broj, eo ? eo.sesija : (cs0 && cs0.id), S.editing);
    if (hold) { setMsg(failText({ code: 'dup_no', o: { vrsta: vrsta, opis: opis, broj: broj }, other: hold }), true); $('broj').focus(); return; }
    var extras = S.editing ? [] : readExtras();
    var seen = [{ v: vrsta, b: broj }];
    for (var ei = 0; ei < extras.length; ei++) {
      var xe = extras[ei];
      if (xe.v === 'drugo' && !xe.o) { setMsg('Napiši šta je došlo (npr. ćurka) za dodatno pečenje.', true); xe.el.querySelector('.xo').focus(); return; }
      if (!(xe.b >= 1)) { setMsg('Upiši broj za dodatno pečenje.', true); xe.el.querySelector('.xb').focus(); return; }
      var xh = activeHolder(xe.v, xe.b, cs0 && cs0.id, null);
      if (xh) { setMsg(failText({ code: 'dup_no', o: { vrsta: xe.v, opis: xe.o, broj: xe.b }, other: xh }), true); xe.el.querySelector('.xb').focus(); return; }
      if (seen.some(function(s){ return s.v === xe.v && s.b === xe.b; })) { setMsg(TYPE[xe.v] + ' broj ' + xe.b + ' je već u ovom upisu. Izaberi drugi broj.', true); xe.el.querySelector('.xb').focus(); return; }
      seen.push({ v: xe.v, b: xe.b });
    }

    if (S.editing && !canEditOrders()) { setMsg('Nemaš dozvolu za izmjenu upisa. Javi se vlasniku.', true); return; }
    var btn = $('submit'); btn.disabled = true;
    var saved = [];
    try {
      if (S.editing) {
        var patch = { vrsta: vrsta, broj: broj, ime: ime, napomena: napomena, opis: opis, kidanje: kid, zaKidanje: kid !== 'ne', telefon: telefon, dolazi: dolazi, dolaziDatum: dolaziDatum };
        if (kid === 'ne') { Object.assign(patch, kidPatch(false)); }
        await updateOrder(S.editing, patch);
        setMsg('Izmjena sačuvana.');
        showToast('✓ Izmjena sačuvana');
      } else {
        var grp = extras.length ? 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) : '';
        var mk = function(v, b, op){
          var r = { datum: todayStr(), sesija: curSession().id, vrsta: v, opis: v === 'drugo' ? op : '', broj: b, ime: ime, napomena: napomena, telefon: telefon, dolazi: dolazi, dolaziDatum: dolaziDatum, preuzeto: false,
            kidanje: kid, zaKidanje: kid !== 'ne', iskidano: false, kreirano: Date.now(), upisao: ME.id || '', upisaoIme: S.worker };
          if (grp) r.grupa = grp;
          return r;
        };
        var added = [{ v: vrsta, b: broj, o: opis }].concat(extras);
        for (var xi = 0; xi < added.length; xi++) { await addOrder(mk(added[xi].v, added[xi].b, added[xi].o)); saved.push(added[xi]); }
        setMsg(added.map(function(x){ return (x.v === 'drugo' ? x.o : TYPE[x.v]) + ' ' + x.b; }).join(', ') + ' dodato' + (ime ? ' za ' + ime : '') + (kid === 'odmah' ? ' (za kidanje).' : '.'));
        showToast('✓ Upisano: ' + added.map(function(x){ return (x.v === 'drugo' ? x.o : TYPE[x.v]) + ' ' + x.b; }).join(', ') + (ime ? ' · ' + ime : ''));
      }
      resetForm();
      btn.textContent = '✓ Upisano';
      setTimeout(function(){ if (!S.editing) btn.textContent = 'Dodaj'; }, 1500);
      $('broj').focus();
    } catch(err){
      writeFailed(err);
      if (saved.length) setMsg('Upisano: ' + saved.map(function(x){ return (x.v === 'drugo' ? x.o : TYPE[x.v]) + ' ' + x.b; }).join(', ') + '. ' + failText(err), true);
      if (err && err.code === 'dup_no' && !saved.length) { S.touched = false; render(); }
    } finally {
      btn.disabled = false;
    }
  });

  $('list2').addEventListener('click', async function(e){
    var btn = e.target.closest('button[data-act]'); if (!btn) return;
    var row = btn.closest('.row'); var id = row.getAttribute('data-id');
    var o = orders.filter(function(x){ return x.id === id; })[0]; if (!o) return;
    var act = btn.getAttribute('data-act');

    if (act === 'toggle') {
      try {
        await updateOrder(id, o.preuzeto
          ? { preuzeto: false, preuzetoU: 0, preuzeo: '', preuzeoIme: '' }
          : { preuzeto: true, preuzetoU: Date.now(), preuzeo: ME.id || '', preuzeoIme: S.worker });
      } catch(err){ writeFailed(err); }
    } else if ((act === 'edit' || act === 'del') && !canEditOrders()) {
      setMsg2('Nemaš dozvolu za izmjenu i brisanje. Javi se vlasniku.', true);
    } else if (act === 'edit') {
      S.editing = id; S.vrsta = o.vrsta; S.kid = kidMode(o); S.touched = true;
      document.getElementById('vr-' + o.vrsta).checked = true;
      document.getElementById('kid-' + S.kid).checked = true;
      $('opis').value = o.opis || '';
      syncOpis();
      $('broj').value = o.broj; $('ime').value = o.ime || ''; $('napomena').value = o.napomena || '';
      $('telefon').value = o.telefon || ''; fillDays(o.dolaziDatum || ''); $('dolazi').value = o.dolazi || '';
      $('submit').textContent = 'Sačuvaj izmjene'; $('cancel').hidden = false; $('extras').innerHTML = '';
      setMsg('Izmjena: ' + lbl(o) + ' broj ' + o.broj + '.');
      go('upis');
      $('f').scrollIntoView({ block: 'start', behavior: 'smooth' });
      $('ime').focus();
    } else if (act === 'del') {
      if (S.confirmId === id) {
        clearTimeout(confirmTimer); S.confirmId = null;
        try { await removeOrder(id); setMsg2('Upis obrisan.'); if (S.editing === id) resetForm(); } catch(err){ writeFailed(err); }
        render();
      } else {
        S.confirmId = id; render();
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(function(){ S.confirmId = null; render(); }, 4000);
      }
    }
  });

  /* ---------- events: Kidanje ---------- */
  $('qkb').addEventListener('click', function(){
    var q = $('q'), num = q.getAttribute('inputmode') === 'numeric';
    q.setAttribute('inputmode', num ? 'text' : 'numeric');
    this.textContent = num ? '123' : 'abc';
    q.blur(); setTimeout(function(){ q.focus(); }, 50);
  });
  $('q').addEventListener('input', function(){ S.q = $('q').value; renderKidanje(dayOrders()); });
  /* Dodir bilo gdje van polja za kucanje spušta tastaturu. */
  document.addEventListener('pointerdown', function(e){
    var a = document.activeElement;
    if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('input, textarea, select, label, #sugg, #qx, #qkb')) return;
    try { a.blur(); } catch(x){}
  }, true);
  $('qx').addEventListener('click', function(){
    $('q').value = ''; S.q = ''; setMsg2('');
    renderKidanje(dayOrders());
    try { $('q').focus(); } catch(e){}
  });
  $('kfilters').addEventListener('click', function(e){
    var b = e.target.closest('.chip'); if (!b) return;
    var kf = b.getAttribute('data-kf');
    S.kfilter = (kf === S.kfilter) ? 'sve' : kf;
    if (S.q) { S.q = ''; $('q').value = ''; }
    render();
  });
  function showUndo(text, id, revert){
    clearTimeout(undoTimer);
    lastUndo = { id: id, patch: revert };
    $('undoText').textContent = text;
    $('undoBar').hidden = false;
    undoTimer = setTimeout(hideUndo, 8000);
  }
  $('list2').addEventListener('click', async function(e){
    var cl = e.target.closest('[data-call]');
    if (cl) { openCall(cl.getAttribute('data-call'), cl.getAttribute('data-tel'), cl.getAttribute('data-who')); return; }
    var cp = e.target.closest('[data-copy]');
    if (cp) {
      var t = cp.getAttribute('data-copy'), ok = false;
      try { await navigator.clipboard.writeText(t); ok = true; } catch(x){}
      if (!ok) {
        try { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch(x){}
      }
      var isNum = cp.hasAttribute('data-num');
      setMsg2(ok ? (isNum ? 'Broj kopiran: ' + t : 'Poruka kopirana: „' + t + '“ Zalijepi je u poruku kupcu.') : 'Kopiranje nije uspjelo. ' + (isNum ? 'Broj: ' : 'Poruka: ') + '„' + t + '“', !ok);
      var old = cp.textContent; cp.textContent = ok ? '✓ Kopirano' : 'Nije kopirano';
      setTimeout(function(){ try { cp.textContent = old; } catch(x){} }, 2000);
      return;
    }
    var btn = e.target.closest('button[data-act]'); if (!btn) return;
    var id = btn.closest('.row').getAttribute('data-id');
    var o = orders.filter(function(x){ return x.id === id; })[0]; if (!o) return;
    var act = btn.getAttribute('data-act');
    if (act !== 'loc' && act !== 'kid') return;
    setMsg2('');
    try {
      if (act === 'loc') {
        var v = btn.getAttribute('data-v');
        await updateOrder(id, { mjesto: o.mjesto === v ? '' : v });
      } else if (act === 'kid') {
        var now = !o.iskidano;
        var kime = '';
        if (now) { kime = await pickKidac(o); if (!kime) return; }
        await updateOrder(id, kidPatch(now, kime));
        if (now) showUndo('Iskidano: ' + lbl(o) + ' broj ' + o.broj + (o.ime ? ', ' + o.ime : '') + '.', id, kidPatch(false));
        else hideUndo();
      }
    } catch(err){ writeFailed(err); }
  });
  $('undoBtn').addEventListener('click', async function(){
    if (!lastUndo) return;
    var u = lastUndo; hideUndo();
    try { await updateOrder(u.id, u.patch); } catch(err){ writeFailed(err); }
  });

  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    if (!$('kConf').hidden) closeK(null);
    if (!$('callConf').hidden) closeCall();
  });

  /* ---------- poziv uz potvrdu ---------- */
  var callAt = 0;
  function openCall(num, tel, who){
    $('callNum').textContent = tel || num;
    $('callWho').textContent = who || ''; $('callWho').hidden = !who;
    $('callYes').setAttribute('href', 'tel:' + num);
    callAt = Date.now();
    $('callConf').hidden = false;
    try { $('callNo').focus(); } catch(e){}
  }
  function closeCall(){ $('callConf').hidden = true; }
  $('callNo').addEventListener('click', closeCall);
  $('callConf').addEventListener('click', function(e){ if (e.target === $('callConf')) closeCall(); });
  $('callYes').addEventListener('click', function(e){
    /* slučajan dupli dodir ne zove: potvrda radi tek kad prozor stoji pola sekunde */
    if (Date.now() - callAt < 600) { e.preventDefault(); return; }
    setTimeout(closeCall, 300);
  });

  /* ---------- izbor kidača ---------- */
  var K = { res: null, at: 0 };
  function pickKidac(o){
    if (K.res) closeK(null);
    return new Promise(function(res){
      K.res = res; K.at = Date.now();
      $('kConfWhat').textContent = lbl(o) + ' ' + o.broj;
      $('kConfName').textContent = o.ime || ''; $('kConfName').hidden = !o.ime;
      var names = KIDACI.length ? KIDACI : [S.worker || 'Iskidano'];
      $('kConfQ').textContent = KIDACI.length ? 'Ko je iskidao?' : 'Da li je iskidano?';
      $('kList').innerHTML = names.map(function(n){
        return '<button class="btn" type="button" data-kn="' + esc(n) + '">' + esc(KIDACI.length ? n : '✓ Da, iskidano je') + '</button>';
      }).join('');
      $('kConf').hidden = false;
      try { $('kNo').focus(); } catch(e){}
    });
  }
  function closeK(v){ $('kConf').hidden = true; var r = K.res; K.res = null; if (r) r(v); }
  $('kList').addEventListener('click', function(e){
    var b = e.target.closest('[data-kn]'); if (!b) return;
    if (Date.now() - K.at < 600) return;
    closeK(KIDACI.length ? b.getAttribute('data-kn') : (S.worker || ''));
  });
  $('kNo').addEventListener('click', function(){ closeK(null); });
  $('kConf').addEventListener('click', function(e){ if (e.target === $('kConf')) closeK(null); });

  /* ---------- kidači: podešavanje ---------- */
  var kdKey = '', kdConfirm = null, kdTimer = null;
  function setKdMsg(t, isErr){ var m = $('kdMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  function renderKdAdmin(){
    var key = JSON.stringify(KIDACI) + '|' + kdConfirm;
    if (key === kdKey) return;
    kdKey = key;
    $('kdList').innerHTML = KIDACI.length ? KIDACI.map(function(n){
      var c = kdConfirm === n;
      return '<li class="srow" data-n="' + esc(n) + '"><span class="sname">' + esc(n) + '</span><span class="sbtns">' +
        '<button class="ghost danger' + (c ? ' confirm' : '') + '" type="button" data-kact="del">' + (c ? 'Potvrdi uklanjanje' : 'Ukloni') + '</button></span></li>';
    }).join('') : '<li class="note">Lista je prazna. Tada se pri kidanju samo traži potvrda.</li>';
  }
  async function saveKd(list){
    if (S.mode === 'db') { await kdRef.set({ lista: list }); }
    else { try { localStorage.setItem(LSKD, JSON.stringify(list)); } catch(e){} }
    setKdList(list); render();
  }
  function loadKdLocal(){ try { return JSON.parse(localStorage.getItem(LSKD) || 'null'); } catch(e){ return null; } }
  async function addKd(){
    var n = $('newKd').value.trim();
    if (!n) { setKdMsg('Upiši ime.', true); return; }
    if (KIDACI.some(function(x){ return norm(x) === norm(n); })) { setKdMsg('To ime je već na listi.', true); return; }
    if (KIDACI.length >= 10) { setKdMsg('Može najviše 10 imena.', true); return; }
    try { await saveKd(KIDACI.concat([n])); $('newKd').value = ''; setKdMsg('Dodato: ' + n + '.'); }
    catch(err){ setKdMsg('Nije sačuvano. Provjeri internet i pokušaj ponovo.', true); }
  }
  $('kdAdd').addEventListener('click', addKd);
  $('newKd').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); addKd(); } });
  $('kdList').addEventListener('click', async function(e){
    var b = e.target.closest('[data-kact]'); if (!b) return;
    var n = b.closest('.srow').getAttribute('data-n');
    clearTimeout(kdTimer);
    if (kdConfirm !== n) { kdConfirm = n; renderKdAdmin(); kdTimer = setTimeout(function(){ kdConfirm = null; renderKdAdmin(); }, 4000); return; }
    kdConfirm = null;
    try { await saveKd(KIDACI.filter(function(x){ return x !== n; })); setKdMsg('Uklonjeno: ' + n + '.'); }
    catch(err){ setKdMsg('Nije uklonjeno.', true); renderKdAdmin(); }
  });
  /* ---------- štampa ---------- */
  var PCSS = '.pa{font:11pt Arial,Helvetica,sans-serif;color:#000;background:#fff}' +
    '.pa h1{font-size:18pt;margin:0 0 4pt}.pa p{margin:0 0 8pt;font-size:10pt}' +
    '.pa table{width:100%;border-collapse:collapse}.pa th,.pa td{border:1px solid #777;padding:3pt 5pt;text-align:left;vertical-align:top;font-size:10pt}' +
    '.pa td:nth-child(3){white-space:nowrap}.pa th{background:#e8e8e8}.pa td.n{font-weight:bold;font-size:13pt;white-space:nowrap}.pa tr{break-inside:avoid}' +
    '.pa .bx{display:inline-block;width:11pt;height:11pt;border:1.5pt solid #000;vertical-align:middle}' +
    '.pa tr.g td{background:#f3f3f3;font-weight:bold;text-transform:uppercase;letter-spacing:.05em}';
  function printBody(){
    var cur = curSession(); if (!cur) return '';
    var day = dayOrders().slice().sort(sortRows);
    var c = function(v){ return day.filter(function(o){ return o.vrsta === v; }).length; };
    var head = '<h1>' + esc(cur.ime) + '</h1><p>Jagnjad ' + c('jagnje') + ' · Prasad ' + c('prase') + ' · Drugo ' + c('drugo') +
      ' · Ukupno ' + day.length + ' · odštampano ' + esc(fmtWhen(Date.now())) + '</p>';
    var last = '', body = '';
    day.forEach(function(o){
      if (o.vrsta !== last) { last = o.vrsta; body += '<tr class="g"><td colspan="7">' + esc(o.vrsta === 'jagnje' ? 'Jagnjad' : o.vrsta === 'prase' ? 'Prasad' : 'Drugo') + '</td></tr>'; }
      var nap = o.napomena || '';
      body += '<tr><td class="n">' + esc(o.broj) + (o.vrsta === 'drugo' && o.opis ? '<br><small style="font-weight:normal;font-size:9pt">' + esc(o.opis) + '</small>' : '') + '</td><td>' + esc(o.ime || '') + '</td><td>' + esc(o.telefon || '') + '</td><td>' + esc(hasArr(o) ? arrText(o) : '') + '</td>' +
        '<td>' + (kidMode(o) === 'ne' ? 'bez' : (o.iskidano ? '✓' : '<span class="bx"></span>')) + '</td><td>' + esc(nap) + '</td>' +
        '<td>' + (o.preuzeto ? '✓' : '<span class="bx"></span>') + '</td></tr>';
    });
    return '<div class="pa">' + head + '<table><thead><tr><th>Broj</th><th>Ime</th><th>Telefon</th><th>Dolazi</th><th>Kidanje</th><th>Napomena</th><th>Preuzeto</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7">Nema upisa.</td></tr>') + '</tbody></table></div>';
  }
  function csvMsg(t, isErr){ var m = $('csvMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  /* ---------- spisak kao PDF: crta se stranica po stranica (A4, 150 dpi) ---------- */
  function spisakPdf(){
    var cur = curSession(); if (!cur || !window.jspdf) return null;
    var day = dayOrders().slice().sort(sortRows);
    var W = 1240, H = 1754, M = 70, F = 'Arial, Helvetica, sans-serif';
    var cols = [['Broj', 90], ['Ime', 250], ['Telefon', 180], ['Dolazi', 140], ['Kidanje', 110], ['Napomena', 220], ['Preuzeto', 110]];
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    function wrap(t, w, font){
      g.font = font; t = String(t || '');
      if (!t) return [''];
      var words = t.split(/\s+/), lines = [], line = '';
      words.forEach(function(wd){
        var test = line ? line + ' ' + wd : wd;
        if (g.measureText(test).width <= w || !line) line = test; else { lines.push(line); line = wd; }
      });
      if (line) lines.push(line);
      return lines;
    }
    var cnt = function(v){ return day.filter(function(o){ return o.vrsta === v; }).length; };
    var rows = [], last = '';
    day.forEach(function(o){
      if (o.vrsta !== last) { last = o.vrsta; rows.push({ g: o.vrsta === 'jagnje' ? 'JAGNJAD' : o.vrsta === 'prase' ? 'PRASAD' : 'DRUGO' }); }
      rows.push({ o: o });
    });
    var pages = [], y = 0, page = -1;
    function line(){ g.strokeStyle = '#777'; g.lineWidth = 1.5; }
    function newPage(){
      if (page >= 0) pages.push(cv.toDataURL('image/jpeg', 0.9));
      page++;
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.textBaseline = 'top';
      y = M;
      if (page === 0) {
        g.font = 'bold 46px ' + F; g.fillText(cur.ime, M, y); y += 60;
        g.font = '22px ' + F;
        g.fillText('Jagnjad ' + cnt('jagnje') + '  ·  Prasad ' + cnt('prase') + '  ·  Drugo ' + cnt('drugo') + '  ·  Ukupno ' + day.length + '  ·  odštampano ' + fmtWhen(Date.now()), M, y);
        y += 44;
      }
      var x = M; g.fillStyle = '#e6e6e6'; g.fillRect(M, y, W - 2 * M, 40); g.fillStyle = '#000';
      g.font = 'bold 21px ' + F;
      cols.forEach(function(c){ g.fillText(c[0], x + 8, y + 10); x += c[1]; });
      line(); g.strokeRect(M, y, W - 2 * M, 40);
      y += 40;
    }
    function box(x, yy, done){
      g.lineWidth = 2.5; g.strokeStyle = '#000'; g.strokeRect(x, yy, 24, 24);
      if (done) { g.beginPath(); g.moveTo(x + 5, yy + 12); g.lineTo(x + 10, yy + 19); g.lineTo(x + 20, yy + 5); g.stroke(); }
    }
    newPage();
    if (!rows.length) { g.font = '24px ' + F; g.fillText('Nema upisa.', M + 8, y + 12); }
    rows.forEach(function(r){
      if (r.g) {
        if (y + 38 + 50 > H - M) newPage();
        g.fillStyle = '#f2f2f2'; g.fillRect(M, y, W - 2 * M, 38); g.fillStyle = '#000';
        g.font = 'bold 21px ' + F; g.fillText(r.g, M + 8, y + 9);
        line(); g.strokeRect(M, y, W - 2 * M, 38);
        y += 38; return;
      }
      var o = r.o, pad = 10, lh = 28, fn = '23px ' + F;
      var cells = [
        { t: String(o.broj), font: 'bold 30px ' + F, sub: o.vrsta === 'drugo' ? (o.opis || '') : '' },
        { t: o.ime || '' }, { t: o.telefon || '' }, { t: hasArr(o) ? arrText(o) : '' },
        { k: kidMode(o) === 'ne' ? 'bez' : (o.iskidano ? 'da' : 'ne') }, { t: o.napomena || '' }, { p: !!o.preuzeto }
      ];
      var hgt = 48;
      cells.forEach(function(c, idx){
        if (c.t == null) return;
        c.lines = wrap(c.t, cols[idx][1] - 2 * pad, c.font || fn);
        if (c.sub) c.subl = wrap(c.sub, cols[idx][1] - 2 * pad, '18px ' + F);
        var h = pad * 2 + c.lines.length * lh + (c.subl ? c.subl.length * 22 : 0);
        if (h > hgt) hgt = h;
      });
      if (y + hgt > H - M) newPage();
      var x = M;
      cells.forEach(function(c, idx){
        var cw = cols[idx][1];
        if (c.lines) {
          g.font = c.font || fn; g.fillStyle = '#000';
          c.lines.forEach(function(l, n){ g.fillText(l, x + pad, y + pad + n * lh); });
          if (c.subl) { g.font = '18px ' + F; c.subl.forEach(function(l, n){ g.fillText(l, x + pad, y + pad + c.lines.length * lh + n * 22); }); }
        } else if (c.k) {
          if (c.k === 'bez') { g.font = fn; g.fillText('bez', x + pad, y + pad); } else box(x + pad, y + pad, c.k === 'da');
        } else box(x + pad, y + pad, c.p);
        line(); g.strokeRect(x, y, cw, hgt);
        x += cw;
      });
      y += hgt;
    });
    pages.push(cv.toDataURL('image/jpeg', 0.9));
    var pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    pages.forEach(function(img, n){
      if (n) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, 595.28, 841.89);
      if (pages.length > 1) { pdf.setFontSize(8); pdf.text((n + 1) + ' / ' + pages.length, 595.28 - 34, 841.89 - 18, { align: 'right' }); }
    });
    var name = 'spisak-' + String(cur.ime).toLowerCase().replace(/[^a-z0-9čćžšđ]+/g, '-').replace(/^-+|-+$/g, '') + '.pdf';
    return new File([pdf.output('blob')], name, { type: 'application/pdf' });
  }
  var pdfLoading = null;
  function ucitajPdf(){
    if (window.jspdf) return Promise.resolve();
    if (!pdfLoading) pdfLoading = new Promise(function(ok, no){
      var sc = document.createElement('script'); sc.src = 'vendor/jspdf.umd.min.js'; sc.async = true;
      sc.onload = function(){ ok(); }; sc.onerror = function(){ pdfLoading = null; no(); };
      document.head.appendChild(sc);
    });
    return pdfLoading;
  }
  setTimeout(function(){ ucitajPdf().catch(function(){}); }, 2500);
  function jeIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function mozeDijeliti(f){ try { return !!(f && navigator.canShare && navigator.canShare({ files: [f] })); } catch(e){ return false; } }
  /* Štampa: na iPhoneu preko menija za dijeljenje (tamo je „Štampaj“), drugdje običan prozor za štampu. */
  function doPrint(){
    if (!curSession()) { csvMsg('Nema događaja za štampu.', true); return; }
    if (jeIOS()) {
      if (!window.jspdf) { csvMsg('Pripremam štampu… pritisni dugme ponovo.'); ucitajPdf().then(function(){ csvMsg('Spremno. Pritisni „Štampaj spisak“.'); }, function(){ csvMsg('Štampa nije spremna. Provjeri internet.', true); }); return; }
      var f = spisakPdf();
      if (f && mozeDijeliti(f)) {
        csvMsg('U meniju koji se otvori izaberi „Štampaj“ (Print).');
        navigator.share({ files: [f], title: f.name }).then(function(){ csvMsg(''); }, function(err){
          if (!err || err.name !== 'AbortError') csvMsg('Spisak nije otvoren. Pokušaj „Sačuvaj spisak (PDF)“.', true);
        });
        return;
      }
    }
    $('printArea').innerHTML = '<style>' + PCSS + '@page{margin:12mm}</style>' + printBody();
    try { window.print(); } catch(e){ csvMsg('Štampa nije dostupna. Sačuvaj spisak kao PDF pa ga odštampaj.', true); }
  }
  $('printBtn').addEventListener('click', doPrint);
  $('printDlBtn').addEventListener('click', async function(){
    if (!window.jspdf) {
      csvMsg('Pripremam PDF…');
      try { await ucitajPdf(); } catch(e){ csvMsg('PDF nije spreman. Provjeri internet.', true); return; }
      if (jeIOS()) { csvMsg('Spremno. Pritisni „Sačuvaj spisak (PDF)“ ponovo.'); return; }
    }
    var f = spisakPdf();
    if (!f) { csvMsg('PDF nije napravljen. Provjeri internet pa osvježi aplikaciju.', true); return; }
    if (jeIOS() && mozeDijeliti(f)) {
      try { await navigator.share({ files: [f], title: f.name }); csvMsg(''); }
      catch(err){ if (!err || err.name !== 'AbortError') csvMsg('Spisak nije sačuvan.', true); }
      return;
    }
    try {
      var dl = await window.claude.use('downloads');
      await dl.save({ filename: f.name, data: f });
      csvMsg('Spisak (PDF) je preuzet.');
    } catch(err){ csvMsg('Spisak nije sačuvan.', true); }
  });

  /* ---------- istorija: učitava se samo najnovije, staro se može obrisati ---------- */
  function subHist(){
    if (!histRef) return;
    if (histUnsub) { try { histUnsub(); } catch(e){} }
    var lim = Math.min(S.histLimit, 1000);
    histUnsub = histRef.orderBy('t', 'desc').limit(lim).onSnapshot(function(snap){
      HIST = snap.docs.map(function(d){ var x = Object.assign({}, d.data()); x.id = d.id; return x; });
      S.histFull = snap.size < lim || lim >= 1000;
      renderHist();
    }, function(){});
  }
  /* Vlasnik je prijavljeni nalog sa ulogom vlasnik (provjerava i baza). */
  function pruneAllowed(){ return S.mode === 'local' || !!ME.isOwner; }
  /* Događaje (zbir, spisak, ranije događaje) i istoriju vidi vlasnik i radnici kojima je to dozvolio. */
  function canView(){
    if (pruneAllowed()) return true;
    var me = STAFF.filter(function(p){ return p.id === ME.id; })[0];
    return !!(me && me.pregled);
  }
  /* Izmjenu i brisanje upisa radi vlasnik i radnici kojima je to dozvolio (u Osoblju). */
  function canEditOrders(){
    if (pruneAllowed()) return true;
    var me = STAFF.filter(function(p){ return p.id === ME.id; })[0];
    return !!(me && me.urednik);
  }
  var pruneT = null;
  $('histPrune').addEventListener('click', function(){
    if (!pruneAllowed()) return;
    var b = $('histPrune');
    clearTimeout(pruneT);
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm'); b.textContent = 'Potvrdi brisanje starih zapisa';
      pruneT = setTimeout(function(){ b.classList.remove('confirm'); b.textContent = 'Obriši zapise starije od 6 mjeseci'; }, 4000);
      return;
    }
    b.classList.remove('confirm'); b.textContent = 'Obriši zapise starije od 6 mjeseci';
    doPrune();
  });
  async function doPrune(){
    var btn = $('histPrune');
    var cutoff = Date.now() - 183 * 864e5, n = 0;
    btn.disabled = true; setHistMsg('Brišem stare zapise…');
    try {
      if (S.mode === 'db') {
        for (var round = 0; round < 100; round++) {
          var snap = await histRef.where('t', '<', cutoff).limit(100).get();
          for (var i = 0; i < snap.docs.length; i++) { await histRef.doc(snap.docs[i].id).delete(); n++; }
          if (snap.size < 100) break;
        }
      } else {
        var before = HIST.length;
        HIST = HIST.filter(function(h){ return (h.t || 0) >= cutoff; });
        n = before - HIST.length; saveHistLocal();
      }
      setHistMsg(n ? 'Obrisano starih zapisa: ' + n + '.' : 'Nema zapisa starijih od 6 mjeseci.');
    } catch(err){
      setHistMsg('Brisanje nije završeno' + (n ? ' (obrisano ' + n + ')' : '') + '. Pokušaj ponovo.', true);
    } finally { btn.disabled = false; renderHist(); }
  }

  /* ---------- mjesta: podešavanje ---------- */
  var mjKey = '', mjConfirm = null, mjTimer = null;
  function setMjMsg(t, isErr){ var m = $('mjMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  function renderMjAdmin(){
    var key = JSON.stringify(MJLIST) + '|' + mjConfirm;
    if (key === mjKey) return;
    mjKey = key;
    var act = MJLIST.filter(function(x){ return !x.obrisano; });
    $('mjList').innerHTML = act.length ? act.map(function(x){
      var c = mjConfirm === x.k;
      return '<li class="mjrow" data-k="' + esc(x.k) + '"><input class="field mjname" type="text" maxlength="24" value="' + esc(x.ime) + '" aria-label="Naziv mjesta">' +
        '<button class="ghost" type="button" data-mact="save">Sačuvaj</button>' +
        '<button class="ghost danger' + (c ? ' confirm' : '') + '" type="button" data-mact="del">' + (c ? 'Potvrdi uklanjanje' : 'Ukloni') + '</button></li>';
    }).join('') : '<li class="note">Nema mjesta. Dodaj prvo ispod.</li>';
  }
  async function saveMj(list){
    if (S.mode === 'db') { await mjRef.set({ lista: list }); }
    else { try { localStorage.setItem(LSMJ, JSON.stringify(list)); } catch(e){} }
    setMjList(list); render();
  }
  function loadMjLocal(){ try { return JSON.parse(localStorage.getItem(LSMJ) || 'null'); } catch(e){ return null; } }
  function mjCopy(){ return MJLIST.map(function(x){ return Object.assign({}, x); }); }
  function mjTaken(ime, exceptK){
    return MJLIST.some(function(x){ return !x.obrisano && x.k !== exceptK && norm(x.ime) === norm(ime); });
  }
  async function addMj(){
    var ime = $('newMj').value.trim();
    if (!ime) { setMjMsg('Upiši naziv mjesta.', true); return; }
    if (mjTaken(ime)) { setMjMsg('To mjesto već postoji.', true); return; }
    if (MJESTA.length >= 8) { setMjMsg('Može najviše 8 mjesta. Ukloni neko pa dodaj novo.', true); return; }
    var list = mjCopy();
    var old = list.filter(function(x){ return x.obrisano && norm(x.ime) === norm(ime); })[0];
    if (old) { old.obrisano = false; old.ime = ime; }
    else list.push({ k: 'm' + Date.now().toString(36), ime: ime });
    try { await saveMj(list); $('newMj').value = ''; setMjMsg('Dodato mjesto: ' + ime + '.'); }
    catch(err){ setMjMsg('Mjesto nije sačuvano. Samo vlasnik i urednici mogu mijenjati mjesta.', true); }
  }
  $('mjAdd').addEventListener('click', addMj);
  $('newMj').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); addMj(); } });
  $('mjList').addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target.closest('.mjname')) { e.preventDefault(); e.target.closest('.mjrow').querySelector('[data-mact="save"]').click(); }
  });
  $('mjList').addEventListener('click', async function(e){
    var b = e.target.closest('[data-mact]'); if (!b) return;
    var row = b.closest('.mjrow'), k = row.getAttribute('data-k'), act = b.getAttribute('data-mact');
    var list = mjCopy(), it = list.filter(function(x){ return x.k === k; })[0]; if (!it) return;
    if (act === 'save') {
      var ime = row.querySelector('.mjname').value.trim();
      if (!ime) { setMjMsg('Naziv ne može biti prazan.', true); return; }
      if (ime === it.ime) { setMjMsg('Naziv je isti.'); return; }
      if (mjTaken(ime, k)) { setMjMsg('To mjesto već postoji.', true); return; }
      it.ime = ime;
      try { await saveMj(list); setMjMsg('Naziv sačuvan: ' + ime + '.'); }
      catch(err){ setMjMsg('Naziv nije sačuvan. Samo vlasnik i urednici mogu mijenjati mjesta.', true); }
    } else if (act === 'del') {
      clearTimeout(mjTimer);
      if (mjConfirm !== k) {
        mjConfirm = k; renderMjAdmin();
        mjTimer = setTimeout(function(){ mjConfirm = null; renderMjAdmin(); }, 4000);
        return;
      }
      mjConfirm = null; it.obrisano = true;
      try { await saveMj(list); setMjMsg('Uklonjeno mjesto: ' + it.ime + '.'); }
      catch(err){ setMjMsg('Mjesto nije uklonjeno.', true); renderMjAdmin(); }
    }
  });

  /* ---------- moj PIN ili šifra (vlasnik može ulaziti šifrom sa slovima i znakovima) ---------- */
  function setMyPinMsg(t, isErr){ var m = $('myPinMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  var myModeSel = null;
  function myStaff(){ return STAFF.filter(function(p){ return p.id === ME.id; })[0] || null; }
  function syncMyPin(){
    var me = myStaff(), cur = (me && me.tajna) === 'sifra' ? 'sifra' : 'pin';
    var own = !!ME.isOwner && S.mode === 'db';
    $('myMode').hidden = !own;
    var mode = own ? (myModeSel || cur) : 'pin';
    $('mm-pin').checked = mode === 'pin'; $('mm-sif').checked = mode === 'sifra';
    $('myPinSum').textContent = own ? 'Moj PIN / šifra' : 'Moj PIN';
    $('myPinFoot').textContent = mode === 'sifra'
      ? 'Šifra može imati slova, brojeve i znakove, najmanje 6. Na ekranu za prijavu tada se kuca šifra umjesto PIN-a.'
      : 'PIN od 4 cifre kojim ulaziš u aplikaciju.';
    $('myOldL').textContent = cur === 'sifra' ? 'Trenutna šifra' : 'Trenutni PIN';
    $('myNewL').textContent = mode === 'sifra' ? 'Nova šifra' : 'Novi PIN';
    var o = $('myPinOld');
    o.setAttribute('inputmode', cur === 'sifra' ? 'text' : 'numeric'); o.maxLength = cur === 'sifra' ? 64 : 4; o.classList.toggle('sif', cur === 'sifra');
    ['myPinNew', 'myPinNew2'].forEach(function(id){
      var el = $(id); el.setAttribute('inputmode', mode === 'sifra' ? 'text' : 'numeric'); el.maxLength = mode === 'sifra' ? 64 : 4; el.classList.toggle('sif', mode === 'sifra');
    });
    return { cur: cur, mode: mode };
  }
  ['mm-pin', 'mm-sif'].forEach(function(id){ $(id).addEventListener('change', function(){ myModeSel = this.value; $('myPinNew').value = ''; $('myPinNew2').value = ''; setMyPinMsg(''); syncMyPin(); }); });
  ['myPinOld', 'myPinNew', 'myPinNew2'].forEach(function(id){
    $(id).addEventListener('input', function(){ if (this.getAttribute('inputmode') === 'numeric') this.value = this.value.replace(/\D/g, '').slice(0, 4); });
  });
  $('myPinOk').addEventListener('click', async function(){
    var st = syncMyPin(), a = $('myPinOld').value, b = $('myPinNew').value, b2 = $('myPinNew2').value;
    if (!a) { setMyPinMsg(st.cur === 'sifra' ? 'Upiši trenutnu šifru.' : 'Upiši trenutni PIN.', true); return; }
    if (st.mode === 'pin' && !/^\d{4}$/.test(b)) { setMyPinMsg('Novi PIN mora imati tačno 4 cifre.', true); return; }
    if (st.mode === 'sifra' && (b.length < 6 || b.length > 64)) { setMyPinMsg('Šifra mora imati najmanje 6 znakova.', true); return; }
    if (b !== b2) { setMyPinMsg('Nova ' + (st.mode === 'sifra' ? 'šifra' : 'PIN') + ' i ponovljeni unos se ne poklapaju.', true); return; }
    if (a === b) { setMyPinMsg('Novo je isto kao staro.', true); return; }
    var btn = this; btn.disabled = true;
    var promjena = st.mode !== st.cur;
    try {
      /* prvo se zapiše način ulaza, pa tek onda nova tajna (ako tajna ne uspije, vraća se način) */
      if (promjena) await staffRef.doc(ME.id).update({ tajna: st.mode });
      try { await window.__promijeniPin(a, b); }
      catch(err){ if (promjena) { try { await staffRef.doc(ME.id).update({ tajna: st.cur }); } catch(x){} } throw err; }
      $('myPinOld').value = ''; $('myPinNew').value = ''; $('myPinNew2').value = ''; myModeSel = null;
      setMyPinMsg(st.mode === 'sifra' ? (promjena ? 'Šifra je postavljena. Od sada ulaziš šifrom.' : 'Šifra je promijenjena.') : (promjena ? 'Vraćen je PIN. Od sada ulaziš PIN-om.' : 'PIN je promijenjen.'));
    } catch(err){
      setMyPinMsg(err && err.code === 'pogresan' ? (st.cur === 'sifra' ? 'Trenutna šifra nije tačna.' : 'Trenutni PIN nije tačan.') : 'Nije sačuvano. Provjeri internet i pokušaj ponovo.', true);
    } finally { btn.disabled = false; syncMyPin(); }
  });

  /* ---------- podaci: rezervna kopija i uvoz ---------- */
  function setDataMsg(t, isErr){ var m = $('dataMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  $('expBtn').addEventListener('click', async function(){
    var btn = this; btn.disabled = true; setDataMsg('Pripremam kopiju…');
    try {
      var data = await window.__izvoz();
      var n = Object.keys(data.porudzbine || {}).length;
      var d = new Date(), name = 'pecenje-kopija-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      var dl = await window.claude.use('downloads');
      await dl.save({ filename: name, data: JSON.stringify(data, null, 1) });
      setDataMsg('Kopija je preuzeta (' + n + ' upisa).');
    } catch(err){ setDataMsg('Kopija nije napravljena. Provjeri internet i pokušaj ponovo.', true); }
    finally { btn.disabled = false; }
  });
  $('impFile').addEventListener('change', async function(){
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    setDataMsg('Uvozim…');
    try {
      var data = JSON.parse(await f.text());
      var r = await window.__uvoz(data, function(done, total){ setDataMsg('Uvozim… ' + done + ' / ' + total); });
      setDataMsg('Uvezeno: ' + r.porudzbine + ' upisa, ' + r.sesije + ' događaja, ' + r.istorija + ' zapisa istorije.');
    } catch(err){ setDataMsg(err && err.message === 'format' ? 'Ovo nije fajl sa podacima pečenja.' : 'Uvoz nije završen. Provjeri internet i pokušaj ponovo.', true); }
  });

  /* ---------- sesije ---------- */
  function loadSesLocal(){ try { return JSON.parse(localStorage.getItem(LSSL) || '[]'); } catch(e){ return []; } }
  function saveSesLocal(){ dataVer++; try { localStorage.setItem(LSSL, JSON.stringify(SESIJE)); } catch(e){} }
  function saveSelSes(){
    try { if (S.sesija) localStorage.setItem(LSSES, S.sesija); else localStorage.removeItem(LSSES); } catch(e){}
  }
  function migrateLocal(){
    var orphan = orders.filter(function(o){ return !o.sesija; });
    if (!orphan.length || SESIJE.length) return;
    var first = Math.min.apply(null, orphan.map(function(o){ return o.kreirano || Date.now(); }));
    var s = { id: 'l' + Date.now().toString(36), ime: 'Prvi događaj', kreirano: first };
    SESIJE.push(s);
    orphan.forEach(function(o){ o.sesija = s.id; });
    saveSesLocal(); saveLocal();
  }
  function canManageSes(){
    if (S.mode === 'db' && S.staffLoaded && !canView()) return false;
    return S.mode === 'local' || (S.mode === 'db' && ME.ready && !!ME.canEdit && !ro());
  }
  function sortedSes(){ return SESIJE.slice().sort(function(a, b){ return (a.kreirano || 0) - (b.kreirano || 0); }); }
  function newestSession(){ var r = sortedSes(); return r.length ? r[r.length - 1] : null; }
  function sessionsAll(){
    var arr = sortedSes();
    if (orders.some(function(o){ return !o.sesija; })) arr.unshift({ id: '_', ime: 'Bez događaja', kreirano: 0, virtual: true });
    return arr;
  }
  var curKey = null, curVal = null;
  function curSession(){
    var k = dataVer + '|' + (S.sesija || '');
    if (k === curKey) return curVal;
    curKey = k; curVal = curSessionCalc();
    return curVal;
  }
  function curSessionCalc(){
    var all = sessionsAll();
    if (!all.length) return null;
    if (S.sesija) {
      var f = all.filter(function(x){ return x.id === S.sesija; })[0];
      if (f) return f;
    }
    return newestSession() || all[all.length - 1];
  }
  function upisa(n){ var m10 = n % 10, m100 = n % 100; return n + (m10 === 1 && m100 !== 11 ? ' upis' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? ' upisa' : ' upisa')); }
  function sesCount(id){ return orders.filter(function(o){ return (o.sesija || '_') === id; }).length; }
  function setSesMsg(t, isErr){ var m = $('sesMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  function renderSes(){
    var cur = curSession(), all = sessionsAll(), mg = canManageSes(), nw = newestSession();
    renderSum(cur);
    $('sesName').textContent = cur ? cur.ime : 'Nema događaja';
    $('sesMeta').textContent = !cur ? 'Počni prvi događaj da možeš upisivati.'
      : (cur.virtual ? 'Stari upisi bez događaja · ' + sesCount(cur.id) + ' upisa'
        : 'Počeo ' + fmtWhen(cur.kreirano) + ' · ' + upisa(sesCount(cur.id)));
    var old = !!(cur && nw && cur.id !== nw.id);
    $('sesOld').hidden = !old;
    if (old) $('sesOldText').textContent = 'Gledaš stariji događaj. Novi upisi idu u njega. Aktuelni događaj je „' + nw.ime + '“.';
    var canRen = mg && !!cur && !cur.virtual;
    $('panelNew').hidden = !mg;
    $('panelRename').hidden = !canRen;
    if (canRen && S.renameFor !== cur.id) { S.renameFor = cur.id; $('sesRenameName').value = cur.ime; }
    $('sesNewHint').textContent = cur && !cur.virtual
      ? 'Brojevi počinju ispočetka od 1. Upisi iz događaja „' + cur.ime + '“ ostaju sačuvani i vide se pod „Događaji“.' : '';
    if (!all.length) {
      setHTML($('sesList'), '<li class="empty"><strong>Još nema događaja</strong>Napravi prvi događaj iznad.</li>');
    } else {
      setHTML($('sesList'), all.slice().reverse().map(function(x){
        var on = cur && x.id === cur.id;
        var d = orders.filter(function(o){ return (o.sesija || '_') === x.id; });
        var cnt = function(v){ return d.filter(function(o){ return o.vrsta === v; }).length; };
        var akt = nw && x.id === nw.id;
        var bad = akt ? '<span class="sbad">Aktuelni</span>' : (on ? '<span class="sbad sel">Izabran</span>' : '<span></span>');
        return '<li><button class="sesitem' + (on ? ' on' : '') + '" type="button" data-sid="' + esc(x.id) + '" aria-pressed="' + !!on + '"><span class="sin">' + esc(x.ime) + '</span>' + bad +
          '<span class="sim">' + (x.virtual ? 'stari upisi' : 'Počeo ' + esc(fmtWhen(x.kreirano))) + ' · ' + upisa(d.length) + '</span>' +
          (d.length ? '<span class="sescnt"><span class="j">Jagnjad ' + cnt('jagnje') + '</span><span class="p">Prasad ' + cnt('prase') + '</span>' + (cnt('drugo') ? '<span class="d">Drugo ' + cnt('drugo') + '</span>' : '') +
            '<span>Preuzeto ' + d.filter(function(o){ return o.preuzeto; }).length + '/' + d.length + '</span></span>' : '') + '</button></li>';
      }).join(''));
    }
  }
  function renderSum(cur){
    var card = $('sumCard');
    if (!cur) { card.hidden = true; return; }
    card.hidden = false;
    $('sumName').textContent = cur.ime;
    var day = dayOrders();
    var n = function(f){ return day.filter(f).length; };
    var kd = day.filter(function(o){ return kidMode(o) !== 'ne'; });
    var drugo = {};
    day.forEach(function(o){ if (o.vrsta === 'drugo') { var k = (o.opis || 'drugo').trim(); drugo[k] = (drugo[k] || 0) + 1; } });
    var dTxt = Object.keys(drugo).map(function(k){ return k + ' ' + drugo[k]; }).join(', ');
    var rows = [
      ['Jagnjad', n(function(o){ return o.vrsta === 'jagnje'; })],
      ['Prasad', n(function(o){ return o.vrsta === 'prase'; })],
      ['Drugo' + (dTxt ? ' (' + dTxt + ')' : ''), n(function(o){ return o.vrsta === 'drugo'; })],
      ['Ukupno', day.length], null,
      ['Preuzeto', n(function(o){ return !!o.preuzeto; })],
      ['Nije preuzeto', n(function(o){ return !o.preuzeto; })], null,
      ['Za kidanje', kd.length],
      ['Iskidano', kd.filter(function(o){ return !!o.iskidano; }).length],
      ['Čeka kidanje', kd.filter(function(o){ return !o.iskidano; }).length],
      ['Bez kidanja', day.length - kd.length]
    ].concat(prevRows(cur));
    setHTML($('sumGrid'), rows.map(function(r){
      return r ? '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>' : '<div class="sep"></div>';
    }).join(''));
    $('csvBtn').disabled = !day.length;
    renderWorkers(day);
  }
  function renderWorkers(day){
    var card = $('wCard');
    var W = {}, order = [];
    function add(n, f){ if (!n) return; if (!W[n]) { W[n] = { u: 0, k: 0, p: 0 }; order.push(n); } W[n][f]++; }
    var bezImena = 0;
    day.forEach(function(o){
      add(o.upisaoIme || nameOf(o.upisao), 'u');
      if (o.iskidano && kidMode(o) !== 'ne') { var ik = o.iskidaoIme || nameOf(o.iskidao); if (ik) add(ik, 'k'); else bezImena++; }
      if (o.preuzeto) add(o.preuzeoIme || nameOf(o.preuzeo), 'p');
    });
    card.hidden = !FEAT.radnici || !order.length;
    if (card.hidden) return;
    order.sort(function(a, b){ var x = W[a], y = W[b]; return (y.u + y.k + y.p) - (x.u + x.k + x.p) || a.localeCompare(b); });
    setHTML($('wTab'), '<thead><tr><th>Radnik</th><th>Upisao</th><th>Iskidao</th><th>Predao</th></tr></thead><tbody>' +
      order.map(function(n){ return '<tr><td>' + esc(n) + '</td><td>' + W[n].u + '</td><td>' + W[n].k + '</td><td>' + W[n].p + '</td></tr>'; }).join('') + '</tbody>');
    $('wNote').hidden = !bezImena;
    $('wNote').textContent = bezImena ? 'Kod ' + bezImena + ' iskidanih pečenja nije zapisano ko ih je iskidao (označena su prije nego što se to počelo bilježiti).' : '';
  }
  function csvCell(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function fmtFull(ts){
    if (!(ts > 0)) return '';
    var d = new Date(ts), p = function(x){ return (x < 10 ? '0' : '') + x; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  async function exportCsv(){
    var cur = curSession(); if (!cur) return;
    var msg = $('csvMsg'); msg.textContent = ''; msg.className = 'msg';
    var day = dayOrders().slice().sort(sortRows);
    var head = ['Vrsta', 'Broj', 'Ime', 'Telefon', 'Napomena', 'Kidanje', 'Iskidano', 'Iskidano u', 'Iskidao', 'Dolazi', 'Mjesto', 'Preuzeto', 'Preuzeto u', 'Preuzeo', 'Upisano', 'Upisao'];
    var lines = [head.map(csvCell).join(';')];
    day.forEach(function(o){
      var m = mjFind(o.mjesto);
      var dol = (o.dolaziDatum ? o.dolaziDatum + ' ' : '') + (o.dolazi || '');
      lines.push([
        o.vrsta === 'drugo' ? (o.opis || 'Drugo') : (TYPE[o.vrsta] || o.vrsta), o.broj, o.ime || '', o.telefon || '', o.napomena || '',
        kidMode(o) === 'ne' ? 'Bez kidanja' : 'Za kidanje', kidMode(o) === 'ne' ? '' : (o.iskidano ? 'Da' : 'Ne'),
        o.iskidano ? fmtFull(o.iskidanoU) : '', o.iskidano ? (o.iskidaoIme || nameOf(o.iskidao) || '') : '',
        dol.trim(), m ? m[1] : '', o.preuzeto ? 'Da' : 'Ne', fmtFull(o.preuzetoU), o.preuzeoIme || nameOf(o.preuzeo) || '',
        fmtFull(o.kreirano), o.upisaoIme || nameOf(o.upisao) || ''
      ].map(csvCell).join(';'));
    });
    var name = 'pecenje-' + String(cur.ime).toLowerCase().replace(/[^a-z0-9čćžšđ]+/g, '-').replace(/^-+|-+$/g, '') + '.csv';
    try {
      var dl = window.claude ? await window.claude.use('downloads') : null;
      if (!dl) { msg.textContent = 'Preuzimanje nije dostupno u ovom prikazu.'; msg.className = 'msg err'; return; }
      await dl.save({ filename: name, data: '﻿' + lines.join('\r\n') });
      msg.textContent = 'Tabela je spremna.';
    } catch(err){
      if (err && err.code === 'declined') return;
      msg.textContent = 'Tabela nije sačuvana.'; msg.className = 'msg err';
    }
  }
  $('csvBtn').addEventListener('click', exportCsv);
  function onSessionChange(){
    S.touched = false; S.confirmId = null; hideUndo();
    S.q = ''; $('q').value = '';
    setMsg(''); setMsg2('');
    if (S.editing) { resetForm(); } else { render(); }
  }
  async function createSession(ime){
    var rec = { ime: ime, kreirano: Date.now() };
    if (S.mode === 'db') { await sesRef.add(rec); }
    else { rec.id = 'l' + Date.now().toString(36); SESIJE.push(rec); saveSesLocal(); }
  }
  async function renameSession(id, ime){
    if (S.mode === 'db') { await sesRef.doc(id).update({ ime: ime }); }
    else { SESIJE.forEach(function(x){ if (x.id === id) x.ime = ime; }); saveSesLocal(); }
  }
  async function submitSesNew(){
    var ime = $('sesNewName').value.trim();
    if (!ime) { setSesMsg('Upiši naziv događaja.', true); $('sesNewName').focus(); return; }
    var btn = $('sesNewOk'); btn.disabled = true;
    try {
      await createSession(ime);
      $('sesNewName').value = ''; S.sesija = null; saveSelSes();
      setSesMsg('');
      onSessionChange();
      setMsg('Novi događaj „' + ime + '“ je počeo. Brojevi idu od 1.');
      go('upis');
    } catch(err){
      setSesMsg('Događaj nije napravljen. Samo vlasnik i korisnici sa pravom uređivanja mogu da prave događaje.', true);
    } finally { btn.disabled = false; }
  }
  $('sesNewOk').addEventListener('click', submitSesNew);
  $('sesNewName').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); submitSesNew(); } });
  $('sesList').addEventListener('click', function(e){
    var b = e.target.closest('button[data-sid]'); if (!b) return;
    var id = b.getAttribute('data-sid'), nw = newestSession();
    S.sesija = (nw && nw.id === id) ? null : id;
    saveSelSes();
    onSessionChange();
    var picked = sessionsAll().filter(function(x){ return x.id === id; })[0];
    setSesMsg(picked ? 'Izabran događaj: ' + picked.ime + '. Otvori „Upis“ ili „Kidanje“ da radiš u njoj.' : '');
  });
  $('sesBack').addEventListener('click', function(){ S.sesija = null; saveSelSes(); onSessionChange(); });
  async function submitRename(){
    var cur = curSession(); if (!cur || cur.virtual) return;
    var ime = $('sesRenameName').value.trim();
    if (!ime) { setSesMsg('Upiši naziv događaja.', true); return; }
    try { await renameSession(cur.id, ime); setSesMsg('Naziv je sačuvan.'); render(); }
    catch(err){ setSesMsg('Naziv nije sačuvan. Samo vlasnik i korisnici sa pravom uređivanja mogu da ga mijenjaju.', true); }
  }
  $('sesRenameOk').addEventListener('click', submitRename);
  $('sesRenameName').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); submitRename(); } });

  /* ---------- osoblje (ko radi) ---------- */
  function loadStaffLocal(){ try { return JSON.parse(localStorage.getItem(LSS) || '[]'); } catch(e){ return []; } }
  function saveStaffLocal(){ try { localStorage.setItem(LSS, JSON.stringify(STAFF)); } catch(e){} }
  function renderStaff(){
    if (S.staffLoaded && S.worker && !STAFF.some(function(p){ return p.ime === S.worker; })) { if (window.__odjava) { window.__odjava('Tvoj nalog je uklonjen. Javi se vlasniku.'); return; } S.worker = ''; }
    var meW = S.worker ? STAFF.filter(function(p){ return p.ime === S.worker; })[0] : null;
    document.documentElement.classList.toggle('big', !!(meW && meW.krupno));
    var bar = $('staffBar');
    document.documentElement.classList.toggle('gost', ro());
    var show = STAFF.length > 0;
    bar.hidden = !show;
    var logged = !!S.worker;
    bar.classList.toggle('need', show && !logged);
    $('staffCur').hidden = !logged;
    if (logged) {
      $('curName').textContent = S.worker;
      setHTML($('curActs'), S.changing
        ? '<span class="ask">Promijeniti radnika?</span><button class="btn" type="button" data-cact="yes">Da, promijeni</button><button class="btn sec" type="button" data-cact="no">Ne</button>'
        : '<button class="ghost" type="button" data-cact="ask">Promijeni radnika</button>');
    }
    var adm = (S.mode === 'db' && ME.canEdit && !ro()) || S.mode === 'local';
    $('staffAdmin').hidden = !adm || !pruneAllowed();
    $('dataAdmin').hidden = !pruneAllowed();
    $('setLabel').hidden = false;
    syncMyPin();
    $('histAdmin').hidden = !adm || !canView();
    if (S.mode === 'db' && histRef && S.staffLoaded) {
      if (canView() && !histUnsub) subHist();
      else if (!canView() && histUnsub) { try { histUnsub(); } catch(e){} histUnsub = null; HIST = []; }
    }
    $('mjAdmin').hidden = !adm || ro();
    renderMjAdmin();
    $('kdAdmin').hidden = !adm || ro();
    renderKdAdmin();
    renderHist();
    {
      setHTML($('staffList'), STAFF.length ? STAFF.map(function(p){
        var c = S.staffConfirm === p.id;
        var own = p.uloga === 'vlasnik', gost = p.uloga === 'gost';
        return '<li class="srow" data-id="' + esc(p.id) + '"><span class="sname">' + esc(p.ime) + '<small>' + (own ? 'vlasnik' : gost ? 'gost · samo pregled' : ['radnik'].concat(p.urednik ? ['mijenja i briše'] : [], p.pregled ? ['vidi događaje'] : []).join(' · ')) + '</small></span>' +
          '<span class="sbtns">' + (own || gost ? '' : '<button class="ghost" type="button" data-sact="pregled" aria-pressed="' + !!p.pregled + '">' + (p.pregled ? '✓ Vidi događaje i istoriju' : 'Vidi događaje i istoriju') + '</button>') +
          (own || gost ? '' : '<button class="ghost" type="button" data-sact="urednik" aria-pressed="' + !!p.urednik + '">' + (p.urednik ? '✓ Mijenja i briše' : 'Mijenja i briše') + '</button>') +
          '<button class="ghost" type="button" data-sact="big" aria-pressed="' + !!p.krupno + '">' + (p.krupno ? '✓ Krupna slova' : 'Krupna slova') + '</button>' +
          (own ? '' : '<button class="ghost danger' + (c ? ' confirm' : '') + '" type="button" data-sact="del">' + (c ? 'Potvrdi uklanjanje' : 'Ukloni') + '</button>') + '</span></li>';
      }).join('') : '<li class="note">Još nema radnika. Dodaj prvo ime ispod.</li>');
    }
  }
  function setStaffMsg(t, isErr){ var m = $('staffMsg'); m.textContent = t || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  async function removeStaff(id){
    if (S.mode === 'db') { await staffRef.doc(id).delete(); }
    else { STAFF = STAFF.filter(function(p){ return p.id !== id; }); saveStaffLocal(); render(); }
  }
  var changeTimer = null;
  $('curActs').addEventListener('click', function(e){
    var b = e.target.closest('button[data-cact]'); if (!b) return;
    var a = b.getAttribute('data-cact');
    clearTimeout(changeTimer);
    if (a === 'ask') {
      S.changing = true;
      changeTimer = setTimeout(function(){ S.changing = false; render(); }, 5000);
    } else if (a === 'no') {
      S.changing = false;
    } else if (a === 'yes') {
      if (window.__odjava) { window.__odjava(); return; }
      S.changing = false; S.worker = '';
      if (S.editing) resetForm();
      try { localStorage.removeItem(LSW); } catch(x){}
    }
    render();
  });
  async function submitStaff(){
    if (!pruneAllowed()) { setStaffMsg('Radnike može dodavati samo vlasnik.', true); return; }
    var ime = $('newStaff').value.trim(), pin = $('newStaffPin').value.trim(), uloga = $('newStaffUloga').value;
    if (!ime) { setStaffMsg('Upiši ime radnika.', true); return; }
    if (!/^\d{4}$/.test(pin)) { setStaffMsg('Upiši PIN od 4 cifre za novog radnika.', true); $('newStaffPin').focus(); return; }
    if (STAFF.some(function(p){ return norm(p.ime) === norm(ime); })) { setStaffMsg('Taj radnik već postoji.', true); return; }
    var btn = $('staffAdd'); btn.disabled = true; setStaffMsg('Dodajem…');
    try { await window.__noviRadnik(ime, pin, uloga); $('newStaff').value = ''; $('newStaffPin').value = ''; $('newStaffUloga').value = 'radnik'; setStaffMsg(ime + (uloga === 'gost' ? ' je dodat(a) kao gost (samo pregled).' : ' je dodat(a).') + ' Ulazi sa PIN-om ' + pin + '.'); }
    catch(err){ setStaffMsg('Dodavanje nije uspjelo. Provjeri internet i pokušaj ponovo.', true); }
    finally { btn.disabled = false; }
  }
  $('staffAdd').addEventListener('click', submitStaff);
  $('newStaff').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); $('newStaffPin').focus(); } });
  $('newStaffPin').addEventListener('input', function(){ this.value = this.value.replace(/\D/g, '').slice(0, 4); });
  $('newStaffPin').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); submitStaff(); } });
  $('staffList').addEventListener('click', async function(e){
    var b = e.target.closest('button[data-sact]'); if (!b) return;
    if (!pruneAllowed()) { setStaffMsg('Osoblje može mijenjati samo vlasnik.', true); return; }
    var id = b.closest('.srow').getAttribute('data-id');
    var act = b.getAttribute('data-sact');
    var p = STAFF.filter(function(x){ return x.id === id; })[0];
    if (p && p.uloga === 'vlasnik' && act === 'del') return;
    if (act === 'del') {
      if (S.staffConfirm === id) {
        clearTimeout(staffTimer); S.staffConfirm = null;
        try { await removeStaff(id); setStaffMsg('Radnik uklonjen.'); }
        catch(err){ setStaffMsg('Uklanjanje nije uspjelo.', true); }
        render();
      } else {
        S.staffConfirm = id; render();
        clearTimeout(staffTimer);
        staffTimer = setTimeout(function(){ S.staffConfirm = null; render(); }, 4000);
      }
    } else if (act === 'pregled' && p && p.uloga !== 'vlasnik') {
      try {
        await staffRef.doc(p.id).update({ pregled: !p.pregled });
        setStaffMsg(p.pregled ? p.ime + ' više ne vidi događaje ni istoriju.' : p.ime + ' sada vidi događaje i istoriju.');
      } catch(err){ setStaffMsg('Nije sačuvano. Provjeri internet i pokušaj ponovo.', true); }
      render();
    } else if (act === 'urednik' && p && p.uloga !== 'vlasnik') {
      try {
        await staffRef.doc(p.id).update({ urednik: !p.urednik });
        setStaffMsg(p.urednik ? p.ime + ' više ne može mijenjati ni brisati upise.' : p.ime + ' sada može mijenjati i brisati upise.');
      } catch(err){ setStaffMsg('Nije sačuvano. Provjeri internet i pokušaj ponovo.', true); }
      render();
    } else if (act === 'big' && p) {
      try {
        if (S.mode === 'db') await staffRef.doc(p.id).update({ krupno: !p.krupno });
        else { p.krupno = !p.krupno; saveStaffLocal(); }
        setStaffMsg((p.krupno && S.mode !== 'db') || (!p.krupno && S.mode === 'db') ? p.ime + ' sada ima krupna slova.' : p.ime + ' više nema krupna slova.');
      } catch(err){ setStaffMsg('Nije sačuvano. Samo vlasnik i urednici mogu mijenjati osoblje.', true); }
      render();
    }
  });

  /* ---------- korisnici ---------- */
  async function resolveNames(){
    if (!userNs) return;
    var seen = {};
    orders.forEach(function(o){ if (o.upisao) seen[o.upisao] = 1; if (o.preuzeo) seen[o.preuzeo] = 1; if (o.iskidao) seen[o.iskidao] = 1; });
    var need = Object.keys(seen).filter(function(id){ return !(id in NAMES); });
    if (!need.length) return;
    need.forEach(function(id){ NAMES[id] = { name: '', guest: false }; });
    try {
      var ps = await userNs.profiles(need);
      need.forEach(function(id){ var p = ps && ps[id]; if (p) NAMES[id] = { name: p.name || '', guest: !!p.guest }; });
    } catch(e){}
    render();
  }
  async function initUser(){
    try { userNs = window.claude ? await window.claude.use('user') : null; } catch(e){ userNs = null; }
    if (!userNs) return;
    try {
      var me = await userNs.me();
      ME.id = me.id; ME.name = me.name || ''; ME.isOwner = !!me.isOwner; ME.canEdit = !!me.canEdit;
      ME.canWrite = await userNs.can('data.write');
    } catch(e){}
    ME.ready = true;
    render();
    resolveNames();
  }

  var toastT = 0;
  function showToast(t){
    var el = $('toast'); el.textContent = t; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function(){ el.hidden = true; }, 2500);
    try { if (navigator.vibrate) navigator.vibrate(40); } catch(e){}
  }

  /* ---------- tema ---------- */
  function effTheme(){
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function paintTheme(){
    var d = effTheme() === 'dark', b = $('themeBtn');
    b.innerHTML = d ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    b.setAttribute('aria-label', d ? 'Svijetli prikaz' : 'Tamni prikaz');
    b.title = d ? 'Svijetli prikaz' : 'Tamni prikaz';
  }
  try { var st = localStorage.getItem('pecenjara-tema'); if (st === 'light' || st === 'dark') document.documentElement.setAttribute('data-theme', st); } catch(e){}
  $('themeBtn').addEventListener('click', function(){
    var n = effTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', n);
    try { localStorage.setItem('pecenjara-tema', n); } catch(e){}
    paintTheme();
  });
  paintTheme();

  setInterval(function(){ if (S.loaded) render(); }, 60000);

  /* ---------- start ---------- */
  S.view = viewFromHash();
  try { S.worker = localStorage.getItem(LSW) || ''; } catch(e){ S.worker = ''; }
  try { S.sesija = localStorage.getItem(LSSES) || null; } catch(e){ S.sesija = null; }
  syncOpis();
  render();
  initUser();
  (async function init(){
    var db = null;
    try { db = window.claude ? await window.claude.use('db') : null; } catch(e){ db = null; }
    if (db) {
      S.mode = 'db';
      DB = db;
      dbRef = db.collection(COL);
      staffRef = db.collection('osoblje');
      staffRef.onSnapshot(function(snap){
        STAFF = snap.docs.map(function(d){ var x = Object.assign({}, d.data()); x.id = d.id; return x; })
          .sort(function(a, b){ return (a.kreirano || 0) - (b.kreirano || 0); });
        S.staffLoaded = true; render();
      }, function(){ S.staffLoaded = true; });
      histRef = db.collection('istorija');
      try {
        mjRef = db.collection('podesavanja').doc('mjesta');
        mjRef.onSnapshot(function(snap){
          setMjList(snap && snap.exists ? (snap.data() || {}).lista : null);
          render();
        }, function(){});
      } catch(e){}
      try {
        khRef = db.collection('podesavanja').doc('kupci');
        khRef.onSnapshot(function(snap){ KH = (snap && snap.exists && (snap.data() || {}).skriveni) || {}; }, function(){});
      } catch(e){}
      try {
        kdRef = db.collection('podesavanja').doc('kidaci');
        kdRef.onSnapshot(function(snap){
          setKdList(snap && snap.exists ? (snap.data() || {}).lista : null);
          render();
        }, function(){});
      } catch(e){}
      sesRef = db.collection('sesije');
      sesRef.onSnapshot(function(snap){
        SESIJE = snap.docs.map(function(d){ var x = Object.assign({}, d.data()); x.id = d.id; return x; });
        dataVer++; S.sesLoaded = true; render();
      }, function(){ S.sesLoaded = true; });
      var slow = setTimeout(function(){ if (!S.loaded) setMsg('Podaci se još ne učitavaju. Provjeri internet vezu.', true); }, 10000);
      dbRef.onSnapshot(function(snap){
        orders = snap.docs.map(function(d){ var x = Object.assign({}, d.data()); x.id = d.id; return x; });
        dataVer++; S.loaded = true;
        if (!snap.metadata.fromCache) { clearTimeout(slow); if ($('msg').classList.contains('err') && /učitavaju/.test($('msg').textContent)) setMsg(''); }
        render(); resolveNames();
      }, function(){
        clearTimeout(slow);
        S.mode = 'local'; orders = loadLocal(); S.loaded = true; STAFF = loadStaffLocal(); S.staffLoaded = true; SESIJE = loadSesLocal(); S.sesLoaded = true; HIST = loadHistLocal(); setMjList(loadMjLocal()); setKdList(loadKdLocal()); KH = khLoadLocal(); migrateLocal();
        setMsg('Veza sa bazom nije dostupna, upisi se čuvaju samo na ovom uređaju.', true);
        render();
      });
    } else {
      S.mode = 'local'; orders = loadLocal(); S.loaded = true; STAFF = loadStaffLocal(); S.staffLoaded = true; SESIJE = loadSesLocal(); S.sesLoaded = true; HIST = loadHistLocal(); setMjList(loadMjLocal()); setKdList(loadKdLocal()); KH = khLoadLocal(); migrateLocal(); render();
    }
  })();
})();
