-- Alerta de vencimiento de seguro (conecta el lado del servidor; el celular
-- ya sabia recibir y mostrar el tipo 'seguro', pero nada lo disparaba).
-- Ejecutar una sola vez en la base de datos de produccion:
--   PGPASSWORD="$DB_PASSWORD" psql -h localhost -U postgres -d fleet_system -f migracion_alerta_seguro.sql

-- Guarda para que fecha_vencimiento_seguro especifica ya se aviso, para no
-- repetir la misma alerta cada dia durante la ventana de 3 dias. Si el
-- dueño renueva el seguro (fecha_vencimiento_seguro cambia), esta columna
-- deja de coincidir y el aviso puede volver a dispararse para el proximo
-- vencimiento sin tocar nada a mano.
ALTER TABLE camiones
    ADD COLUMN IF NOT EXISTS seguro_alerta_enviada_fecha DATE;
