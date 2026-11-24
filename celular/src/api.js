import { CapacitorHttp } from '@capacitor/core';
import { urlBase, firma } from './conexion.js';

// La notebook está en el mismo Wi-Fi: si no contesta en 2,5 s, no va a contestar.
const pedir = async (v, ruta, data, ms = 2500) => {
  const r = await CapacitorHttp.post({
    url: urlBase(v) + ruta,
    headers: { Authorization: `Bearer ${v.t}`, 'Content-Type': 'application/json' },
    data, connectTimeout: ms, readTimeout: ms,
  });
  if (r.status !== 200) throw new Error(`La notebook respondió ${r.status}`);
  return r.data;
};

// Devuelve el identificador de la notebook que hay en esa dirección, o null.
// Solo vale si demuestra que conoce la clave del QR: el identificador es público y cualquiera en la red lo puede repetir.
export const hola = async (v, h, ms = 700) => {
  const uso = crypto.randomUUID();
  const r = await CapacitorHttp.get({ url: `${urlBase({ ...v, h })}/hola?n=${uso}`, connectTimeout: ms, readTimeout: ms });
  if (r.status !== 200 || typeof r.data?.id !== 'string') return null;
  return r.data.prueba === await firma(v.t, `${uso}.${r.data.id}.${h}`) ? r.data.id : null;
};
export const escaneo = (v, e) => pedir(v, '/escaneos', e);
export const producto = (v, p) => pedir(v, '/productos', p);
