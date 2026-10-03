import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE_URL } from '../context/AuthContext';

// Que las notificaciones que lleguen con la app abierta tambien se muestren
// como banner del sistema (ademas del banner propio de AlertsContext).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function obtenerExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('⚠️ Push notifications requieren un dispositivo fisico (no emulador/web).');
    return null;
  }

  const permisoActual = await Notifications.getPermissionsAsync();
  let estadoFinal = permisoActual.status;

  if (estadoFinal !== 'granted') {
    const solicitado = await Notifications.requestPermissionsAsync();
    estadoFinal = solicitado.status;
  }

  if (estadoFinal !== 'granted') {
    console.log('⚠️ Permiso de notificaciones no concedido.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alertas de flota',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
    // Canal del "pin" x5 para motor encendido/apagado y exceso de velocidad
    // (server.js: TIPOS_CON_SONIDO_PIN). En Android el sonido de un canal no
    // se puede cambiar despues de creado: si se cambia el archivo, hay que
    // usar un id de canal nuevo aqui y en el servidor.
    await Notifications.setNotificationChannelAsync('alertas-pin5', {
      name: 'Motor y velocidad',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'pinpin5.wav',
      vibrationPattern: [0, 150, 120, 150, 120, 150, 120, 150, 120, 150],
    });
    // Canal anterior de 3 pines: ya no se usa, se quita de los ajustes
    await Notifications.deleteNotificationChannelAsync('alertas-pin');
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const resultado = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  return resultado.data;
}

export async function registrarPushToken(ownerToken: string): Promise<void> {
  try {
    const expoPushToken = await obtenerExpoPushToken();
    if (!expoPushToken) return;

    await fetch(`${API_BASE_URL}/api/registrar-push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ token: expoPushToken }),
    });
    console.log('🔔 Push token registrado en el servidor.');
  } catch (error) {
    console.log('Error registrando push token:', error);
  }
}
