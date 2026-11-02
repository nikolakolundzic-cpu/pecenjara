# Evidencija pečenja

Aplikacija za upis, kidanje i preuzimanje pečenja po događajima. Radi na iPhoneu i Androidu
kao instalirana aplikacija (PWA), a podaci su u Firebase bazi.

## Šta je u repozitorijumu

| Fajl | Čemu služi |
|---|---|
| `index.html` | izgled aplikacije i ekran za prijavu |
| `app.js` | sva logika: upis, pretraga, kidanje, događaji, podešavanja |
| `shim.js` | veza sa Firebaseom: prijava radnika, baza, uvoz i rezervna kopija |
| `config.js` | podaci za povezivanje sa Firebase projektom |
| `firestore.rules` | pravila baze: ko šta smije da čita i mijenja |
| `sw.js`, `manifest.webmanifest`, `icons/` | instalacija na telefon i otvaranje bez interneta |

U repozitorijumu nema nijednog kupca, broja telefona ni PIN-a. Svi podaci su samo u bazi.

## Ko šta može

- **Vlasnik** (postavlja se pri prvom pokretanju): dodaje i uklanja radnike, mijenja i briše upise,
  briše staru istoriju, pravi rezervnu kopiju i uvozi podatke.
- **Radnik**: upisuje pečenja, označava preuzeto/iskidano i mjesto, mijenja svoj PIN.
- **Radnik sa dozvolom „Mijenja i briše“** (vlasnik je uključuje u Osoblju): još i mijenja i briše upise.
- **Radnik sa dozvolom „Vidi događaje i istoriju“**: otvara stranicu Događaj (zbir, po radniku, raniji događaji,
  štampa, CSV) i Istoriju. Bez te dozvole Događaj se samo prikazuje na vrhu, a istoriju baza ne daje.
- **Gost** (vlasnik ga dodaje u Osoblju, uloga „Gost (samo pregled)“): vidi samo Pretragu i listu pečenja
  (broj, ime, vrsta, kidanje, preuzeto, mjesto, dolazak). Ne vidi zbirove, brojeve u filterima, telefone,
  događaje ni istoriju i ne može ništa upisati ni promijeniti; to brani i baza.
- Bez prijave se ne vidi ništa osim imena radnika na ekranu za prijavu.

Ovo ne provjerava samo aplikacija, nego i sama baza (`firestore.rules`).

Vlasnik pod **Podešavanja → Moj PIN / šifra** može umjesto PIN-a postaviti šifru sa slovima, brojevima
i znakovima (najmanje 6). Na ekranu za prijavu se tada kod njegovog imena kuca šifra.

## Postavljanje (jednom)

1. Firebase projekat: Authentication → Email/Password uključen; Firestore Database napravljen.
2. U `config.js` upisati `firebaseConfig` iz Firebase konzole (Project settings → Your apps → Web).
3. Firestore → **Rules**: zalijepiti sadržaj `firestore.rules` → **Publish**.
4. GitHub → Settings → Pages → Source: *Deploy from a branch*, grana `main`, folder `/ (root)`.
5. Otvoriti adresu aplikacije i postaviti vlasnika (ime i PIN).

## Instalacija na telefon

- **iPhone:** otvoriti u Safariju → dugme Dijeli → **Dodaj na početni ekran**.
- **Android:** otvoriti u Chromeu → ⋮ → **Instaliraj aplikaciju** (ili *Dodaj na početni ekran*).

## Nova verzija

Posle izmjene koda povećati `PECENJE_VERZIJA` u `config.js` i `VERZIJA` u `sw.js`,
da telefoni sigurno preuzmu novu verziju.

## Testiranje na računaru

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-pecenje
python3 -m http.server 5173
```

Otvoriti `http://127.0.0.1:5173/?emu=1` (sa test podacima u `config.js`, npr. `projectId: "demo-pecenje"`).
