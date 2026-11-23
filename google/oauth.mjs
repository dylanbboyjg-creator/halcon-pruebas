// Entrar con Google desde una app de escritorio: PKCE + vuelta a 127.0.0.1. Sin dependencias.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

export function crearPkce() {
  const verificador = randomBytes(48).toString('base64url');
  return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') };
}

export function urlAutorizacion({ clientId, puerto, permisos, desafio, estado, extra = {} }) {
  const u = new URL(AUTH);
  const p = {
    client_id: clientId, redirect_uri: `http://127.0.0.1:${puerto}`, response_type: 'code',
    scope: permisos.join(' '), code_challenge: desafio, code_challenge_method: 'S256',
    access_type: 'offline', state: estado, ...extra,
  };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u.toString();
}

// Acepta un link de Hojas de cálculo o el id suelto; devuelve null si no parece ninguno.
export function idDeHoja(texto) {
  const t = String(texto ?? '').trim();
  const m = t.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(t) ? t : null;
}

// Levanta un servidor solo en 127.0.0.1, espera UNA vuelta de Google y se cierra.
// `alListo(puerto)` se llama cuando ya escucha; devuelve los parámetros de la vuelta.
export function esperarRespuesta({ estado, alListo, ms = 180_000 }) {
  return new Promise((resolver, rechazar) => {
    const srv = createServer((req, res) => {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      if (!q.has('code') && !q.has('error')) { res.writeHead(404).end(); return; }
      const ok = q.get('state') === estado && q.has('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(ok ? 'Listo, ya podés volver a la consola.' : 'No se pudo completar. Volvé a la consola.');
      clearTimeout(timer);
      srv.close(); srv.closeAllConnections();
      if (q.get('state') !== estado) rechazar(new Error('La respuesta no coincide con lo que pedimos (state distinto). Se descartó.'));
      else if (q.has('error')) rechazar(new Error(`Google devolvió: ${q.get('error')}`));
      else resolver(Object.fromEntries(q));
    });
    const timer = setTimeout(() => { srv.close(); srv.closeAllConnections(); rechazar(new Error('Se venció el tiempo esperando que entres en el navegador.')); }, ms);
    srv.on('error', (e) => { clearTimeout(timer); rechazar(e); });
    srv.listen(0, '127.0.0.1', () => alListo(srv.address().port));
  });
}

async function pedirToken(tokenUri, cuerpo) {
  const r = await fetch(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google rechazó el pedido de token (${r.status}): ${j.error ?? ''} ${j.error_description ?? ''}`.trim());
  return j;
}

const conSecreto = (c, o) => (c.client_secret ? { ...o, client_secret: c.client_secret } : o);

export const canjearCodigo = (c, { code, verificador, puerto }) =>
  pedirToken(c.token_uri, conSecreto(c, { grant_type: 'authorization_code', code, code_verifier: verificador, redirect_uri: `http://127.0.0.1:${puerto}`, client_id: c.client_id }));

export const renovarToken = (c, refreshToken) =>
  pedirToken(c.token_uri, conSecreto(c, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.client_id }));
