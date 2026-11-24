import { Escaner, nativo } from './escaner.js';
import { leerQr, buscarNotebook } from './conexion.js';
import { crearLista } from './lista.js';
import * as api from './api.js';

const $ = (id) => document.getElementById(id);
const raiz = document.documentElement;
raiz.classList.toggle('nativo', nativo);

const FORMATOS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128'];
const DESCANSO_MS = 60000; // sin uso, la cámara se apaga para no gastar batería
const guardado = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pesos = (centavos) => '$ ' + Math.round(centavos / 100).toLocaleString('es-AR');
const icono = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;

let v = guardado('vinculo', null);
// Solo en el navegador (desarrollo): el vínculo se puede pasar en la dirección, porque no hay cámara para leer el QR.
if (!nativo && location.hash.startsWith('#v=')) v = leerQr(decodeURIComponent(location.hash.slice(3)));
const ajustes = guardado('ajustes', { sonido: true, vibracion: true });
const lista = crearLista();
const colas = new Map(); // un envío a la vez por renglón: si no, dos cambios de cantidad pueden llegar cruzados
const hojas = ['hoja-teclado', 'hoja-producto', 'hoja-ajustes'].map($);
let modo = '', ultimoId = null, buscando = false, linterna = false, zoom = 1, reloj = 0, relojSenal = 0, cargando = null;

const vista = (n) => { raiz.dataset.vista = n; };
const guardarVinculo = () => localStorage.setItem('vinculo', JSON.stringify(v));

// ---------- Cámara ----------

async function prender(formatos, marco) {
  const { camara } = await Escaner.pedirPermiso();
  if (camara !== 'granted') throw new Error('Falta el permiso de la cámara. Dáselo desde los ajustes del celular.');
  const r = marco.getBoundingClientRect();
  await Escaner.ajustes(ajustes);
  await Escaner.iniciar({ formatos, zona: { arriba: r.top / innerHeight, abajo: r.bottom / innerHeight }, repetirMs: 1000 });
}

function camaraApagada() {
  clearTimeout(reloj);
  linterna = false;
  $('btn-linterna').setAttribute('aria-pressed', 'false');
}

function descansar() {
  clearTimeout(reloj);
  reloj = setTimeout(async () => {
    await Escaner.detener();
    camaraApagada();
    $('btn-despertar').hidden = false;
    $('ayuda-cam').hidden = true;
  }, DESCANSO_MS);
}

async function prenderEscaner() {
  $('btn-despertar').hidden = true;
  $('ayuda-cam').hidden = false;
  try {
    await prender(FORMATOS, $('franja'));
    if ($('aviso').dataset.tipo === 'camara') avisar(null);
    descansar();
  } catch (e) {
    avisar('camara', e.message || 'No pude abrir la cámara.', 'Probar de nuevo', prenderEscaner);
  }
}

function senal(tipo) {
  $('franja').dataset.senal = tipo;
  clearTimeout(relojSenal);
  relojSenal = setTimeout(() => delete $('franja').dataset.senal, 420);
}
const atencion = () => { Escaner.senal({ tipo: 'error' }); senal('error'); };

// ---------- Vincular ----------

async function vincular() {
  $('inicio-error').textContent = '';
  vista('vincular');
  try {
    await prender(['QR_CODE'], $('marco-qr'));
    modo = 'qr';
  } catch (e) {
    vista('inicio');
    $('inicio-error').textContent = e.message || 'No pude abrir la cámara.';
  }
}

async function cancelarVinculo(mensaje = '') {
  modo = '';
  await Escaner.detener();
  vista('inicio');
  $('inicio-error').textContent = mensaje;
}

async function alQr(texto) {
  modo = '';
  await Escaner.detener();
  try {
    const n = leerQr(texto);
    // El vínculo se guarda recién cuando contesta la notebook de ese QR.
    if (await api.hola(n, n.h, 2500).catch(() => null) !== n.id) throw new Error('Leí el QR, pero la notebook no contesta. Fijate que el celular esté en el mismo Wi‑Fi.');
    v = n;
    guardarVinculo();
    abrirEscaner();
  } catch (e) {
    Escaner.senal({ tipo: 'error' });
    cancelarVinculo(e.message === 'QR no válido' ? 'Ese código no es el de la notebook.' : e.message);
  }
}

// ---------- Escanear ----------

async function abrirEscaner() {
  modo = 'productos';
  vista('escanear');
  red('ok');
  pintar();
  await prenderEscaner();
  if (await api.hola(v, v.h).catch(() => null) !== v.id) buscar();
}

function alLeer(valor) {
  descansar();
  senal('ok');
  const ya = lista.items().find((i) => i.codigo === valor && i.estado !== 'error');
  const item = ya ? lista.cambiarCantidad(ya.id, 1) : lista.agregar(valor);
  ultimoId = item.id;
  pintar(true);
  enCola(item, () => enviar(item));
}

function enCola(item, tarea) {
  const p = (colas.get(item.id) ?? Promise.resolve()).then(tarea).then(() => {
    if (colas.get(item.id) === p) colas.delete(item.id);
    pintar();
  });
  colas.set(item.id, p);
}

async function enviar(item, automatico = false) {
  try {
    const r = await api.escaneo(v, { id: item.id, codigo: item.codigo, cantidad: item.cantidad });
    const eraNuevo = item.estado === 'nuevo';
    lista.confirmar(item.id, { producto: r.producto });
    if (!r.producto && !eraNuevo) atencion();
  } catch {
    lista.fallar(item.id, 'No llegó a la notebook');
    atencion();
    if (!automatico) buscar(); // el reintento automático no vuelve a buscar: evita un ciclo si la notebook contesta /hola pero rechaza el envío
  }
}

// Se quita de la pantalla recién cuando la notebook lo borró.
async function quitar(item) {
  try {
    await api.escaneo(v, { id: item.id, codigo: item.codigo, cantidad: 0 });
    lista.cambiarCantidad(item.id, -item.cantidad);
    if (ultimoId === item.id) ultimoId = lista.items()[0]?.id ?? null;
  } catch {
    lista.fallar(item.id, 'No se pudo quitar: la notebook no contesta');
    atencion();
    buscar();
  }
}

function red(estado) {
  $('red').dataset.estado = estado;
  $('red').lastElementChild.textContent = { ok: 'Notebook conectada', buscando: 'Buscando la notebook', perdida: 'Sin notebook' }[estado];
}

function avisar(tipo, texto = '', boton = '', accion = null) {
  const a = $('aviso'), b = $('aviso-boton');
  a.hidden = !tipo;
  a.dataset.tipo = tipo ?? '';
  $('aviso-texto').textContent = texto;
  b.hidden = !boton;
  b.textContent = boton;
  b.onclick = accion;
}

async function buscar() {
  if (buscando) return;
  buscando = true;
  red('buscando');
  avisar('buscando', 'No encuentro la notebook. La estoy buscando en la red…');
  const n = await buscarNotebook(v, (h) => api.hola(v, h));
  buscando = false;
  if (!n) {
    red('perdida');
    return avisar('perdida', 'La notebook no aparece. Fijate que esté prendida, con el programa abierto y en este mismo Wi‑Fi.', 'Buscar de nuevo', buscar);
  }
  v = n;
  guardarVinculo();
  red('ok');
  avisar(null);
  for (const i of lista.items()) if (i.estado === 'error') { lista.reintentar(i.id); enCola(i, () => enviar(i, true)); }
  pintar();
}

// ---------- Dibujar ----------

const contador = (u) => `<div class="contador">
  <button data-accion="menos" aria-label="Uno menos">${icono('menos')}</button>
  <output aria-label="Cantidad">${u.cantidad}</output>
  <button data-accion="mas" aria-label="Uno más">${icono('mas')}</button></div>`;

function htmlUltimo(u) {
  if (u.estado === 'error') return `<p class="nombre">${esc(u.nombre ?? `Código ${u.codigo}`)}</p>
    <p class="nota mal">${esc(u.error)}</p>
    <button class="boton lleno chico" data-accion="reintentar">${icono('reintentar')}Reintentar</button>`;
  if (u.estado === 'nuevo') return `<p class="nombre">Producto nuevo</p>
    <div class="acciones"><p class="nota">Código ${esc(u.codigo)}</p>
    <button class="boton lleno chico" data-accion="cargar">Cargar nombre y precio</button></div>${contador(u)}`;
  if (u.nombre == null) return `<p class="nombre"><span class="hueso"></span></p><p class="nota">Código ${esc(u.codigo)}</p>${contador(u)}`;
  return `<p class="nombre">${esc(u.nombre)}</p><p class="precio${pesos(u.precio).length > 7 ? ' largo' : ''}">${pesos(u.precio)}</p>${contador(u)}`;
}

function htmlRenglon(i) {
  const importe = i.estado === 'error' ? '<span class="imp mal">No llegó</span>'
    : i.estado === 'nuevo' ? '<span class="imp espera">Sin precio</span>'
    : i.precio == null ? '<span class="imp espera">…</span>'
    : `<span class="imp">${pesos(i.precio * i.cantidad)}</span>`;
  return `<li><button data-id="${esc(i.id)}"${i.id === ultimoId ? ' aria-current="true"' : ''}>
    <span class="cant">${i.cantidad} ×</span><span class="nom">${esc(i.nombre ?? i.codigo)}</span><span class="puntos"></span>${importe}</button></li>`;
}

function pintar(recienLeido = false) {
  const items = lista.items();
  const u = items.find((i) => i.id === ultimoId);
  const caja = $('ultimo');
  caja.innerHTML = u ? htmlUltimo(u)
    : '<div class="vacio"><strong>Todavía no escaneaste nada</strong><span>Apuntá a un código de barras. Vas a sentir una vibración cuando lo lea.</span></div>';
  if (recienLeido) {
    caja.classList.remove('entra');
    void caja.offsetWidth; // reinicia la animación
    caja.classList.add('entra');
  }
  $('lista').innerHTML = items.map(htmlRenglon).join('');
  const { unidades, total } = lista.resumen();
  $('total-unidades').textContent = unidades === 0 ? 'Nada todavía' : unidades === 1 ? '1 producto' : `${unidades} productos`;
  $('total-plata').textContent = unidades ? pesos(total) : '';
}

// ---------- Botones ----------

$('btn-vincular').onclick = vincular;
$('btn-cancelar').onclick = () => cancelarVinculo();
$('btn-despertar').onclick = prenderEscaner;

$('ultimo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-accion]');
  const u = lista.items().find((i) => i.id === ultimoId);
  if (!b || !u) return;
  descansar();
  const accion = b.dataset.accion;
  if (accion === 'cargar') return abrirProducto(u);
  if (accion === 'menos' && u.cantidad <= 1) return enCola(u, () => quitar(u));
  if (accion === 'reintentar') lista.reintentar(u.id);
  else lista.cambiarCantidad(u.id, accion === 'mas' ? 1 : -1);
  pintar();
  enCola(u, () => enviar(u));
});

$('lista').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  ultimoId = b.dataset.id;
  pintar(true);
});

$('btn-linterna').onclick = async () => {
  linterna = !linterna;
  try { await Escaner.linterna({ encendida: linterna }); } catch { linterna = false; }
  $('btn-linterna').setAttribute('aria-pressed', String(linterna));
  descansar();
};

// Con una hoja abierta la cámara se apaga: si no, seguiría leyendo y sonando detrás.
async function abrirHoja(h) {
  await Escaner.detener();
  camaraApagada();
  h.showModal();
}
for (const h of hojas) h.addEventListener('close', () => { if (raiz.dataset.vista === 'escanear') prenderEscaner(); });

$('btn-teclado').onclick = () => { $('campo-codigo').value = ''; abrirHoja($('hoja-teclado')); };
$('form-teclado').addEventListener('submit', (e) => {
  const codigo = $('campo-codigo').value.trim();
  if (e.submitter?.value !== 'ok' || !codigo) return;
  Escaner.senal({ tipo: 'ok' });
  alLeer(codigo);
});

function abrirProducto(item) {
  cargando = item;
  $('producto-codigo').textContent = `Código ${item.codigo}`;
  $('campo-nombre').value = '';
  $('campo-precio').value = '';
  $('producto-error').textContent = '';
  abrirHoja($('hoja-producto'));
}
$('form-producto').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault(); // la hoja se cierra recién cuando la notebook lo guardó
  const nombre = $('campo-nombre').value.trim();
  if (!nombre) return void ($('producto-error').textContent = 'Escribí el nombre.');
  e.submitter.disabled = true;
  try {
    const p = await api.producto(v, { codigo: cargando.codigo, nombre, precio: Number($('campo-precio').value) * 100 });
    for (const i of lista.items()) if (i.codigo === p.codigo && i.estado !== 'error') lista.confirmar(i.id, { producto: p });
    $('hoja-producto').close();
    pintar();
  } catch {
    $('producto-error').textContent = 'No se pudo guardar: la notebook no contesta. Probá de nuevo.';
  }
  e.submitter.disabled = false;
});

$('btn-ajustes').onclick = () => {
  $('aj-sonido').checked = ajustes.sonido;
  $('aj-vibracion').checked = ajustes.vibracion;
  $('aj-notebook').textContent = `Notebook en ${v.h}`;
  delete $('btn-olvidar').dataset.seguro;
  $('btn-olvidar').textContent = 'Olvidar esta notebook';
  abrirHoja($('hoja-ajustes'));
};
for (const k of ['sonido', 'vibracion']) {
  $(`aj-${k}`).onchange = (e) => {
    ajustes[k] = e.target.checked;
    localStorage.setItem('ajustes', JSON.stringify(ajustes));
    Escaner.ajustes(ajustes);
  };
}
$('btn-olvidar').onclick = (e) => {
  if (!e.currentTarget.dataset.seguro) {
    e.currentTarget.dataset.seguro = '1';
    e.currentTarget.textContent = 'Tocá otra vez para olvidarla';
    return;
  }
  localStorage.removeItem('vinculo');
  v = null;
  vista('inicio');
  $('hoja-ajustes').close();
};

// ---------- Gestos sobre la cámara: tocar enfoca, dos dedos hacen zoom ----------

const cam = $('camara'), dedos = new Map();
let separacion0 = 0, zoom0 = 1, movio = false, zoomOcupado = false;
const separacion = () => { const [a, b] = [...dedos.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); };

cam.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  dedos.set(e.pointerId, e);
  movio = false;
  if (dedos.size === 2) { separacion0 = separacion(); zoom0 = zoom; }
});
cam.addEventListener('pointermove', async (e) => {
  if (!dedos.has(e.pointerId)) return;
  dedos.set(e.pointerId, e);
  if (dedos.size !== 2 || !separacion0 || zoomOcupado) return;
  movio = true;
  zoomOcupado = true;
  try { zoom = (await Escaner.zoom({ factor: zoom0 * separacion() / separacion0 })).factor; } catch { /* sin cámara no hay zoom */ }
  zoomOcupado = false;
});
const soltar = (e) => {
  if (!dedos.delete(e.pointerId)) return;
  if (dedos.size < 2) separacion0 = 0;
  if (movio || dedos.size || e.type !== 'pointerup') return;
  Escaner.enfocar({ x: e.clientX / innerWidth, y: e.clientY / innerHeight }).catch(() => {});
  const f = $('foco'), r = cam.getBoundingClientRect();
  f.style.left = `${e.clientX - r.left}px`;
  f.style.top = `${e.clientY - r.top}px`;
  f.hidden = true;
  void f.offsetWidth;
  f.hidden = false;
  setTimeout(() => { f.hidden = true; }, 800);
  descansar();
};
cam.addEventListener('pointerup', soltar);
cam.addEventListener('pointercancel', soltar);

// ---------- Arranque ----------

document.addEventListener('visibilitychange', () => {
  const donde = raiz.dataset.vista;
  if (donde === 'vincular' && document.hidden) return cancelarVinculo();
  if (donde !== 'escanear') return;
  if (document.hidden) { Escaner.detener(); camaraApagada(); }
  else if (!hojas.some((h) => h.open)) prenderEscaner();
});

Escaner.addListener('codigo', ({ valor }) => {
  if (modo === 'qr') alQr(valor);
  else if (modo === 'productos') alLeer(valor);
});

if (v) abrirEscaner();
