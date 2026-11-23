import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { iniciarNucleo } from './servidor.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const archivoToken = `${raiz}token-prueba.txt`;
if (!existsSync(archivoToken)) writeFileSync(archivoToken, randomBytes(16).toString('hex'));
const token = readFileSync(archivoToken, 'utf8').trim();

const n = await iniciarNucleo({ archivoBase: `${raiz}datos-prueba.sqlite`, puerto: 47800, host: '0.0.0.0', token, version: '0.0.0-prueba' });
const ips = Object.values(networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log('Direcciones:', ips.map((ip) => `http://${ip}:${n.puerto}`).join(', ') || '(sin red)');
console.log('Token:', token);
console.log('Id:', n.id);
process.on('SIGINT', async () => { await n.cerrar(); process.exit(0); });
