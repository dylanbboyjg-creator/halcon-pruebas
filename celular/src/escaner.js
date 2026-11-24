import { Capacitor, registerPlugin } from '@capacitor/core';

export const nativo = Capacitor.isNativePlatform();

// En el navegador (desarrollo) no hay cámara nativa: mismo contrato, y los códigos se emiten con window.simularCodigo('779...').
function deMentira() {
  const oyentes = new Set();
  let prendida = false;
  window.simularCodigo = (valor, formato = 'EAN_13') => { if (prendida) for (const f of oyentes) f({ valor, formato }); };
  const nada = async () => ({});
  return {
    pedirPermiso: async () => ({ camara: 'granted' }),
    iniciar: async () => { prendida = true; return {}; },
    detener: async () => { prendida = false; return {}; },
    zoom: async ({ factor }) => ({ factor: Math.min(4, Math.max(1, factor)), maximo: 4 }),
    linterna: nada, enfocar: nada, senal: nada, ajustes: nada,
    addListener: async (_evento, f) => { oyentes.add(f); return { remove: async () => oyentes.delete(f) }; },
  };
}

export const Escaner = nativo ? registerPlugin('Escaner') : deMentira();
