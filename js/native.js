/* =========================================================
   native.js · Web APIs nativas del dispositivo
     1. Cámara        → MediaDevices.getUserMedia (+ respaldo <input capture>)
     2. Geolocalización → navigator.geolocation
     3. Notificaciones → Notification API + ServiceWorkerRegistration.showNotification
   Extra: Permissions API para consultar estados y Vibration API.
   Cada función valida soporte, pide permiso y maneja el rechazo.
   ========================================================= */

/* ---------------- Permisos (consulta) ---------------- */

/**
 * Devuelve 'granted' | 'denied' | 'prompt' | 'unsupported'.
 * name: 'camera' | 'geolocation' | 'notifications'
 */
export async function getPermissionState(name) {
  if (name === 'notifications') {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  }
  if (name === 'camera' && !navigator.mediaDevices?.getUserMedia) return 'unsupported';
  if (name === 'geolocation' && !('geolocation' in navigator)) return 'unsupported';

  try {
    const status = await navigator.permissions.query({ name });
    return status.state;
  } catch {
    // Algunos navegadores (Safari/Firefox) no permiten consultar 'camera'
    return 'prompt';
  }
}

/* ======================= 1. CÁMARA ======================= */

export const Camera = {
  stream: null,

  isSupported: () => !!navigator.mediaDevices?.getUserMedia,

  /** Abre la cámara trasera y la muestra en el <video> indicado. */
  async start(videoEl) {
    if (!this.isSupported()) {
      throw new Error('Tu navegador no permite usar la cámara en vivo. Usa “Subir foto”.');
    }
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
    } catch (err) {
      throw new Error(cameraErrorMessage(err));
    }
    videoEl.srcObject = this.stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play();
  },

  /** Toma una foto del video y devuelve un Blob JPEG comprimido. */
  async capture(videoEl, maxSize = 1280) {
    const { videoWidth: w, videoHeight: h } = videoEl;
    if (!w || !h) throw new Error('La cámara aún no está lista.');
    const scale = Math.min(1, maxSize / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas);
  },

  /** Libera la cámara (apaga el indicador del dispositivo). */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  },
};

function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permiso de cámara denegado. Actívalo en la configuración del sitio o usa “Subir foto”.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró una cámara en este dispositivo. Usa “Subir foto”.';
    case 'NotReadableError':
      return 'La cámara está siendo usada por otra aplicación.';
    default:
      return 'No se pudo abrir la cámara: ' + (err?.message || err);
  }
}

function canvasToBlob(canvas, quality = 0.82) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/jpeg', quality)
  );
}

/** Reduce una imagen elegida desde archivo para no saturar IndexedDB. */
export async function compressImageFile(file, maxSize = 1280) {
  if (!file.type.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen.');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvasToBlob(canvas);
}

/* =================== 2. GEOLOCALIZACIÓN =================== */

export const Geo = {
  isSupported: () => 'geolocation' in navigator,

  /** Obtiene la posición actual. Resuelve { lat, lng, accuracy }. */
  getPosition({ timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error('Tu navegador no soporta geolocalización.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6),
          accuracy: Math.round(pos.coords.accuracy),
        }),
        (err) => reject(new Error(geoErrorMessage(err))),
        { enableHighAccuracy: true, timeout, maximumAge: 30000 }
      );
    });
  },
};

function geoErrorMessage(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Permiso de ubicación denegado. Actívalo en la configuración del sitio para adjuntar la ubicación.';
    case err.POSITION_UNAVAILABLE:
      return 'No se pudo determinar la ubicación. Revisa que el GPS esté encendido.';
    case err.TIMEOUT:
      return 'La ubicación tardó demasiado. Intenta de nuevo en un lugar abierto.';
    default:
      return 'Error de ubicación: ' + err.message;
  }
}

/* ===================== 3. NOTIFICACIONES ===================== */

export const Notify = {
  isSupported: () => 'Notification' in window && 'serviceWorker' in navigator,

  /**
   * Pide permiso (debe llamarse desde un clic del usuario).
   * Devuelve 'granted' | 'denied' | 'default' | 'unsupported'.
   */
  async requestPermission() {
    if (!this.isSupported()) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    return Notification.requestPermission();
  },

  /**
   * Muestra una notificación a través del Service Worker
   * (necesario en Android y cuando la app está instalada).
   * Si no hay permiso, no hace nada y devuelve false.
   */
  async show(title, { body = '', url = './#/reportes', tag } = {}) {
    if (!this.isSupported() || Notification.permission !== 'granted') return false;
    const options = {
      body,
      tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-72.png',
      vibrate: [120, 60, 120],
      data: { url },
      lang: 'es-MX',
    };
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
    } catch {
      new Notification(title, options); // Respaldo si el SW no está listo
    }
    return true;
  },
};

/* ===================== Extra: vibración ===================== */
export const vibrate = (pattern = 80) => { try { navigator.vibrate?.(pattern); } catch { /* sin soporte */ } };
