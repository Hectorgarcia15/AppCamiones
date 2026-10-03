import React, { useEffect, useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, AppState, Animated, Easing } from 'react-native';
import MapView, { Marker, Polyline, Camera, LatLng } from 'react-native-maps';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useAuth, API_BASE_URL } from '../context/AuthContext';
import { socketService, useEstadoConexion } from '../services/socketService';
import { formatearUltimaSenal } from '../utils/formatearUltimaSenal';
import { obtenerDireccion, distanciaMetros } from '../utils/obtenerDireccion';

// La direccion se vuelve a buscar solo si el camion se movio mas de esto,
// y nunca mas seguido que cada SEGUNDOS_ENTRE_DIRECCIONES
const METROS_PARA_ACTUALIZAR_DIRECCION = 100;
const SEGUNDOS_ENTRE_DIRECCIONES = 30;

// ~550 m de alto de pantalla: vista cerrada sobre las calles junto al camion
const ZOOM_INICIAL_DELTA = 0.005;

// Tope de puntos de la estela, para que no crezca sin limite si la pantalla
// queda abierta horas (con un reporte cada ~10 s son mas de 80 min de camino)
const MAX_PUNTOS_ESTELA = 500;

type Punto = { latitude: number; longitude: number };

// El rumbo se calcula con las posiciones GPS (no con el que manda el tracker,
// que no era confiable y no todos los protocolos lo reportan). Solo se
// recalcula cuando el camion avanzo al menos esto desde el ultimo punto usado:
// con distancias menores el error del GPS hace girar el mapa al azar
const METROS_MIN_PARA_RUMBO = 15;

// Rumbo en grados (0 = norte, sentido horario) para ir del punto 1 al 2
function rumboEntre(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const rad = Math.PI / 180;
    const dLon = (lon2 - lon1) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
    return (Math.atan2(y, x) / rad + 360) % 360;
}

// Icono del vehiculo visto desde arriba, con el frente hacia el norte. Va como
// imagen fija (prop image) y no como vista hija: en Android las vistas hijas
// de un marcador se dibujan "fotografiandolas", y si la foto se toma antes de
// que el mapa termine de cargar el marcador queda invisible
const ICONO_VEHICULO = require('../../../assets/vehiculo_arriba.png');

// Duracion de un ciclo del pulso del halo mientras el camion se mueve
const MS_CICLO_PULSO = 1400;

// Halo que crece y se desvanece en bucle. Va en un marcador aparte que solo
// existe mientras el vehiculo se mueve: detenido se quita del mapa y no gasta
// bateria, y si algun dia no se dibujara, el icono del vehiculo no se afecta
function HaloMovimiento() {
    const [progreso] = useState(() => new Animated.Value(0));

    useEffect(() => {
        // useNativeDriver en false: en Android el marcador se dibuja como imagen
        // y solo captura los cambios que pasan por JS
        const bucle = Animated.loop(
            Animated.timing(progreso, { toValue: 1, duration: MS_CICLO_PULSO, easing: Easing.out(Easing.ease), useNativeDriver: false })
        );
        bucle.start();
        return () => bucle.stop();
    }, [progreso]);

    return (
        <View style={styles.halo}>
            <Animated.View
                style={[
                    styles.haloCirculo,
                    {
                        opacity: progreso.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                        transform: [{ scale: progreso.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
                    },
                ]}
            />
        </View>
    );
}

// Movimiento continuo del vehiculo (como Uber): cada tramo dura lo que se
// espera que tarde el proximo reporte, asi el icono sigue andando hasta que
// entra. Se estima por lo alto (el mayor de los ultimos intervalos + holgura)
// porque pasarse es inofensivo (el reporte llega antes y el tramo nuevo sale
// de donde va el icono, sin salto) y quedarse corto lo deja quieto esperando.
// Los trackers no reportan a ritmo fijo (ej. mandan uno extra al doblar), por
// eso no basta con el ultimo intervalo. A cambio, el icono va unos segundos
// detras de la posicion real
const MS_PRIMERA_ANIMACION = 1000;   // primer reporte, aun sin intervalo medido
const MS_MIN_ANIMACION = 1000;       // piso: una rafaga de reportes juntos no deja tramos de milisegundos
const MS_MAX_ANIMACION = 15000;      // tope: si el tracker tarda mas, se queda quieto el resto
const INTERVALOS_RECORDADOS = 3;
const HOLGURA_DURACION = 1.3;
// Mas lejos que esto (ej. al volver de una desconexion) se salta directo, en
// vez de "manejar" en linea recta por encima de manzanas enteras
const METROS_SALTO_DIRECTO = 1000;
// Cada cuanto se recalcula la posicion intermedia (~30 cuadros por segundo)
const MS_PASO_ANIMACION = 33;

type MovimientoVehiculo = {
    // duracionMs 0 = salto directo
    moverA: (destino: LatLng, duracionMs: number) => void;
};

// Recorrido en curso: el icono avanza a velocidad constante por 'puntos'
// (su posicion al empezar + los puntos GPS que le faltan), en 'duracion' ms
type Recorrido = {
    puntos: LatLng[];
    acumulado: number[];   // metros desde puntos[0] hasta cada punto
    inicio: number;
    duracion: number;
    pasados: number;       // indice del ultimo punto por el que ya paso (ya en la estela)
};

function armarRecorrido(puntos: LatLng[], duracion: number): Recorrido {
    const acumulado = [0];
    for (let i = 1; i < puntos.length; i++) {
        const a = puntos[i - 1], b = puntos[i];
        acumulado.push(acumulado[i - 1] + distanciaMetros(a.latitude, a.longitude, b.latitude, b.longitude));
    }
    return { puntos, acumulado, inicio: Date.now(), duracion, pasados: 0 };
}

// Icono del vehiculo + halo, moviendose de forma continua entre reportes. La
// posicion intermedia se interpola aqui (lineal, a velocidad constante) en vez
// de usar animateMarkerToCoordinate: ese metodo de Android no se puede
// cancelar (un reporte que llega antes de terminar deja dos animaciones
// peleando por el marcador, y el salto directo no frenaria la anterior) y
// acelera/frena en cada punto. Si llega un reporte antes de terminar, el
// recorrido sigue desde donde va el icono y pasa por los puntos que le
// faltaban antes del nuevo: nunca salta ni corta esquinas. El halo usa la
// misma posicion, asi nunca se despega del icono. Solo hay timers mientras hay
// un recorrido en curso
const VehiculoEnMapa = forwardRef<MovimientoVehiculo, {
    inicial: LatLng;
    titulo: string;
    descripcion: string;
    rotacion: number;
    enMovimiento: boolean;
    // Se llama al pasar por cada punto GPS, para la estela
    onLlegada: (punto: LatLng) => void;
}>(function VehiculoEnMapa({ inicial, titulo, descripcion, rotacion, enMovimiento, onLlegada }, ref) {
    const [posicion, setPosicion] = useState<LatLng>(inicial);
    const posicionRef = useRef<LatLng>(inicial);
    const recorrido = useRef<Recorrido | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onLlegadaRef = useRef(onLlegada);
    onLlegadaRef.current = onLlegada;

    const aplicar = (punto: LatLng) => {
        posicionRef.current = punto;
        setPosicion(punto);
    };
    const cancelarTimer = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };

    useImperativeHandle(ref, () => ({
        moverA(destino, duracionMs) {
            const actual = recorrido.current;
            // Estacionado el tracker repite la misma coordenada: no se arranca un
            // recorrido "al mismo punto" (timers corriendo hasta 15 s para nada)
            const haciaDonde = actual ? actual.puntos[actual.puntos.length - 1] : posicionRef.current;
            if (haciaDonde.latitude === destino.latitude && haciaDonde.longitude === destino.longitude) {
                // Ya esta ahi: igual cuenta para la estela (la duplicada se descarta)
                if (!actual) onLlegadaRef.current(destino);
                return;
            }
            cancelarTimer();
            recorrido.current = null;

            if (duracionMs <= 0) {
                // Salto directo: los puntos que faltaban no se recorren (la estela
                // la reinicia la pantalla)
                aplicar(destino);
                onLlegadaRef.current(destino);
                return;
            }
            // Llego un reporte antes de terminar: el recorrido nuevo sale de donde
            // esta el icono ahora y pasa por los puntos que le faltaban
            const pendientes = actual ? actual.puntos.slice(actual.pasados + 1) : [];
            recorrido.current = armarRecorrido([posicionRef.current, ...pendientes, destino], duracionMs);

            const paso = () => {
                const r = recorrido.current;
                if (!r) return;
                const f = Math.min(1, (Date.now() - r.inicio) / r.duracion);
                const total = r.acumulado[r.acumulado.length - 1];
                const metros = total * f;
                // Puntos GPS por los que ya paso: a la estela, en orden
                while (r.pasados < r.puntos.length - 1 && r.acumulado[r.pasados + 1] <= metros) {
                    r.pasados++;
                    onLlegadaRef.current(r.puntos[r.pasados]);
                }
                if (f >= 1 || total === 0) {
                    while (r.pasados < r.puntos.length - 1) {
                        r.pasados++;
                        onLlegadaRef.current(r.puntos[r.pasados]);
                    }
                    aplicar(r.puntos[r.puntos.length - 1]);
                    recorrido.current = null;
                    timer.current = null;
                    return;
                }
                const a = r.puntos[r.pasados], b = r.puntos[r.pasados + 1];
                const largo = r.acumulado[r.pasados + 1] - r.acumulado[r.pasados];
                const g = largo > 0 ? (metros - r.acumulado[r.pasados]) / largo : 1;
                aplicar({
                    latitude: a.latitude + (b.latitude - a.latitude) * g,
                    longitude: a.longitude + (b.longitude - a.longitude) * g,
                });
                timer.current = setTimeout(paso, MS_PASO_ANIMACION);
            };
            paso();
        },
    }), []);

    useEffect(() => cancelarTimer, []);

    return (
        <>
            {enMovimiento && (
                <Marker coordinate={posicion} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges zIndex={1}>
                    <HaloMovimiento />
                </Marker>
            )}
            <Marker
                coordinate={posicion}
                title={titulo}
                description={descripcion}
                image={ICONO_VEHICULO}
                anchor={{ x: 0.5, y: 0.5 }}
                // flat: el icono queda pegado al mapa y rotation se mide desde el
                // norte, asi apunta hacia donde va (y hacia arriba, porque la
                // camara gira con el mismo rumbo). Sin rumbo aun, mira al norte
                flat
                rotation={rotacion}
                zIndex={2}
            />
        </>
    );
});

// Cada cuanto se redibuja el texto de "Última señal" para que avance solo
const MS_REFRESCO_ULTIMA_SENAL = 10000;

export default function LiveMapScreen() {
    const route = useRoute<any>();
    const navigation = useNavigation<any>();
    const { user } = useAuth();
    const estadoConexion = useEstadoConexion();

    const camionParam = route?.params?.camion;
    const imei = camionParam?.imei || '352812345678901';
    const nombreCamion = camionParam ? `${camionParam.ficha} - ${camionParam.marca}` : 'Vehiculo';
    const esHQ = camionParam?.protocolo === 'HQ';

    const [camion, setCamion] = useState<{ latitud: number; longitud: number; velocidad: number }>({
        latitud: camionParam?.latitud || 18.4861,
        longitud: camionParam?.longitud || -69.9312,
        velocidad: camionParam?.velocidad || 0,
    });

    // Movimiento del icono (ver VehiculoEnMapa) y datos para calcular cada tramo:
    // a donde va el icono ahora y cuando llego el ultimo reporte
    const vehiculoRef = useRef<MovimientoVehiculo>(null);
    const [posicionInicial] = useState<LatLng>(() => ({ latitude: camion.latitud, longitude: camion.longitud }));
    const destinoActual = useRef<LatLng>(posicionInicial);
    const msUltimoReporte = useRef<number | null>(null);
    const ultimosIntervalos = useRef<number[]>([]);

    // Si el camion ya tiene una ubicacion guardada la mostramos de una vez, en vez
    // de quedarnos en "Esperando señal GPS..." hasta el proximo reporte en vivo
    const [tieneSenal, setTieneSenal] = useState<boolean>(!!(camionParam?.latitud && camionParam?.longitud));
    const [ultimaActualizacion, setUltimaActualizacion] = useState<string | null>(camionParam?.ultima_actualizacion || null);
    const [apagando, setApagando] = useState(false);
    const [bloqueado, setBloqueado] = useState<boolean>(!!camionParam?.bloqueado_remoto);
    // Ultimo estado del motor que detecto el servidor (por velocidad mientras
    // no este conectado el cable de ignicion). null = todavia no se sabe
    const [motorEncendido, setMotorEncendido] = useState<boolean | null>(
        typeof camionParam?.motor_encendido === 'boolean' ? camionParam.motor_encendido : null
    );
    const [direccion, setDireccion] = useState<string | null>(null);
    const [buscandoDireccion, setBuscandoDireccion] = useState(false);
    // Estela del recorrido: solo con las ubicaciones que llegan en vivo mientras
    // la pantalla esta abierta. No arranca desde la ultima ubicacion guardada
    // porque puede ser vieja y se dibujaria una linea recta falsa hasta la nueva
    const [estela, setEstela] = useState<Punto[]>([]);
    // Ultimo rumbo calculado (grados, 0 = norte). El mapa siempre gira con el
    const ultimoRumbo = useRef<number | null>(null);
    // Punto desde el que se mide el proximo rumbo: solo se mueve cuando el
    // camion avanzo METROS_MIN_PARA_RUMBO. Arranca con la primera ubicacion en
    // vivo, no con la guardada, que puede ser vieja
    const puntoBaseRumbo = useRef<{ latitud: number; longitud: number } | null>(null);
    // Mismo rumbo, como estado, para girar el icono del vehiculo
    const [rumboMarcador, setRumboMarcador] = useState<number | null>(null);
    const mapRef = useRef<MapView>(null);
    const ultimaConsultaDireccion = useRef<{ latitud: number; longitud: number; tiempo: number } | null>(null);
    // Copia de ultimaActualizacion legible desde callbacks sin re-crearlos
    const ultimaActualizacionRef = useRef<string | null>(ultimaActualizacion);
    ultimaActualizacionRef.current = ultimaActualizacion;
    // Solo sirve para forzar el redibujado periodico de "Última señal"
    const [, setTick] = useState(0);

    // Handler nombrado, para poder quitar exactamente ESTE listener al salir
    const manejarActualizacion = useCallback((datos: any) => {
        if (datos && datos.latitud && datos.longitud) {
            console.log(`🚚 ¡Coordenada recibida para ${nombreCamion}!`, datos);
            const latitud = Number(datos.latitud);
            const longitud = Number(datos.longitud);
            setCamion({ latitud, longitud, velocidad: datos.velocidad || 0 });

            const ahora = Date.now();
            // Reportes que llegan casi juntos (ej. los acumulados mientras la app
            // estaba en segundo plano) no dicen nada del ritmo del tracker: no se
            // cuentan, o el recorrido atrasado se haria de un tiron en 1 s
            const intervaloNuevo = msUltimoReporte.current === null ? null : ahora - msUltimoReporte.current;
            if (intervaloNuevo !== null && intervaloNuevo >= MS_MIN_ANIMACION) {
                ultimosIntervalos.current = [...ultimosIntervalos.current, intervaloNuevo].slice(-INTERVALOS_RECORDADOS);
            }
            msUltimoReporte.current = ahora;
            const intervalos = ultimosIntervalos.current;
            const desde = destinoActual.current;
            const salto = distanciaMetros(desde.latitude, desde.longitude, latitud, longitud) > METROS_SALTO_DIRECTO;
            const duracion = salto
                ? 0
                : intervalos.length === 0
                    ? MS_PRIMERA_ANIMACION
                    : Math.round(Math.min(MS_MAX_ANIMACION, Math.max(MS_MIN_ANIMACION, Math.max(...intervalos) * HOLGURA_DURACION)));
            destinoActual.current = { latitude: latitud, longitude: longitud };
            if (salto) {
                // La linea entre los dos puntos seria falsa: la estela empieza de nuevo
                setEstela([]);
                puntoBaseRumbo.current = null;
            }
            vehiculoRef.current?.moverA({ latitude: latitud, longitude: longitud }, duracion);

            const base = puntoBaseRumbo.current;
            if (!base) {
                puntoBaseRumbo.current = { latitud, longitud };
            } else if (distanciaMetros(base.latitud, base.longitud, latitud, longitud) >= METROS_MIN_PARA_RUMBO) {
                ultimoRumbo.current = rumboEntre(base.latitud, base.longitud, latitud, longitud);
                puntoBaseRumbo.current = { latitud, longitud };
                setRumboMarcador(ultimoRumbo.current);
            }
            // Sigue al camion cambiando el centro y girando el mapa segun su rumbo,
            // sin tocar el zoom del usuario
            const camara: Partial<Camera> = { center: { latitude: latitud, longitude: longitud } };
            if (ultimoRumbo.current !== null) {
                camara.heading = ultimoRumbo.current;
            }
            if (duracion > 0) {
                mapRef.current?.animateCamera(camara, { duration: duracion });
            } else {
                mapRef.current?.setCamera(camara);
            }
            setTieneSenal(true);
            setUltimaActualizacion(datos.ultima_actualizacion || new Date().toISOString());
        }
    }, [nombreCamion]);

    // La estela se alarga cuando el icono llega a cada punto, no cuando llega
    // el reporte: si no, la linea iria por delante del carro
    const agregarALaEstela = useCallback((punto: LatLng) => {
        setEstela((anterior) => {
            const ultimo = anterior[anterior.length - 1];
            // Con el camion parado el GPS repite la misma coordenada: no la duplicamos
            if (ultimo && ultimo.latitude === punto.latitude && ultimo.longitude === punto.longitude) {
                return anterior;
            }
            const nueva = [...anterior, punto];
            return nueva.length > MAX_PUNTOS_ESTELA ? nueva.slice(-MAX_PUNTOS_ESTELA) : nueva;
        });
    }, []);

    // Pide al servidor la ultima ubicacion guardada. Se usa al reconectar el
    // socket y al volver a primer plano, porque los reportes que llegaron
    // mientras no habia conexion no se reenvian por el socket
    const resincronizarUbicacion = useCallback(async () => {
        if (!user?.token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/camion/${imei}`, {
                headers: { Authorization: `Bearer ${user.token}` },
            });
            if (!res.ok) return;
            const datos = await res.json();
            if (typeof datos.bloqueado_remoto === 'boolean') {
                setBloqueado(datos.bloqueado_remoto);
            }
            if (typeof datos.motor_encendido === 'boolean') {
                setMotorEncendido(datos.motor_encendido);
            }
            // Si mientras tanto llego algo mas nuevo por el socket, no se pisa
            const actual = ultimaActualizacionRef.current ? new Date(ultimaActualizacionRef.current).getTime() : 0;
            const recibida = datos.ultima_actualizacion ? new Date(datos.ultima_actualizacion).getTime() : 0;
            if (!recibida || recibida <= actual) return;
            // Postgres puede devolver numeric como texto
            manejarActualizacion({ ...datos, velocidad: Number(datos.velocidad) || 0 });
        } catch (error) {
            console.log('No se pudo resincronizar la ubicacion:', error);
        }
    }, [imei, user?.token, manejarActualizacion]);

    useEffect(() => socketService.suscribirReconexion(resincronizarUbicacion), [resincronizarUbicacion]);

    useEffect(() => {
        const suscripcion = AppState.addEventListener('change', (estadoApp) => {
            if (estadoApp === 'active') resincronizarUbicacion();
        });
        return () => suscripcion.remove();
    }, [resincronizarUbicacion]);

    useEffect(() => {
        const intervalo = setInterval(() => setTick((t) => t + 1), MS_REFRESCO_ULTIMA_SENAL);
        return () => clearInterval(intervalo);
    }, []);

    useEffect(() => {
        if (!user?.token) return;

        // Conecta y autentica UNA sola vez (si ya estaba conectado, no repite nada)
        const socket = socketService.conectar(user.token);

        const eventoSocket = `camion_${imei}`;
        console.log(`📡 Escuchando en vivo el canal de socket: ${eventoSocket}`);

        socket.on(eventoSocket, manejarActualizacion);

        // El servidor avisa los cambios de motor como alertas 'encendido'/'apagado'
        const manejarAlerta = (alerta: { imei?: string; tipo?: string }) => {
            if (alerta?.imei !== imei) return;
            if (alerta.tipo === 'encendido') setMotorEncendido(true);
            else if (alerta.tipo === 'apagado') setMotorEncendido(false);
        };
        socket.on('alerta', manejarAlerta);

        return () => {
            // Solo quita el listener de ESTE camion, nada mas
            socket.off(eventoSocket, manejarActualizacion);
            socket.off('alerta', manejarAlerta);
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
    const enMovimiento = camion.velocidad > 0;

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
                {estela.length > 1 && (
                    <Polyline
                        coordinates={estela}
                        strokeColor="#3b82f6"
                        strokeWidth={4}
                    />
                )}
                <VehiculoEnMapa
                    ref={vehiculoRef}
                    inicial={posicionInicial}
                    titulo={nombreCamion}
                    descripcion={direccion ? `${direccion} · ${camion.velocidad} km/h` : `Velocidad: ${camion.velocidad} km/h`}
                    rotacion={rumboMarcador ?? 0}
                    enMovimiento={enMovimiento}
                    onLlegada={agregarALaEstela}
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
                {estadoConexion !== 'conectado' && (
                    <View style={styles.bannerSinConexion}>
                        <Text style={styles.bannerSinConexionText}>
                            {estadoConexion === 'token_rechazado'
                                ? 'El servidor rechazó tu código de acceso: el mapa no se actualizará. Cierra sesión y vuelve a entrar.'
                                : estadoConexion === 'reconectando' ? 'Sin conexión — reconectando…' : 'Sin conexión'}
                        </Text>
                    </View>
                )}
                <View style={styles.infoBox}>
                    <Text style={styles.truckName}>{nombreCamion}</Text>
                    {motorEncendido !== null && (
                        <View style={[styles.motorPill, motorEncendido ? styles.motorPillEncendido : styles.motorPillApagado]}>
                            <Text style={[styles.motorPillText, motorEncendido ? styles.motorTextEncendido : styles.motorTextApagado]}>
                                {motorEncendido ? '● Motor encendido' : '● Motor apagado'}
                            </Text>
                        </View>
                    )}
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
    },
    halo: {
        width: 100,
        height: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    haloCirculo: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#ef4444',
    },
    bannerSinConexion: {
        backgroundColor: 'rgba(127, 29, 29, 0.95)',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ef4444',
        alignItems: 'center',
        marginBottom: 8,
    },
    bannerSinConexionText: {
        color: '#fecaca',
        textAlign: 'center',
        fontWeight: 'bold',
        fontSize: 13,
    },
    infoBox: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        paddingVertical: 4,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#0b54f3',
    },
    motorPill: {
        paddingVertical: 2,
        paddingHorizontal: 10,
        borderRadius: 10,
        borderWidth: 1,
        marginVertical: 2,
    },
    motorPillEncendido: {
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        borderColor: '#22c55e',
    },
    motorPillApagado: {
        backgroundColor: 'rgba(148, 163, 184, 0.15)',
        borderColor: '#64748b',
    },
    motorPillText: {
        fontWeight: 'bold',
        fontSize: 13,
    },
    motorTextEncendido: {
        color: '#4ade80',
    },
    motorTextApagado: {
        color: '#cbd5e1',
    },
    truckName: {
        color: '#9cbbfe',
        fontWeight: '900',
        fontSize: 15,
    },
    direccionText: {
        color: '#cbd5e1',
        fontSize: 12,
    },
    infoText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 15,
    },
    imeiText: {
        color: '#cbd5e1',
        fontSize: 12,
    },
});