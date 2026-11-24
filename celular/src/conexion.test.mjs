import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerQr, urlBase, candidatas, buscarNotebook } from './conexion.js';

test('lee un QR bueno', () => {
  const v = leerQr('{"h":"192.168.0.42","p":47800,"t":"abc","id":"x"}');
  assert.deepEqual(v, { h: '192.168.0.42', p: 47800, t: 'abc', id: 'x' });
  assert.equal(urlBase(v), 'http://192.168.0.42:47800');
});
test('rechaza un QR que no es nuestro', () => {
  assert.throws(() => leerQr('7790001000019'), /QR no válido/);
  assert.throws(() => leerQr('{"h":"192.168.0.42"}'), /QR no válido/);
});
test('rechaza direcciones que no son de red privada y puertos raros', () => {
  for (const q of [
    '{"h":"8.8.8.8","p":47800,"t":"a","id":"x"}',
    '{"h":"evil.example","p":47800,"t":"a","id":"x"}',
    '{"h":"192.168.0.42","p":70000,"t":"a","id":"x"}',
    '{"h":"192.168.0.999","p":47800,"t":"a","id":"x"}',
  ]) assert.throws(() => leerQr(q), /QR no válido/);
});
test('acepta 10.x y 172.16-31.x', () => {
  assert.equal(leerQr('{"h":"10.0.0.5","p":47800,"t":"a","id":"x"}').h, '10.0.0.5');
  assert.equal(leerQr('{"h":"172.20.1.1","p":47800,"t":"a","id":"x"}').h, '172.20.1.1');
});
test('rechaza ceros a la izquierda y acepta direcciones normales', () => {
  for (const h of ['010.0.0.1', '192.168.01.1']) assert.throws(() => leerQr(`{"h":"${h}","p":47800,"t":"a","id":"x"}`), /QR no válido/);
  for (const h of ['10.0.0.5', '172.20.1.1', '192.168.0.42']) assert.equal(leerQr(`{"h":"${h}","p":47800,"t":"a","id":"x"}`).h, h);
});
test('candidatas: las otras 253 de la red, de más cerca a más lejos', () => {
  const c = candidatas('192.168.0.44');
  assert.equal(c.length, 253);
  assert.deepEqual(c.slice(0, 4), ['192.168.0.43', '192.168.0.45', '192.168.0.42', '192.168.0.46']);
  for (const x of ['192.168.0.44', '192.168.0.0', '192.168.0.255']) assert.ok(!c.includes(x));
});
const v = { h: '192.168.0.44', p: 47800, t: 'a', id: 'x' };
test('buscarNotebook: usa la dirección del QR si contesta', async () => {
  const vistas = [];
  const r = await buscarNotebook(v, async (h) => { vistas.push(h); return 'x'; });
  assert.deepEqual(r, v);
  assert.deepEqual(vistas, ['192.168.0.44']);
});
test('buscarNotebook: encuentra otra dirección y no sigue con más tandas', async () => {
  const vistas = [];
  const r = await buscarNotebook(v, async (h) => { vistas.push(h); return h === '192.168.0.50' ? 'x' : null; }, 4);
  assert.deepEqual(r, { ...v, h: '192.168.0.50' });
  assert.equal(vistas.length, 13); // QR + 3 tandas de 4; la 4ª no se lanza
  assert.ok(!vistas.includes('192.168.0.1'));
});
test('buscarNotebook: null si nadie contesta; rechazos cuentan como null', async () => {
  assert.equal(await buscarNotebook(v, async () => { throw new Error('x'); }), null);
});
test('buscarNotebook: ignora una notebook con otro identificador', async () => {
  assert.equal(await buscarNotebook(v, async () => 'otra'), null);
});
