/* Evidencija pečenja: veza sa Firebase bazom i prijava radnika.
   Aplikacija (app.js) se učitava tek kad je radnik prijavljen. */
(function(){
  'use strict';
  var CFG = window.PECENJE_CONFIG || null;
  var DOM = '@pecenje.app';                       // izmišljene adrese, nikad se ne šalje pošta
  function pwd(pin){ return 'pecenje-' + pin + '!'; }  // Firebase traži bar 6 znakova
  function $(id){ return document.getElementById(id); }
  function show(id){ ['lLoad', 'lPick', 'lPin', 'lSetup'].forEach(function(x){ $(x).hidden = x !== id; }); }
  function msg(t, ok){ var m = $('lMsg'); m.textContent = t || ''; m.className = 'lmsg' + (ok ? ' ok' : ''); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function digits(el){ el.addEventListener('input', function(){ el.value = el.value.replace(/\D/g, '').slice(0, 4); }); }

  /* tema iz prethodnog izbora, da ekran za prijavu ne trepne */
  try { var tm = localStorage.getItem('pecenjara-tema'); if (tm === 'light' || tm === 'dark') document.documentElement.setAttribute('data-theme', tm); } catch(e){}

  if (!CFG || !CFG.apiKey || !window.firebase) {
    $('lLoadMsg').textContent = !window.firebase
      ? 'Nema interneta. Aplikacija se prvi put mora otvoriti uz internet.'
      : 'Aplikacija još nije povezana sa bazom (config.js).';
    return;
  }

  firebase.initializeApp(CFG);
  var auth = firebase.auth();
  var fs = firebase.firestore();
  if (/[?&]emu=1/.test(location.search)) {           // samo za testiranje na računaru
    auth.useEmulator('http://127.0.0.1:9099');
    fs.useEmulator('127.0.0.1', 8080);
  } else {
    try { fs.enablePersistence({ synchronizeTabs: true }).catch(function(){}); } catch(e){}
  }

  /* ---------- prilagođavanje baze onome što app.js očekuje ---------- */
  function wrapDoc(ref){
    ref.acquire = function(o){
      return fs.runTransaction(function(t){
        return t.get(ref).then(function(s){
          var d = s.exists ? s.data() : null, now = Date.now();
          if (d && d.exp > now && d.holder !== o.holder) return { acquired: false, expiresAt: new Date(d.exp).toISOString() };
          var exp = now + Math.max(1000, o.ttlMs || 30000);
          t.set(ref, { holder: o.holder, exp: exp });
          return { acquired: true, holder: o.holder, expiresAt: new Date(exp).toISOString() };
        });
      });
    };
    return ref;
  }
  function wrapCol(col){
    var orig = col.doc.bind(col);
    col.doc = function(id){ return wrapDoc(id ? orig(id) : orig()); };
    return col;
  }
  var dbApi = {
    collection: function(p){ return wrapCol(fs.collection(p)); },
    doc: function(p){ return wrapDoc(fs.doc(p)); }
  };

  var me = null, NAMES = {};
  var userApi = {
    me: function(){ return Promise.resolve({ id: me.uid, name: me.ime, isOwner: me.uloga === 'vlasnik', canEdit: true }); },
    id: function(){ return Promise.resolve(me.uid); },
    can: function(){ return Promise.resolve(true); },
    isOwner: function(){ return me.uloga === 'vlasnik'; },
    canEdit: function(){ return true; },
    profiles: function(ids){
      var o = {};
      (ids || []).forEach(function(id){ if (NAMES[id]) o[id] = { name: NAMES[id], guest: false }; });
      return Promise.resolve(o);
    }
  };
  var dlApi = {
    save: function(f){
      var type = /\.csv$/i.test(f.filename) ? 'text/csv;charset=utf-8' : /\.html?$/i.test(f.filename) ? 'text/html;charset=utf-8' : 'application/json';
      var blob = f.data instanceof Blob ? f.data : new Blob([f.data], { type: type });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = f.filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
      return Promise.resolve();
    }
  };
  window.claude = {
    use: function(name){
      if (name === 'db') return Promise.resolve(dbApi);
      if (name === 'user') return Promise.resolve(userApi);
      if (name === 'downloads') return Promise.resolve(dlApi);
      return Promise.resolve(null);
    }
  };

  /* ---------- radnje koje app.js poziva ---------- */
  window.__odjava = function(poruka){
    try { if (poruka) sessionStorage.setItem('pecenje-poruka', poruka); } catch(e){}
    try { localStorage.removeItem('pecenjara-radnik'); } catch(e){}
    auth.signOut().then(function(){ location.reload(); }, function(){ location.reload(); });
  };
  window.__noviRadnik = function(ime, pin){
    var sec = firebase.apps.filter(function(a){ return a.name === 'dodavanje'; })[0] || firebase.initializeApp(CFG, 'dodavanje');
    var sa = sec.auth();
    if (/[?&]emu=1/.test(location.search) && !sa.__emu) { sa.useEmulator('http://127.0.0.1:9099'); sa.__emu = true; }
    var email = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + DOM;
    return sa.setPersistence(firebase.auth.Auth.Persistence.NONE)
      .then(function(){ return sa.createUserWithEmailAndPassword(email, pwd(pin)); })
      .then(function(cred){
        var uid = cred.user.uid;
        return sa.signOut().then(function(){
          return fs.collection('osoblje').doc(uid).set({ ime: ime, email: email, uloga: 'radnik', kreirano: Date.now() });
        });
      });
  };
  window.__promijeniPin = function(stari, novi){
    var u = auth.currentUser;
    var cred = firebase.auth.EmailAuthProvider.credential(u.email, pwd(stari));
    return u.reauthenticateWithCredential(cred).catch(function(e){
      throw (e && /wrong-password|invalid-credential|invalid-login/.test(e.code || '')) ? { code: 'pogresan' } : e;
    }).then(function(){ return u.updatePassword(pwd(novi)); });
  };
  var KOLEKCIJE = ['porudzbine', 'sesije', 'istorija', 'podesavanja'];
  window.__izvoz = function(){
    var out = { verzija: 1, napravljeno: new Date().toISOString() };
    return Promise.all(KOLEKCIJE.map(function(c){
      return fs.collection(c).get().then(function(snap){
        out[c] = {};
        snap.docs.forEach(function(d){ out[c][d.id] = d.data(); });
      });
    })).then(function(){ return out; });
  };
  window.__uvoz = function(data, napredak){
    if (!data || typeof data !== 'object' || !data.porudzbine) return Promise.reject(new Error('format'));
    var writes = [], count = { porudzbine: 0, sesije: 0, istorija: 0 };
    KOLEKCIJE.forEach(function(c){
      var src = data[c]; if (!src) return;
      var list = Array.isArray(src) ? src.map(function(x){ return [x.id, x.data || x]; }) : Object.keys(src).map(function(k){ return [k, src[k]]; });
      list.forEach(function(p){
        var id = String(p[0] || ''), d = p[1];
        if (!/^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(id) || !d || typeof d !== 'object') return;
        d = Object.assign({}, d); delete d.id;
        if (c === 'podesavanja' && id === 'mjesta' && !Array.isArray(d.lista)) return;
        writes.push([c, id, d]);
        if (c in count) count[c]++;
      });
    });
    var done = 0;
    function next(){
      if (done >= writes.length) return Promise.resolve(count);
      var b = fs.batch(), part = writes.slice(done, done + 400);
      part.forEach(function(w){ b.set(fs.collection(w[0]).doc(w[1]), w[2]); });
      return b.commit().then(function(){ done += part.length; if (napredak) napredak(done, writes.length); return next(); });
    }
    return next();
  };

  /* ---------- prijava ---------- */
  var STAFF = [], picked = null, settingUp = false, started = false;
  fs.collection('osoblje').onSnapshot(function(snap){
    STAFF = snap.docs.map(function(d){ var x = d.data(); x.id = d.id; return x; })
      .sort(function(a, b){ return (a.kreirano || 0) - (b.kreirano || 0); });
    NAMES = {}; STAFF.forEach(function(p){ NAMES[p.id] = p.ime; });
    if (!started && !$('lPick').hidden) renderChips();
  }, function(){});

  function renderChips(){
    $('lChips').innerHTML = STAFF.length ? STAFF.map(function(p){
      return '<button type="button" data-uid="' + esc(p.id) + '">' + esc(p.ime) + '</button>';
    }).join('') : '<p class="lfoot">Još nema radnika.</p>';
  }
  function showPick(t){
    show('lLoad'); $('lLoadMsg').textContent = 'Učitavam…';
    fs.collection('config').doc('vlasnik').get().then(function(s){
      if (!s.exists) { show('lSetup'); msg(t || ''); try { $('sIme').focus(); } catch(e){} return; }
      return fs.collection('osoblje').get().then(function(snap){
        STAFF = snap.docs.map(function(d){ var x = d.data(); x.id = d.id; return x; })
          .sort(function(a, b){ return (a.kreirano || 0) - (b.kreirano || 0); });
        renderChips(); show('lPick'); msg(t || '');
      });
    }).catch(function(){
      $('lLoadMsg').textContent = 'Nema veze sa bazom. Provjeri internet pa osvježi stranicu.';
    });
  }
  $('lChips').addEventListener('click', function(e){
    var b = e.target.closest('[data-uid]'); if (!b) return;
    picked = STAFF.filter(function(p){ return p.id === b.getAttribute('data-uid'); })[0]; if (!picked) return;
    $('lWho').textContent = picked.ime; $('lPinIn').value = ''; msg('');
    show('lPin'); try { $('lPinIn').focus(); } catch(x){}
  });
  digits($('lPinIn'));
  $('lPinIn').addEventListener('input', function(){ if (this.value.length === 4) login(); });
  $('lPinIn').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); login(); } });
  $('lPinOk').addEventListener('click', login);
  $('lPinBack').addEventListener('click', function(){ picked = null; msg(''); show('lPick'); });
  var busy = false;
  function login(){
    var pin = $('lPinIn').value;
    if (!picked || busy) return;
    if (!/^\d{4}$/.test(pin)) { msg('Upiši PIN od 4 cifre.'); return; }
    busy = true; $('lPinOk').disabled = true; msg('');
    auth.signInWithEmailAndPassword(picked.email, pwd(pin)).catch(function(e){
      var c = (e && e.code) || '';
      $('lPinIn').value = '';
      msg(/too-many-requests/.test(c) ? 'Previše pokušaja. Sačekaj par minuta.'
        : /network/.test(c) ? 'Nema interneta. Pokušaj ponovo.'
        : 'Pogrešan PIN.');
      try { $('lPinIn').focus(); } catch(x){}
    }).then(function(){ busy = false; $('lPinOk').disabled = false; });
  }

  digits($('sPin')); digits($('sPin2'));
  $('sOk').addEventListener('click', function(){
    var ime = $('sIme').value.trim(), a = $('sPin').value, b = $('sPin2').value;
    if (!ime) { msg('Upiši svoje ime.'); return; }
    if (!/^\d{4}$/.test(a)) { msg('PIN mora imati 4 cifre.'); return; }
    if (a !== b) { msg('PIN-ovi se ne poklapaju.'); return; }
    var btn = this; btn.disabled = true; settingUp = true; msg('');
    var email = 'vlasnik' + Date.now().toString(36) + DOM, uid;
    auth.createUserWithEmailAndPassword(email, pwd(a)).then(function(cred){
      uid = cred.user.uid;
      return fs.collection('config').doc('vlasnik').set({ uid: uid, kreirano: Date.now() });
    }).then(function(){
      return fs.collection('osoblje').doc(uid).set({ ime: ime, email: email, uloga: 'vlasnik', kreirano: Date.now() });
    }).then(function(){
      settingUp = false; onUser(auth.currentUser);
    }).catch(function(){
      settingUp = false; btn.disabled = false;
      auth.signOut().catch(function(){});
      msg('Postavljanje nije uspjelo. Možda je vlasnik već postavljen: osvježi stranicu.');
    });
  });

  function onUser(u){
    if (settingUp) return;
    if (!u) { var t = ''; try { t = sessionStorage.getItem('pecenje-poruka') || ''; sessionStorage.removeItem('pecenje-poruka'); } catch(e){} showPick(t); return; }
    show('lLoad'); $('lLoadMsg').textContent = 'Ulazim…';
    fs.collection('osoblje').doc(u.uid).get().then(function(d){
      if (!d.exists) { window.__odjava('Ovaj nalog više nema pristup. Javi se vlasniku.'); return; }
      var x = d.data();
      me = { uid: u.uid, ime: x.ime, uloga: x.uloga || 'radnik' };
      start();
    }).catch(function(){
      $('lLoadMsg').textContent = 'Nema veze sa bazom. Provjeri internet pa osvježi stranicu.';
    });
  }
  function start(){
    if (started) return;
    started = true;
    try { localStorage.setItem('pecenjara-radnik', me.ime); } catch(e){}
    $('login').hidden = true;
    document.body.classList.remove('locked');
    var s = document.createElement('script');
    s.src = 'app.js?v=' + (window.PECENJE_VERZIJA || '1');
    document.body.appendChild(s);
  }
  auth.onAuthStateChanged(onUser);

  /* ---------- rad bez interneta: čuva aplikaciju na telefonu ---------- */
  /* Nova verzija: telefon provjerava pri svakom vraćanju u aplikaciju. Kad stigne,
     aplikacija se sama osvježi čim se skloni sa ekrana, ili odmah na dugme „Osvježi“. */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    var imaNovu = false;
    function ponudiNovu(){
      if (imaNovu) return; imaNovu = true;
      var b = document.createElement('div');
      b.className = 'novaverzija';
      b.innerHTML = '<span>Stigla je nova verzija aplikacije.</span><button type="button">Osvježi</button>';
      b.querySelector('button').addEventListener('click', function(){ location.reload(); });
      document.body.appendChild(b);
    }
    window.addEventListener('load', function(){
      var bioKontroler = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', function(){
        if (!bioKontroler) { bioKontroler = true; return; }
        if (document.visibilityState === 'hidden' || !started) location.reload(); else ponudiNovu();
      });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function(reg){
        function provjeri(){ try { reg.update(); } catch(e){} }
        document.addEventListener('visibilitychange', function(){
          if (document.visibilityState === 'visible') provjeri();
          else if (imaNovu) location.reload();
        });
        setInterval(provjeri, 15 * 60 * 1000);
      }).catch(function(){});
    });
  }
})();
