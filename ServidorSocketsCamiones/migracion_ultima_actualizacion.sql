-- Agrega el campo de "última señal" a camiones.
-- Correr en el droplet (Postgres solo escucha en localhost):
--   psql -U postgres -d fleet_system -f migracion_ultima_actualizacion.sql
-- y despues reiniciar server.js para que empiece a escribir el campo.

ALTER TABLE camiones ADD COLUMN IF NOT EXISTS ultima_actualizacion TIMESTAMPTZ;
