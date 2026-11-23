import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crearPkce, urlAutorizacion, idDeHoja } from './oauth.mjs';

test('el desafío es el SHA-256 del verificador en base64url', () => {
  const { verificador, desafio } = crearPkce();
  assert.ok(verificador.length >= 43 && verificador.length <= 128);
  assert.equal(desafio, createHash('sha256').update(verificador).digest('base64url'));
});
test('la dirección de autorización lleva lo necesario', () => {
  const u = new URL(urlAutorizacion({ clientId: 'c', puerto: 5123, permisos: ['https://www.googleapis.com/auth/drive.file'], desafio: 'd', estado: 'e' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5123');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(u.searchParams.get('state'), 'e');
});
test('los parámetros extra (selector de archivos) se suman a la dirección', () => {
  const u = new URL(urlAutorizacion({ clientId: 'c', puerto: 1, permisos: ['p'], desafio: 'd', estado: 'e', extra: { prompt: 'consent', trigger_onepick: 'true' } }));
  assert.equal(u.searchParams.get('trigger_onepick'), 'true');
  assert.equal(u.searchParams.get('prompt'), 'consent');
});
test('idDeHoja saca el id de un link o acepta el id suelto', () => {
  assert.equal(idDeHoja('https://docs.google.com/spreadsheets/d/1AbC_-xyz123/edit?gid=0#gid=0'), '1AbC_-xyz123');
  assert.equal(idDeHoja('  1AbC_-xyz123 '), '1AbC_-xyz123');
  assert.equal(idDeHoja('https://docs.google.com/spreadsheets/d/1AbC_-xyz123'), '1AbC_-xyz123');
  assert.equal(idDeHoja('hola que tal'), null);
  assert.equal(idDeHoja(''), null);
});
