const privada = (h) => {
  const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(h);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  return [a, b, c, d].every((n) => n <= 255) && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
};

// Lee el texto del QR que muestra la ventana de escritorio.
export function leerQr(texto) {
  let v;
  try { v = JSON.parse(texto); } catch { throw new Error('QR no válido'); }
  const ok = v && typeof v === 'object' && typeof v.h === 'string' && v.h
    && privada(v.h) && Number.isInteger(v.p) && v.p >= 1 && v.p <= 65535 && typeof v.t === 'string' && v.t && typeof v.id === 'string' && v.id;
  if (!ok) throw new Error('QR no válido');
  return { h: v.h, p: v.p, t: v.t, id: v.id };
}

export const urlBase = (v) => `http://${v.h}:${v.p}`;

// HMAC-SHA256 en hexadecimal. Sirve para comprobar que quien contesta conoce la clave del QR sin que la clave viaje.
export async function firma(clave, texto) {
  const cod = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', cod.encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const f = await crypto.subtle.sign('HMAC', k, cod.encode(texto));
  return [...new Uint8Array(f)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Las otras direcciones de la red /24, de la más cercana a la más lejana (en empate, la menor primero).
export function candidatas(h) {
  const i = h.lastIndexOf('.') + 1;
  const pre = h.slice(0, i), n = Number(h.slice(i));
  return Array.from({ length: 254 }, (_, k) => k + 1)
    .filter((k) => k !== n)
    .sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || a - b)
    .map((k) => pre + k);
}

// Si la IP del QR cambió (DHCP), busca la notebook por su identificador en la misma red.
export async function buscarNotebook(v, pedirHola, tanda = 32) {
  const es = async (h) => (await pedirHola(h).catch(() => null)) === v.id;
  if (await es(v.h)) return v;
  const lista = candidatas(v.h);
  for (let i = 0; i < lista.length; i += tanda) {
    const hs = lista.slice(i, i + tanda);
    const ok = await Promise.all(hs.map(es));
    const k = ok.indexOf(true);
    if (k >= 0) return { ...v, h: hs[k] };
  }
  return null;
}
