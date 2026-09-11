const { Pool } = require('pg');

if (!process.env.DB_PASSWORD) {
    console.log('❌ Falta la variable de entorno DB_PASSWORD.');
    console.log('   Ejemplo: DB_PASSWORD=tu_password node registrarKilometrajeInicial.js ...');
    process.exit(1);
}

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_system',
    password: process.env.DB_PASSWORD,
    port: 5432
});

// Kilometraje inicial: se ingresa una sola vez a mano (al dar de alta el
// camion, o para corregirlo). De ahi en adelante el servidor lo va sumando
// solo con cada paquete GPS que llega (ver actualizarYNotificar en server.js).
async function registrarKilometrajeInicial(imei, kilometraje, intervaloCambioAceite) {
    try {
        const camionExiste = await pool.query('SELECT ficha FROM camiones WHERE imei = $1', [imei]);
        if (camionExiste.rows.length === 0) {
            console.log('❌ No existe ningún camión con IMEI: ' + imei);
            await pool.end();
            return;
        }

        const resultado = intervaloCambioAceite
            ? await pool.query(
                  'UPDATE camiones SET kilometraje = $1, intervalo_cambio_aceite = $2 WHERE imei = $3 RETURNING ficha, kilometraje, intervalo_cambio_aceite',
                  [kilometraje, intervaloCambioAceite, imei]
              )
            : await pool.query(
                  'UPDATE camiones SET kilometraje = $1 WHERE imei = $2 RETURNING ficha, kilometraje, intervalo_cambio_aceite',
                  [kilometraje, imei]
              );

        const fila = resultado.rows[0];
        console.log('\n✅ Kilometraje inicial registrado:');
        console.log('   Ficha: ' + fila.ficha);
        console.log('   Kilometraje: ' + fila.kilometraje + ' km');
        console.log('   Intervalo de cambio de aceite: ' + fila.intervalo_cambio_aceite + ' km\n');
    } catch (error) {
        console.log('❌ Error: ' + error.message);
    }
    await pool.end();
}

const [imei, kilometrajeArgumento, intervaloArgumento] = process.argv.slice(2);

if (!imei || !kilometrajeArgumento) {
    console.log('❌ Faltan datos. Uso correcto:');
    console.log('node registrarKilometrajeInicial.js IMEI KILOMETRAJE [INTERVALO_CAMBIO_ACEITE]');
    console.log('Ejemplo:');
    console.log('node registrarKilometrajeInicial.js 352812345678901 50000 10000');
    process.exit(1);
}

registrarKilometrajeInicial(imei, Number(kilometrajeArgumento), intervaloArgumento ? Number(intervaloArgumento) : null);
