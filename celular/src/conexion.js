// Lee el texto del QR que muestra la ventana de escritorio.
export function leerQr(texto) {
  let v;
  try { v = JSON.parse(texto); } catch { throw new Error('QR no válido'); }
  const ok = v && typeof v === 'object' && typeof v.h === 'string' && v.h
    && Number.isInteger(v.p) && typeof v.t === 'string' && v.t && typeof v.id === 'string' && v.id;
  if (!ok) throw new Error('QR no válido');
  return { h: v.h, p: v.p, t: v.t, id: v.id };
}

export const urlBase = (v) => `http://${v.h}:${v.p}`;
