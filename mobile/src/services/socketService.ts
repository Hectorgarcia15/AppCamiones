/**
 * SOCKET SERVICE - Conexion unica y centralizada al servidor en tiempo real
 * Se crea UNA sola vez cuando el usuario inicia sesion, no en cada pantalla.
 * Esto evita listeners duplicados cuando el dueno navega entre varios camiones.
 *
 * Cada vez que el socket (re)conecta, el servidor lo ve como un socket nuevo
 * sin sala, asi que hay que volver a mandar 'autenticar' en cada 'connect'
 * para que siga recibiendo las ubicaciones y alertas del dueno.
 */

import { useSyncExternalStore } from 'react';
import { AppState, AppStateStatus, NativeEventSubscription } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../context/AuthContext';

// conectado: hay conexion viva con el servidor
// reconectando: se perdio la conexion y socket.io esta reintentando solo
// desconectado: no hay socket (sin sesion o despues de logout)
// token_rechazado: hay conexion pero el servidor no acepto el codigo del dueño,
// asi que no llegan ubicaciones (el mapa se veria congelado sin avisar)
export type EstadoConexion = 'conectado' | 'reconectando' | 'desconectado' | 'token_rechazado';

class SocketService {
  private socket: Socket | null = null;
  private autenticado = false;
  private token: string | null = null;
  private estado: EstadoConexion = 'desconectado';
  private oyentesEstado = new Set<() => void>();
  private oyentesReconexion = new Set<() => void>();
  // Distingue la primera conexion de las reconexiones: solo en estas hay que
  // resincronizar, porque pudieron perderse ubicaciones mientras no habia socket
  private yaConectoAntes = false;
  private suscripcionAppState: NativeEventSubscription | null = null;

  conectar(token: string) {
    this.token = token;

    if (this.socket && this.autenticado) {
      return this.socket;
    }

    if (!this.socket) {
      this.socket = io(API_BASE_URL, {
        // Reconexion automatica explicita: el celular pierde senal a ratos
        // (cambio de torre, tuneles) y nunca debe dejar de reintentar.
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.5,
        timeout: 10000,
        // En React Native el long-polling inicial falla seguido con redes
        // moviles inestables; ir directo a websocket reconecta mas rapido.
        transports: ['websocket'],
      });
      this.cambiarEstado('reconectando');

      // Se dispara en la primera conexion y en cada reconexion automatica
      this.socket.on('connect', () => {
        if (this.token) {
          this.socket?.emit('autenticar', this.token);
        }
        this.cambiarEstado('conectado');
        if (this.yaConectoAntes) {
          this.oyentesReconexion.forEach((oyente) => oyente());
        }
        this.yaConectoAntes = true;
      });

      this.socket.on('disconnect', (razon) => {
        this.autenticado = false;
        console.log('🔌 Socket desconectado:', razon);
        // Si fue el servidor quien cerro la conexion, socket.io NO reintenta
        // solo; hay que pedir la reconexion a mano (salvo que sea logout).
        if (razon === 'io server disconnect' && this.token) {
          this.socket?.connect();
        }
        this.cambiarEstado(this.token ? 'reconectando' : 'desconectado');
      });

      // Falla del primer intento de conexion (servidor caido, sin internet):
      // socket.io sigue reintentando, asi que se muestra como reconectando
      this.socket.on('connect_error', () => {
        if (this.token) this.cambiarEstado('reconectando');
      });

      this.socket.io.on('reconnect_attempt', (intento) => {
        console.log(`🔄 Reintentando conexion (intento ${intento})...`);
      });

      this.socket.io.on('reconnect', () => {
        console.log('✅ Socket reconectado');
      });

      this.socket.on('autenticado', (respuesta: { ok: boolean }) => {
        this.autenticado = respuesta.ok;
        console.log(respuesta.ok ? '🔑 Autenticado en el servidor' : '❌ Token rechazado');
        this.cambiarEstado(respuesta.ok ? 'conectado' : 'token_rechazado');
      });

      // Al volver a primer plano el socket pudo haber muerto en segundo plano
      // (Android suspende la red) y el backoff puede tener hasta 10 s de espera:
      // se fuerza el reintento de una vez
      this.suscripcionAppState = AppState.addEventListener('change', this.manejarAppState);

      return this.socket;
    }

    // El socket ya existe pero aun no esta autenticado: si ya esta conectado,
    // el 'connect' no se va a repetir, asi que se autentica ahora. Si no esta
    // conectado, el handler de 'connect' lo hara al reconectar.
    if (this.socket.connected) {
      this.socket.emit('autenticar', token);
    }

    return this.socket;
  }

  private manejarAppState = (estadoApp: AppStateStatus) => {
    if (estadoApp === 'active') {
      this.reconectarSiHaceFalta();
    }
  };

  reconectarSiHaceFalta() {
    if (this.socket && this.token && !this.socket.connected) {
      console.log('📱 App en primer plano: forzando reconexion del socket');
      // Mientras socket.io espera el backoff, connect() solo no hace nada:
      // primero se corta el ciclo de reintentos (no emite 'disconnect' porque
      // ya no estaba conectado) y luego se abre una conexion nueva al momento
      this.socket.disconnect();
      this.socket.connect();
    }
  }

  private cambiarEstado(nuevo: EstadoConexion) {
    if (this.estado === nuevo) return;
    this.estado = nuevo;
    this.oyentesEstado.forEach((oyente) => oyente());
  }

  getEstado(): EstadoConexion {
    return this.estado;
  }

  // Devuelve la funcion para dejar de escuchar
  suscribirEstado(oyente: () => void): () => void {
    this.oyentesEstado.add(oyente);
    return () => {
      this.oyentesEstado.delete(oyente);
    };
  }

  // Se llama en cada reconexion (no en la primera conexion)
  suscribirReconexion(oyente: () => void): () => void {
    this.oyentesReconexion.add(oyente);
    return () => {
      this.oyentesReconexion.delete(oyente);
    };
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  estaAutenticado(): boolean {
    return this.autenticado;
  }

  desconectar() {
    // El token se borra antes para que el 'disconnect' no lo tome como caida
    this.token = null;
    this.suscripcionAppState?.remove();
    this.suscripcionAppState = null;
    this.socket?.disconnect();
    this.socket = null;
    this.autenticado = false;
    this.yaConectoAntes = false;
    this.cambiarEstado('desconectado');
  }
}

export const socketService = new SocketService();

// Estado de la conexion en vivo para mostrarlo en pantalla
export function useEstadoConexion(): EstadoConexion {
  return useSyncExternalStore(
    (oyente) => socketService.suscribirEstado(oyente),
    () => socketService.getEstado(),
  );
}
