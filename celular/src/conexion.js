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
