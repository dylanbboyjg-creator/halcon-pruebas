import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarNucleo } from './servidor.mjs';

const base = () => join(mkdtempSync(join(tmpdir(), 'halcon-')), 'datos.sqlite');
const nuevo = (extra = {}) => iniciarNucleo({ archivoBase: base(), puerto: 0, host: '127.0.0.1', token: 'secreto', version: '9.9.9', ...extra });
const url = (n, ruta) => `http://127.0.0.1:${n.puerto}${ruta}`;
const auth = { Authorization: 'Bearer secreto', 'Content-Type': 'application/json' };
const escanear = (n, codigo) => fetch(url(n, '/escaneos'), { method: 'POST', headers: auth, body: JSON.stringify({ codigo }) });

test('hola responde sin token', async () => {
  const n = await nuevo();
  const r = await (await fetch(url(n, '/hola'))).json();
  assert.deepEqual(r, { ok: true, version: '9.9.9', id: n.id });
  assert.equal(n.id.length, 36);
  await n.cerrar();
});

test('sin token o con token equivocado da 401', async () => {
  const n = await nuevo();
  assert.equal((await fetch(url(n, '/escaneos'), { method: 'POST', body: '{"codigo":"1"}' })).status, 401);
  assert.equal((await fetch(url(n, '/cambios?desde=0'), { headers: { Authorization: 'Bearer otro' } })).status, 401);
  await n.cerrar();
});

test('token de otra longitud da 401 y no 500', async () => {
  const n = await nuevo();
  for (const t of ['x', 'secretoooooooooooooooooooooooooo', '']) {
    assert.equal((await fetch(url(n, '/cambios?desde=0'), { headers: { Authorization: `Bearer ${t}` } })).status, 401);
  }
  await n.cerrar();
});

test('JSON roto da 400 y el servidor sigue', async () => {
  const n = await nuevo();
  assert.equal((await fetch(url(n, '/escaneos'), { method: 'POST', headers: auth, body: '{roto' })).status, 400);
  assert.equal((await fetch(url(n, '/hola'))).status, 200);
  await n.cerrar();
});

test('la consulta larga responde en menos de 1 s después de un escaneo', async () => {
  const n = await nuevo();
  const espera = fetch(url(n, '/cambios?desde=0'), { headers: auth }).then(r => r.json());
  await new Promise(r => setTimeout(r, 100));
  const t0 = Date.now();
  assert.deepEqual(await (await escanear(n, '7790001000019')).json(), { seq: 1 });
  assert.deepEqual(await espera, { seq: 1, escaneos: [{ seq: 1, codigo: '7790001000019' }] });
  assert.ok(Date.now() - t0 < 1000);
  await n.cerrar();
});

test('sin novedades responde vacío al vencer la espera', async () => {
  const n = await nuevo({ esperaMs: 200 });
  assert.deepEqual(await (await fetch(url(n, '/cambios?desde=0'), { headers: auth })).json(), { seq: 0, escaneos: [] });
  await n.cerrar();
});

test('cortar una consulta larga no rompe el servidor', async () => {
  const n = await nuevo();
  const corte = new AbortController();
  const p = fetch(url(n, '/cambios?desde=0'), { headers: auth, signal: corte.signal }).catch(() => 'cortado');
  await new Promise(r => setTimeout(r, 100));
  corte.abort();
  assert.equal(await p, 'cortado');
  assert.deepEqual(await (await escanear(n, '1')).json(), { seq: 1 });
  await n.cerrar();
});

test('los datos y el id siguen después de cerrar y abrir', async () => {
  const archivoBase = base();
  const a = await nuevo({ archivoBase });
  await escanear(a, '123');
  await a.cerrar();
  const b = await nuevo({ archivoBase });
  assert.equal(b.id, a.id);
  const r = await (await fetch(url(b, '/cambios?desde=0'), { headers: auth })).json();
  assert.deepEqual(r.escaneos, [{ seq: 1, codigo: '123' }]);
  await b.cerrar();
});

test('puerto ocupado rechaza con un error claro', async () => {
  const a = await nuevo();
  await assert.rejects(nuevo({ puerto: a.puerto }), /puerto .* en uso/i);
  await a.cerrar();
});
