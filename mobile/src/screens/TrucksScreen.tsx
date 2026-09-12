import React from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { Camion } from "../utils/routeAlertUtils";

export default function TrucksScreen() {
  const navigation = useNavigation<any>();
  const { trucks } = useAuth();

  const renderCamion = ({ item }: { item: Camion }) => {
    const colorEstado =
      item.estado === "En Ruta" ? "#22c55e" :
      item.estado === "Mantenimiento" ? "#ef4444" : "#eab308";

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
        <Text style={styles.fichaText}>
  {item.ficha} - <Text style={styles.marcaText}>{item.marca}</Text>
</Text>
          <View style={[styles.badge, { backgroundColor: colorEstado + "20", borderColor: colorEstado }]}> 
            <Text style={[styles.badgeText, { color: colorEstado }]}>{item.estado}</Text>
          </View>
        </View>

        <Text style={styles.modeloText}>{item.modelo} ({item.ano})</Text>
        <Text style={styles.kmText}>📊 Kilometraje: {Math.round(Number(item.kilometraje)).toLocaleString('es-DO')} km</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnDetalles]}
            onPress={() => navigation.navigate("TruckDetail", { camion: item })}
          >
            <Text style={styles.btnText}>Detalles Técnicos</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnMapa]}
            onPress={() => navigation.navigate("LiveMap", { camion: item })}
          >
            <Text style={styles.btnText}>📍 Ver en Tiempo Real</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>⬅️</Text>
        </TouchableOpacity>
        <Text style={styles.headerText}>Mis Unidades</Text>
      </View>
      <FlatList
        data={trucks}
        keyExtractor={(item) => item.id}
        renderItem={renderCamion}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", paddingHorizontal: 20, paddingTop: 20 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  backButton: { paddingRight: 15 },
  backButtonText: { fontSize: 20, color: "#ffffff" },
  headerText: { fontSize: 28, fontWeight: "bold", color: "white", flex: 1 },
  card: { backgroundColor: "#1e293b", padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: "#334155" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  fichaText: { color: "white", fontSize: 18, fontWeight: "bold" },
  marcaText: { color: "black", backgroundColor: "yellow", fontWeight: "900", fontSize: 20, paddingHorizontal: 4 },
  modeloText: { color: "#94a3b8", fontSize: 15, marginBottom: 5 },
  kmText: { color: "#cbd5e1", fontSize: 14, marginBottom: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: "bold" },
  buttonRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  btnDetalles: { backgroundColor: "#334155", marginRight: 8 },
  btnMapa: { backgroundColor: "#16a34a" },
  btnText: { color: "white", fontWeight: "bold", fontSize: 13 },
});
