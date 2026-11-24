import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

// Se comparan los hashes para que tengan siempre la misma longitud y no lance con tokens de otro largo.
const hash = (t) => createHash('sha256').update(String(t ?? '')).digest();
const tokenValido = (recibido, token) => timingSafeEqual(hash(recibido), hash(`Bearer ${token}`));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export async function iniciarNucleo({ archivoBase, puerto, host, token, version, esperaMs = 25000 }) {
  const db = new DatabaseSync(archivoBase);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  // Tabla de una versión anterior (sin id): son datos de prueba, se rehace.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('escaneos') WHERE name = 'id'").get()) db.exec('DROP TABLE IF EXISTS escaneos');
  db.exec(`CREATE TABLE IF NOT EXISTS escaneos (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, codigo TEXT NOT NULL, cantidad INTEGER NOT NULL, ts INTEGER NOT NULL);
           CREATE TABLE IF NOT EXISTS productos (codigo TEXT PRIMARY KEY, nombre TEXT NOT NULL, precio INTEGER NOT NULL);
           CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO ajustes (clave, valor) VALUES (?, ?)').run('id', randomUUID());
  db.prepare("INSERT OR IGNORE INTO ajustes (clave, valor) VALUES ('version', '0')").run();
  const id = db.prepare("SELECT valor FROM ajustes WHERE clave = 'id'").get().valor;

  const leerVersion = db.prepare("SELECT CAST(valor AS INTEGER) AS v FROM ajustes WHERE clave = 'version'");
  const subirVersion = db.prepare("UPDATE ajustes SET valor = CAST(valor AS INTEGER) + 1 WHERE clave = 'version'");
  const porId = db.prepare('SELECT seq, codigo, cantidad FROM escaneos WHERE id = ?');
  const insertar = db.prepare('INSERT INTO escaneos (id, codigo, cantidad, ts) VALUES (?, ?, ?, ?)');
  const actualizar = db.prepare('UPDATE escaneos SET cantidad = ? WHERE seq = ?');
  const borrar = db.prepare('DELETE FROM escaneos WHERE seq = ?');
  const producto = db.prepare('SELECT codigo, nombre, precio FROM productos WHERE codigo = ?');
  const guardarProducto = db.prepare('INSERT OR REPLACE INTO productos (codigo, nombre, precio) VALUES (?, ?, ?)');
  const ultimos = db.prepare(`SELECT e.seq, e.id, e.codigo, e.cantidad, p.nombre, p.precio
    FROM escaneos e LEFT JOIN productos p ON p.codigo = e.codigo ORDER BY e.seq DESC LIMIT 100`);
  const esperas = new Set(); // cada espera: { res, timer }

  const responder = (res, estado, cuerpo) => {
    res.writeHead(estado, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  };
  const estado = () => ({ version: leerVersion.get().v, escaneos: ultimos.all().map((f) => ({ ...f })) });
  const resolver = (e) => {
    clearTimeout(e.timer);
    esperas.delete(e);
    if (!e.res.destroyed) responder(e.res, 200, estado());
  };
  const cambio = () => { subirVersion.run(); for (const e of [...esperas]) resolver(e); };
  const TOPE = 16 * 1024;
  // Si se pasa del tope sigue leyendo sin guardar (para poder contestar 413) y devuelve null.
  const leerCuerpo = (req) => new Promise((ok, mal) => {
    let t = '', largo = 0;
    req.on('data', (c) => { largo += c.length; if (largo <= TOPE) t += c; });
    req.on('end', () => ok(largo > TOPE ? null : t));
    req.on('error', mal);
  });
  const texto = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
  const entero = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

  const servidor = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      // Para diagnosticar pruebas con el celular: quién pidió qué y qué se le respondió.
      if (process.env.HALCON_LOG) res.on('close', () => console.log(new Date().toISOString(), req.socket.remoteAddress, req.method, u.pathname, res.statusCode));
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      if (req.method === 'GET' && u.pathname === '/hola') return responder(res, 200, { ok: true, version, id });
      if (!tokenValido(req.headers.authorization, token)) return responder(res, 401, { error: 'no autorizado' });

      if (req.method === 'POST' && (u.pathname === '/escaneos' || u.pathname === '/productos')) {
        const crudo = await leerCuerpo(req);
        if (crudo === null) return responder(res, 413, { error: 'cuerpo demasiado grande' });
        let d;
        try { d = JSON.parse(crudo); } catch { return responder(res, 400, { error: 'JSON inválido' }); }
        if (u.pathname === '/productos') {
          const nombre = typeof d?.nombre === 'string' ? d.nombre.trim() : '';
          if (!texto(d?.codigo, 64) || !texto(nombre, 80) || !entero(d.precio, 99999999)) return responder(res, 400, { error: 'producto inválido' });
          guardarProducto.run(d.codigo, nombre, d.precio);
          responder(res, 200, { codigo: d.codigo, nombre, precio: d.precio });
          return cambio();
        }
        if (!texto(d?.id, 64) || !texto(d?.codigo, 64) || (d.cantidad !== undefined && !entero(d.cantidad, 9999))) return responder(res, 400, { error: 'escaneo inválido' });
        const previo = porId.get(d.id);
        let seq, cantidad, cambia = true;
        if (!previo) {
          // shortcut: un id nuevo con cantidad 0 no crea nada y responde seq 0; revisar si el celular lo necesita.
          cantidad = d.cantidad ?? 1;
          if (cantidad === 0) { seq = 0; cambia = false; } else seq = Number(insertar.run(d.id, d.codigo, cantidad, Date.now()).lastInsertRowid);
        } else if (previo.codigo !== d.codigo) {
          return responder(res, 409, { error: 'el id ya tiene otro código' });
        } else {
          seq = previo.seq;
          cantidad = d.cantidad ?? previo.cantidad;
          if (cantidad === 0) borrar.run(seq);
          else if (cantidad !== previo.cantidad) actualizar.run(cantidad, seq);
          else cambia = false;
        }
        const p = producto.get(d.codigo);
        responder(res, 200, { seq, cantidad, producto: p ? { ...p } : null });
        if (cambia) cambio();
        return;
      }
      if (req.method === 'GET' && u.pathname === '/cambios') {
        const desde = Number(u.searchParams.get('desde') ?? 0);
        if (!Number.isInteger(desde) || desde < 0) return responder(res, 400, { error: 'desde inválido' });
        if (leerVersion.get().v > desde) return responder(res, 200, estado());
        const e = { res };
        e.timer = setTimeout(() => resolver(e), esperaMs);
        esperas.add(e);
        res.on('close', () => { clearTimeout(e.timer); esperas.delete(e); });
        return;
      }
      responder(res, 404, { error: 'no existe' });
    } catch (err) {
      if (!res.headersSent) responder(res, 500, { error: String(err.message) });
    }
  });

  await new Promise((ok, mal) => {
    servidor.once('error', (err) => mal(err.code === 'EADDRINUSE' ? new Error(`El puerto ${puerto} ya está en uso (puerto en uso)`) : err));
    servidor.listen(puerto, host, ok);
  });
  servidor.on('error', (err) => console.error('error del servidor:', err));

  return {
    puerto: servidor.address().port,
    id,
    async cerrar() {
      for (const e of [...esperas]) resolver(e);
      await new Promise((ok) => { servidor.close(ok); servidor.closeAllConnections(); });
      db.close();
    },
  };
}
