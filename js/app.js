import { openDB, Reports } from './db.js';
import { seedDemoUser, login, register, logout, restoreSession, getUser } from './auth.js';
import { Camera, Geo, Notify, getPermissionState, compressImageFile, vibrate } from './native.js';
import { miniMapHTML, mapsLink } from './minimap.js';

/* ---------------------- Catálogos ---------------------- */
export const CATEGORIES = [
  'Bache', 'Alumbrado público', 'Basura acumulada', 'Fuga de agua',
  'Banqueta dañada', 'Semáforo', 'Árbol caído', 'Otro',
];

const STATUS = {
  pendiente: { label: 'Pendiente', cls: 'badge--pendiente' },
  proceso: { label: 'En proceso', cls: 'badge--proceso' },
  resuelto: { label: 'Resuelto', cls: 'badge--resuelto' },
};

/* ---------------------- Utilidades ---------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const appEl = $('#app');
const shellEl = $('#shell');
const navEl = $('#mainNav');

const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const fmtDate = (ts) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(ts);

const icons = {
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16"/></svg>',
  inbox: '<svg viewBox="0 0 24 24"><path d="M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  progress: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

/* Paso numerado del formulario "Nuevo reporte" (solo presentación) */
const stepHead = (n, title, hint) => `
  <header class="step__head">
    <span class="step__num" aria-hidden="true"><span>${n}</span></span>
    <div><h2><span class="sr-only">Paso ${n}: </span>${title}</h2><p class="step__hint">${hint}</p></div>
  </header>`;

/** Avisos tipo toast. action = { label, onClick } opcional. */
export function toast(message, type = 'ok', action = null, ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.onclick = () => { action.onClick(); el.remove(); };
    el.appendChild(btn);
  }
  $('#toasts').appendChild(el);
  if (!action) setTimeout(() => el.remove(), ms);
}

/* Las URLs de objeto (fotos) se liberan al cambiar de vista */
let objectUrls = [];
function blobUrl(blob) {
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}
function releaseViewResources() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
  Camera.stop();
}

/* =========================================================
   SERVICE WORKER
   ========================================================= */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] No soportado en este navegador.');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.info('[SW] Registrado con alcance:', reg.scope);

    // Si ya hay una versión nueva esperando, avisar
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          promptUpdate(newWorker);
        }
      });
    });

    // Cuando el nuevo SW toma el control, recargamos una sola vez
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });

    // Buscar actualizaciones cada hora mientras la app esté abierta
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  } catch (err) {
    console.error('[SW] Error al registrar:', err);
  }
}

function promptUpdate(worker) {
  toast('Hay una nueva versión disponible.', 'warn', {
    label: 'Actualizar',
    onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
  });
}

/* =========================================================
   INSTALACIÓN (prompt personalizado)
   ========================================================= */

let deferredInstall = null;
const btnInstall = $('#btnInstall');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // Evita la mini barra automática
  deferredInstall = e;         // Guardamos el evento para usarlo con nuestro botón
  btnInstall.classList.remove('hidden');
});

btnInstall.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') toast('¡Instalando ReportaYa!');
  deferredInstall = null;
  btnInstall.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  btnInstall.classList.add('hidden');
  deferredInstall = null;
  toast('ReportaYa se instaló en tu dispositivo.');
});

/* =========================================================
   ESTADO DE RED
   ========================================================= */

function updateNetworkStatus(showToast = false) {
  const pill = $('#netStatus');
  const online = navigator.onLine;
  pill.textContent = online ? 'En línea' : 'Sin conexión';
  pill.classList.toggle('offline', !online);
  if (showToast) {
    online
      ? toast('Conexión restablecida.')
      : toast('Sin conexión: puedes seguir creando y consultando reportes.', 'warn');
  }
}
window.addEventListener('online', () => updateNetworkStatus(true));
window.addEventListener('offline', () => updateNetworkStatus(true));

/* =========================================================
   ENRUTADOR (hash) + CSR
   ========================================================= */

const routes = {
  login: { view: viewLogin, public: true },
  registro: { view: viewRegister, public: true },
  inicio: { view: viewHome },
  reportes: { view: viewList },
  nuevo: { view: viewNew },
  reporte: { view: viewDetail },
  ajustes: { view: viewSettings },
};

function parseHash() {
  const [name = '', param] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, param };
}

async function router() {
  releaseViewResources();
  let { name, param } = parseHash();
  const user = getUser();

  if (!routes[name]) name = user ? 'inicio' : 'login';
  if (!routes[name].public && !user) { location.hash = '#/login'; return; }
  if (routes[name].public && user) { location.hash = '#/inicio'; return; }

  // El shell muestra la navegación solo con sesión iniciada
  navEl.classList.toggle('hidden', !user);
  shellEl.classList.toggle('no-nav', !user);
  navEl.querySelectorAll('a').forEach((a) => {
    const active = a.dataset.route === name || (name === 'reporte' && a.dataset.route === 'reportes');
    a.classList.toggle('active', active);
    a.toggleAttribute('aria-current', active);
  });

  try {
    await routes[name].view(param);
  } catch (err) {
    console.error(err);
    appEl.innerHTML = `<div class="card"><h2>Algo salió mal</h2><p class="muted">${esc(err.message)}</p>
      <a class="btn" href="#/inicio">Volver al inicio</a></div>`;
  }
  appEl.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', router);

/* =========================================================
   VISTAS
   ========================================================= */

/* ---------- Login ---------- */
function viewLogin() {
  document.title = 'Iniciar sesión · ReportaYa';
  appEl.innerHTML = `
    <section class="auth">
      <div class="auth__box card">
        <div class="auth__hero">
          <img src="icons/icon-192.png" width="56" height="56" alt="Logotipo de ReportaYa">
          <h1>Iniciar sesión</h1>
          <p class="subtitle">Reporta incidencias de tu ciudad, incluso sin internet.</p>
        </div>
        <form class="stack" id="loginForm" novalidate>
          <div class="field">
            <label for="email">Correo electrónico</label>
            <input id="email" name="email" type="email" autocomplete="username" placeholder="nombre@correo.com" required>
          </div>
          <div class="field">
            <label for="password">Contraseña</label>
            <input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
          </div>
          <p class="form-error" id="loginError" role="alert"></p>
          <button class="btn btn--block" type="submit">Iniciar sesión</button>
        </form>
        <p class="auth__footer">¿No tienes cuenta? <a href="#/registro">Regístrate</a></p>
      </div>
    </section>`;

  const form = $('#loginForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    $('#loginError').textContent = '';
    try {
      const user = await login(form.email.value, form.password.value);
      toast(`Hola, ${user.name}`);
      location.hash = '#/inicio';
    } catch (err) {
      $('#loginError').textContent = err.message;
      btn.disabled = false;
    }
  };
}

/* ---------- Registro ---------- */
function viewRegister() {
  document.title = 'Crear cuenta · ReportaYa';
  appEl.innerHTML = `
    <section class="auth">
      <div class="auth__box card">
        <div class="auth__hero">
          <img src="icons/icon-192.png" width="56" height="56" alt="Logotipo de ReportaYa">
          <h1>Crear cuenta</h1>
          <p class="subtitle">Tus datos se guardan solo en este dispositivo.</p>
        </div>
        <form class="stack" id="regForm" novalidate>
          <div class="field"><label for="name">Nombre completo</label>
            <input id="name" name="name" type="text" autocomplete="name" required></div>
          <div class="field"><label for="email">Correo electrónico</label>
            <input id="email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="password">Contraseña</label>
            <input id="password" name="password" type="password" autocomplete="new-password" aria-describedby="pwdHint" required>
            <span class="hint" id="pwdHint">Mínimo 8 caracteres, con letras y números.</span></div>
          <p class="form-error" id="regError" role="alert"></p>
          <button class="btn btn--block" type="submit">Crear cuenta</button>
        </form>
        <p class="auth__footer">¿Ya tienes cuenta? <a href="#/login">Inicia sesión</a></p>
      </div>
    </section>`;

  const form = $('#regForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    $('#regError').textContent = '';
    try {
      await register({ name: form.name.value, email: form.email.value, password: form.password.value });
      toast('Cuenta creada. ¡Bienvenido!');
      location.hash = '#/inicio';
    } catch (err) {
      $('#regError').textContent = err.message;
      btn.disabled = false;
    }
  };
}

/* ---------- Inicio (dashboard) ---------- */
async function viewHome() {
  document.title = 'Inicio · ReportaYa';
  const user = getUser();
  const reports = await Reports.listByUser(user.email);
  const count = (s) => reports.filter((r) => r.status === s).length;

  const byCat = CATEGORIES
    .map((c) => ({ c, n: reports.filter((r) => r.category === c).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const maxCat = Math.max(1, ...byCat.map((x) => x.n));

  appEl.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Hola, ${esc(user.name.split(' ')[0])}</h1>
        <p class="subtitle">Resumen de tus reportes de incidencias.</p>
      </div>
      <a class="btn btn--accent" href="#/nuevo">${icons.camera} Nuevo reporte</a>
    </div>

    <div class="stats">
      <div class="card stat"><span class="stat__icon" aria-hidden="true">${icons.inbox}</span><div class="stat__num">${reports.length}</div><div class="stat__label">Total</div></div>
      <div class="card stat stat--pend"><span class="stat__icon" aria-hidden="true">${icons.clock}</span><div class="stat__num">${count('pendiente')}</div><div class="stat__label">Pendientes</div></div>
      <div class="card stat stat--proc"><span class="stat__icon" aria-hidden="true">${icons.progress}</span><div class="stat__num">${count('proceso')}</div><div class="stat__label">En proceso</div></div>
      <div class="card stat stat--res"><span class="stat__icon" aria-hidden="true">${icons.check}</span><div class="stat__num">${count('resuelto')}</div><div class="stat__label">Resueltos</div></div>
    </div>

    <div class="dash-grid">
      <section class="card">
        <div class="card__head">
          <h2>Reportes recientes</h2>
          <a class="card__link" href="#/reportes">Ver todos</a>
        </div>
        ${reports.length
          ? `<div class="recent-list">${reports.slice(0, 3).map(reportCard).join('')}</div>`
          : emptyState('Aún no tienes reportes', 'Toma una foto de una incidencia y repórtala en segundos.')}
      </section>
      <section class="card">
        <div class="card__head">
          <h2>Por categoría</h2>
          ${byCat.length ? `<span class="card__meta">${reports.length} en total</span>` : ''}
        </div>
        ${byCat.length
          ? `<ul class="cat-bars">${byCat.map(({ c, n }) => `
              <li class="cat-bar">
                <div class="cat-bar__top"><span class="cat-bar__name">${esc(c)}</span><span class="cat-bar__val"><strong>${n}</strong> · ${Math.round((n / reports.length) * 100)}%</span></div>
                <div class="cat-bar__track" aria-hidden="true"><div class="cat-bar__fill" style="width:${(n / reports.length) * 100}%"></div></div>
              </li>`).join('')}</ul>`
          : '<p class="card__empty">Las estadísticas aparecerán cuando registres reportes.</p>'}
      </section>
    </div>`;
}

function emptyState(title, text) {
  return `<div class="empty">
    <span class="empty__icon" aria-hidden="true">${icons.inbox}</span>
    <p class="empty__title">${esc(title)}</p>
    <p class="empty__text">${esc(text)}</p>
    <a class="btn btn--accent" href="#/nuevo">${icons.camera} Crear reporte</a></div>`;
}

function reportCard(r) {
  const st = STATUS[r.status] || STATUS.pendiente;
  const thumb = r.photo
    ? `<img class="report-card__img" src="${blobUrl(r.photo)}" alt="">`
    : `<div class="report-card__img">${icons.image}</div>`;
  return `
    <a class="report-card" href="#/reporte/${r.id}">
      ${thumb}
      <div class="report-card__body">
        <span class="report-card__title">${esc(r.title)}</span>
        <div class="badges">
          <span class="badge ${st.cls}">${st.label}</span>
          <span class="badge badge--cat">${esc(r.category)}</span>
        </div>
        <span class="report-card__meta">
          <span>${fmtDate(r.createdAt)}</span>
          ${r.location ? `<span class="report-card__loc" title="Con ubicación">${icons.pin}<span class="sr-only">· con ubicación</span></span>` : ''}
        </span>
      </div>
    </a>`;
}

/* ---------- Lista con filtros ---------- */
async function viewList() {
  document.title = 'Mis reportes · ReportaYa';
  appEl.innerHTML = `
    <div class="page-head">
      <div><h1>Mis reportes</h1><p class="subtitle" id="listCount">Cargando…</p></div>
      <a class="btn btn--accent" href="#/nuevo">${icons.camera} Nuevo</a>
    </div>
    <div class="filters">
      <div class="search">${icons.search}<input type="search" id="fText" placeholder="Buscar por título, descripción o referencia…" aria-label="Buscar"></div>
      <select id="fStatus" aria-label="Filtrar por estado">
        <option value="">Todos los estados</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
      </select>
      <select id="fCat" aria-label="Filtrar por categoría">
        <option value="">Todas las categorías</option>
        ${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div id="listBox"></div>`;

  const render = async () => {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
    const results = await Reports.query(getUser().email, {
      text: $('#fText').value, status: $('#fStatus').value, category: $('#fCat').value,
    });
    $('#listCount').textContent = `${results.length} reporte${results.length === 1 ? '' : 's'}`;
    $('#listBox').innerHTML = results.length
      ? `<div class="report-list">${results.map(reportCard).join('')}</div>`
      : emptyState('Sin resultados', 'No hay reportes que coincidan con los filtros.');
  };

  let t;
  $('#fText').oninput = () => { clearTimeout(t); t = setTimeout(render, 200); };
  $('#fStatus').onchange = render;
  $('#fCat').onchange = render;
  await render();
}

/* ---------- Nuevo reporte (Cámara + GPS + Notificación) ---------- */
function viewNew() {
  document.title = 'Nuevo reporte · ReportaYa';
  let photo = null;
  let coords = null;

  appEl.innerHTML = `
    <div class="page-head">
      <div><h1>Nuevo reporte</h1><p class="subtitle">Foto, ubicación y una breve descripción.</p></div>
    </div>

    <ol class="stepper" aria-hidden="true">
      <li class="stepper__item stepper__item--foto"><span class="stepper__dot">1</span><span>Foto</span></li>
      <li class="stepper__item stepper__item--loc"><span class="stepper__dot">2</span><span>Ubicación</span></li>
      <li class="stepper__item stepper__item--det"><span class="stepper__dot">3</span><span>Detalles</span></li>
    </ol>

    <form id="newForm" class="form-grid form-grid--2" novalidate>
      <!-- Columna 1: evidencia -->
      <div class="stack">
        <section class="card step capture">
          ${stepHead(1, 'Foto de evidencia', 'Usa la cámara o sube una imagen.')}
          <div class="camera-box" id="camBox">
            <div class="camera-box__placeholder">${icons.camera}<span>Abre la cámara o sube una foto de la incidencia.</span></div>
          </div>
          <div class="capture__actions">
            <button class="btn" type="button" id="btnCam">${icons.camera} Abrir cámara</button>
            <button class="btn btn--accent hidden" type="button" id="btnShot">Tomar foto</button>
            <label class="btn btn--outline" for="fileInput">${icons.upload} Subir foto</label>
            <input class="sr-only" type="file" id="fileInput" accept="image/*" capture="environment">
          </div>
          <p class="form-error" id="camError" role="alert"></p>
        </section>

        <section class="card step loc-box">
          ${stepHead(2, 'Ubicación', 'Adjunta las coordenadas GPS del lugar.')}
          <div class="loc-status" id="locStatus">Aún no se ha obtenido la ubicación.</div>
          <div id="locMap"></div>
          <button class="btn btn--outline" type="button" id="btnLoc">${icons.pin} Obtener mi ubicación</button>
        </section>
      </div>

      <!-- Columna 2: datos -->
      <section class="card step step--details">
        ${stepHead(3, 'Detalles', 'Describe la incidencia para darle seguimiento.')}
        <div class="field"><label for="title">Título</label>
          <input id="title" name="title" type="text" minlength="5" maxlength="80" placeholder="Ej. Bache profundo frente a la escuela" required></div>
        <div class="field"><label for="category">Categoría</label>
          <select id="category" name="category" required>
            <option value="">Selecciona…</option>
            ${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="address">Referencia o dirección <span class="muted">(opcional)</span></label>
          <input id="address" name="address" type="text" maxlength="120" placeholder="Calle, colonia, entre calles…"></div>
        <div class="field"><label for="description">Descripción</label>
          <textarea id="description" name="description" minlength="10" maxlength="500" placeholder="Describe el problema y desde cuándo existe." required></textarea></div>
        <p class="form-error" id="formError" role="alert"></p>
        <button class="btn btn--accent btn--block btn--lg" type="submit">Guardar reporte</button>
        <p class="form-note">Se guarda en tu dispositivo, aunque no tengas internet.</p>
      </section>
    </form>`;

  const camBox = $('#camBox');
  const camError = $('#camError');

  const showPhoto = (blob) => {
    photo = blob;
    Camera.stop();
    camBox.innerHTML = `<img src="${blobUrl(blob)}" alt="Foto capturada">`;
    $('#btnShot').classList.add('hidden');
    $('#btnCam').innerHTML = `${icons.camera} Tomar otra`;
  };

  // Cámara en vivo
  $('#btnCam').onclick = async () => {
    camError.textContent = '';
    camBox.innerHTML = '<video autoplay playsinline muted></video>';
    try {
      await Camera.start($('video', camBox));
      $('#btnShot').classList.remove('hidden');
    } catch (err) {
      camBox.innerHTML = `<div class="camera-box__placeholder">${icons.camera}<span>Cámara no disponible</span></div>`;
      camError.textContent = err.message;
    }
  };

  $('#btnShot').onclick = async () => {
    try {
      showPhoto(await Camera.capture($('video', camBox)));
      vibrate(60);
    } catch (err) { camError.textContent = err.message; }
  };

  // Respaldo: elegir / capturar desde archivo
  $('#fileInput').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    camError.textContent = '';
    try { showPhoto(await compressImageFile(file)); } catch (err) { camError.textContent = err.message; }
  };

  // Geolocalización
  $('#btnLoc').onclick = async () => {
    const box = $('#locStatus');
    const btn = $('#btnLoc');
    box.className = 'loc-status';
    box.textContent = 'Buscando tu ubicación…';
    btn.disabled = true;
    try {
      coords = await Geo.getPosition();
      box.className = 'loc-status ok';
      box.innerHTML = `Ubicación obtenida: <strong>${coords.lat}, ${coords.lng}</strong> (precisión ±${coords.accuracy} m)`;
      $('#locMap').innerHTML = miniMapHTML(coords.lat, coords.lng);
      btn.innerHTML = `${icons.pin} Actualizar ubicación`;
    } catch (err) {
      box.className = 'loc-status err';
      box.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };

  // Guardar
  $('#newForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#formError');
    err.textContent = '';

    const data = {
      title: f.title.value.trim(),
      category: f.category.value,
      address: f.address.value.trim(),
      description: f.description.value.trim(),
    };
    if (data.title.length < 5) return (err.textContent = 'El título debe tener al menos 5 caracteres.');
    if (!data.category) return (err.textContent = 'Selecciona una categoría.');
    if (data.description.length < 10) return (err.textContent = 'Agrega una descripción (mínimo 10 caracteres).');
    if (!photo && !coords) return (err.textContent = 'Agrega al menos una foto o la ubicación como evidencia.');

    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const id = await Reports.add({ ...data, photo, location: coords, userEmail: getUser().email });
      vibrate([80, 40, 80]);
      const notified = await Notify.show('Reporte guardado', {
        body: `“${data.title}” se registró como pendiente.`,
        url: `./#/reporte/${id}`,
        tag: `reporte-${id}`,
      });
      toast(notified ? 'Reporte guardado.' : 'Reporte guardado. Activa las notificaciones en Perfil para recibir avisos.');
      location.hash = `#/reporte/${id}`;
    } catch (e2) {
      err.textContent = 'No se pudo guardar: ' + e2.message;
      btn.disabled = false;
    }
  };
}

/* ---------- Detalle ---------- */
async function viewDetail(id) {
  const r = await Reports.get(id);
  if (!r || r.userEmail !== getUser().email) {
    appEl.innerHTML = `<div class="card">${emptyState('Reporte no encontrado', 'Puede que haya sido eliminado.')}</div>`;
    return;
  }
  document.title = `${r.title} · ReportaYa`;
  const st = STATUS[r.status] || STATUS.pendiente;

  appEl.innerHTML = `
    <a class="back-link" href="#/reportes">${icons.back} Mis reportes</a>
    <div class="page-head page-head--detail">
      <div>
        <h1>${esc(r.title)}</h1>
        <div class="badges"><span class="badge ${st.cls}">${st.label}</span><span class="badge badge--cat">${esc(r.category)}</span></div>
      </div>
    </div>

    <div class="detail">
      <div class="stack">
        <div class="detail__photo${r.photo ? '' : ' detail__photo--empty'}">${r.photo
          ? `<img src="${blobUrl(r.photo)}" alt="Foto de la incidencia">`
          : `${icons.image}<span>Sin foto de evidencia</span>`}</div>
        ${r.location ? miniMapHTML(r.location.lat, r.location.lng) : ''}
      </div>

      <div class="stack">
        <section class="card">
          <h2>Información</h2>
          <dl class="kv">
            <dt>Descripción</dt><dd>${esc(r.description)}</dd>
            ${r.address ? `<dt>Referencia</dt><dd>${esc(r.address)}</dd>` : ''}
            <dt>Ubicación</dt><dd>${r.location
              ? `<span class="coords">${r.location.lat}, ${r.location.lng}</span> <span class="muted">(±${r.location.accuracy} m)</span><br><a href="${mapsLink(r.location.lat, r.location.lng)}" target="_blank" rel="noopener">Abrir en el mapa</a>`
              : '<span class="muted">Sin ubicación</span>'}</dd>
            <dt>Creado</dt><dd>${fmtDate(r.createdAt)}</dd>
            <dt>Actualizado</dt><dd>${fmtDate(r.updatedAt)}</dd>
          </dl>
        </section>

        <section class="card">
          <h2>Estado del reporte</h2>
          <div class="status-switch" role="group" aria-label="Cambiar estado">
            ${Object.entries(STATUS).map(([k, v]) => `<button type="button" data-status="${k}" aria-pressed="${r.status === k}">${v.label}</button>`).join('')}
          </div>
        </section>

        <div class="detail__actions">
          ${navigator.share ? `<button class="btn btn--outline" id="btnShare" type="button">${icons.share} Compartir</button>` : ''}
          <button class="btn btn--danger" id="btnDelete" type="button">${icons.trash} Eliminar</button>
        </div>
      </div>
    </div>`;

  appEl.querySelectorAll('[data-status]').forEach((b) => {
    b.onclick = async () => {
      const status = b.dataset.status;
      if (status === r.status) return;
      await Reports.update(r.id, { status });
      vibrate(40);
      if (status === 'resuelto') {
        await Notify.show('¡Incidencia resuelta!', { body: `“${r.title}” se marcó como resuelta.`, url: `./#/reporte/${r.id}`, tag: `reporte-${r.id}` });
      }
      toast(`Estado actualizado a “${STATUS[status].label}”.`);
      viewDetail(r.id); // re-render en tiempo real
    };
  });

  $('#btnShare')?.addEventListener('click', async () => {
    const text = `${r.title} (${r.category})\n${r.description}${r.location ? `\n${mapsLink(r.location.lat, r.location.lng)}` : ''}`;
    try {
      const file = r.photo ? new File([r.photo], `reporte-${r.id}.jpg`, { type: 'image/jpeg' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ title: r.title, text, files: [file] });
      else await navigator.share({ title: r.title, text });
    } catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir.', 'err'); }
  });

  $('#btnDelete').onclick = async () => {
    const btn = $('#btnDelete');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.innerHTML = `${icons.trash} Confirmar eliminación`;
      setTimeout(() => { if (btn.isConnected) { btn.dataset.confirm = ''; btn.innerHTML = `${icons.trash} Eliminar`; } }, 4000);
      return;
    }
    await Reports.remove(r.id);
    toast('Reporte eliminado.');
    location.hash = '#/reportes';
  };
}

/* ---------- Perfil y permisos ---------- */
async function viewSettings() {
  document.title = 'Perfil · ReportaYa';
  const user = getUser();
  const reports = await Reports.listByUser(user.email);
  let storageInfo = '';
  if (navigator.storage?.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    storageInfo = `${(usage / 1048576).toFixed(1)} MB usados de ${(quota / 1048576).toFixed(0)} MB disponibles`;
  }

  const stateLabel = { granted: 'Permitido', denied: 'Bloqueado', prompt: 'Sin decidir', unsupported: 'No soportado' };
  const perms = [
    { key: 'camera', icon: icons.camera, title: 'Cámara', desc: 'Tomar fotos de evidencia.' },
    { key: 'geolocation', icon: icons.pin, title: 'Ubicación (GPS)', desc: 'Adjuntar coordenadas al reporte.' },
    { key: 'notifications', icon: icons.bell, title: 'Notificaciones', desc: 'Avisos al guardar o resolver reportes.' },
  ];
  const states = await Promise.all(perms.map((p) => getPermissionState(p.key)));

  appEl.innerHTML = `
    <div class="page-head"><div><h1>Perfil</h1><p class="subtitle">Tu cuenta, permisos y datos guardados en este dispositivo.</p></div></div>

    <section class="card profile">
      <span class="avatar" aria-hidden="true">${esc(user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>
      <div class="profile__info">
        <p class="profile__name">${esc(user.name)}</p>
        <p class="profile__email">${esc(user.email)}</p>
      </div>
      <div class="profile__count"><strong>${reports.length}</strong><span>reportes</span></div>
    </section>

    <div class="dash-grid">
      <section class="card">
        <h2>Permisos del dispositivo</h2>
        <div class="perm-list">
          ${perms.map((p, i) => `
            <div class="perm">
              <div class="perm__info">${p.icon}<div><strong>${p.title}</strong><div class="perm__desc">${p.desc}</div></div></div>
              <div class="perm__actions">
                <span class="perm__state ${states[i]}">${stateLabel[states[i]]}</span>
                ${states[i] === 'prompt' ? `<button class="btn btn--sm btn--outline" data-perm="${p.key}" type="button">Permitir</button>` : ''}
              </div>
            </div>`).join('')}
        </div>
        ${states.includes('denied') ? '<p class="card__note">Para desbloquear un permiso, toca el candado junto a la dirección del sitio y cámbialo a “Permitir”.</p>' : ''}
        ${states[2] === 'granted' ? `<button class="btn btn--outline btn--sm" id="btnTestNotif" type="button">${icons.bell} Enviar notificación de prueba</button>` : ''}
      </section>

      <section class="card stack">
        <h2>Datos locales</h2>
        <p class="card__note">Tienes <strong>${reports.length}</strong> reportes guardados en IndexedDB.${storageInfo ? `<br>${storageInfo}.` : ''}</p>
        <button class="btn btn--outline" id="btnSample" type="button">Agregar reportes de ejemplo</button>
        <div class="session-zone">
          <button class="btn btn--danger btn--block" id="btnLogout" type="button">${icons.logout} Cerrar sesión</button>
        </div>
      </section>
    </div>`;

  appEl.querySelectorAll('[data-perm]').forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.perm;
      try {
        if (key === 'notifications') {
          const res = await Notify.requestPermission();
          if (res === 'granted') await Notify.show('Notificaciones activadas', { body: 'Te avisaremos sobre tus reportes.' });
          else if (res === 'denied') toast('Rechazaste las notificaciones. Puedes activarlas desde el candado del navegador.', 'warn');
        } else if (key === 'geolocation') {
          await Geo.getPosition();
          toast('Ubicación permitida.');
        } else if (key === 'camera') {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          s.getTracks().forEach((t) => t.stop());
          toast('Cámara permitida.');
        }
      } catch (err) {
        toast(err.message || 'Permiso no concedido.', 'err');
      }
      viewSettings();
    };
  });

  $('#btnTestNotif')?.addEventListener('click', () =>
    Notify.show('Notificación de prueba', { body: 'Las notificaciones de ReportaYa funcionan correctamente.' }));

  $('#btnSample').onclick = async () => {
    await addSampleReports(user.email);
    toast('Se agregaron 4 reportes de ejemplo.');
    viewSettings();
  };

  $('#btnLogout').onclick = async () => {
    await logout();
    toast('Sesión cerrada.');
    location.hash = '#/login';
  };
}

/* Datos de ejemplo (Ciudad de México) para demostraciones */
async function addSampleReports(email) {
  const samples = [
    { title: 'Bache profundo en carril derecho', category: 'Bache', status: 'pendiente', address: 'Av. Insurgentes Sur y Félix Cuevas, Col. Del Valle', description: 'Bache de aprox. 60 cm de diámetro que ya ponchó llantas de varios autos.', location: { lat: 19.373289, lng: -99.178364, accuracy: 12 } },
    { title: 'Luminaria apagada en parque', category: 'Alumbrado público', status: 'proceso', address: 'Parque Hundido, acceso por Av. Porfirio Díaz', description: 'Tres postes de luz apagados desde hace una semana, la zona queda muy oscura de noche.', location: { lat: 19.378543, lng: -99.180112, accuracy: 18 } },
    { title: 'Fuga de agua en banqueta', category: 'Fuga de agua', status: 'resuelto', address: 'Calle Pilares 512, Col. Del Valle', description: 'Sale agua limpia de una grieta en la banqueta de forma constante.', location: { lat: 19.370021, lng: -99.168954, accuracy: 9 } },
    { title: 'Basura acumulada en esquina', category: 'Basura acumulada', status: 'pendiente', address: 'Eje 7 Sur y Av. Coyoacán', description: 'Bolsas de basura acumuladas desde hace varios días, hay mal olor.', location: { lat: 19.374505, lng: -99.164321, accuracy: 15 } },
  ];
  for (const s of samples) await Reports.add({ ...s, photo: null, userEmail: email });
}

/* =========================================================
   ARRANQUE
   ========================================================= */

async function init() {
  updateNetworkStatus();
  registerServiceWorker();
  try {
    await openDB();
    await seedDemoUser();
    await restoreSession();
  } catch (err) {
    appEl.innerHTML = `<div class="card"><h2>No se pudo iniciar</h2><p class="muted">${esc(err.message)}</p></div>`;
    return;
  }
  router();
}

init();
