// Estado de la lista de escaneos; sin pantalla ni red.
export function crearLista(generarId = () => crypto.randomUUID()) {
  let lista = [];
  const buscar = (id) => lista.find((x) => x.id === id) ?? null;
  return {
    agregar(codigo) {
      const item = { id: generarId(), codigo, cantidad: 1, estado: 'enviando', nombre: null, precio: null, error: null };
      lista.unshift(item);
      return item;
    },
    confirmar(id, { producto }) {
      const i = buscar(id);
      if (!i) return null;
      if (producto) Object.assign(i, { estado: 'ok', nombre: producto.nombre, precio: producto.precio });
      else i.estado = 'nuevo';
      return i;
    },
    fallar(id, mensaje) {
      const i = buscar(id);
      if (!i) return null;
      Object.assign(i, { estado: 'error', error: mensaje });
      return i;
    },
    reintentar(id) {
      const i = buscar(id);
      if (!i) return null;
      Object.assign(i, { estado: 'enviando', error: null });
      return i;
    },
    cambiarCantidad(id, delta) {
      const i = buscar(id);
      if (!i) return null;
      i.cantidad = Math.min(9999, Math.max(0, i.cantidad + delta));
      if (i.cantidad === 0) lista = lista.filter((x) => x !== i);
      return i;
    },
    items: () => [...lista],
    resumen: () => ({
      renglones: lista.length,
      unidades: lista.reduce((s, i) => s + i.cantidad, 0),
      total: lista.reduce((s, i) => s + (i.precio == null ? 0 : i.precio * i.cantidad), 0),
    }),
  };
}
