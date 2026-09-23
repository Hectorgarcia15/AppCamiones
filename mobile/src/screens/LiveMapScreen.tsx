import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth, API_BASE_URL } from '../context/AuthContext';
import { socketService } from '../services/socketService';
import { formatearUltimaSenal } from '../utils/formatearUltimaSenal';
import { obtenerDireccion, distanciaMetros } from '../utils/obtenerDireccion';

// La direccion se vuelve a buscar solo si el camion se movio mas de esto,
// y nunca mas seguido que cada SEGUNDOS_ENTRE_DIRECCIONES
const METROS_PARA_ACTUALIZAR_DIRECCION = 100;
const SEGUNDOS_ENTRE_DIRECCIONES = 30;

// ~1.1 km de alto de pantalla: se ven las calles del sector
const ZOOM_INICIAL_DELTA = 0.01;

export default function LiveMapScreen() {
    const route = useRoute<any>();
    const navigation = useNavigation<any>();
    const { user } = useAuth();

    const camionParam = route?.params?.camion;
    const imei = camionParam?.imei || '352812345678901';
    const nombreCamion = camionParam ? `${camionParam.ficha} - ${camionParam.marca}` : 'Vehiculo';
    const esHQ = camionParam?.protocolo === 'HQ';

    const [camion, setCamion] = useState<{ latitud: number; longitud: number; velocidad: number }>({
        latitud: camionParam?.latitud || 18.4861,
        longitud: camionParam?.longitud || -69.9312,
        velocidad: camionParam?.velocidad || 0,
    });

    // Si el camion ya tiene una ubicacion guardada la mostramos de una vez, en vez
    // de quedarnos en "Esperando señal GPS..." hasta el proximo reporte en vivo
    const [tieneSenal, setTieneSenal] = useState<boolean>(!!(camionParam?.latitud && camionParam?.longitud));
    const [ultimaActualizacion, setUltimaActualizacion] = useState<string | null>(camionParam?.ultima_actualizacion || null);
    const [apagando, setApagando] = useState(false);
    const [bloqueado, setBloqueado] = useState<boolean>(!!camionParam?.bloqueado_remoto);
    const [direccion, setDireccion] = useState<string | null>(null);
    const [buscandoDireccion, setBuscandoDireccion] = useState(false);
    const mapRef = useRef<MapView>(null);
    const ultimaConsultaDireccion = useRef<{ latitud: number; longitud: number; tiempo: number } | null>(null);

    // Handler nombrado, para poder quitar exactamente ESTE listener al salir
    const manejarActualizacion = useCallback((datos: any) => {
        if (datos && datos.latitud && datos.longitud) {
            console.log(`🚚 ¡Coordenada recibida para ${nombreCamion}!`, datos);
            const latitud = Number(datos.latitud);
            const longitud = Number(datos.longitud);
            setCamion({ latitud, longitud, velocidad: datos.velocidad || 0 });
            // Sigue al camion cambiando solo el centro, sin tocar el zoom del usuario
            mapRef.current?.animateCamera({ center: { latitude: latitud, longitude: longitud } });
            setTieneSenal(true);
            setUltimaActualizacion(datos.ultima_actualizacion || new Date().toISOString());
        }
    }, [nombreCamion]);

    useEffect(() => {
        if (!user?.token) return;

        // Conecta y autentica UNA sola vez (si ya estaba conectado, no repite nada)
        const socket = socketService.conectar(user.token);

        const eventoSocket = `camion_${imei}`;
        console.log(`📡 Escuchando en vivo el canal de socket: ${eventoSocket}`);

        socket.on(eventoSocket, manejarActualizacion);

        return () => {
            // Solo quita el listener de ESTE camion, nada mas
            socket.off(eventoSocket, manejarActualizacion);
        };
    }, [imei, user?.token, manejarActualizacion]);

    // Nombre de la calle: se busca al abrir la pantalla y luego solo cuando el
    // camion se movio lo suficiente, para no consultar el geocodificador con
    // cada reporte del GPS
    useEffect(() => {
        if (!tieneSenal) return;

        const anterior = ultimaConsultaDireccion.current;
        if (anterior) {
            const movido = distanciaMetros(anterior.latitud, anterior.longitud, camion.latitud, camion.longitud);
            const segundos = (Date.now() - anterior.tiempo) / 1000;
            if (movido < METROS_PARA_ACTUALIZAR_DIRECCION || segundos < SEGUNDOS_ENTRE_DIRECCIONES) return;
        }

        ultimaConsultaDireccion.current = { latitud: camion.latitud, longitud: camion.longitud, tiempo: Date.now() };
        setBuscandoDireccion(true);
        obtenerDireccion(camion.latitud, camion.longitud).then((resultado) => {
            setDireccion(resultado);
            setBuscandoDireccion(false);
        });
    }, [camion.latitud, camion.longitud, tieneSenal]);

    const camionDetenido = camion.velocidad === 0;

    const confirmarApagado = () => {
        Alert.alert(
            'Apagar el Vehículo',
            '¿Seguro que quieres apagar el motor del Vehículo? El Vehículo no podrá volver a encender hasta que lo actives de nuevo desde la app.',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, apagar', style: 'destructive', onPress: ejecutarApagado },
            ]
        );
    };

    const ejecutarApagado = async () => {
        if (!user?.token) return;
        setApagando(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/apagar-camion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${user.token}`,
                },
                body: JSON.stringify({ imei }),
            });
            const data = await res.json();
            if (res.ok) {
                setBloqueado(true);
                Alert.alert('Comando enviado', 'La orden de apagado fue enviada al camión. Quedará bloqueado hasta que lo reactives desde la app.');
            } else {
                Alert.alert('No se pudo apagar', data.error || 'Intenta de nuevo en unos segundos.');
            }
        } catch (error) {
            Alert.alert('Error de conexión', 'No se pudo contactar al servidor.');
        }
        setApagando(false);
    };

    const confirmarActivacion = () => {
        Alert.alert(
            'Reactivar el Vehículo',
            '¿Seguro que quieres reactivar el motor? A partir de ahora podrá encenderse y apagarse con la llave normalmente.',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, reactivar', onPress: ejecutarActivacion },
            ]
        );
    };

    const ejecutarActivacion = async () => {
        if (!user?.token) return;
        setApagando(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/encender-camion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${user.token}`,
                },
                body: JSON.stringify({ imei }),
            });
            const data = await res.json();
            if (res.ok) {
                setBloqueado(false);
                Alert.alert('Comando enviado', 'El camión fue reactivado y ya puede encenderse con llave.');
            } else {
                Alert.alert('No se pudo reactivar', data.error || 'Intenta de nuevo en unos segundos.');
            }
        } catch (error) {
            Alert.alert('Error de conexión', 'No se pudo contactar al servidor.');
        }
        setApagando(false);
    };

    return (
        <View style={styles.container}>
            {/* Solo initialRegion (sin "region"): asi el zoom que ponga el usuario
                no se reinicia en cada redibujado de la pantalla */}
            <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={{
                    latitude: camion.latitud,
                    longitude: camion.longitud,
                    latitudeDelta: ZOOM_INICIAL_DELTA,
                    longitudeDelta: ZOOM_INICIAL_DELTA,
                }}
            >
                <Marker
                    coordinate={{ latitude: camion.latitud, longitude: camion.longitud }}
                    title={nombreCamion}
                    description={direccion ? `${direccion} · ${camion.velocidad} km/h` : `Velocidad: ${camion.velocidad} km/h`}
                />
            </MapView>

            <View style={styles.navRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Text style={styles.backButtonText}>⬅ Volver atrás</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.backButton, styles.controlesButton]}
                    onPress={() => navigation.navigate('Controles', { camion: camionParam })}
                >
                    <Text style={styles.backButtonText}>Ir a controles ⚙️</Text>
                </TouchableOpacity>
            </View>

            {!esHQ && (
                <>
                    {bloqueado ? (
                        <TouchableOpacity
                            style={[styles.apagarButton, styles.activarButton, apagando && styles.apagarButtonDisabled]}
                            onPress={confirmarActivacion}
                            disabled={apagando}
                        >
                            <Text style={[styles.apagarButtonText, styles.activarButtonText]}>
                                {apagando ? 'ENVIANDO...' : 'REACTIVAR'}
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={[styles.apagarButton, (!camionDetenido || apagando) && styles.apagarButtonDisabled]}
                            onPress={confirmarApagado}
                            disabled={!camionDetenido || apagando}
                        >
                            <Text style={styles.apagarButtonText}>
                                {apagando ? 'ENVIANDO...' : 'APAGAR'}
                            </Text>
                        </TouchableOpacity>
                    )}
                    {bloqueado ? (
                        <Text style={styles.avisoText}>Vehículo bloqueado remotamente</Text>
                    ) : !camionDetenido && (
                        <Text style={styles.avisoText}>Solo se puede apagar con el camión detenido</Text>
                    )}
                </>
            )}

            <View style={styles.bottomContainer}>
                <View style={styles.infoBox}>
                    <Text style={styles.truckName}>{nombreCamion}</Text>
                    {tieneSenal && (direccion || buscandoDireccion) && (
                        <Text style={styles.direccionText}>
                            📍 {direccion || 'Buscando dirección...'}
                        </Text>
                    )}
                    <Text style={styles.infoText}>
                        {tieneSenal ? `Velocidad: ${camion.velocidad} km/h` : "Esperando señal GPS..."}
                    </Text>
                    {tieneSenal && (
                        <Text style={styles.imeiText}>Última señal: {formatearUltimaSenal(ultimaActualizacion)}</Text>
                    )}
                    <Text style={styles.imeiText}>IMEI: {imei}</Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f172a',
    },
    map: {
        flex: 1,
    },
    navRow: {
        position: 'absolute',
        top: 50,
        left: 20,
        right: 20,
        zIndex: 10,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
    },
    backButton: {
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#475569',
    },
    backButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
    },
    controlesButton: {
        borderColor: '#3b82f6',
    },
    // APAGAR/REACTIVAR (GT06) van en una segunda fila, debajo de la navegacion
    apagarButton: {
        position: 'absolute',
        top: 104,
        right: 20,
        zIndex: 10,
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: '#ef4444',
    },
    apagarButtonDisabled: {
        borderColor: '#475569',
        opacity: 0.6,
    },
    apagarButtonText: {
        color: '#ef4444',
        fontWeight: '900',
        fontSize: 14,
        letterSpacing: 0.5,
    },
    activarButton: {
        borderColor: '#22c55e',
    },
    activarButtonText: {
        color: '#22c55e',
    },
    avisoText: {
        position: 'absolute',
        top: 146,
        right: 20,
        maxWidth: 160,
        color: '#94a3b8',
        fontSize: 10,
        textAlign: 'right',
    },
    bottomContainer: {
        position: 'absolute',
        bottom: 40,
        left: 20,
        right: 20,
        // El recuadro toma el ancho de su contenido, centrado, en vez de llenar la fila
        alignItems: 'center',
    },
    infoBox: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        maxWidth: '85%',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#0b54f3',
    },
    truckName: {
        color: '#9cbbfe',
        fontWeight: '900',
        fontSize: 18,
        marginBottom: 2,
    },
    direccionText: {
        color: '#cbd5e1',
        fontSize: 14,
        marginBottom: 2,
    },
    infoText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 15,
        marginBottom: 2,
    },
    imeiText: {
        color: '#64748b',
        fontSize: 12,
    },
});