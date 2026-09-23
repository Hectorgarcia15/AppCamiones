import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Linking, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth, API_BASE_URL } from '../context/AuthContext';
import { socketService } from '../services/socketService';
import { formatearUltimaSenal } from '../utils/formatearUltimaSenal';
import { obtenerDireccion, distanciaMetros } from '../utils/obtenerDireccion';

// Comandos SMS del tracker HQ (ej. ACCURATE Tracker) - no confundir con el
// apagado GT06, que va por el servidor y sí confirma el resultado.
const COMANDO_APAGAR_HQ = '#stopoil#123456#';
const COMANDO_REACTIVAR_HQ = '#supplyoil#123456#';

// La direccion se vuelve a buscar solo si el camion se movio mas de esto,
// y nunca mas seguido que cada SEGUNDOS_ENTRE_DIRECCIONES
const METROS_PARA_ACTUALIZAR_DIRECCION = 100;
const SEGUNDOS_ENTRE_DIRECCIONES = 30;

export default function LiveMapScreen() {
    const route = useRoute<any>();
    const navigation = useNavigation();
    const { user } = useAuth();

    const camionParam = route?.params?.camion;
    const imei = camionParam?.imei || '352812345678901';
    const nombreCamion = camionParam ? `${camionParam.ficha} - ${camionParam.marca}` : 'Vehiculo';
    const esHQ = camionParam?.protocolo === 'HQ';
    const numeroChip: string | null = camionParam?.numero_chip || null;

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
    const ultimaConsultaDireccion = useRef<{ latitud: number; longitud: number; tiempo: number } | null>(null);

    // Handler nombrado, para poder quitar exactamente ESTE listener al salir
    const manejarActualizacion = useCallback((datos: any) => {
        if (datos && datos.latitud && datos.longitud) {
            console.log(`🚚 ¡Coordenada recibida para ${nombreCamion}!`, datos);
            setCamion({
                latitud: Number(datos.latitud),
                longitud: Number(datos.longitud),
                velocidad: datos.velocidad || 0,
            });
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

    const abrirSMS = async (comando: string) => {
        if (!numeroChip) return;
        // iOS usa "&" antes de "body", Android usa "?" - con el separador
        // equivocado el texto no se prellena en una de las dos plataformas.
        const separador = Platform.OS === 'ios' ? '&' : '?';
        const url = `sms:${numeroChip}${separador}body=${encodeURIComponent(comando)}`;
        try {
            await Linking.openURL(url);
        } catch (error) {
            Alert.alert('No se pudo abrir Mensajes', 'Verifica que tu teléfono tenga una app de SMS disponible.');
        }
    };

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                initialRegion={{
                    latitude: camion.latitud,
                    longitude: camion.longitud,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
                region={{
                    latitude: camion.latitud,
                    longitude: camion.longitud,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }}
            >
                <Marker
                    coordinate={{ latitude: camion.latitud, longitude: camion.longitud }}
                    title={nombreCamion}
                    description={direccion ? `${direccion} · ${camion.velocidad} km/h` : `Velocidad: ${camion.velocidad} km/h`}
                />
            </MapView>

            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Text style={styles.backButtonText}>⬅ Volver al Listado</Text>
            </TouchableOpacity>

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
                {esHQ && (
                    <View style={styles.smsCard}>
                        <Text style={styles.smsTitle}>Apagado remoto por SMS</Text>
                        <Text style={styles.smsAviso}>
                            Este vehículo se controla por SMS directo al chip, no por el servidor.
                            Se abrirá tu app de Mensajes — no podemos confirmar si el motor se apagó.
                        </Text>
                        {numeroChip ? (
                            <>
                                <Text style={styles.smsNumero}>Chip: {numeroChip}</Text>
                                <View style={styles.smsBotones}>
                                    <TouchableOpacity
                                        style={[styles.smsBoton, styles.smsBotonApagar]}
                                        onPress={() => abrirSMS(COMANDO_APAGAR_HQ)}
                                    >
                                        <Text style={styles.smsBotonTexto}>Enviar apagado</Text>
                                        <Text style={styles.smsComandoTexto}>{COMANDO_APAGAR_HQ}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.smsBoton, styles.smsBotonReactivar]}
                                        onPress={() => abrirSMS(COMANDO_REACTIVAR_HQ)}
                                    >
                                        <Text style={[styles.smsBotonTexto, styles.smsBotonReactivarTexto]}>Enviar reactivar</Text>
                                        <Text style={styles.smsComandoTexto}>{COMANDO_REACTIVAR_HQ}</Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        ) : (
                            <Text style={styles.smsFaltaChip}>Falta configurar el número del chip para este vehículo.</Text>
                        )}
                    </View>
                )}

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
    backButton: {
        position: 'absolute',
        top: 50,
        left: 20,
        zIndex: 10,
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#475569',
    },
    backButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
    },
    apagarButton: {
        position: 'absolute',
        top: 50,
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
        top: 92,
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
    },
    infoBox: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#0b54f3',
    },
    smsCard: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#3b82f6',
        marginBottom: 12,
    },
    smsTitle: {
        color: '#93c5fd',
        fontWeight: '900',
        fontSize: 15,
        marginBottom: 6,
    },
    smsAviso: {
        color: '#94a3b8',
        fontSize: 12,
        marginBottom: 10,
        lineHeight: 16,
    },
    smsNumero: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 13,
        marginBottom: 10,
    },
    smsFaltaChip: {
        color: '#fbbf24',
        fontSize: 12,
    },
    smsBotones: {
        flexDirection: 'row',
        gap: 10,
    },
    smsBoton: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1.5,
        alignItems: 'center',
    },
    smsBotonApagar: {
        borderColor: '#3b82f6',
    },
    smsBotonReactivar: {
        borderColor: '#22c55e',
    },
    smsBotonTexto: {
        color: '#93c5fd',
        fontWeight: '900',
        fontSize: 12,
        marginBottom: 2,
    },
    smsBotonReactivarTexto: {
        color: '#22c55e',
    },
    smsComandoTexto: {
        color: '#64748b',
        fontSize: 10,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    truckName: {
        color: '#9cbbfe',
        fontWeight: '900',
        fontSize: 18,
        marginBottom: 4,
    },
    direccionText: {
        color: '#cbd5e1',
        fontSize: 14,
        marginBottom: 4,
    },
    infoText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 15,
        marginBottom: 4,
    },
    imeiText: {
        color: '#64748b',
        fontSize: 12,
    },
});