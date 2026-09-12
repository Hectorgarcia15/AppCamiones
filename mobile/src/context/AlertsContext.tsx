import React, { createContext, useContext, useState, useEffect } from 'react';
import { Audio } from 'expo-av';
import { Vibration } from 'react-native';
import { beepService } from '../services/beepService';
import { useAuth } from './AuthContext';
import { socketService } from '../services/socketService';

type TipoAlerta = 'ruta' | 'velocidad' | 'aceite' | 'seguro' | 'ignicion' | 'apagado' | 'desbloqueo' | 'recordatorio_motor';

interface AlertContextType {
  activeAlert: { type: string; message: string; infinite: boolean } | null;
  triggerAlert: (type: TipoAlerta, kmFaltantes?: number, mensajePersonalizado?: string) => void;
  dismissAlert: () => void;
}

// Mapea el "tipo" que manda el servidor (server.js: dispararAlerta) al tipo de
// alerta local. Un solo listener global cubre las alertas del plan unificado.
// "recordatorio_motor" NO pasa por aqui: no dispara el banner de alerta
// (seria muy invasivo cada 10 min), solo reproduce el sonido leve.
const TIPO_SERVIDOR_A_ALERTA: Record<string, TipoAlerta> = {
  ruta: 'ruta',
  velocidad: 'velocidad',
  encendido: 'ignicion',
  apagado: 'apagado',
  desbloqueo: 'desbloqueo',
  aceite: 'aceite',
  seguro: 'seguro',
};

// Intensidad del sonido y patron de repeticion por tipo de alerta, segun el
// diseño acordado: encendido = 3 pines una vez, apagado/desbloqueo = normal
// una vez, velocidad/ruta = fuerte hasta que se descarte, recordatorio del
// motor = leve una vez (se repite solo porque el servidor lo vuelve a
// emitir cada 10 min, no porque el cliente lo loopee).
type Intensidad = 'leve' | 'normal' | 'fuerte';
type Patron = 'una-vez' | 'triple' | 'loop';

const CONFIG_SONIDO: Record<TipoAlerta, { intensidad: Intensidad; patron: Patron }> = {
  ruta: { intensidad: 'fuerte', patron: 'loop' },
  velocidad: { intensidad: 'fuerte', patron: 'loop' },
  aceite: { intensidad: 'normal', patron: 'una-vez' },
  seguro: { intensidad: 'leve', patron: 'una-vez' },
  ignicion: { intensidad: 'normal', patron: 'triple' },
  apagado: { intensidad: 'normal', patron: 'una-vez' },
  desbloqueo: { intensidad: 'normal', patron: 'una-vez' },
  recordatorio_motor: { intensidad: 'leve', patron: 'una-vez' },
};

const FRECUENCIA_POR_INTENSIDAD: Record<Intensidad, number> = {
  leve: 500,
  normal: 650,
  fuerte: 850,
};

const VOLUMEN_POR_INTENSIDAD: Record<Intensidad, number> = {
  leve: 0.35,
  normal: 0.7,
  fuerte: 1.0,
};

const VIBRACION_POR_INTENSIDAD: Record<Intensidad, number[]> = {
  fuerte: [0, 100, 100, 100, 100, 100],
  normal: [0, 50, 100, 50],
  leve: [0, 30],
};

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeAlert, setActiveAlert] = useState<any>(null);
  const [soundInstance, setSoundInstance] = useState<Audio.Sound | null>(null);

  // Inicializar Audio con el formato moderno de Expo
  useEffect(() => {
    const initAudio = async () => {
      try {
      await Audio.setAudioModeAsync({
  playsInSilentModeIOS: true,
  staysActiveInBackground: true,
  playThroughEarpieceAndroid: false, // 🟢 CAMBIADO: 'shouldRouteThrough...' ahora se llama así
});

      } catch (error) {
        console.log("Error inicializando audio:", error);
      }
    };
    initAudio();
  }, []);

  // Reproduce el sonido correspondiente al tipo de alerta, usando la
  // intensidad (leve/normal/fuerte) y el patrón (una-vez/triple/loop)
  // definidos en CONFIG_SONIDO.
  async function playAlarmSound(type: TipoAlerta) {
    const { intensidad, patron } = CONFIG_SONIDO[type];
    const frecuencia = FRECUENCIA_POR_INTENSIDAD[intensidad];
    const volumen = VOLUMEN_POR_INTENSIDAD[intensidad];

    try {
      if (soundInstance) {
        await soundInstance.unloadAsync().catch(() => {});
        setSoundInstance(null);
      }

      if (patron === 'loop') {
        // Para las alertas que suenan hasta que el usuario las descarte,
        // intentamos primero el archivo real de sirena; si no existe,
        // caemos al beep generado en loop.
        try {
          const soundObj = new Audio.Sound();
          await soundObj.loadAsync(require('../assets/alarma.mp3'));
          setSoundInstance(soundObj);
          await soundObj.setVolumeAsync(volumen);
          await soundObj.setIsLoopingAsync(true);
          await soundObj.playAsync();
          console.log("✓ Sonido alarma.mp3 reproduciendo en loop");
          return;
        } catch (loadError) {
          console.log("⚠️ No se pudo cargar alarma.mp3, usando beep continuo generado");
        }
        await beepService.playLoopingBeep(frecuencia, 700, volumen);
        return;
      }

      // Patrones cortos (una-vez / triple): siempre con el beep generado,
      // para controlar con precisión cuántas veces suena.
      const repeticiones = patron === 'triple' ? 3 : 1;
      await beepService.playRepeatingBeep(frecuencia, 500, repeticiones, 250, volumen);
    } catch (error) {
      console.log("❌ Error general con sonido:", error);
    }
  }

  const { user } = useAuth();

  // Listener global unico: mientras el socket este autenticado, cualquier
  // alerta que dispare el servidor (velocidad, ruta, encendido, apagado)
  // llega aqui sin importar en que pantalla este el dueño.
  useEffect(() => {
    if (!user) return;
    const socket = socketService.getSocket();
    if (!socket) return;

    const manejarAlertaDelServidor = (payload: { tipo: string; mensaje: string }) => {
      // El recordatorio de motor encendido NO abre el banner de alerta (se
      // repite cada 10 min y seria muy invasivo pedir "Apagar Alarma" cada
      // vez) - solo reproduce el sonido leve.
      if (payload.tipo === 'recordatorio_motor') {
        playAlarmSound('recordatorio_motor');
        return;
      }

      const tipoAlerta = TIPO_SERVIDOR_A_ALERTA[payload.tipo];
      if (tipoAlerta) {
        triggerAlert(tipoAlerta, undefined, payload.mensaje);
      }
    };

    socket.on('alerta', manejarAlertaDelServidor);
    return () => {
      socket.off('alerta', manejarAlertaDelServidor);
    };
  }, [user]);

  const triggerAlert = (type: TipoAlerta, kmFaltantes?: number, mensajePersonalizado?: string) => {
    let message = "";

    switch (type) {
      case 'ruta':
        message = "¡ALERTA CRÍTICA! Camión fuera de ruta asignada.";
        break;
      case 'velocidad':
        message = "¡ALERTA DE VELOCIDAD! Unidad excedió los 80 KPH.";
        break;
      case 'aceite':
        message = kmFaltantes === 0
          ? "¡MANTENIMIENTO CRÍTICO! Cambio de aceite obligatorio YA."
          : `Aviso: Faltan ${kmFaltantes} KM para el cambio de aceite.`;
        break;
      case 'seguro':
        message = "Recordatorio: El seguro del camión vence en 1 semana.";
        break;
      case 'ignicion':
        message = "Notificación: Motor encendido.";
        break;
      case 'apagado':
        message = "Notificación: Motor apagado.";
        break;
      case 'desbloqueo':
        message = "Notificación: Vehículo reactivado.";
        break;
      case 'recordatorio_motor':
        message = "Recordatorio: el motor sigue encendido.";
        break;
    }

    if (mensajePersonalizado) {
      message = mensajePersonalizado;
    }

    const { intensidad, patron } = CONFIG_SONIDO[type];
    const infinite = patron === 'loop';

    console.log(`🔔 ALERTA DISPARADA: ${type} - ${message}`);

    setActiveAlert({ type, message, infinite });

    try {
      Vibration.vibrate(VIBRACION_POR_INTENSIDAD[intensidad]);
      console.log("✓ Vibración iniciada");
    } catch (e) {
      console.log("✗ Error en vibración:", e);
    }

    playAlarmSound(type);
  };

  const dismissAlert = async () => {
    try {
      if (soundInstance) {
        await soundInstance.stopAsync().catch(() => {});
        await soundInstance.unloadAsync().catch(() => {});
        setSoundInstance(null);
      }
    } catch (error) {
      console.log("Error al descartar alerta de media real:", error);
    }

    try {
      await beepService.stopLoopingBeep();
    } catch (error) {
      console.log("Error al detener beep continuo:", error);
    }

    setActiveAlert(null);
  };

  return (
    <AlertContext.Provider value={{ activeAlert, triggerAlert, dismissAlert }}>
      {children}
    </AlertContext.Provider>
  );
};

export const useAlerts = () => {
  const context = useContext(AlertContext);
  if (!context) throw new Error("useAlerts debe usarse dentro de AlertProvider");
  return context;
};