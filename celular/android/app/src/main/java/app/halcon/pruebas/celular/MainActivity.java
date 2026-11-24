package app.halcon.pruebas.celular;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EscanerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
