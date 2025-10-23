const api = (path, opts={}) => {
  const token = localStorage.getItem('token');
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  return fetch(path, opts).then(r => r.json());
};

const Router = {
  routes: {},
  go(hash){ location.hash = hash; },
  start(){
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/login';
    render();
  }
};

const html = String.raw;
const app = document.getElementById('app');

function render(){
  const route = location.hash.slice(1);
  if (route.startsWith('/dashboard')) return Dashboard();
  if (route.startsWith('/colonnine')) return Colonnine();
  if (route.startsWith('/prenotazioni')) return Prenotazioni();
  if (route.startsWith('/ricariche')) return Ricariche();
  if (route.startsWith('/login')) return Login();
  return Login();
}

function layout(content){
  const user = JSON.parse(localStorage.getItem('user')||'null');
  app.innerHTML = html`
    <div class="container">
      <nav>
        <a class="nav" onclick="Router.go('#/dashboard')">Dashboard</a>
        <a class="nav" onclick="Router.go('#/colonnine')">Colonnine</a>
        <a class="nav" onclick="Router.go('#/prenotazioni')">Prenotazioni</a>
        <a class="nav" onclick="Router.go('#/ricariche')">Ricariche</a>
        <span style="flex:1"></span>
        ${user ? `<span>${user.nome} (${user.ruolo})</span>
          <button onclick="logout()">Esci</button>` : ''}
      </nav>
      ${content}
    </div>
  `;
}

function Login(){
  app.innerHTML = html`
    <div class="container">
      <div class="card">
        <h2>Login</h2>
        <div class="grid">
          <input id="email" placeholder="Email">
          <input id="password" placeholder="Password" type="password">
          <button class="primary" onclick="doLogin()">Entra</button>
        </div>
        <p>Tip: la password "password123" è accettata per test veloce.</p>
      </div>
      <div class="card">
        <h2>Registrazione Rapida</h2>
        <div class="grid">
          <input id="r_nome" placeholder="Nome">
          <input id="r_email" placeholder="Email">
          <input id="r_password" type="password" placeholder="Password">
          <button onclick="doRegister()">Crea</button>
        </div>
      </div>
    </div>`;
}

async function doRegister(){
  const btn = event.target;
  await withBusy(btn, async ()=>{
    const body = {
      nome: val('r_nome'), email: val('r_email'), password: val('r_password')
    };
    const res = await api('/api/register', {method:'POST', body: JSON.stringify(body)});
    if(res.success) toast('Registrazione completata'); else toast(res.message||'Errore registrazione', true);
  });
}

async function doLogin(){
  const btn = event.target;
  await withBusy(btn, async ()=>{
    const body = { email: val('email'), password: val('password') };
    const res = await api('/api/login', {method:'POST', body: JSON.stringify(body)});
    if(res.success){
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      toast('Accesso eseguito'); Router.go('#/dashboard');
    } else toast(res.message||'Credenziali non valide', true);
  });
}
function logout(){
  api('/api/logout',{method:'POST'}).finally(()=>{
    localStorage.removeItem('token'); localStorage.removeItem('user');
    Router.go('#/login');
  });
}

async function Dashboard(){
  layout(html`
    <div class="card"><h2>Benvenuto</h2>
      <p>Usa il menu per gestire le colonnine, prenotazioni e ricariche.</p>
    </div>
  `);
}

let map, markersLayer;

async function Colonnine(){
  const data = await api('/api/colonnine');
  layout(html`
    <div class="card">
      <h2>Colonnine</h2>
      <div class="grid">
        <input id="c_indirizzo" placeholder="Indirizzo">
        <input id="c_lat" placeholder="Latitudine" type="number" step="0.000001">
        <input id="c_lng" placeholder="Longitudine" type="number" step="0.000001">
        <input id="c_kw" placeholder="Potenza kW" type="number" step="0.1">
        <input id="c_qua" placeholder="Quartiere">
        <input id="c_nil" placeholder="NIL">
        <button onclick="addColonnina()" class="primary">Aggiungi</button>
      </div>
    </div>
    <div id="map" class="card" style="padding:0"></div>
  `);

  // Inizializza mappa solo la prima volta
  if(!map){
    map = L.map('map', { zoomControl: true }).setView([45.4642, 9.19], 12); // centro Milano default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);

    // Click sulla mappa compila lat/lng
    map.on('click', e=>{
      document.getElementById('c_lat').value = e.latlng.lat.toFixed(6);
      document.getElementById('c_lng').value = e.latlng.lng.toFixed(6);
      toast('Coordinate impostate dal click');
    });
  } else {
    // se esiste già, assicurati che il contenitore sia collegato
    map.invalidateSize();
  }

  // Disegna marker
  drawColumnsOnMap(data.items||[]);
}

// Ridisegna i marker
function drawColumnsOnMap(items){
  markersLayer.clearLayers();
  if(!items.length) return;
  const bounds = [];
  items.forEach(c=>{
    if(c.latitudine==null || c.longitudine==null) return;
    const m = L.marker([c.latitudine, c.longitudine]).addTo(markersLayer);
    m.cData = c; // attacca dati al marker

    const popupHtml = `
      <div>
        <b>${c.indirizzo||'Senza indirizzo'}</b><br>
        kW: ${c.potenza_kW??'-'}<br>
        Quartiere: ${c.quartiere||'-'}<br>
        <button class="btn-del-col" data-id="${c.id}">Elimina</button>
      </div>`;
    m.bindPopup(popupHtml);

    // quando si apre il popup, collega l'handler al bottone interno
    m.on('popupopen', (ev)=>{
      const btn = ev.popup.getElement().querySelector('.btn-del-col');
      if(btn){
        btn.addEventListener('click', async ()=>{
          if(!confirm('Eliminare colonnina?')) return;
          await withBusy(btn, async ()=>{
            const res = await api('/api/colonnine?id='+btn.dataset.id,{method:'DELETE'});
            if(res.success){
              toast('Colonnina eliminata');
              await Colonnine(); // ridisegna mappa e popup
            } else toast('Errore eliminazione', true);
          });
        });
      }
    });

    bounds.push([c.latitudine, c.longitudine]);
  });
  if(bounds.length) map.fitBounds(bounds, { padding:[30,30] });
}


async function addColonnina(){
  const btn = event.target;
  await withBusy(btn, async ()=>{
    const body = {
      indirizzo: val('c_indirizzo'), latitudine: num('c_lat'), longitudine: num('c_lng'),
      potenza_kW: num('c_kw'), quartiere: val('c_qua'), NIL: val('c_nil')
    };
    const res = await api('/api/colonnine',{method:'POST', body: JSON.stringify(body)});
    if(res.success){
      toast('Colonnina aggiunta con successo');
      await Colonnine(); // refresh lista
    } else toast('Errore aggiunta colonnina', true);
  });
}

async function delCol(id){
  if(!confirm('Eliminare colonnina?')) return;
  const btn = event.target;
  await withBusy(btn, async ()=>{
    const res = await api('/api/colonnine?id='+id,{method:'DELETE'});
    if(res.success){ toast('Colonnina eliminata'); await Colonnine(); }
    else toast('Errore eliminazione', true);
  });
}

async function Prenotazioni(){
  const data = await api('/api/prenotazioni');
  const cols = await api('/api/colonnine');
  layout(html`
    <div class="card">
      <h2>Prenotazioni</h2>
      <div class="grid">
        <select id="p_col">
          ${(cols.items||[]).map(c=>`<option value="${c.id}">${c.indirizzo} (${c.potenza_kW}kW)</option>`).join('')}
        </select>
        <input id="p_data" type="datetime-local">
        <button id="btnPrenota" class="primary">Prenota</button>
      </div>
      <table id="tblPren">
        <thead><tr><th>ID</th><th>Colonnina</th><th>Quando</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          ${(data.items||[]).map(p=>`
            <tr data-id="${p.id}">
              <td>${p.id}</td>
              <td>${p.colonnina_id}</td>
              <td>${p.data_prenotazione}</td>
              <td>${p.stato}</td>
              <td><button class="btn-annulla">Annulla</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `);

  document.getElementById('btnPrenota').addEventListener('click', addPren);

  // Delega: cattura click su tutti i futuri pulsanti "Annulla"
  document.getElementById('tblPren').addEventListener('click', async (e)=>{
    if(!e.target.classList.contains('btn-annulla')) return;
    const tr = e.target.closest('tr');
    const id = tr.getAttribute('data-id');
    await delPren(Number(id), e.target);
  });
}

async function delPren(id, btnEl){
  await withBusy(btnEl, async ()=>{
    const res = await api(`/api/prenotazioni/${id}/annulla`, { method: 'PATCH' });
    if(res.success){ toast('Prenotazione annullata'); await Prenotazioni(); }
    else toast(res.message||'Errore annullamento', true);
  });
}


async function addPren(){
  const btn = event.target;
  await withBusy(btn, async ()=>{
    const body = { colonnina_id: num('p_col'), data_prenotazione: val('p_data'), stato:'attiva' };
    const res = await api('/api/prenotazioni',{method:'POST', body: JSON.stringify(body)});
    if(res.success){ toast('Prenotazione effettuata con successo'); await Prenotazioni(); }
    else toast('Errore prenotazione', true);
  });
}
async function Ricariche(){
  const data = await api('/api/ricariche');
  const cols = await api('/api/colonnine');
  layout(html`
    <div class="card">
      <h2>Ricariche</h2>
      <div class="grid">
        <select id="r_col">
          ${(cols.items||[]).map(c=>`<option value="${c.id}">${c.indirizzo}</option>`).join('')}
        </select>
        <input id="r_ini" type="datetime-local">
        <input id="r_fine" type="datetime-local">
        <input id="r_kwh" type="number" step="0.1" placeholder="kWh">
        <button onclick="addRic()" class="primary">Registra</button>
      </div>
      <table>
        <thead><tr><th>ID</th><th>Colonnina</th><th>Inizio</th><th>Fine</th><th>kWh</th></tr></thead>
        <tbody>${(data.items||[]).map(r=>`
          <tr><td>${r.id}</td><td>${r.colonnina_id}</td><td>${r.inizio}</td><td>${r.fine||''}</td><td>${r.energia_kWh||''}</td></tr>
        `).join('')}</tbody>
      </table>
    </div>
  `);
}
async function addRic(){
  const btn = event.target;
  await withBusy(btn, async ()=>{
    const body = {
      colonnina_id: num('r_col'), inizio: val('r_ini'), fine: val('r_fine'), energia_kWh: num('r_kwh')
    };
    const res = await api('/api/ricariche',{method:'POST', body: JSON.stringify(body)});
    if(res.success){ toast('Ricarica registrata con successo'); await Ricariche(); }
    else toast('Errore registrazione ricarica', true);
  });
}


function toast(msg, isError=false){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (isError ? 'error' : '');
  requestAnimationFrame(()=> t.classList.add('show'));
  setTimeout(()=> t.classList.remove('show'), 2500);
}
function withBusy(btn, fn){
  const old = btn.innerHTML;
  btn.classList.add('btn-wait');
  btn.innerHTML = `<span class="spinner"></span> ${old}`;
  return Promise.resolve()
    .then(fn)
    .finally(()=>{
      btn.classList.remove('btn-wait');
      btn.innerHTML = old;
    });
}

function val(id){ return document.getElementById(id).value }
function num(id){ return document.getElementById(id).value ? Number(document.getElementById(id).value) : null }

Router.start();
