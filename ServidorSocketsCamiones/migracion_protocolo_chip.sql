-- Soporte para trackers HQ (protocolo de texto, ej. tracker ACCURATE) que no
-- aceptan corte remoto de motor via el servidor (a diferencia del GT06) y
-- solo se controlan mandando un SMS directo al numero del chip instalado.
-- Ejecutar una sola vez en la base de datos de produccion:
--   PGPASSWORD="$DB_PASSWORD" psql -h localhost -U postgres -d fleet_system -f migracion_protocolo_chip.sql

-- protocolo: que traductor de server.js entiende este camion ('GT06' o 'HQ').
-- Default 'GT06' para que los camiones existentes no cambien de comportamiento.
-- numero_chip: numero de telefono del SIM del tracker, para armar el SMS de
-- apagado/reactivacion. Nulo para GT06 (no lo necesita).
ALTER TABLE camiones
    ADD COLUMN IF NOT EXISTS protocolo VARCHAR(10) NOT NULL DEFAULT 'GT06',
    ADD COLUMN IF NOT EXISTS numero_chip VARCHAR(20);
