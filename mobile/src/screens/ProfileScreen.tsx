import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import * as Application from "expo-application";
import { useNavigation } from "@react-navigation/native";
import { useAuth, API_BASE_URL } from "../context/AuthContext";

// Iniciales para el circulo (ej. "Hector Garcia" -> "HG")
const iniciales = (nombre?: string) =>
  (nombre || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?";

const formatearHora = (fecha: Date | null) =>
  fecha
    ? fecha.toLocaleString("es-DO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user, trucks, logout, ultimaCargaCamiones } = useAuth();
  const [cerrando, setCerrando] = useState(false);

  // Version visible en Ajustes de Android (versionName) y numero de build
  // (versionCode), que EAS sube solo en cada build (autoIncrement)
  const version = `${Application.nativeApplicationVersion ?? "?"} (build ${Application.nativeBuildVersion ?? "?"})`;
  const servidor = API_BASE_URL.replace(/^https?:\/\//, "");

  const confirmarCierre = () => {
    Alert.alert(
      "Cerrar sesión",
      `Vas a salir de la cuenta de ${user?.name || "este dueño"}. Para volver a entrar necesitarás el código de acceso.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar sesión",
          style: "destructive",
          onPress: async () => {
            setCerrando(true);
            // Al quedar sin usuario, AppNavigator cambia solo a la pantalla de inicio
            await logout();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>⬅ Volver</Text>
      </TouchableOpacity>

      <View style={styles.avatarPlaceholder}>
        <Text style={styles.avatarText}>{iniciales(user?.name)}</Text>
      </View>

      <Text style={styles.title}>{user?.name || "Dueño"}</Text>
      <Text style={styles.subtitle}>
        Administrador de Flota · {trucks.length} {trucks.length === 1 ? "vehículo" : "vehículos"}
      </Text>

      <TouchableOpacity
        style={[styles.logoutButton, cerrando && styles.logoutButtonDisabled]}
        onPress={confirmarCierre}
        disabled={cerrando}
      >
        <Text style={styles.logoutText}>{cerrando ? "Cerrando sesión..." : "Cerrar Sesión"}</Text>
      </TouchableOpacity>

      {/* Diagnostico: para saber de un vistazo que APK tiene el telefono, a que
          servidor habla y en que cuenta esta (si alguien ve datos ajenos) */}
      <View style={styles.diagnostico}>
        <Text style={styles.diagnosticoTitulo}>Diagnóstico</Text>
        <Text style={styles.diagnosticoLinea}>Versión: {version}</Text>
        <Text style={styles.diagnosticoLinea}>Servidor: {servidor}</Text>
        <Text style={styles.diagnosticoLinea}>Cuenta: {user?.ownerId || "—"}</Text>
        <Text style={styles.diagnosticoLinea}>Lista actualizada: {formatearHora(ultimaCargaCamiones)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f172a", // Azul oscuro oficial
    padding: 20,
  },
  backButton: {
    position: "absolute",
    top: 50,
    left: 20,
    backgroundColor: "rgba(30, 41, 59, 0.9)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#475569",
  },
  backButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  avatarText: {
    color: "white",
    fontSize: 40,
    fontWeight: "bold",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "white",
    marginBottom: 5,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#cbd5e1",
    marginBottom: 40,
    textAlign: "center",
  },
  logoutButton: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutButtonDisabled: {
    opacity: 0.6,
  },
  logoutText: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  diagnostico: {
    marginTop: 40,
    alignSelf: "stretch",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "rgba(30, 41, 59, 0.6)",
  },
  diagnosticoTitulo: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  diagnosticoLinea: {
    color: "#cbd5e1",
    fontSize: 12,
  },
});
