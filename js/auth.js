/* =========================================================
   auth.js · Inicio de sesión local (sin servidor)
   - Las contraseñas se guardan como hash SHA-256 con "sal" aleatoria.
   - La sesión activa vive en IndexedDB, así funciona también offline.
   ========================================================= */

import { Users, Session } from './db.js';

/*
 * Cuenta inicial para evaluación. NO se guarda la contraseña en texto plano:
 * solo su "sal" y su hash SHA-256 (sha256(salt + contraseña)).
 * Las credenciales se entregan por separado (README / documento de entrega).
 */
const SEED_USER = {
  name: 'Usuario Demo',
  email: 'demo@reportaya.mx',
  salt: 'f621770f71dce8c115779b1226a302fa',
  passwordHash: '68e14e8bf08f41b36baeb484ac6534f72dfdd79f95d09a35b747eadaef4c5415',
};

let currentUser = null;

/** Hash SHA-256 en hexadecimal (Web Crypto API). */
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/** Crea la cuenta inicial la primera vez que se abre la app. */
export async function seedDemoUser() {
  const exists = await Users.get(SEED_USER.email);
  if (exists) return;
  await Users.add({ ...SEED_USER, createdAt: Date.now() });
}

/** Registra un usuario nuevo. Lanza Error con mensaje legible si algo falla. */
export async function register({ name, email, password }) {
  email = normalizeEmail(email);
  name = String(name || '').trim();

  if (name.length < 3) throw new Error('El nombre debe tener al menos 3 caracteres.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo válido.');
  if (password.length < 8 || !/\d/.test(password) || !/[a-zA-Z]/.test(password)) {
    throw new Error('La contraseña debe tener mínimo 8 caracteres, con letras y números.');
  }
  if (await Users.get(email)) throw new Error('Ya existe una cuenta con ese correo.');

  const salt = randomSalt();
  await Users.add({ email, name, salt, passwordHash: await sha256(salt + password), createdAt: Date.now() });
  await Session.set(email);
  currentUser = { email, name };
  return currentUser;
}

/** Inicia sesión validando el hash de la contraseña. */
export async function login(email, password) {
  email = normalizeEmail(email);
  const user = await Users.get(email);
  // Mensaje genérico para no revelar si el correo existe
  const fail = new Error('Correo o contraseña incorrectos.');
  if (!user) throw fail;
  const hash = await sha256(user.salt + password);
  if (hash !== user.passwordHash) throw fail;

  await Session.set(email);
  currentUser = { email: user.email, name: user.name };
  return currentUser;
}

export async function logout() {
  await Session.clear();
  currentUser = null;
}

/** Recupera la sesión guardada (si existe) al abrir la app. */
export async function restoreSession() {
  const session = await Session.get();
  if (!session) return null;
  const user = await Users.get(session.email);
  if (!user) { await Session.clear(); return null; }
  currentUser = { email: user.email, name: user.name };
  return currentUser;
}

export const getUser = () => currentUser;
