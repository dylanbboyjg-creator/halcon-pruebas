// Prueba descartable: Google Drive y Hojas con el permiso mínimo. Uso: node google/probar.mjs <paso>
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crearPkce, urlAutorizacion, esperarRespuesta, canjearCodigo, renovarToken, idDeHoja } from './oauth.mjs';

const CREDENCIALES = fileURLToPath(new URL('./credenciales.json', import.meta.url));
const TOKENS = fileURLToPath(new URL('./tokens.json', import.meta.url));
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const SOLO_LECTURA = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const HOJA = 'application/vnd.google-apps.spreadsheet';

const AYUDA = `Uso: node google/probar.mjs <paso>

Pasos:
  entrar [--con-lectura]  Entrar con Google (permiso drive.file). Con --con-lectura suma el permiso de leer hojas (plan B).
  copia                   Crear la carpeta "Halcon Pruebas" en tu Drive y subir un archivo de texto.
  resumen                 Crear la hoja "Resumen (prueba)", escribir dos filas y volver a leerlas.
  elegir                  Abrir el selector de archivos de Google para elegir una hoja tuya.
  leer <id o link>        Leer las primeras 5 filas de una hoja (acepta el id o el link entero).
  renovar                 Pedir un token nuevo sin abrir el navegador y repetir "resumen".
`;

const fallo = (msg) => { throw new Error(msg); };

async function credenciales() {
  let txt;
  try { txt = await readFile(CREDENCIALES, 'utf8'); }
  catch { fallo(`Falta el archivo de credenciales de Google.\nBajalo de Google Cloud (cliente OAuth "App de escritorio") y guardalo como:\n  ${CREDENCIALES}`); }
  const c = JSON.parse(txt).installed ?? fallo('El archivo credenciales.json no tiene la sección "installed": ¿es un cliente de tipo "App de escritorio"?');
  return c;
}

const leerTokens = async () => {
  try { return JSON.parse(await readFile(TOKENS, 'utf8')); }
  catch { return fallo('Todavía no entraste. Corré primero: node google/probar.mjs entrar'); }
};

async function guardarTokens(nuevos, previos = {}) {
  const t = { ...previos, ...nuevos };
  if (nuevos.expires_in) t.vence = Date.now() + nuevos.expires_in * 1000;
  await writeFile(TOKENS, JSON.stringify(t, null, 2), { mode: 0o600 });
  await chmod(TOKENS, 0o600); // por si el archivo ya existía con otros permisos
  return t;
}

async function tokenDeAcceso(c, forzar = false) {
  const t = await leerTokens();
  if (!forzar && t.access_token && t.vence > Date.now() + 60_000) return t.access_token;
  t.refresh_token ?? fallo('No hay token de renovación guardado. Volvé a correr "entrar".');
  return (await guardarTokens(await renovarToken(c, t.refresh_token), t)).access_token;
}

async function flujoNavegador(c, permisos, extra) {
  const { verificador, desafio } = crearPkce();
  const estado = randomBytes(16).toString('base64url');
  let puertoLocal;
  const vuelta = await esperarRespuesta({
    estado,
    alListo: (puerto) => {
      puertoLocal = puerto;
      console.log('Abrí esta dirección en tu navegador y seguí los pasos de Google:\n');
      console.log(urlAutorizacion({ clientId: c.client_id, puerto, permisos, desafio, estado, extra }));
      console.log('\nEsperando tu respuesta (hasta 3 minutos)...');
    },
  });
  const nuevos = await canjearCodigo(c, { code: vuelta.code, verificador, puerto: puertoLocal });
  await guardarTokens(nuevos, await leerTokens().catch(() => ({})));
  return { vuelta, nuevos };
}

async function api(c, url, { json, ...opts } = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { authorization: `Bearer ${await tokenDeAcceso(c)}`, ...(json ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: json ? JSON.stringify(json) : opts.body,
  });
  if (!r.ok) {
    const j = await r.clone().json().catch(() => ({}));
    throw Object.assign(new Error(`Google respondió ${r.status}: ${j.error?.message ?? r.statusText}`), { estado: r.status });
  }
  return r;
}

const pasos = {
  async entrar(c, args) {
    const permisos = args.includes('--con-lectura') ? [DRIVE_FILE, SOLO_LECTURA] : [DRIVE_FILE];
    const { nuevos } = await flujoNavegador(c, permisos, { prompt: 'consent' });
    console.log('Listo, entraste. Permisos concedidos:');
    for (const p of String(nuevos.scope ?? '').split(' ')) console.log(`  - ${p}`);
    console.log(`Guardado en ${TOKENS} (no entra en git).`);
  },

  async copia(c) {
    const carpeta = await (await api(c, 'https://www.googleapis.com/drive/v3/files', { method: 'POST', json: { name: 'Halcon Pruebas', mimeType: 'application/vnd.google-apps.folder' } })).json();
    const f = '--limite';
    const cuerpo = `--${f}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: 'prueba.txt', parents: [carpeta.id] })}\r\n--${f}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nArchivo de prueba de Halcon.\r\n--${f}--`;
    const arch = await (await api(c, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${f}` }, body: cuerpo })).json();
    console.log(`Carpeta creada: ${carpeta.id}\nArchivo subido: ${arch.id}\nMirá tu Drive: tiene que aparecer "Halcon Pruebas/prueba.txt".`);
  },

  async resumen(c) {
    const h = await (await api(c, 'https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', json: { properties: { title: 'Resumen (prueba)' } } })).json();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${h.spreadsheetId}/values/A1:B2`;
    await api(c, `${base}?valueInputOption=RAW`, { method: 'PUT', json: { values: [['Producto', 'Cantidad'], ['Prueba', '3']] } });
    const filas = (await (await api(c, base)).json()).values;
    console.log(`Hoja creada: ${h.spreadsheetId}\nFilas leídas:`);
    for (const f of filas) console.log(`  ${f.join(' | ')}`);
  },

  async elegir(c) {
    // Guía: developers.google.com/workspace/drive/picker/guides/overview-desktop (solo drive.file, sin otros permisos)
    const { vuelta } = await flujoNavegador(c, [DRIVE_FILE], { prompt: 'consent', trigger_onepick: 'true', mimetypes: HOJA });
    if (!vuelta.picked_file_ids) fallo('Google no devolvió ningún archivo elegido (¿cerraste el selector sin elegir?).');
    console.log(`Archivo(s) elegido(s): ${vuelta.picked_file_ids}\nProbá leerlo con: node google/probar.mjs leer <id>`);
  },

  async leer(c, args) {
    const id = idDeHoja(args[0]) ?? fallo('Pasame el id de la hoja o el link entero: node google/probar.mjs leer <id o link>');
    try {
      const v = (await (await api(c, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1:Z5`)).json()).values ?? [];
      console.log('Anduvo con: API de Hojas (values.get). Primeras filas:');
      v.forEach((f) => console.log(`  ${f.join(' | ')}`));
    } catch (e) {
      if (e.estado !== 403 && e.estado !== 404) throw e;
      console.log(`La API de Hojas no dejó leer (${e.message}). Pruebo exportar a CSV con la API de Drive...`);
      try {
        const csv = await (await api(c, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv`)).text();
        console.log('Anduvo con: Drive files.export a CSV. Primeras líneas:');
        csv.split('\n').slice(0, 5).forEach((l) => console.log(`  ${l}`));
      } catch (e2) {
        console.log(`Tampoco anduvo la exportación (${e2.message}).\nPlan B: corré "entrar --con-lectura", anotá qué cartel muestra Google, y repetí "leer".`);
        throw new Error('No se pudo leer la hoja con el permiso mínimo.');
      }
    }
  },

  async renovar(c) {
    await tokenDeAcceso(c, true);
    console.log('Token nuevo obtenido sin abrir el navegador. Repito "resumen":');
    await pasos.resumen(c);
  },
};

const [paso, ...args] = process.argv.slice(2);
if (!Object.hasOwn(pasos, paso ?? '')) {
  console.log(AYUDA);
} else {
  try { await pasos[paso](await credenciales(), args); }
  catch (e) { console.error(`\n${e.message}`); process.exitCode = 1; }
}
