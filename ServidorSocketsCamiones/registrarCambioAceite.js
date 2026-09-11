const { Pool } = require('pg');

if (!process.env.DB_PASSWORD) {
    console.log('❌ Falta la variable de entorno DB_PASSWORD.');
    console.log('   Ejemplo: DB_PASSWORD=tu_password node registrarCambioAceite.js ...');
    process.exit(1);
}

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_system',
    password: process.env.DB_PASSWORD,
    port: 5432
});

// Se corre a mano cuando el dueño confirma que ya le hizo el cambio de
// aceite al camión. Marca "kilometraje_ultimo_cambio" al valor de
// "kilometraje" en este momento; kilometraje sigue acumulando después de
// esto sin reiniciarse, solo se corre la vara del próximo cambio.
async function registrarCambioAceite(imei) {
    try {
        const resultado = await pool.query(
            'UPDATE camiones SET kilometraje_ultimo_cambio = kilometraje WHERE imei = $1 RETURNING ficha, kilometraje, kilometraje_ultimo_cambio, intervalo_cambio_aceite',
            [imei]
        );

        if (resultado.rows.length === 0) {
            console.log('❌ No existe ningún camión con IMEI: ' + imei);
        } else {
            const fila = resultado.rows[0];
            console.log('\n✅ Cambio de aceite registrado:');
            console.log('   Ficha: ' + fila.ficha);
            console.log('   Kilometraje actual: ' + fila.kilometraje + ' km');
            console.log('   Próximo cambio: ' + (Number(fila.kilometraje_ultimo_cambio) + Number(fila.intervalo_cambio_aceite)) + ' km\n');
        }
    } catch (error) {
        console.log('❌ Error: ' + error.message);
    }
    await pool.end();
}

const imeiArgumento = process.argv[2];
if (!imeiArgumento) {
    console.log('Uso: node registrarCambioAceite.js IMEI');
    process.exit(1);
}

registrarCambioAceite(imeiArgumento);
