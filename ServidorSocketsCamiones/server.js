const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_system',
    password: 'Hector1557',
    port: 5432,
    max: 50,
    idleTimeoutMillis: 30000
});

// ==================== AUTENTICACION DE LA API ====================
async function verificarToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Falta el token de acceso' });
    }
    const token = authHeader.replace('Bearer ', '');
    try {
        const resultado = await pool.query(
            'SELECT owner_id, nombre FROM duenos WHERE LOWER(token) = LOWER($1) AND activo = true',
            [token]
        );
        if (resultado.rows.length === 0) {
            return res.status(401).json({ error: 'Token invalido' });
        }
        req.dueno = resultado.rows[0];
        next();
    } catch (error) {
        res.status(500).json({ error: 'Error de servidor' });
    }
}

app.get('/api/mi-perfil', verificarToken, (req, res) => {
    res.json({ ownerId: req.dueno.owner_id, nombre: req.dueno.nombre });
});

app.get('/api/mis-camiones', verificarToken, async (req, res) => {
    try {
        const resultado = await pool.query(
            'SELECT * FROM camiones WHERE owner_id = $1',
            [req.dueno.owner_id]
        );
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo camiones' });
    }
});

// Guarda (o refresca) el push token de Expo del dispositivo del dueño que
// llama, para poder mandarle notificaciones con la app cerrada.
app.post('/api/registrar-push-token', verificarToken, async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
        return res.status(400).json({ error: 'Falta el token de push' });
    }
    try {
        await pool.query(
            `INSERT INTO push_tokens (owner_id, token, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (owner_id, token) DO UPDATE SET updated_at = NOW()`,
            [req.dueno.owner_id, token]
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: 'Error guardando el token de push' });
    }
});

// ==================== APAGADO REMOTO DEL CAMION ====================
// Guardamos aqui la conexion TCP activa de cada camion GT06, usando su IMEI como llave.
// Asi, cuando alguien pida apagar un camion desde la app, sabemos por cual conexion
// mandarle el comando (solo funciona si el camion esta conectado/con señal en ese momento).
const conexionesGT06 = new Map();

let serialComando = 1;
function proximoSerial() {
    serialComando = (serialComando + 1) % 0xffff;
    return serialComando;
}

// Comandos de texto GT06/Coban para el rele que corta/restaura el motor.
// NOTA: ninguno de los dos se ha probado todavia con hardware real. Cuando
// se pruebe con el GPS fisico, confirmar contra el manual del TK403/GT06N
// que estos son los comandos correctos para ESE modelo especifico.
const COMANDO_GT06_CORTAR_MOTOR = 'DYD,000000#';
const COMANDO_GT06_RESTAURAR_MOTOR = 'HFYD,000000#';

// Construye el paquete binario GT06 para mandar un comando de texto al dispositivo
// (por ejemplo, para cortar el motor via el rele). Formato basado en el protocolo
// estandar GT06/Concox para el comando 0x80 (comando personalizado).
function construirComandoGT06(comandoTexto, serial) {
    const comandoBuffer = Buffer.from(comandoTexto, 'ascii');
    const banderaServidor = Buffer.from([0x00, 0x00, 0x00, 0x01]);

    const contenido = Buffer.concat([
        Buffer.from([comandoBuffer.length]),
        comandoBuffer,
        banderaServidor,
    ]);

    const cuerpo = Buffer.concat([
        Buffer.from([0x80]),
        contenido,
        Buffer.from([(serial >> 8) & 0xff, serial & 0xff]),
    ]);

    const longitudPaquete = cuerpo.length + 2; // +2 por el CRC que va despues
    const crc = crc16Itu(Buffer.concat([Buffer.from([longitudPaquete]), cuerpo]));

    return Buffer.concat([
        Buffer.from([0x78, 0x78]),
        Buffer.from([longitudPaquete]),
        cuerpo,
        Buffer.from([(crc >> 8) & 0xff, crc & 0xff]),
        Buffer.from([0x0d, 0x0a]),
    ]);
}

app.post('/api/apagar-camion', verificarToken, async (req, res) => {
    const { imei } = req.body;
    if (!imei) {
        return res.status(400).json({ error: 'Falta el IMEI del camion' });
    }

    try {
        // Confirmamos que el camion realmente pertenece a este dueño (seguridad:
        // que nadie pueda apagar el camion de otro dueño mandando cualquier IMEI)
        const camionResultado = await pool.query(
            'SELECT owner_id, ficha FROM camiones WHERE imei = $1',
            [imei]
        );

        if (camionResultado.rows.length === 0) {
            return res.status(404).json({ error: 'Camion no encontrado' });
        }

        const { owner_id: ownerId, ficha } = camionResultado.rows[0];
        if (ownerId !== req.dueno.owner_id) {
            return res.status(403).json({ error: 'Este vehículo no te pertenece' });
        }

        const socketGPS = conexionesGT06.get(imei);
        if (!socketGPS) {
            return res.status(404).json({ error: 'El vehículo no está conectado ahora mismo. Intenta cuando tenga señal.' });
        }

        const comando = construirComandoGT06(COMANDO_GT06_CORTAR_MOTOR, proximoSerial());
        socketGPS.write(comando);

        // El bloqueo dura hasta que el dueño reactive desde la app (ver
        // /api/encender-camion): mientras este en true, cualquier intento de
        // arranque por llave o reconexion del GPS reenvia el corte.
        await pool.query(
            'UPDATE camiones SET bloqueado_remoto = true, motor_encendido = false WHERE imei = $1',
            [imei]
        );
        detenerRecordatorioMotor(imei);

        console.log(`🔴 Comando de apagado enviado al camion IMEI: ${imei} (dueño: ${req.dueno.owner_id})`);
        await dispararAlerta(
            ownerId,
            imei,
            'apagado',
            `Unidad ${ficha} fue apagada y bloqueada remotamente desde la app.`,
            { origen: 'remoto' }
        );

        res.json({ ok: true, mensaje: 'Comando de apagado enviado al camion' });
    } catch (error) {
        console.log(`❌ Error enviando comando de apagado: ${error.message}`);
        res.status(500).json({ error: 'Error de servidor enviando el comando' });
    }
});

app.post('/api/encender-camion', verificarToken, async (req, res) => {
    const { imei } = req.body;
    if (!imei) {
        return res.status(400).json({ error: 'Falta el IMEI del camion' });
    }

    try {
        const camionResultado = await pool.query(
            'SELECT owner_id, ficha FROM camiones WHERE imei = $1',
            [imei]
        );

        if (camionResultado.rows.length === 0) {
            return res.status(404).json({ error: 'Camion no encontrado' });
        }

        const { owner_id: ownerId, ficha } = camionResultado.rows[0];
        if (ownerId !== req.dueno.owner_id) {
            return res.status(403).json({ error: 'Este vehículo no te pertenece' });
        }

        const socketGPS = conexionesGT06.get(imei);
        if (!socketGPS) {
            return res.status(404).json({ error: 'El vehículo no está conectado ahora mismo. Intenta cuando tenga señal.' });
        }

        const comando = construirComandoGT06(COMANDO_GT06_RESTAURAR_MOTOR, proximoSerial());
        socketGPS.write(comando);

        // A partir de aqui la llave vuelve a funcionar sin restricciones,
        // hasta el proximo apagado remoto.
        await pool.query('UPDATE camiones SET bloqueado_remoto = false WHERE imei = $1', [imei]);

        console.log(`🟢 Comando de reactivacion enviado al camion IMEI: ${imei} (dueño: ${req.dueno.owner_id})`);
        await dispararAlerta(
            ownerId,
            imei,
            'desbloqueo',
            `Unidad ${ficha} fue reactivada desde la app. La llave ya funciona con normalidad.`,
            { origen: 'remoto' }
        );

        res.json({ ok: true, mensaje: 'Comando de reactivacion enviado al camion' });
    } catch (error) {
        console.log(`❌ Error enviando comando de reactivacion: ${error.message}`);
        res.status(500).json({ error: 'Error de servidor enviando el comando' });
    }
});

// ==================== ALERTAS: PERSISTENCIA + PUSH (Etapa A, compartida por las 4 alertas) ====================
// Titulo de la notificacion push segun el tipo de alerta.
function tituloPorTipoAlerta(tipo) {
    switch (tipo) {
        case 'velocidad': return '🚨 Exceso de velocidad';
        case 'ruta': return '🚨 Fuera de ruta';
        case 'encendido': return '🔧 Motor encendido';
        case 'apagado': return '🔧 Motor apagado';
        case 'desbloqueo': return '🔓 Vehículo reactivado';
        case 'aceite': return '🛢️ Cambio de aceite';
        default: return '🚨 Alerta de flota';
    }
}

// Manda un push (Expo Push API) a todos los dispositivos registrados de un dueño.
async function enviarPush(ownerId, titulo, mensaje, datosExtra) {
    try {
        const tokens = await pool.query('SELECT token FROM push_tokens WHERE owner_id = $1', [ownerId]);
        if (tokens.rows.length === 0) return;

        const mensajes = tokens.rows.map((fila) => ({
            to: fila.token,
            sound: 'default',
            title: titulo,
            body: mensaje,
            data: datosExtra || {},
        }));

        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(mensajes),
        });
    } catch (error) {
        console.log(`❌ Error enviando push: ${error.message}`);
    }
}

// Punto unico por el que pasan las 4 alertas (velocidad, ruta, encendido, apagado):
// guarda el historial, notifica por Socket.IO a quien tenga la app abierta, y
// ademas manda push a quien la tenga cerrada.
async function dispararAlerta(ownerId, imei, tipo, mensaje, datosExtra) {
    try {
        await pool.query(
            `INSERT INTO alertas (owner_id, imei, tipo, mensaje, fecha) VALUES ($1, $2, $3, $4, $5)`,
            [ownerId, imei, tipo, mensaje, new Date()]
        );

        io.to(ownerId).emit('alerta', { imei, tipo, mensaje, fecha: new Date().toISOString(), ...datosExtra });
        console.log(`🔔 Alerta "${tipo}" para IMEI ${imei} (dueño ${ownerId}): ${mensaje}`);

        await enviarPush(ownerId, tituloPorTipoAlerta(tipo), mensaje, { tipo, imei, ...datosExtra });
    } catch (error) {
        console.log(`❌ Error disparando alerta: ${error.message}`);
    }
}

// ==================== RECORDATORIO DE MOTOR ENCENDIDO (cada 10 min) ====================
// Mientras el motor siga encendido, recuerda al dueño con un sonido leve +
// push cada 10 min, hasta que se apague. No pasa por dispararAlerta a
// proposito: es un recordatorio recurrente, no un evento puntual, y
// guardarlo en la tabla "alertas" llenaria el historial de filas repetidas
// para un mismo encendido largo.
const RECORDATORIO_MOTOR_INTERVALO_MS = 10 * 60 * 1000;
const timersRecordatorioMotor = new Map(); // imei -> intervalId

function iniciarRecordatorioMotor(ownerId, imei, ficha) {
    detenerRecordatorioMotor(imei);
    const intervalId = setInterval(() => {
        const mensaje = `Unidad ${ficha} sigue con el motor encendido.`;
        io.to(ownerId).emit('alerta', { imei, tipo: 'recordatorio_motor', mensaje, fecha: new Date().toISOString() });
        enviarPush(ownerId, '🔔 Motor encendido', mensaje, { tipo: 'recordatorio_motor', imei });
    }, RECORDATORIO_MOTOR_INTERVALO_MS);
    timersRecordatorioMotor.set(imei, intervalId);
}

function detenerRecordatorioMotor(imei) {
    const intervalId = timersRecordatorioMotor.get(imei);
    if (intervalId) {
        clearInterval(intervalId);
        timersRecordatorioMotor.delete(imei);
    }
}

// ==================== DETECCION DE IGNICION (ACC) VIA GT06 0x13 ====================
// NOTA IMPORTANTE: el bit exacto de ACC dentro del "Terminal Information
// Content" (primer byte del cuerpo del paquete 0x13) varia segun el clon de
// GT06. El valor de abajo (bit 1) es el mas comun en la documentacion
// publica del protocolo, pero TODAVIA NO SE HA CONFIRMADO contra este
// hardware especifico. Para validarlo: prender/apagar la llave con el GPS
// conectado, comparar los "cuerpoHex" logueados en cada estado, y ajustar
// esta mascara si el bit que cambia no es este.
const MASCARA_BIT_ACC = 0x02;

function interpretarEstadoTerminal(cuerpoHex) {
    if (!cuerpoHex || cuerpoHex.length < 2) return null;
    const byteEstado = parseInt(cuerpoHex.substring(0, 2), 16);
    if (Number.isNaN(byteEstado)) return null;
    return (byteEstado & MASCARA_BIT_ACC) !== 0;
}

// Se llama con cada heartbeat (0x13). Compara contra el ultimo estado
// conocido en BD y, si cambio, dispara la alerta de encendido/apagado y
// arranca/detiene el recordatorio. Si el vehiculo esta bloqueado
// remotamente y alguien intenta arrancarlo con llave, refuerza el corte
// en vez de tratarlo como un encendido legitimo.
async function procesarCambioDeIgnicion(imei, cuerpoHex) {
    const motorEncendidoAhora = interpretarEstadoTerminal(cuerpoHex);
    if (motorEncendidoAhora === null) return;

    try {
        const resultado = await pool.query(
            'SELECT owner_id, ficha, motor_encendido, bloqueado_remoto FROM camiones WHERE imei = $1',
            [imei]
        );
        if (resultado.rows.length === 0) return;

        const {
            owner_id: ownerId,
            ficha,
            motor_encendido: motorEncendidoAntes,
            bloqueado_remoto: bloqueado,
        } = resultado.rows[0];

        if (bloqueado && motorEncendidoAhora) {
            const socketGPS = conexionesGT06.get(imei);
            if (socketGPS) {
                socketGPS.write(construirComandoGT06(COMANDO_GT06_CORTAR_MOTOR, proximoSerial()));
                console.log(`🔒 Intento de encendido con llave bloqueado (remoto) en IMEI ${imei}, reforzando corte`);
            }
            return;
        }

        if (motorEncendidoAntes === motorEncendidoAhora) return;

        await pool.query('UPDATE camiones SET motor_encendido = $1 WHERE imei = $2', [motorEncendidoAhora, imei]);

        if (motorEncendidoAhora) {
            await dispararAlerta(ownerId, imei, 'encendido', `Unidad ${ficha} encendió el motor.`, {});
            iniciarRecordatorioMotor(ownerId, imei, ficha);
        } else {
            await dispararAlerta(ownerId, imei, 'apagado', `Unidad ${ficha} apagó el motor.`, {});
            detenerRecordatorioMotor(imei);
        }
    } catch (error) {
        console.log(`❌ Error procesando cambio de ignición: ${error.message}`);
    }
}

// Al reconectar un GPS que estaba bloqueado remotamente, refuerza el corte
// por si el dispositivo perdio energia y el rele volvio a su estado normal.
async function reforzarBloqueoSiAplica(imei, socketGPS) {
    try {
        const resultado = await pool.query('SELECT bloqueado_remoto FROM camiones WHERE imei = $1', [imei]);
        if (resultado.rows.length > 0 && resultado.rows[0].bloqueado_remoto) {
            socketGPS.write(construirComandoGT06(COMANDO_GT06_CORTAR_MOTOR, proximoSerial()));
            console.log(`🔒 Reforzando bloqueo remoto tras reconexión, IMEI ${imei}`);
        }
    } catch (error) {
        console.log(`❌ Error reforzando bloqueo remoto: ${error.message}`);
    }
}

// ==================== RETENCION DE HISTORIAL DE ALERTAS (2 meses) ====================
const RETENCION_ALERTAS_INTERVALO_MS = 24 * 60 * 60 * 1000;

async function limpiarAlertasViejas() {
    try {
        const resultado = await pool.query(`DELETE FROM alertas WHERE fecha < NOW() - INTERVAL '2 months'`);
        if (resultado.rowCount > 0) {
            console.log(`🧹 Limpieza de historial: ${resultado.rowCount} alertas viejas eliminadas`);
        }
    } catch (error) {
        console.log(`❌ Error limpiando historial de alertas: ${error.message}`);
    }
}

// ==================== FUNCION COMPARTIDA: GUARDAR Y NOTIFICAR ====================
const VELOCIDAD_MAX_PERMITIDA = 80;
// Ultima velocidad conocida por IMEI, para disparar la alerta solo al CRUZAR
// el umbral (no en cada paquete mientras se mantiene arriba de 80).
const ultimaVelocidadConocida = new Map();

// El GPS no tiene odometro: el kilometraje se calcula solo, sumando la
// distancia (Haversine) entre cada par de coordenadas consecutivas que
// llegan, sobre el total acumulado que ya traia el camion. Dos guardas para
// que el ruido/errores del GPS no infecten ese total:
//  - KM_TRAMO_MIN_METROS: por debajo de esto es "flotacion" normal del GPS
//    con el camion detenido, no movimiento real.
//  - KM_TRAMO_MAX_KM: por encima de esto es un salto de coordenada
//    imposible al ritmo normal de reporte (glitch de hardware), se descarta.
const KM_TRAMO_MIN_METROS = 15;
const KM_TRAMO_MAX_KM = 5;
// Umbral de aviso de cambio de aceite. Igual que con la velocidad, se
// guarda el ultimo valor conocido por IMEI para disparar la alerta solo al
// CRUZAR el umbral, no en cada paquete mientras se mantiene por debajo.
const KM_AVISO_CAMBIO_ACEITE = 300;
const ultimoKmFaltantesConocido = new Map();

function distanciaHaversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function actualizarYNotificar(imei, latitud, longitud, velocidad) {
    try {
        const anterior = await pool.query(
            'SELECT latitud, longitud FROM camiones WHERE imei = $1',
            [imei]
        );

        let deltaKm = 0;
        if (anterior.rows.length > 0) {
            const { latitud: latAnterior, longitud: lonAnterior } = anterior.rows[0];
            if (latAnterior != null && lonAnterior != null && !(latAnterior === 0 && lonAnterior === 0)) {
                const tramoKm = distanciaHaversineKm(latAnterior, lonAnterior, latitud, longitud);
                if (tramoKm * 1000 >= KM_TRAMO_MIN_METROS && tramoKm <= KM_TRAMO_MAX_KM) {
                    deltaKm = tramoKm;
                } else if (tramoKm > KM_TRAMO_MAX_KM) {
                    console.log(`⚠️ Salto GPS descartado para IMEI ${imei}: ${tramoKm.toFixed(2)} km entre dos paquetes consecutivos`);
                }
            }
        }

        const resultadoCamion = await pool.query(
            `UPDATE camiones
             SET latitud = $1, longitud = $2, velocidad = $3, ultima_actualizacion = NOW(), kilometraje = kilometraje + $4
             WHERE imei = $5
             RETURNING owner_id, ficha, ultima_actualizacion, kilometraje, kilometraje_ultimo_cambio, intervalo_cambio_aceite`,
            [latitud, longitud, velocidad, deltaKm, imei]
        );

        await pool.query(
            `INSERT INTO historial_ubicaciones (imei_camion, latitud, longitud, velocidad, fecha_reporte)
             VALUES ($1, $2, $3, $4, $5)`,
            [imei, latitud, longitud, velocidad, new Date()]
        );

        if (resultadoCamion.rows.length > 0) {
            const {
                owner_id: ownerId,
                ficha,
                ultima_actualizacion: ultimaActualizacion,
                kilometraje,
                kilometraje_ultimo_cambio: kilometrajeUltimoCambio,
                intervalo_cambio_aceite: intervaloCambioAceite,
            } = resultadoCamion.rows[0];
            io.to(ownerId).emit(`camion_${imei}`, { imei, latitud, longitud, velocidad, ultima_actualizacion: ultimaActualizacion });
            console.log(`💾 Ubicación actualizada y enviada a la sala de "${ownerId}"`);

            const velocidadAnterior = ultimaVelocidadConocida.get(imei) ?? 0;
            ultimaVelocidadConocida.set(imei, velocidad);
            if (velocidadAnterior <= VELOCIDAD_MAX_PERMITIDA && velocidad > VELOCIDAD_MAX_PERMITIDA) {
                await dispararAlerta(
                    ownerId,
                    imei,
                    'velocidad',
                    `Unidad ${ficha} circula a ${velocidad} kph y supera los ${VELOCIDAD_MAX_PERMITIDA} kph.`,
                    { velocidad, latitud, longitud }
                );
            }

            const kmFaltantes = Math.round(Number(kilometrajeUltimoCambio) + Number(intervaloCambioAceite) - Number(kilometraje));
            const kmFaltantesAnterior = ultimoKmFaltantesConocido.get(imei) ?? Infinity;
            ultimoKmFaltantesConocido.set(imei, kmFaltantes);
            if (kmFaltantesAnterior > 0 && kmFaltantes <= 0) {
                await dispararAlerta(
                    ownerId,
                    imei,
                    'aceite',
                    `¡MANTENIMIENTO CRÍTICO! Unidad ${ficha} debe cambiar aceite YA (superó el intervalo por ${Math.abs(kmFaltantes)} km).`,
                    { kmFaltantes }
                );
            } else if (kmFaltantesAnterior > KM_AVISO_CAMBIO_ACEITE && kmFaltantes <= KM_AVISO_CAMBIO_ACEITE) {
                await dispararAlerta(
                    ownerId,
                    imei,
                    'aceite',
                    `Aviso: faltan ${kmFaltantes} km para el cambio de aceite de la unidad ${ficha}.`,
                    { kmFaltantes }
                );
            }
        } else {
            console.log(`⚠️ IMEI ${imei} no está registrado a ningún dueño`);
        }
    } catch (error) {
        console.log(`❌ Error de Base de Datos: ${error.message}`);
    }
}

// ==================== TRADUCTOR COBAN (protocolo de texto) ====================
function procesarTramaCoban(tramaCruda) {
    if (!tramaCruda || !tramaCruda.includes('imei:')) return null;
    const partes = tramaCruda.split(',');
    const imei = partes[1].replace('##,imei:', '').replace('imei:', '');
    if (partes[2] !== 'A') return null;
    const latitudRaw = partes[6];
    const direccionLat = partes[7];
    const longitudRaw = partes[8];
    const direccionLon = partes[9];
    let latitud = convertirADecimal(latitudRaw, direccionLat);
    let longitud = convertirADecimal(longitudRaw, direccionLon);
    const velocidad = parseFloat(partes[10]) * 1.852;
    return {
        imei: imei,
        latitud: latitud,
        longitud: longitud,
        velocidad: Math.round(velocidad),
        fecha_reporte: new Date()
    };
}

function convertirADecimal(coordenada, direccion) {
    if (!coordenada) return 0;
    const puntoIdx = coordenada.indexOf('.');
    const grados = parseFloat(coordenada.substring(0, puntoIdx - 2));
    const minutes = parseFloat(coordenada.substring(puntoIdx - 2));
    let decimal = grados + (minutes / 60);
    if (direccion === 'S' || direccion === 'W') decimal = decimal * -1;
    return parseFloat(decimal.toFixed(6));
}

// ==================== TRADUCTOR GT06 (protocolo binario del Concox) ====================
const TABLA_CRC = [
    0x0000,0x1189,0x2312,0x329b,0x4624,0x57ad,0x6536,0x74bf,
    0x8c48,0x9dc1,0xaf5a,0xbed3,0xca6c,0xdbe5,0xe97e,0xf8f7,
    0x1081,0x0108,0x3393,0x221a,0x56a5,0x472c,0x75b7,0x643e,
    0x9cc9,0x8d40,0xbfdb,0xae52,0xdaed,0xcb64,0xf9ff,0xe876,
    0x2102,0x308b,0x0210,0x1399,0x6726,0x76af,0x4434,0x55bd,
    0xad4a,0xbcc3,0x8e58,0x9fd1,0xeb6e,0xfae7,0xc87c,0xd9f5,
    0x3183,0x200a,0x1291,0x0318,0x77a7,0x662e,0x54b5,0x453c,
    0xbdcb,0xac42,0x9ed9,0x8f50,0xfbef,0xea66,0xd8fd,0xc974,
    0x4204,0x538d,0x6116,0x709f,0x0420,0x15a9,0x2732,0x36bb,
    0xce4c,0xdfc5,0xed5e,0xfcd7,0x8868,0x99e1,0xab7a,0xbaf3,
    0x5285,0x430c,0x7197,0x601e,0x14a1,0x0528,0x37b3,0x263a,
    0xdecd,0xcf44,0xfddf,0xec56,0x98e9,0x8960,0xbbfb,0xaa72,
    0x6306,0x728f,0x4014,0x519d,0x2522,0x34ab,0x0630,0x17b9,
    0xef4e,0xfec7,0xcc5c,0xddd5,0xa96a,0xb8e3,0x8a78,0x9bf1,
    0x7387,0x620e,0x5095,0x411c,0x35a3,0x242a,0x16b1,0x0738,
    0xffcf,0xee46,0xdcdd,0xcd54,0xb9eb,0xa862,0x9af9,0x8b70,
    0x8408,0x9581,0xa71a,0xb693,0xc22c,0xd3a5,0xe13e,0xf0b7,
    0x0840,0x19c9,0x2b52,0x3adb,0x4e64,0x5fed,0x6d76,0x7cff,
    0x9489,0x8500,0xb79b,0xa612,0xd2ad,0xc324,0xf1bf,0xe036,
    0x18c1,0x0948,0x3bd3,0x2a5a,0x5ee5,0x4f6c,0x7df7,0x6c7e,
    0xa50a,0xb483,0x8618,0x9791,0xe32e,0xf2a7,0xc03c,0xd1b5,
    0x2942,0x38cb,0x0a50,0x1bd9,0x6f66,0x7eef,0x4c74,0x5dfd,
    0xb58b,0xa402,0x9699,0x8710,0xf3af,0xe226,0xd0bd,0xc134,
    0x39c3,0x284a,0x1ad1,0x0b58,0x7fe7,0x6e6e,0x5cf5,0x4d7c,
    0xc60c,0xd785,0xe51e,0xf497,0x8028,0x91a1,0xa33a,0xb2b3,
    0x4a44,0x5bcd,0x6956,0x78df,0x0c60,0x1de9,0x2f72,0x3efb,
    0xd68d,0xc704,0xf59f,0xe416,0x90a9,0x8120,0xb3bb,0xa232,
    0x5ac5,0x4b4c,0x79d7,0x685e,0x1ce1,0x0d68,0x3ff3,0x2e7a,
    0xe70e,0xf687,0xc41c,0xd595,0xa12a,0xb0a3,0x8238,0x93b1,
    0x6b46,0x7acf,0x4854,0x59dd,0x2d62,0x3ceb,0x0e70,0x1ff9,
    0xf78f,0xe606,0xd49d,0xc514,0xb1ab,0xa022,0x92b9,0x8330,
    0x7bc7,0x6a4e,0x58d5,0x495c,0x3de3,0x2c6a,0x1ef1,0x0f78
];

function crc16Itu(buffer) {
    let fcs = 0xffff;
    for (let i = 0; i < buffer.length; i++) {
        fcs = (fcs >> 8) ^ TABLA_CRC[(fcs ^ buffer[i]) & 0xff];
    }
    return (~fcs) & 0xffff;
}

function construirRespuestaGT06(protocolo, serial) {
    const cuerpo = Buffer.from([0x05, protocolo, (serial >> 8) & 0xff, serial & 0xff]);
    const crc = crc16Itu(cuerpo);
    return Buffer.concat([
        Buffer.from([0x78, 0x78]),
        cuerpo,
        Buffer.from([(crc >> 8) & 0xff, crc & 0xff]),
        Buffer.from([0x0d, 0x0a])
    ]);
}

function procesarPaqueteGT06(buffer) {
    if (buffer.length < 12 || buffer[0] !== 0x78 || buffer[1] !== 0x78) return null;

    const protocolo = buffer[3];
    const serial = buffer.readUInt16BE(buffer.length - 6);

    if (protocolo === 0x01) {
        const imeiBytes = buffer.slice(4, 12);
        let imei = '';
        for (const byte of imeiBytes) {
            imei += byte.toString(16).padStart(2, '0');
        }
        imei = imei.replace(/^0/, '');
        return { tipo: 'login', imei, respuesta: construirRespuestaGT06(0x01, serial) };
    }

    if (protocolo === 0x12) {
        const contenido = buffer.slice(4, buffer.length - 6);
        const latitudRaw = contenido.readUInt32BE(7);
        const longitudRaw = contenido.readUInt32BE(11);
        const velocidad = contenido[15];
        const cursoEstado = contenido.readUInt16BE(16);

        let latitud = latitudRaw / 30000 / 60;
        let longitud = longitudRaw / 30000 / 60;

        const esNorte = (cursoEstado & 0x0400) !== 0;
        const esOeste = (cursoEstado & 0x0800) !== 0;

        if (!esNorte) latitud = -latitud;
        if (esOeste) longitud = -longitud;

        return {
            tipo: 'ubicacion',
            latitud: parseFloat(latitud.toFixed(6)),
            longitud: parseFloat(longitud.toFixed(6)),
            velocidad,
        };
    }

    if (protocolo === 0x13) {
        // DIAGNOSTICO TEMPORAL: capturamos el cuerpo crudo del paquete de estado
        // para identificar en que byte/bit viene el estado de ACC (encendido) en
        // este modelo de rastreador, antes de implementar la deteccion real.
        const contenido = buffer.slice(4, buffer.length - 6);
        return {
            tipo: 'heartbeat',
            cuerpoHex: contenido.toString('hex'),
            respuesta: construirRespuestaGT06(0x13, serial),
        };
    }

    return { tipo: 'desconocido' };
}

// ==================== SOCKET.IO: SALAS PRIVADAS POR DUEÑO ====================
io.on('connection', (socket) => {
    socket.on('autenticar', async (token) => {
        try {
            const resultado = await pool.query(
                'SELECT owner_id FROM duenos WHERE token = $1 AND activo = true',
                [token]
            );
            if (resultado.rows.length > 0) {
                const ownerId = resultado.rows[0].owner_id;
                socket.join(ownerId);
                socket.emit('autenticado', { ok: true });
                console.log(`🔑 Dueño "${ownerId}" conectado a su sala privada`);
            } else {
                socket.emit('autenticado', { ok: false });
            }
        } catch (e) {
            socket.emit('autenticado', { ok: false });
        }
    });
});

// ==================== RECEPTOR 1: PROTOCOLO COBAN (Puerto 5001) ====================
const tcpServerCoban = net.createServer((socket) => {
    socket.on('data', async (data) => {
        const tramaCruda = data.toString().trim();
        const datosCamion = procesarTramaCoban(tramaCruda);
        if (datosCamion) {
            console.log(`\n⚡ [COBAN] Camión IMEI: ${datosCamion.imei}`);
            await actualizarYNotificar(datosCamion.imei, datosCamion.latitud, datosCamion.longitud, datosCamion.velocidad);
        }
    });
    socket.on('error', () => {});
});

tcpServerCoban.listen(5001, () => {
    console.log('🚀 RECEPTOR COBAN LISTO [Puerto 5001]');
});

// ==================== RECEPTOR 2: PROTOCOLO GT06 / CONCOX (Puerto 5002) ====================
const tcpServerGT06 = net.createServer((socket) => {
    let imeiDeEstaConexion = null;

    socket.on('data', async (data) => {
        try {
            const paquete = procesarPaqueteGT06(data);
            if (!paquete) return;

            if (paquete.tipo === 'login') {
                imeiDeEstaConexion = paquete.imei;
                console.log(`\n🔐 [GT06] Login recibido, IMEI: ${paquete.imei}`);
                socket.write(paquete.respuesta);
                // Guardamos esta conexion para poder mandarle comandos despues (ej. apagado)
                conexionesGT06.set(paquete.imei, socket);
                await reforzarBloqueoSiAplica(paquete.imei, socket);
            } else if (paquete.tipo === 'ubicacion' && imeiDeEstaConexion) {
                console.log(`⚡ [GT06] Ubicación de IMEI: ${imeiDeEstaConexion}`);
                await actualizarYNotificar(imeiDeEstaConexion, paquete.latitud, paquete.longitud, paquete.velocidad);
            } else if (paquete.tipo === 'heartbeat') {
                // DIAGNOSTICO TEMPORAL: dejar este log hasta confirmar la mascara de
                // MASCARA_BIT_ACC contra hardware real.
                console.log(`📟 [GT06] Estado (0x13) de IMEI ${imeiDeEstaConexion}, cuerpo hex: ${paquete.cuerpoHex}`);
                socket.write(paquete.respuesta);
                if (imeiDeEstaConexion) {
                    await procesarCambioDeIgnicion(imeiDeEstaConexion, paquete.cuerpoHex);
                }
            }
        } catch (error) {
            console.log(`❌ Error procesando paquete GT06: ${error.message}`);
        }
    });

    socket.on('close', () => {
        // Si esta conexion se cierra, la quitamos de la lista de conexiones activas
        if (imeiDeEstaConexion && conexionesGT06.get(imeiDeEstaConexion) === socket) {
            conexionesGT06.delete(imeiDeEstaConexion);
        }
    });

    socket.on('error', () => {});
});

tcpServerGT06.listen(5002, () => {
    console.log('🛰️  RECEPTOR GT06 (CONCOX) LISTO [Puerto 5002]');
});

server.listen(3000, () => {
    console.log('🌐 API + WEBSOCKETS SEGUROS [Puerto 3000]');
});

limpiarAlertasViejas();
setInterval(limpiarAlertasViejas, RETENCION_ALERTAS_INTERVALO_MS);