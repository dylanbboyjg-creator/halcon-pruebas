import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { iniciarNucleo } from './servidor.mjs';

const base = () => join(mkdtempSync(join(tmpdir(), 'halcon-')), 'datos.sqlite');
const nuevo = (extra = {}) => iniciarNucleo({ archivoBase: base(), puerto: 0, host: '127.0.0.1', token: 'secreto', version: '9.9.9', ...extra });
const url = (n, ruta) => `http://127.0.0.1:${n.puerto}${ruta}`;
const auth = { Authorization: 'Bearer secreto', 'Content-Type': 'application/json' };
const post = (n, ruta, cuerpo) => fetch(url(n, ruta), { method: 'POST', headers: auth, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
const escanear = (n, codigo, id = `id-${codigo}`, extra = {}) => post(n, '/escaneos', { id, codigo, ...extra });
const cambios = async (n, desde = 0) => (await fetch(url(n, `/cambios?desde=${desde}`), { headers: auth })).json();

test('hola responde sin token', async () => {
  const n = await nuevo();
  const r = await (await fetch(url(n, '/hola'))).json();
  assert.deepEqual(r, { ok: true, version: '9.9.9', id: n.id });
  assert.equal(n.id.length, 36);
  await n.cerrar();
});

test('sin token o con token equivocado da 401', async () => {
  const n = await nuevo();
  assert.equal((await fetch(url(n, '/escaneos'), { method: 'POST', body: '{"id":"a","codigo":"1"}' })).status, 401);
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
  assert.deepEqual(await (await escanear(n, '7790001000019')).json(), { seq: 1, cantidad: 1, producto: null });
  assert.deepEqual(await espera, { version: 1, escaneos: [{ seq: 1, id: 'id-7790001000019', codigo: '7790001000019', cantidad: 1, nombre: null, precio: null }] });
  assert.ok(Date.now() - t0 < 1000);
  await n.cerrar();
});

test('sin novedades responde vacío al vencer la espera', async () => {
  const n = await nuevo({ esperaMs: 200 });
  assert.deepEqual(await (await fetch(url(n, '/cambios?desde=0'), { headers: auth })).json(), { version: 0, escaneos: [] });
  await n.cerrar();
});

test('cortar una consulta larga no rompe el servidor', async () => {
  const n = await nuevo();
  const corte = new AbortController();
  const p = fetch(url(n, '/cambios?desde=0'), { headers: auth, signal: corte.signal }).catch(() => 'cortado');
  await new Promise(r => setTimeout(r, 100));
  corte.abort();
  assert.equal(await p, 'cortado');
  assert.deepEqual(await (await escanear(n, '1')).json(), { seq: 1, cantidad: 1, producto: null });
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
  assert.deepEqual(r.escaneos, [{ seq: 1, id: 'id-123', codigo: '123', cantidad: 1, nombre: null, precio: null }]);
  await b.cerrar();
});

test('puerto ocupado rechaza con un error claro', async () => {
  const a = await nuevo();
  await assert.rejects(nuevo({ puerto: a.puerto }), /puerto .* en uso/i);
  await a.cerrar();
});

test('mismo id no duplica, actualiza cantidad y 0 borra', async () => {
  const n = await nuevo();
  await escanear(n, '1', 'a');
  assert.deepEqual(await (await escanear(n, '1', 'a')).json(), { seq: 1, cantidad: 1, producto: null });
  assert.equal((await cambios(n)).escaneos.length, 1);
  assert.equal((await (await escanear(n, '1', 'a', { cantidad: 5 })).json()).cantidad, 5);
  assert.equal((await cambios(n)).escaneos[0].cantidad, 5);
  assert.equal((await (await escanear(n, '1', 'a', { cantidad: 0 })).json()).cantidad, 0);
  assert.deepEqual((await cambios(n)).escaneos, []);
  await n.cerrar();
});

test('mismo id con otro código da 409', async () => {
  const n = await nuevo();
  await escanear(n, '1', 'a');
  assert.equal((await escanear(n, '2', 'a')).status, 409);
  await n.cerrar();
});

test('datos inválidos dan 400', async () => {
  const n = await nuevo();
  assert.equal((await escanear(n, '1', 'a', { cantidad: '2' })).status, 400);
  assert.equal((await escanear(n, '1', 'a', { cantidad: 10000 })).status, 400);
  assert.equal((await escanear(n, '1', '')).status, 400);
  assert.equal((await escanear(n, 'x'.repeat(65))).status, 400);
  assert.equal((await post(n, '/productos', { codigo: '1', nombre: '  ', precio: 1 })).status, 400);
  assert.equal((await post(n, '/productos', { codigo: '1', nombre: 'a', precio: 1.5 })).status, 400);
  await n.cerrar();
});

test('un producto guardado aparece en /escaneos y en /cambios', async () => {
  const n = await nuevo();
  assert.deepEqual(await (await post(n, '/productos', { codigo: '1', nombre: ' Alfajor ', precio: 125000 })).json(), { codigo: '1', nombre: 'Alfajor', precio: 125000 });
  assert.deepEqual((await (await escanear(n, '1')).json()).producto, { codigo: '1', nombre: 'Alfajor', precio: 125000 });
  const e = (await cambios(n)).escaneos[0];
  assert.equal(e.nombre, 'Alfajor');
  assert.equal(e.precio, 125000);
  await n.cerrar();
});

test('/cambios responde en menos de 1 s tras guardar un producto', async () => {
  const n = await nuevo();
  await escanear(n, '1');
  const espera = fetch(url(n, '/cambios?desde=1'), { headers: auth }).then(r => r.json());
  await new Promise(r => setTimeout(r, 100));
  const t0 = Date.now();
  await post(n, '/productos', { codigo: '1', nombre: 'Alfajor', precio: 100 });
  assert.equal((await espera).escaneos[0].nombre, 'Alfajor');
  assert.ok(Date.now() - t0 < 1000);
  await n.cerrar();
});

test('cuerpo de 20 KB da 413', async () => {
  const n = await nuevo();
  assert.equal((await post(n, '/escaneos', 'x'.repeat(20 * 1024))).status, 413);
  assert.equal((await fetch(url(n, '/hola'))).status, 200);
  await n.cerrar();
});

test('una tabla escaneos vieja se migra', async () => {
  const archivoBase = base();
  const viejo = new DatabaseSync(archivoBase);
  viejo.exec("CREATE TABLE escaneos (seq INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, ts INTEGER NOT NULL); INSERT INTO escaneos (codigo, ts) VALUES ('1', 0);");
  viejo.close();
  const n = await nuevo({ archivoBase });
  assert.deepEqual((await cambios(n)).escaneos, []);
  assert.equal((await escanear(n, '2')).status, 200);
  await n.cerrar();
});
