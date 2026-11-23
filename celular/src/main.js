import { CapacitorHttp } from '@capacitor/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { leerQr, urlBase } from './conexion.js';

const $ = (id) => document.getElementById(id);
const CLAVE = 'vinculo';
const guardado = () => JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
const mostrarError = (e) => { $('error').textContent = String(e?.message ?? e); };

async function pedirCamara() {
  const { camera } = await BarcodeScanner.requestPermissions();
  if (camera !== 'granted' && camera !== 'limited') throw new Error('Falta el permiso de la cámara');
}

// Abre la cámara y llama a porCodigo con cada código leído, hasta que se llame a parar().
async function abrirCamara(formats, porCodigo) {
  await pedirCamara();
  document.documentElement.classList.add('escaneando');
  document.body.classList.add('escaneando');
  const oyente = await BarcodeScanner.addListener('barcodesScanned', ({ barcodes }) => {
    for (const b of barcodes) if (b.rawValue) porCodigo(b.rawValue);
  });
  const limpiar = async () => {
    await oyente.remove();
    document.documentElement.classList.remove('escaneando');
    document.body.classList.remove('escaneando');
  };
  try { await BarcodeScanner.startScan({ formats }); } catch (e) { await limpiar(); throw e; }
  return async () => { await limpiar(); await BarcodeScanner.stopScan(); };
}

function pintarVinculo() {
  const v = guardado();
  $('estado').textContent = v ? `Notebook vinculado: ${v.h}:${v.p}` : 'Sin vincular';
  $('btn-escanear').disabled = !v;
}

async function vincular() {
  $('error').textContent = '';
  let parar;
  try {
    const texto = await new Promise((resolver, rechazar) => {
      abrirCamara([BarcodeFormat.QrCode], (t) => resolver(t)).then((p) => { parar = p; }, rechazar);
    });
    await parar?.();
    parar = null;
    const v = leerQr(texto);
    const r = await CapacitorHttp.get({ url: `${urlBase(v)}/hola`, connectTimeout: 5000, readTimeout: 5000 });
    if (r.status === 200 && r.data?.id === v.id) {
      localStorage.setItem(CLAVE, JSON.stringify(v)); // se guarda solo si el notebook es el del QR
      pintarVinculo();
      $('estado').textContent = `Conectado (${v.h}:${v.p})`;
    } else throw new Error(`El notebook respondió algo inesperado (estado ${r.status})`);
  } catch (e) {
    await parar?.();
    mostrarError(e);
  }
}

let pararEscaneo = null;
const resumen = { enviados: 0, ultimo: '-', ms: '-' };
const pintarResumen = () => { $('datos').textContent = `Enviados: ${resumen.enviados}\nÚltimo código: ${resumen.ultimo}\nÚltimo envío: ${resumen.ms} ms`; };

async function escanear() {
  const v = guardado();
  if (!v) return;
  $('error').textContent = '';
  const vistos = new Map();
  const enviar = async (codigo) => {
    const antes = vistos.get(codigo) ?? 0;
    const ahora = Date.now();
    vistos.set(codigo, ahora);
    if (ahora - antes < 1500) return;
    const t0 = performance.now();
    try {
      const r = await CapacitorHttp.post({
        url: `${urlBase(v)}/escaneos`,
        headers: { Authorization: `Bearer ${v.t}`, 'Content-Type': 'application/json' },
        data: { codigo },
        connectTimeout: 5000, readTimeout: 5000,
      });
      if (r.status !== 200 && r.status !== 201) throw new Error(`El notebook respondió con error ${r.status}`);
      resumen.enviados++;
      resumen.ultimo = codigo;
      resumen.ms = Math.round(performance.now() - t0);
      $('error').textContent = '';
    } catch (e) {
      mostrarError(`No se pudo enviar ${codigo}: ${e?.message ?? e}`);
    }
    pintarResumen();
  };
  try {
    pararEscaneo = await abrirCamara(
      [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code128],
      enviar,
    );
    $('btn-escanear').classList.add('oculto');
    $('btn-parar').classList.remove('oculto');
    pintarResumen();
  } catch (e) { mostrarError(e); }
}

async function parar() {
  await pararEscaneo?.();
  pararEscaneo = null;
  $('btn-parar').classList.add('oculto');
  $('btn-escanear').classList.remove('oculto');
}

$('btn-vincular').onclick = vincular;
$('btn-escanear').onclick = escanear;
$('btn-parar').onclick = parar;
$('btn-olvidar').onclick = async () => { await parar(); localStorage.removeItem(CLAVE); pintarVinculo(); };
pintarVinculo();
