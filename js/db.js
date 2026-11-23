/* =========================================================
   db.js · Persistencia local con IndexedDB
   Almacenes:
     - users    (keyPath: email)          → cuentas de usuario
     - session  (keyPath: key)            → sesión activa
     - reports  (keyPath: id, autoInc)    → reportes de incidencias
   Todas las operaciones son asíncronas y devuelven Promesas.
   ========================================================= */

const DB_NAME = 'reportaya-db';
const DB_VERSION = 1;

let dbPromise = null;

/** Convierte una IDBRequest en Promesa. */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Abre (o crea / migra) la base de datos. */
export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador no soporta IndexedDB.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Migraciones por versión
      if (event.oldVersion < 1) {
        db.createObjectStore('users', { keyPath: 'email' });
        db.createObjectStore('session', { keyPath: 'key' });

        const reports = db.createObjectStore('reports', { keyPath: 'id', autoIncrement: true });
        reports.createIndex('byUser', 'userEmail', { unique: false });
        reports.createIndex('byStatus', 'status', { unique: false });
        reports.createIndex('byCreated', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña actualiza la versión, cerramos para no bloquearla
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('[DB] Apertura bloqueada por otra pestaña.');
  });

  return dbPromise;
}

/** Ejecuta una operación dentro de una transacción y espera a que termine. */
async function tx(storeName, mode, operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    Promise.resolve(operation(store))
      .then((r) => { result = r; })
      .catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transacción abortada'));
  });
}

/* ---------------------- Usuarios ---------------------- */

export const Users = {
  get: (email) => tx('users', 'readonly', (s) => promisify(s.get(email))),
  add: (user) => tx('users', 'readwrite', (s) => promisify(s.add(user))),
  put: (user) => tx('users', 'readwrite', (s) => promisify(s.put(user))),
  count: () => tx('users', 'readonly', (s) => promisify(s.count())),
};

/* ---------------------- Sesión ---------------------- */

export const Session = {
  get: () => tx('session', 'readonly', (s) => promisify(s.get('current'))),
  set: (email) => tx('session', 'readwrite', (s) => promisify(s.put({ key: 'current', email, startedAt: Date.now() }))),
  clear: () => tx('session', 'readwrite', (s) => promisify(s.delete('current'))),
};

/* ---------------------- Reportes ---------------------- */

export const Reports = {
  /** Crea un reporte y devuelve su id. */
  add(report) {
    const now = Date.now();
    const data = { status: 'pendiente', ...report, createdAt: now, updatedAt: now };
    return tx('reports', 'readwrite', (s) => promisify(s.add(data)));
  },

  get: (id) => tx('reports', 'readonly', (s) => promisify(s.get(Number(id)))),

  /** Actualiza campos de un reporte existente. */
  async update(id, changes) {
    return tx('reports', 'readwrite', async (s) => {
      const current = await promisify(s.get(Number(id)));
      if (!current) throw new Error('Reporte no encontrado');
      const updated = { ...current, ...changes, updatedAt: Date.now() };
      await promisify(s.put(updated));
      return updated;
    });
  },

  remove: (id) => tx('reports', 'readwrite', (s) => promisify(s.delete(Number(id)))),

  /** Todos los reportes de un usuario, del más reciente al más antiguo. */
  async listByUser(email) {
    const rows = await tx('reports', 'readonly', (s) => promisify(s.index('byUser').getAll(email)));
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  /** Consulta con filtros (texto, estado, categoría). */
  async query(email, { text = '', status = '', category = '' } = {}) {
    const all = await Reports.listByUser(email);
    const q = text.trim().toLowerCase();
    return all.filter((r) =>
      (!status || r.status === status) &&
      (!category || r.category === category) &&
      (!q || `${r.title} ${r.description} ${r.address || ''}`.toLowerCase().includes(q))
    );
  },
};
