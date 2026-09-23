const net = require('net');

// Nos conectamos al servidor de sockets que tienes corriendo
const client = net.createConnection({ port: 5003 }, () => {
    console.log('📡 Simulador HQ: Conectado al servidor TCP...');

    // Trama de datos idéntica a la que manda el tracker ACCURATE (protocolo HQ)
    const coordenadaFalsa = "*HQ,865205030330012,V1,145452,A,2240.55181,N,11358.32389,E,0.00,0,100815,FFFFFBFF#";

    console.log('🚚 Simulador HQ: Mandando ubicación del camión...');
    client.write(coordenadaFalsa);

    // Cerramos la conexión después de enviar
    client.end();
});

client.on('end', () => {
    console.log('🏁 Simulador HQ: Datos enviados y desconectado.');
});

client.on('error', (err) => {
    console.log(`❌ Error en el simulador HQ: ${err.message}`);
});
