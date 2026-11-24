import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearLista } from './lista.js';

const nueva = () => { let n = 0; return crearLista(() => `id${++n}`); };

test('agregar pone el item nuevo al principio', () => {
  const l = nueva();
  l.agregar('1');
  const i = l.agregar('2');
  assert.deepEqual(i, { id: 'id2', codigo: '2', cantidad: 1, estado: 'enviando', nombre: null, precio: null, error: null });
  assert.deepEqual(l.items().map((x) => x.codigo), ['2', '1']);
});
test('confirmar, fallar y reintentar', () => {
  const l = nueva();
  const a = l.agregar('1'), b = l.agregar('2');
  l.confirmar(a.id, { producto: { nombre: 'Yerba', precio: 1500 } });
  assert.equal(a.estado, 'ok');
  assert.equal(a.nombre, 'Yerba');
  assert.equal(a.precio, 1500);
  l.confirmar(b.id, { producto: null });
  assert.equal(b.estado, 'nuevo');
  l.fallar(a.id, 'sin red');
  assert.equal(a.estado, 'error');
  assert.equal(a.error, 'sin red');
  assert.equal(l.reintentar(a.id).estado, 'enviando');
  assert.equal(a.error, null);
});
test('cambiarCantidad: tope 9999 y quita al llegar a 0', () => {
  const l = nueva();
  const a = l.agregar('1');
  assert.equal(l.cambiarCantidad(a.id, 20000).cantidad, 9999);
  assert.equal(l.cambiarCantidad(a.id, -20000).cantidad, 0);
  assert.equal(l.items().length, 0);
});
test('resumen cuenta renglones, unidades y total en centavos de los que tienen precio', () => {
  const l = nueva();
  const a = l.agregar('1'), b = l.agregar('2');
  l.agregar('3');
  l.confirmar(a.id, { producto: { nombre: 'A', precio: 150 } });
  l.confirmar(b.id, { producto: { nombre: 'B', precio: 99 } });
  l.cambiarCantidad(a.id, 2);
  assert.deepEqual(l.resumen(), { renglones: 3, unidades: 5, total: 150 * 3 + 99 });
});
test('items devuelve una copia y los ids desconocidos devuelven null', () => {
  const l = nueva();
  l.agregar('1');
  l.items().pop();
  assert.equal(l.items().length, 1);
  assert.equal(l.confirmar('zz', { producto: null }), null);
  assert.equal(l.fallar('zz', 'x'), null);
  assert.equal(l.reintentar('zz'), null);
  assert.equal(l.cambiarCantidad('zz', 1), null);
});
