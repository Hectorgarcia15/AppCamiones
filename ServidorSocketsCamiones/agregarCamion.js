const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_system',
    password: 'Hector1557',
    port: 5432
});

async function agregarCamion(ownerId, imei, ficha, marca, modelo, ano, protocolo, numeroChip) {
    try {
        const duenoExiste = await pool.query('SELECT nombre FROM duenos WHERE owner_id = $1', [ownerId]);
        if (duenoExiste.rows.length === 0) {
            console.log('❌ No existe ningún dueño con Owner ID: ' + ownerId);
            console.log('   Revisa que lo hayas escrito igual a como salió en agregarDueno.js');
            await pool.end();
            return;
        }

        await pool.query(
            `INSERT INTO camiones (owner_id, imei, ficha, marca, modelo, ano, estado, protocolo, numero_chip)
             VALUES ($1, $2, $3, $4, $5, $6, 'activo', $7, $8)`,
            [ownerId, imei, ficha, marca, modelo, ano, protocolo, numeroChip || null]
        );

        console.log('\n✅ Camión agregado exitosamente:');
        console.log('   Dueño: ' + duenoExiste.rows[0].nombre + ' (' + ownerId + ')');
        console.log('   Ficha: ' + ficha);
        console.log('   Marca/Modelo: ' + marca + ' ' + modelo + ' ' + ano);
        console.log('   IMEI: ' + imei);
        console.log('   Protocolo: ' + protocolo + (numeroChip ? ` (chip: ${numeroChip})` : '') + '\n');
    } catch (error) {
        console.log('❌ Error: ' + error.message);
    }
    await pool.end();
}

const [ownerId, imei, ficha, marca, modelo, ano, protocoloArg, numeroChip] = process.argv.slice(2);
const protocolo = (protocoloArg || 'GT06').toUpperCase();

if (!ownerId || !imei || !ficha || !marca || !modelo || !ano) {
    console.log('❌ Faltan datos. Uso correcto:');
    console.log('node agregarCamion.js OWNER_ID IMEI FICHA MARCA MODELO ANO [PROTOCOLO] [NUMERO_CHIP]');
    console.log('PROTOCOLO: GT06 (default) o HQ. NUMERO_CHIP solo aplica (y hace falta) para HQ.');
    console.log('Ejemplos:');
    console.log('node agregarCamion.js cliente_prueba 123456789012345 "A123456" Freightliner Cascadia 2020');
    console.log('node agregarCamion.js cliente_prueba 865205030330012 "A123456" ACCURATE Tracker 2024 HQ +50412345678');
    process.exit(1);
}

if (protocolo !== 'GT06' && protocolo !== 'HQ') {
    console.log(`❌ Protocolo inválido: "${protocoloArg}". Debe ser GT06 o HQ.`);
    process.exit(1);
}

if (protocolo === 'HQ' && !numeroChip) {
    console.log('❌ Falta el número de chip: es obligatorio para camiones con protocolo HQ.');
    process.exit(1);
}

agregarCamion(ownerId, imei, ficha, marca, modelo, ano, protocolo, numeroChip);