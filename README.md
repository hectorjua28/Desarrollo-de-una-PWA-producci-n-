# ReportaYa · Incidencias urbanas

Aplicación Web Progresiva (PWA) para reportar incidencias de la vía pública —baches, luminarias apagadas, fugas de agua, basura acumulada— con **foto, ubicación GPS y funcionamiento sin conexión**.

**🔗 Aplicación publicada:** _pendiente de despliegue_

---

## Caso de uso

Cuando una persona encuentra un problema en su colonia, normalmente no tiene una forma rápida de documentarlo, y muchas veces está en un lugar con mala señal. **ReportaYa** le permite:

1. Tomar una foto de la incidencia con la cámara del dispositivo.
2. Adjuntar su ubicación GPS y verla en un mapa.
3. Describir el problema y clasificarlo por categoría.
4. Guardar el reporte **aunque no tenga internet**: se almacena en el dispositivo.
5. Dar seguimiento al estado (*Pendiente → En proceso → Resuelto*) y recibir notificaciones.

## Funcionalidades

- Registro e inicio de sesión locales (contraseñas con hash SHA-256 y *salt*).
- Panel de inicio con estadísticas por estado y gráfico por categoría.
- Lista de reportes con búsqueda y filtros por estado y categoría.
- Creación de reportes en tres pasos: foto, ubicación y detalles.
- Detalle del reporte con mapa, cambio de estado, compartir y eliminar.
- Perfil con el estado de los permisos del dispositivo.
- Instalable en escritorio y móvil, con indicador *En línea / Sin conexión*.
- Diseño responsive y modo oscuro automático.

## Tecnologías

- **HTML, CSS y JavaScript** puro (módulos ES), sin frameworks ni dependencias.
- **Web App Manifest** · **Service Worker** · **Cache API** · **IndexedDB**.
- **Web APIs:** MediaDevices (cámara), Geolocation, Notifications, Permissions, Vibration y Web Share.
- Mapas con teselas de **OpenStreetMap**.

## Arquitectura

La aplicación sigue el modelo **App Shell** con **renderizado del lado del cliente (CSR)**:

```
┌──────────────────────────── index.html (App Shell) ────────────────────────────┐
│  Barra superior · Navegación · <main id="app"> · Zona de avisos                │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                        js/app.js  ── router por hash (#/inicio, #/nuevo, …)
                                        │  genera cada vista con template strings
          ┌─────────────────┬───────────┴───────┬───────────────────┐
          ▼                 ▼                   ▼                   ▼
     js/auth.js         js/db.js           js/native.js        js/minimap.js
   sesión y cuentas     IndexedDB        cámara, GPS,         mapa con teselas
                    (users, session,    notificaciones          OpenStreetMap
                        reports)

     sw.js (Service Worker) ── intercepta las peticiones y aplica la caché
```

- **App Shell:** la estructura fija (`index.html` + `styles.css`) se precarga en la instalación del Service Worker, por lo que la interfaz abre al instante incluso sin red.
- **CSR:** `app.js` lee el *hash* de la URL y dibuja la vista correspondiente dentro de `<main id="app">`.
- **Persistencia:** los usuarios, la sesión y los reportes (incluida la foto como `Blob`) se guardan en **IndexedDB**, así que los datos se consultan y crean sin conexión.

### Estrategias de caché (Service Worker)

| Recurso | Estrategia | Caché |
|---|---|---|
| Navegación (páginas HTML) | *Network First* con respaldo al App Shell y a `offline.html` | `reportaya-dynamic` |
| Recursos propios (CSS, JS, iconos) | *Cache First* | `reportaya-static` (precarga) / `reportaya-dynamic` |
| Teselas del mapa | *Stale-While-Revalidate* (máx. 120) | `reportaya-tiles` |

Al activarse una nueva versión (`VERSION` en `sw.js`), se eliminan las cachés anteriores y se avisa al usuario con la opción **Actualizar**.

### Web APIs del dispositivo

| API | Uso en la app |
|---|---|
| **MediaDevices / getUserMedia** | Cámara en vivo para la foto de evidencia (con carga de archivo como respaldo). |
| **Geolocation** | Coordenadas y precisión del lugar del reporte. |
| **Notifications** (vía Service Worker) | Aviso al guardar un reporte o al marcarlo como resuelto. |
| Permissions · Vibration · Web Share | Estado de permisos, respuesta háptica y compartir reportes. |

## Estructura del proyecto

```
├── index.html        App Shell
├── offline.html      Página de respaldo sin conexión
├── manifest.json     Metadatos de instalación
├── sw.js             Service Worker
├── netlify.toml      Configuración de despliegue
├── css/styles.css    Estilos (variables, responsive, modo oscuro)
├── js/
│   ├── app.js        Router, vistas y registro del Service Worker
│   ├── db.js         Capa de acceso a IndexedDB
│   ├── auth.js       Registro, inicio de sesión y sesión activa
│   ├── native.js     Cámara, geolocalización y notificaciones
│   └── minimap.js    Mini mapa con OpenStreetMap
├── icons/            Iconos PNG (72–512 px y maskable)
└── img/              Capturas para el manifest
```

## Ejecución local

El Service Worker requiere `localhost` o HTTPS. Desde la carpeta del proyecto:

```bash
npx serve .
# o bien
python -m http.server 8080
```

Después abre `http://localhost:8080` en Chrome o Edge.

## Despliegue

Publicada en **Netlify** con HTTPS y despliegue continuo: cada `push` a la rama `main` genera una nueva publicación. El sitio es estático, así que no requiere compilación; `netlify.toml` define la carpeta publicada y los encabezados del Service Worker y del manifest.

URL: _pendiente de despliegue_

## Autor

**Hector** · [@hectorjua28](https://github.com/hectorjua28)
