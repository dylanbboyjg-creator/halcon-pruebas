import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerQr, urlBase } from './conexion.js';

test('lee un QR bueno', () => {
  const v = leerQr('{"h":"192.168.0.42","p":47800,"t":"abc","id":"x"}');
  assert.deepEqual(v, { h: '192.168.0.42', p: 47800, t: 'abc', id: 'x' });
  assert.equal(urlBase(v), 'http://192.168.0.42:47800');
});
test('rechaza un QR que no es nuestro', () => {
  assert.throws(() => leerQr('7790001000019'), /QR no válido/);
  assert.throws(() => leerQr('{"h":"192.168.0.42"}'), /QR no válido/);
});
