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
  db.exec(`CREATE TABLE IF NOT EXISTS escaneos (seq INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT NOT NULL, ts INTEGER NOT NULL);
           CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO ajustes (clave, valor) VALUES (?, ?)').run('id', randomUUID());
  const id = db.prepare("SELECT valor FROM ajustes WHERE clave = 'id'").get().valor;

  const insertar = db.prepare('INSERT INTO escaneos (codigo, ts) VALUES (?, ?)');
  const desdeSeq = db.prepare('SELECT seq, codigo FROM escaneos WHERE seq > ? ORDER BY seq');
  const esperas = new Set(); // cada espera: { desde, res, timer }

  const responder = (res, estado, cuerpo) => {
    res.writeHead(estado, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  };
  const cambios = (desde) => {
    const escaneos = desdeSeq.all(desde).map(({ seq, codigo }) => ({ seq, codigo }));
    return { seq: escaneos.length ? escaneos[escaneos.length - 1].seq : desde, escaneos };
  };
  const resolver = (e) => {
    clearTimeout(e.timer);
    esperas.delete(e);
    if (!e.res.destroyed) responder(e.res, 200, cambios(e.desde));
  };
  const leerCuerpo = (req) => new Promise((ok, mal) => {
    let t = '';
    req.on('data', (c) => (t += c));
    req.on('end', () => ok(t));
    req.on('error', mal);
  });

  const servidor = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
      if (req.method === 'GET' && u.pathname === '/hola') return responder(res, 200, { ok: true, version, id });
      if (!tokenValido(req.headers.authorization, token)) return responder(res, 401, { error: 'no autorizado' });

      if (req.method === 'POST' && u.pathname === '/escaneos') {
        let datos;
        try { datos = JSON.parse(await leerCuerpo(req)); } catch { return responder(res, 400, { error: 'JSON inválido' }); }
        if (typeof datos?.codigo !== 'string' || !datos.codigo) return responder(res, 400, { error: 'falta codigo' });
        const seq = Number(insertar.run(datos.codigo, Date.now()).lastInsertRowid);
        responder(res, 200, { seq });
        for (const e of [...esperas]) resolver(e);
        return;
      }
      if (req.method === 'GET' && u.pathname === '/cambios') {
        const desde = Number(u.searchParams.get('desde') ?? 0);
        if (!Number.isInteger(desde) || desde < 0) return responder(res, 400, { error: 'desde inválido' });
        if (cambios(desde).escaneos.length) return responder(res, 200, cambios(desde));
        const e = { desde, res };
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
