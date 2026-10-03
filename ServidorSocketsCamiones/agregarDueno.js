const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_system',
    password: 'Hector1557',
    port: 5432
});

// Genera un codigo tipo JUAN01, JUAN02, etc, usando el primer nombre
async function generarCodigoUnico(nombre) {
    const primerNombre = nombre
        .trim()
        .split(/\s+/)[0]
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // quita acentos (ej: JOSÉ -> JOSE)

    // Sin distinguir mayusculas: el login compara asi, entonces "juan01" y
    // "JUAN01" serian el mismo codigo
    const resultado = await pool.query(
        'SELECT token FROM duenos WHERE UPPER(token) LIKE $1',
        [primerNombre + '%']
    );

    // Busca el numero mas alto ya usado para ese nombre
    let maxNumero = 0;
    for (const fila of resultado.rows) {
        const match = fila.token.match(new RegExp('^' + primerNombre + '(\\d+)$', 'i'));
        if (match) {
            const numero = parseInt(match[1], 10);
            if (numero > maxNumero) maxNumero = numero;
        }
    }

    const siguienteNumero = String(maxNumero + 1).padStart(2, '0');
    return primerNombre + siguienteNumero;
}

async function agregarDueno(nombre) {
    const ownerId = nombre.toLowerCase().replace(/\s+/g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const token = await generarCodigoUnico(nombre);

    try {
        await pool.query(
            'INSERT INTO duenos (owner_id, nombre, token, activo, fecha_creacion) VALUES ($1, $2, $3, true, NOW())',
            [ownerId, nombre, token]
        );
        console.log('\n✅ Dueño creado exitosamente:');
        console.log('   Nombre: ' + nombre);
        console.log('   Owner ID: ' + ownerId);
        console.log('   Código de acceso: ' + token);
        console.log('\nDale este código al cliente, lo va a escribir en la app la primera vez que la abra.\n');
    } catch (error) {
        if (error.code === '23505') {
            // Lo rechazo el indice unico de migracion_token_unico.sql (o owner_id repetido)
            console.log('❌ Ya existe un dueño con ese código de acceso u owner_id. Corre el script de nuevo o revisa la tabla duenos.');
        }
        console.log('❌ Error creando dueño:', error.message);
    } finally {
        await pool.end();
    }
}

// Uso: node agregarDueno.js "Nombre Completo"
const nombreArgumento = process.argv[2];

if (!nombreArgumento) {
    console.log('Uso: node agregarDueno.js "Nombre Completo"');
    process.exit(1);
}

agregarDueno(nombreArgumento);