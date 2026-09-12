import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";

export default function TruckDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  
  // Recibimos los datos del camión que se seleccionó
  const { camion } = route.params || {};

  // Si por alguna razón no hay datos, mostramos un aviso
  if (!camion) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>No se encontraron datos de la unidad.</Text>
      </View>
    );
  }

  // Datos mecánicos según el modelo
  const esMack = camion.marca.toLowerCase() === "mack";
  const detallesMecanicos = {
    motor: esMack ? "Mack MP7 - 11 Litros" : "Cummins ISX15",
    potencia: esMack ? "405 HP" : "450 HP",
    transmision: esMack ? "Fuller Roadranger 18 cambios" : "Eaton Fuller 10 cambios",
    diferencial: esMack ? "Relación 4.11 (Para 50 Toneladas)" : "Relación 3.73",
    aceite: "15W-40 Premium Diesel",
  };

  return (
    <ScrollView style={styles.container}>
      {/* Botón para volver atrás */}
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>⬅️ Volver a la lista</Text>
      </TouchableOpacity>

      <Text style={styles.header}>{camion.marca} {camion.modelo}</Text>
      <Text style={styles.subHeader}>Ficha: {camion.ficha} | Año: {camion.ano}</Text>

      {/* Tarjeta de Estado Actual */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Status Operativo</Text>
        <Text style={styles.infoText}>📍 Estado: <Text style={styles.boldText}>{camion.estado}</Text></Text>
        <Text style={styles.infoText}>📊 Kilometraje: {Math.round(Number(camion.kilometraje)).toLocaleString('es-DO')} km</Text>
      </View>

      {/* Tarjeta de Especificaciones de Mecánica Pesada */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Ficha Técnica del Tren Motriz</Text>
        
        <View style={styles.specRow}>
          <Text style={styles.specLabel}>Motor:</Text>
          <Text style={styles.specValue}>{detallesMecanicos.motor}</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specLabel}>Potencia:</Text>
          <Text style={styles.specValue}>{detallesMecanicos.potencia}</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specLabel}>Transmisión:</Text>
          <Text style={styles.specValue}>{detallesMecanicos.transmision}</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specLabel}>Diferenciales:</Text>
          <Text style={styles.specValue}>{detallesMecanicos.diferencial}</Text>
        </View>
        <View style={styles.specRow}>
          <Text style={styles.specLabel}>Tipo de Aceite:</Text>
          <Text style={styles.specValue}>{detallesMecanicos.aceite}</Text>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", paddingHorizontal: 20, paddingTop: 40 },
  backButton: { marginBottom: 15 },
  backButtonText: { color: "#38bdf8", fontSize: 16, fontWeight: "600" },
  header: { fontSize: 26, fontWeight: "bold", color: "white" },
  subHeader: { fontSize: 15, color: "#94a3b8", marginBottom: 20, marginTop: 5 },
  sectionCard: { backgroundColor: "#1e293b", padding: 20, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: "#334155" },
  sectionTitle: { color: "#38bdf8", fontSize: 16, fontWeight: "bold", marginBottom: 15, borderBottomWidth: 1, borderBottomColor: "#334155", paddingBottom: 8 },
  infoText: { color: "white", fontSize: 16, marginBottom: 10 },
  boldText: { fontWeight: "bold" },
specRow: { 
    flexDirection: "row", 
    alignItems: "center",
    paddingVertical: 8, 
    borderBottomWidth: 1, 
    borderBottomColor: "#1e293b" 
  },
  specLabel: { 
    color: "#94a3b8", 
    fontSize: 14, 
    fontWeight: "600",
    width: 110 // Le damos un ancho fijo y corto a la etiqueta (Motor:, Potencia:, etc.)
  },
  specValue: { 
    color: "white", 
    fontSize: 14, 
    fontWeight: "bold", 
    textAlign: "left", // Cambiamos a la izquierda para que se pegue a los dos puntos
    flex: 1 // Toma el resto del espacio sin salirse de la pantalla
  },
});