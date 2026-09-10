import React, { createContext, ReactNode, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { socketService } from "../services/socketService";
import { registrarPushToken } from "../services/pushNotificationService";

// Direccion de tu servidor (por ahora tu IP local, luego sera tu dominio real)
export const API_BASE_URL = "http://137.184.48.248:3000";

// Token grabado de fabrica en esta compilacion especifica (cada cliente tiene el suyo)
const OWNER_TOKEN_BAKED = process.env.EXPO_PUBLIC_OWNER_TOKEN;

export interface Camion {
  id: number;
  owner_id: string;
  imei: string;
  ficha: string;
  marca: string;
  modelo: string;
  ano: number;
  kilometraje: string;
  estado: string;
  latitud: number;
  longitud: number;
  velocidad: number;
  fecha_vencimiento_seguro: string | null;
  ultima_actualizacion: string | null;
}

export interface User {
  ownerId: string;
  name: string;
  token: string;
}

interface AuthContextData {
  user: User | null;
  trucks: Camion[];
  loading: boolean;
  loginWithCode: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshTrucks: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [trucks, setTrucks] = useState<Camion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const cargarDatos = async (token: string) => {
    try {
      const perfilRes = await fetch(`${API_BASE_URL}/api/mi-perfil`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!perfilRes.ok) throw new Error("Token invalido");
      const perfil = await perfilRes.json();
      setUser({ ownerId: perfil.ownerId, name: perfil.nombre, token });

      // Conectar el socket UNA sola vez aqui (no en cada pantalla) para que las
      // alertas en vivo lleguen sin importar donde este navegando el dueño, y
      // registrar el push token para que tambien lleguen con la app cerrada.
      socketService.conectar(token);
      registrarPushToken(token);

      const camionesRes = await fetch(`${API_BASE_URL}/api/mis-camiones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const camionesData = await camionesRes.json();
      setTrucks(camionesData);
    } catch (e) {
      console.log("Error cargando datos del dueño:", e);
      setUser(null);
      setTrucks([]);
    }
  };

  useEffect(() => {
    async function iniciar() {
      if (OWNER_TOKEN_BAKED) {
        // Esta compilacion ya trae el token de fabrica: entra directo
        await cargarDatos(OWNER_TOKEN_BAKED);
        setLoading(false);
        return;
      }
      // Sin token de fabrica (modo desarrollo): revisa si hay uno guardado de antes
      const tokenGuardado = await AsyncStorage.getItem("@owner_token");
      if (tokenGuardado) {
        await cargarDatos(tokenGuardado);
      }
      setLoading(false);
    }
    iniciar();
  }, []);

  const loginWithCode = async (code: string) => {
    const token = code.trim();
    try {
      const perfilRes = await fetch(`${API_BASE_URL}/api/mi-perfil`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!perfilRes.ok) return false;
      await AsyncStorage.setItem("@owner_token", token);
      await cargarDatos(token);
      return true;
    } catch {
      return false;
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem("@owner_token");
    socketService.desconectar();
    setUser(null);
    setTrucks([]);
  };

  const refreshTrucks = async () => {
    if (user) await cargarDatos(user.token);
  };

  return (
    <AuthContext.Provider value={{ user, trucks, loading, loginWithCode, logout, refreshTrucks }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}