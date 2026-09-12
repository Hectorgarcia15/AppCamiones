import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
  Image,
  TextInput,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth, Camion } from "../context/AuthContext";

const YELLOW = "#FFD500";
const GREEN = "#00FF00";

const colorEstado = (estado: string) =>
  estado === "En Ruta" ? "#22c55e" :
  estado === "Mantenimiento" ? "#ef4444" : "#eab308";

const formatearVelocidad = (velocidad: number | null | undefined) => {
  const valor = typeof velocidad === "number" && !Number.isNaN(velocidad) ? velocidad : 0;
  return `${Math.round(valor)} km/h`;
};

const formatearUltimaSenal = (fechaIso: string | null | undefined) => {
  if (!fechaIso) return "Sin señal";
  const fecha = new Date(fechaIso).getTime();
  if (Number.isNaN(fecha)) return "Sin señal";

  const segundos = Math.floor((Date.now() - fecha) / 1000);
  if (segundos < 60) return "Hace instantes";

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `Hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  return `Hace ${dias} d`;
};

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { user, trucks, refreshTrucks } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  // Fuerza un re-render cada 30s para que "Hace X min" se mantenga al dia
  // sin depender de que llegue un nuevo dato del GPS.
  const [, forzarActualizacionReloj] = useState(0);

  useEffect(() => {
    const intervalo = setInterval(() => forzarActualizacionReloj((t) => t + 1), 30000);
    return () => clearInterval(intervalo);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshTrucks();
    setRefreshing(false);
  };

  const trucksFiltrados = useMemo(() => {
    if (!busqueda.trim()) return trucks;
    const q = busqueda.trim().toLowerCase();
    return trucks.filter((c: Camion) =>
      c.ficha?.toLowerCase().includes(q) ||
      c.marca?.toLowerCase().includes(q) ||
      c.modelo?.toLowerCase().includes(q)
    );
  }, [trucks, busqueda]);

  const irAMapa = (camion: Camion) => {
    if (camion.latitud && camion.longitud) {
      navigation.navigate("LiveMap", { camion });
    } else {
      Alert.alert("Error", "Coordenadas GPS no disponibles para esta unidad.");
    }
  };

  const renderHeader = () => (
    <>
      <View style={styles.imageContainer}>
        <Image
          source={require('../../../assets/camion_frente.png')}
          style={styles.headerImage}
          resizeMode="cover"
        />
        <View style={styles.imageFrameAccent} />
      </View>

      <View style={styles.headerContainer}>
        <TouchableOpacity onPress={() => navigation.navigate("Home")} style={styles.homeButton}>
          <Text style={styles.homeButtonText}>⟸</Text>
        </TouchableOpacity>

        <View style={styles.titleWrapper}>
          <Text style={styles.ownerNameText}>
            {user?.name ? user.name.split(" ")[0] + " " + (user.name.split(" ")[1] || "") : "Dueño"}
          </Text>
          <Text style={styles.truckCountSubtitle}>
            {trucks.length} {trucks.length === 1 ? "Vehículo" : "Vehículos"}
          </Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.instructionText}>TOCA UNA FICHA PARA VER EN TIEMPO REAL</Text>

      {trucks.length > 5 && (
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por placa, marca o modelo..."
          placeholderTextColor="#7a7a7a"
          value={busqueda}
          onChangeText={setBusqueda}
          autoCapitalize="none"
        />
      )}
    </>
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={trucksFiltrados}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={renderHeader}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={YELLOW} colors={[YELLOW]} />
      }
      ListEmptyComponent={
        <Text style={styles.noTrucksText}>
          {trucks.length === 0
            ? "No tienes vehículos asignados a esta flota."
            : "Ningún vehículo coincide con tu búsqueda."}
        </Text>
      }
      renderItem={({ item: camion }) => (
        <TouchableOpacity style={styles.truckCard} onPress={() => irAMapa(camion)}>
          <View style={styles.truckAccentBar} />
          <View style={styles.truckTopRow}>
            <View style={styles.truckInfoLeft}>
              <Text style={styles.truckIcon}>🚚</Text>
              <View style={styles.textContainer}>
                <Text style={styles.truckNameText}>Ficha {camion.ficha}</Text>
                <Text style={styles.truckDetailText} numberOfLines={1}>{camion.marca} {camion.modelo}</Text>
              </View>
            </View>

            <View style={styles.truckStatusRight}>
              <View style={[styles.statusDot, { backgroundColor: colorEstado(camion.estado) }]} />
              <Text style={[styles.verMapaText, { color: colorEstado(camion.estado) }]} numberOfLines={1}>
                {camion.estado || "Ver mapa"}
              </Text>
            </View>
          </View>

          <View style={styles.truckMetaRow}>
            <View style={styles.truckMetaItem}>
              <Text style={styles.truckMetaIcon}>⚡</Text>
              <Text style={styles.truckMetaText}>{formatearVelocidad(camion.velocidad)}</Text>
            </View>
            <View style={styles.truckMetaItem}>
              <Text style={styles.truckMetaIcon}>🕐</Text>
              <Text style={styles.truckMetaText}>{formatearUltimaSenal(camion.ultima_actualizacion)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  content: {
    paddingHorizontal: 15,
    paddingTop: 40,
    paddingBottom: 30,
  },
  imageContainer: {
    width: '100%',
    height: 160,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#111111',
    borderWidth: 2,
    borderColor: YELLOW,
    shadowColor: YELLOW,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  imageFrameAccent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: YELLOW,
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
    width: "100%",
  },
  homeButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: YELLOW,
    backgroundColor: "#111111",
  },
  homeButtonText: {
    fontSize: 24,
    color: YELLOW,
    fontWeight: "900",
  },
  titleWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ownerNameText: {
    fontSize: 26,
    fontWeight: "900",
    color: YELLOW,
    textAlign: "center",
  },
  truckCountSubtitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#e5e5e5",
    marginTop: 4,
    textAlign: "center",
  },
  instructionText: {
    fontSize: 11,
    fontWeight: "bold",
    color: GREEN,
    textAlign: "center",
    marginBottom: 16,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  searchInput: {
    backgroundColor: "#111111",
    color: "#ffffff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: YELLOW,
    fontSize: 14,
  },
  truckCard: {
    backgroundColor: "#111111",
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: "#2a2a2a",
    width: "100%",
  },
  truckAccentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: YELLOW,
  },
  truckTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  truckInfoLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 10,
    marginLeft: 6,
  },
  textContainer: {
    flex: 1,
  },
  truckIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  truckNameText: {
    color: GREEN,
    fontSize: 15,
    fontWeight: "bold",
  },
  truckDetailText: {
    color: "#c9c9c9",
    fontSize: 14,
    marginTop: 2,
    fontWeight: "600",
  },
  truckStatusRight: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    minWidth: 90,
    justifyContent: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  verMapaText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  truckMetaRow: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 10,
    marginLeft: 6,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
  },
  truckMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 20,
  },
  truckMetaIcon: {
    fontSize: 14,
    marginRight: 5,
  },
  truckMetaText: {
    color: "#c9c9c9",
    fontSize: 13,
    fontWeight: "600",
  },
  noTrucksText: {
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 30,
  },
});
