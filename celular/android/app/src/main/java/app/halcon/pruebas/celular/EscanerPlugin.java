package app.halcon.pruebas.celular;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.media.Image;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Size;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "Escaner",
    permissions = { @Permission(strings = { Manifest.permission.CAMERA }, alias = "camara") }
)
public class EscanerPlugin extends Plugin {

    // Cuadros seguidos con el mismo valor antes de avisar. Calibrar en un celular real.
    private static final int LECTURAS_NECESARIAS = 2;

    private static final Map<String, Integer> FORMATOS = new LinkedHashMap<>();

    static {
        FORMATOS.put("EAN_13", Barcode.FORMAT_EAN_13);
        FORMATOS.put("EAN_8", Barcode.FORMAT_EAN_8);
        FORMATOS.put("UPC_A", Barcode.FORMAT_UPC_A);
        FORMATOS.put("UPC_E", Barcode.FORMAT_UPC_E);
        FORMATOS.put("CODE_128", Barcode.FORMAT_CODE_128);
        FORMATOS.put("QR_CODE", Barcode.FORMAT_QR_CODE);
    }

    private final ExecutorService hiloAnalisis = Executors.newSingleThreadExecutor();

    // Solo se tocan en el hilo principal.
    private ProcessCameraProvider proveedor;
    private volatile PreviewView vista; // el hilo de análisis lee su tamaño
    private Camera camara;
    private Drawable fondoOriginal;
    private boolean fondoGuardado = false;
    private int turno = 0; // cambia en cada apagado: un arranque que quedó viejo no prende nada

    // Se toca solo dentro de synchronized (this).
    private ToneGenerator tono;

    // Se leen desde el hilo de análisis.
    private volatile BarcodeScanner lector;
    private volatile float zonaArriba;
    private volatile float zonaAbajo;
    private volatile long repetirMs;
    private volatile boolean sonido = true;
    private volatile boolean vibracion = true;

    // Racha por valor: se tocan solo dentro de métodos synchronized.
    private final Map<String, Integer> lecturas = new HashMap<>();
    private final Map<String, Long> ignoradosHasta = new HashMap<>();

    @PluginMethod
    public void pedirPermiso(PluginCall call) {
        if (getPermissionState("camara") == PermissionState.GRANTED) {
            responderPermiso(call);
        } else {
            requestPermissionForAlias("camara", call, "permisoCallback");
        }
    }

    @PermissionCallback
    private void permisoCallback(PluginCall call) {
        responderPermiso(call);
    }

    private void responderPermiso(PluginCall call) {
        JSObject res = new JSObject();
        res.put("camara", getPermissionState("camara").toString());
        call.resolve(res);
    }

    @PluginMethod
    public void iniciar(PluginCall call) {
        int formatos = 0;
        int[] resto;
        try {
            JSArray arr = call.getArray("formatos");
            List<String> nombres = arr == null ? null : arr.toList();
            int[] encontrados = new int[nombres == null ? 0 : nombres.size()];
            int n = 0;
            if (nombres != null) {
                for (String nombre : nombres) {
                    Integer f = FORMATOS.get(nombre);
                    if (f != null) encontrados[n++] = f;
                }
            }
            if (n == 0) {
                call.reject("No hay formatos de código válidos para escanear.");
                return;
            }
            formatos = encontrados[0];
            resto = Arrays.copyOfRange(encontrados, 1, n);
        } catch (Exception e) {
            call.reject("No hay formatos de código válidos para escanear.");
            return;
        }
        if (getPermissionState("camara") != PermissionState.GRANTED) {
            call.reject("Falta el permiso de la cámara. Activalo en los ajustes del celular.");
            return;
        }
        JSObject zona = call.getObject("zona");
        float arriba = zona == null ? 0f : (float) zona.optDouble("arriba", 0);
        float abajo = zona == null ? 1f : (float) zona.optDouble("abajo", 1);
        long repetir = call.getInt("repetirMs", 1000);
        int primero = formatos;
        int[] otros = resto;

        getActivity().runOnUiThread(() -> {
            detenerEnUi();
            final int mio = turno;
            try {
                zonaArriba = arriba;
                zonaAbajo = abajo;
                repetirMs = repetir;
                lector = BarcodeScanning.getClient(
                    new BarcodeScannerOptions.Builder().setBarcodeFormats(primero, otros).build()
                );

                ListenableFuture<ProcessCameraProvider> futuro = ProcessCameraProvider.getInstance(getContext());
                futuro.addListener(
                    () -> {
                        if (mio != turno) {
                            call.reject("Se canceló el arranque de la cámara.", "CANCELADA");
                            return;
                        }
                        try {
                            proveedor = futuro.get();

                            ImageAnalysis analisis = new ImageAnalysis.Builder()
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .setResolutionSelector(
                                    new ResolutionSelector.Builder()
                                        .setResolutionStrategy(
                                            new ResolutionStrategy(
                                                new Size(1280, 720),
                                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                                            )
                                        )
                                        .build()
                                )
                                .build();
                            analisis.setAnalyzer(hiloAnalisis, this::analizar);

                            WebView web = getBridge().getWebView();
                            fondoOriginal = web.getBackground();
                            fondoGuardado = true;
                            web.setBackgroundColor(android.graphics.Color.TRANSPARENT);

                            vista = new PreviewView(getActivity());
                            vista.setLayoutParams(
                                new FrameLayout.LayoutParams(
                                    FrameLayout.LayoutParams.MATCH_PARENT,
                                    FrameLayout.LayoutParams.MATCH_PARENT
                                )
                            );
                            vista.setScaleType(PreviewView.ScaleType.FILL_CENTER);
                            ((ViewGroup) web.getParent()).addView(vista, 0);

                            Preview previa = new Preview.Builder().build();
                            previa.setSurfaceProvider(vista.getSurfaceProvider());

                            camara = proveedor.bindToLifecycle(
                                (LifecycleOwner) getActivity(),
                                CameraSelector.DEFAULT_BACK_CAMERA,
                                previa,
                                analisis
                            );
                            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                            call.resolve();
                        } catch (Exception e) {
                            detenerEnUi();
                            call.reject("No se pudo prender la cámara.");
                        }
                    },
                    ContextCompat.getMainExecutor(getContext())
                );
            } catch (Exception e) {
                detenerEnUi();
                call.reject("No se pudo prender la cámara.");
            }
        });
    }

    @PluginMethod
    public void detener(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            detenerEnUi();
            call.resolve();
        });
    }

    @PluginMethod
    public void linterna(PluginCall call) {
        boolean encendida = call.getBoolean("encendida", false);
        getActivity().runOnUiThread(() -> {
            if (camara == null) {
                call.reject("La cámara no está prendida.");
                return;
            }
            try {
                camara.getCameraControl().enableTorch(encendida);
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo cambiar la linterna.");
            }
        });
    }

    @PluginMethod
    public void zoom(PluginCall call) {
        Float pedido = call.getFloat("factor");
        if (pedido == null) {
            call.reject("Falta el factor de zoom.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ZoomState estado = camara == null ? null : camara.getCameraInfo().getZoomState().getValue();
                if (estado == null) {
                    call.reject("La cámara no está prendida.");
                    return;
                }
                float factor = Math.max(estado.getMinZoomRatio(), Math.min(estado.getMaxZoomRatio(), pedido));
                camara.getCameraControl().setZoomRatio(factor);
                JSObject res = new JSObject();
                res.put("factor", factor);
                res.put("maximo", estado.getMaxZoomRatio());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("No se pudo cambiar el zoom.");
            }
        });
    }

    @PluginMethod
    public void enfocar(PluginCall call) {
        Float x = call.getFloat("x");
        Float y = call.getFloat("y");
        if (x == null || y == null) {
            call.reject("Falta el punto de enfoque.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (camara == null || vista == null) {
                call.reject("La cámara no está prendida.");
                return;
            }
            try {
                MeteringPoint punto = vista.getMeteringPointFactory().createPoint(x * vista.getWidth(), y * vista.getHeight());
                camara.getCameraControl().startFocusAndMetering(new FocusMeteringAction.Builder(punto).build());
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo enfocar.");
            }
        });
    }

    @PluginMethod
    public void senal(PluginCall call) {
        senalNativa("error".equals(call.getString("tipo")));
        call.resolve();
    }

    @PluginMethod
    public void ajustes(PluginCall call) {
        sonido = call.getBoolean("sonido", true);
        vibracion = call.getBoolean("vibracion", true);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::detenerEnUi);
        hiloAnalisis.shutdown();
        synchronized (this) {
            if (tono != null) {
                tono.release();
                tono = null;
            }
        }
    }

    // Debe correr en el hilo principal. Es seguro llamarlo sin nada prendido.
    private void detenerEnUi() {
        turno++;
        BarcodeScanner anterior = lector;
        lector = null;
        if (anterior != null) anterior.close();
        if (proveedor != null) proveedor.unbindAll();
        proveedor = null;
        camara = null;
        if (vista != null) {
            if (vista.getParent() != null) ((ViewGroup) vista.getParent()).removeView(vista);
            vista = null;
        }
        if (fondoGuardado) {
            getBridge().getWebView().setBackground(fondoOriginal);
            fondoOriginal = null;
            fondoGuardado = false;
        }
        getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        synchronized (this) {
            lecturas.clear();
            ignoradosHasta.clear();
        }
    }

    private void analizar(ImageProxy proxy) {
        BarcodeScanner actual = lector;
        @SuppressLint("UnsafeOptInUsageError")
        Image imagen = proxy.getImage();
        if (actual == null || imagen == null) {
            proxy.close();
            return;
        }
        try {
            int giro = proxy.getImageInfo().getRotationDegrees();
            InputImage entrada = InputImage.fromMediaImage(imagen, giro);
            // ML Kit devuelve los recuadros sobre la imagen ya enderezada: con el celular parado, ancho y alto van cruzados.
            boolean cruzada = giro == 90 || giro == 270;
            int ancho = cruzada ? entrada.getHeight() : entrada.getWidth();
            int alto = cruzada ? entrada.getWidth() : entrada.getHeight();
            actual
                .process(entrada)
                .addOnSuccessListener(hiloAnalisis, codigos -> registrar(codigos, ancho, alto))
                .addOnCompleteListener(hiloAnalisis, tarea -> proxy.close());
        } catch (Exception e) {
            proxy.close();
        }
    }

    private synchronized void registrar(List<Barcode> codigos, int ancho, int alto) {
        PreviewView v = vista;
        if (lector == null || v == null || v.getWidth() == 0 || v.getHeight() == 0) return;
        float vw = v.getWidth();
        float vh = v.getHeight();
        float escala = Math.max(vw / ancho, vh / alto);

        Map<String, String> enCuadro = new HashMap<>();
        for (Barcode codigo : codigos) {
            String valor = codigo.getRawValue();
            Rect caja = codigo.getBoundingBox();
            if (valor == null || caja == null) continue;
            float y = (caja.centerY() * escala - (alto * escala - vh) / 2) / vh;
            if (y >= zonaArriba && y <= zonaAbajo) enCuadro.put(valor, nombreFormato(codigo.getFormat()));
        }

        // Un cuadro sin el valor corta su racha.
        lecturas.keySet().retainAll(enCuadro.keySet());
        long ahora = SystemClock.elapsedRealtime();
        for (Map.Entry<String, String> e : enCuadro.entrySet()) {
            String valor = e.getKey();
            Long hasta = ignoradosHasta.get(valor);
            if (hasta != null && ahora < hasta) continue;
            int n = lecturas.merge(valor, 1, Integer::sum);
            if (n < LECTURAS_NECESARIAS) continue;
            lecturas.remove(valor);
            ignoradosHasta.put(valor, ahora + repetirMs);
            senalNativa(false);
            JSObject res = new JSObject();
            res.put("valor", valor);
            res.put("formato", e.getValue());
            notifyListeners("codigo", res);
        }
    }

    private static String nombreFormato(int formato) {
        for (Map.Entry<String, Integer> e : FORMATOS.entrySet()) {
            if (e.getValue() == formato) return e.getKey();
        }
        return "DESCONOCIDO";
    }

    @SuppressWarnings("deprecation")
    private void senalNativa(boolean error) {
        if (vibracion) {
            Vibrator vibrador = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrador != null) {
                long[] patron = error ? new long[] { 0, 80, 60, 80 } : new long[] { 0, 60 };
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrador.vibrate(VibrationEffect.createWaveform(patron, -1));
                } else {
                    vibrador.vibrate(patron, -1);
                }
            }
        }
        if (sonido) {
            synchronized (this) {
                try {
                    if (tono == null) tono = new ToneGenerator(AudioManager.STREAM_MUSIC, 80);
                    tono.startTone(error ? ToneGenerator.TONE_SUP_ERROR : ToneGenerator.TONE_PROP_BEEP, error ? 300 : 120);
                } catch (RuntimeException e) {
                    // sin sonido: seguimos igual
                }
            }
        }
    }
}
