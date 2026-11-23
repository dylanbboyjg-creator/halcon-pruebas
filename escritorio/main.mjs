import { app, BrowserWindow, dialog } from 'electron';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import pkg from 'electron-updater';
import { iniciarNucleo } from '../nucleo/servidor.mjs';

const { autoUpdater } = pkg;
const PUERTO = 47800;

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(arrancar).catch(fallar);

function fallar(err) {
  dialog.showErrorBox('Halcon Pruebas', String(err.message ?? err));
  app.exit(1);
}

async function arrancar() {
  const carpeta = app.getPath('userData');
  const archivoToken = join(carpeta, 'token.txt');
  if (!existsSync(archivoToken)) writeFileSync(archivoToken, randomBytes(32).toString('hex'));
  const token = readFileSync(archivoToken, 'utf8').trim();

  const nucleo = await iniciarNucleo({
    archivoBase: join(carpeta, 'datos.sqlite'), puerto: PUERTO, host: '0.0.0.0', token, version: app.getVersion(),
  });
  app.on('will-quit', () => { nucleo.cerrar(); });

  const ip = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address ?? '(sin red)';
  const qr = await QRCode.toDataURL(JSON.stringify({ h: ip, p: PUERTO, t: token, id: nucleo.id }), { width: 240 });

  const ventana = new BrowserWindow({ width: 520, height: 720, title: 'Halcon Pruebas' });
  ventana.setMenuBarVisibility(false);
  // El token viaja solo por la consulta local de esta ventana (file://), nunca por la red.
  await ventana.loadFile(fileURLToPath(new URL('./ventana.html', import.meta.url)), {
    query: { version: app.getVersion(), ip, puerto: String(PUERTO), token, qr },
  });
  app.on('window-all-closed', () => app.quit());

  if (app.isPackaged) actualizar(join(carpeta, 'actualizador.log'));
}

// Una linea por evento en actualizador.log; al bajar la version nueva se instala en silencio y se reabre.
function actualizar(archivoLog) {
  const anotar = (evento, detalle = '') => appendFileSync(archivoLog, `${new Date().toISOString()} ${evento} ${detalle}`.trimEnd() + '\n');
  autoUpdater.on('checking-for-update', () => anotar('checking-for-update'));
  autoUpdater.on('update-available', (i) => anotar('update-available', i.version));
  autoUpdater.on('update-not-available', (i) => anotar('update-not-available', i.version));
  autoUpdater.on('download-progress', (p) => anotar('download-progress', `${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', (i) => { anotar('update-downloaded', i.version); autoUpdater.quitAndInstall(true, true); });
  autoUpdater.on('error', (e) => anotar('error', String(e?.message ?? e).replace(/\s+/g, ' ')));
  autoUpdater.checkForUpdates().catch((e) => anotar('error', String(e?.message ?? e).replace(/\s+/g, ' ')));
}

app.on('second-instance', () => {
  const v = BrowserWindow.getAllWindows()[0];
  if (v) { if (v.isMinimized()) v.restore(); v.focus(); }
});
