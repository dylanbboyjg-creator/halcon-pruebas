import { CapacitorHttp } from '@capacitor/core';
import { urlBase } from './conexion.js';

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
export const hola = async (v, h, ms = 700) => {
  const r = await CapacitorHttp.get({ url: urlBase({ ...v, h }) + '/hola', connectTimeout: ms, readTimeout: ms });
  return r.status === 200 ? r.data?.id ?? null : null;
};
export const escaneo = (v, e) => pedir(v, '/escaneos', e);
export const producto = (v, p) => pedir(v, '/productos', p);
