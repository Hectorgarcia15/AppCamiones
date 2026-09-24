/**
 * SOCKET SERVICE - Conexion unica y centralizada al servidor en tiempo real
 * Se crea UNA sola vez cuando el usuario inicia sesion, no en cada pantalla.
 * Esto evita listeners duplicados cuando el dueno navega entre varios camiones.
 *
 * Cada vez que el socket (re)conecta, el servidor lo ve como un socket nuevo
 * sin sala, asi que hay que volver a mandar 'autenticar' en cada 'connect'
 * para que siga recibiendo las ubicaciones y alertas del dueno.
 */

import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../context/AuthContext';

class SocketService {
  private socket: Socket | null = null;
  private autenticado = false;
  private token: string | null = null;

  conectar(token: string) {
    this.token = token;

    if (this.socket && this.autenticado) {
      return this.socket;
    }

    if (!this.socket) {
      this.socket = io(API_BASE_URL);

      // Se dispara en la primera conexion y en cada reconexion automatica
      this.socket.on('connect', () => {
        if (this.token) {
          this.socket?.emit('autenticar', this.token);
        }
      });

      this.socket.on('disconnect', () => {
        this.autenticado = false;
      });

      this.socket.on('autenticado', (respuesta: { ok: boolean }) => {
        this.autenticado = respuesta.ok;
        console.log(respuesta.ok ? '🔑 Autenticado en el servidor' : '❌ Token rechazado');
      });

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

  getSocket(): Socket | null {
    return this.socket;
  }

  estaAutenticado(): boolean {
    return this.autenticado;
  }

  desconectar() {
    this.socket?.disconnect();
    this.socket = null;
    this.autenticado = false;
    this.token = null;
  }
}

export const socketService = new SocketService();
