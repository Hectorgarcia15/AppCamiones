import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Linking, Platform, ScrollView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth, API_BASE_URL } from '../context/AuthContext';

// Comandos SMS del tracker HQ (ej. ACCURATE Tracker) - no confundir con el
// apagado GT06, que va por el servidor y sí confirma el resultado.
const COMANDO_APAGAR_HQ = '#stopoil#123456#';
const COMANDO_ENCENDER_HQ = '#supplyoil#123456#';

type EstadoMantenimiento = {
    kilometraje: number;
    proximoCambioKm: number;
    kmFaltantesAceite: number;
    diasParaVencerSeguro: number | null;
    fechaVencimientoSeguro: string | null;
};

type Consulta = { cargando: boolean; texto: string | null; detalle: string | null; error: boolean };
const CONSULTA_VACIA: Consulta = { cargando: false, texto: null, detalle: null, error: false };

const formatearKm = (km: number) => `${km.toLocaleString('es-DO')} km`;
const plural = (n: number, palabra: string) => `${n} ${palabra}${n === 1 ? '' : 's'}`;

function textoAceite(estado: EstadoMantenimiento) {
    const km = estado.kmFaltantesAceite;
    const detalle = `Próximo cambio a los ${formatearKm(estado.proximoCambioKm)} · Kilometraje actual: ${formatearKm(estado.kilometraje)}`;
    if (km > 0) return { texto: `Faltan ${formatearKm(km)} para el cambio de aceite`, detalle };
    if (km === 0) return { texto: 'El cambio de aceite toca ahora', detalle };
    return { texto: `Cambio de aceite vencido por ${formatearKm(Math.abs(km))}`, detalle };
}

function textoSeguro(estado: EstadoMantenimiento) {
    const dias = estado.diasParaVencerSeguro;
    if (dias === null || !estado.fechaVencimientoSeguro) {
        return { texto: 'No hay fecha de vencimiento de seguro registrada', detalle: null };
    }
    const detalle = `Fecha de vencimiento: ${estado.fechaVencimientoSeguro}`;
    if (dias > 0) return { texto: `Faltan ${plural(dias, 'día')} para que venza el seguro`, detalle };
    if (dias === 0) return { texto: 'El seguro vence hoy', detalle };
    return { texto: `El seguro venció hace ${plural(Math.abs(dias), 'día')}`, detalle };
}

export default function ControlesScreen() {
    const route = useRoute<any>();
    const navigation = useNavigation();
    const { user } = useAuth();

    const camionParam = route?.params?.camion;
    const imei = camionParam?.imei;
    const nombreCamion = camionParam ? `${camionParam.ficha} - ${camionParam.marca}` : 'Vehiculo';
    const esHQ = camionParam?.protocolo === 'HQ';
    const numeroChip: string | null = camionParam?.numero_chip || null;

    const [aceite, setAceite] = useState<Consulta>(CONSULTA_VACIA);
    const [seguro, setSeguro] = useState<Consulta>(CONSULTA_VACIA);

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

    // Mantenimiento y Seguro piden el estado al servidor en el momento, para
    // que el kilometraje y los dias esten al dia (la lista de camiones puede
    // haberse cargado hace rato)
    const consultar = async (
        setConsulta: (c: Consulta) => void,
        armarTexto: (estado: EstadoMantenimiento) => { texto: string; detalle: string | null },
    ) => {
        if (!user?.token || !imei) return;
        setConsulta({ ...CONSULTA_VACIA, cargando: true });
        try {
            const res = await fetch(`${API_BASE_URL}/api/camion/${imei}/estado-mantenimiento`, {
                headers: { Authorization: `Bearer ${user.token}` },
            });
            const data = await res.json();
            if (!res.ok) {
                setConsulta({ ...CONSULTA_VACIA, texto: data.error || 'No se pudo consultar. Intenta de nuevo.', error: true });
                return;
            }
            setConsulta({ ...CONSULTA_VACIA, ...armarTexto(data) });
        } catch (error) {
            setConsulta({ ...CONSULTA_VACIA, texto: 'No se pudo contactar al servidor.', error: true });
        }
    };

    const renderResultado = (consulta: Consulta) => {
        if (!consulta.texto) return null;
        return (
            <View style={styles.resultado}>
                <Text style={[styles.resultadoTexto, consulta.error && styles.resultadoError]}>{consulta.texto}</Text>
                {consulta.detalle && <Text style={styles.resultadoDetalle}>{consulta.detalle}</Text>}
            </View>
        );
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.contenido}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Text style={styles.backButtonText}>⬅ Volver atrás</Text>
            </TouchableOpacity>

            <Text style={styles.titulo}>Controles</Text>
            <Text style={styles.subtitulo}>{nombreCamion}</Text>

            {esHQ && (
                <View style={[styles.card, styles.smsCard]}>
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
                                    style={[styles.smsBoton, styles.smsBotonEncender]}
                                    onPress={() => abrirSMS(COMANDO_ENCENDER_HQ)}
                                >
                                    <Text style={[styles.smsBotonTexto, styles.smsBotonEncenderTexto]}>Enviar encendido</Text>
                                    <Text style={styles.smsComandoTexto}>{COMANDO_ENCENDER_HQ}</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <Text style={styles.smsFaltaChip}>Falta configurar el número del chip para este vehículo.</Text>
                    )}
                </View>
            )}

            <View style={styles.card}>
                <TouchableOpacity
                    style={[styles.botonConsulta, aceite.cargando && styles.botonDeshabilitado]}
                    onPress={() => consultar(setAceite, textoAceite)}
                    disabled={aceite.cargando}
                >
                    <Text style={styles.botonConsultaTexto}>{aceite.cargando ? 'Consultando...' : '🛢️ Mantenimiento'}</Text>
                </TouchableOpacity>
                {renderResultado(aceite)}
            </View>

            <View style={styles.card}>
                <TouchableOpacity
                    style={[styles.botonConsulta, seguro.cargando && styles.botonDeshabilitado]}
                    onPress={() => consultar(setSeguro, textoSeguro)}
                    disabled={seguro.cargando}
                >
                    <Text style={styles.botonConsultaTexto}>{seguro.cargando ? 'Consultando...' : '📄 Seguro'}</Text>
                </TouchableOpacity>
                {renderResultado(seguro)}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f172a',
    },
    contenido: {
        paddingTop: 50,
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    backButton: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(30, 41, 59, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#475569',
        marginBottom: 20,
    },
    backButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
    },
    titulo: {
        color: '#ffffff',
        fontWeight: '900',
        fontSize: 24,
    },
    subtitulo: {
        color: '#9cbbfe',
        fontWeight: 'bold',
        fontSize: 16,
        marginBottom: 20,
    },
    card: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#0b54f3',
        marginBottom: 12,
    },
    smsCard: {
        borderWidth: 1.5,
        borderColor: '#3b82f6',
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
    smsBotonEncender: {
        borderColor: '#22c55e',
    },
    smsBotonTexto: {
        color: '#93c5fd',
        fontWeight: '900',
        fontSize: 12,
        marginBottom: 2,
    },
    smsBotonEncenderTexto: {
        color: '#22c55e',
    },
    smsComandoTexto: {
        color: '#64748b',
        fontSize: 10,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    botonConsulta: {
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: '#3b82f6',
        alignItems: 'center',
    },
    botonDeshabilitado: {
        opacity: 0.6,
    },
    botonConsultaTexto: {
        color: '#93c5fd',
        fontWeight: '900',
        fontSize: 15,
    },
    resultado: {
        marginTop: 12,
    },
    resultadoTexto: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 15,
        textAlign: 'center',
    },
    resultadoError: {
        color: '#fbbf24',
    },
    resultadoDetalle: {
        color: '#94a3b8',
        fontSize: 12,
        textAlign: 'center',
        marginTop: 4,
    },
});
