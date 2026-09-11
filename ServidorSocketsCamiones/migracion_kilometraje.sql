-- Kilometraje acumulado automaticamente por GPS (Haversine) + aviso de cambio de aceite.
-- Ejecutar una sola vez en la base de datos de produccion:
--   PGPASSWORD='Hector1557' psql -h localhost -U postgres -d fleet_system -f migracion_kilometraje.sql

-- "kilometraje" era texto libre para mostrar tal cual (ej. "50,000 km").
-- De aca en adelante es el total acumulado que el servidor va sumando solo
-- con cada paquete GPS que llega (Haversine), asi que tiene que ser
-- numerico. Los valores existentes se limpian de cualquier caracter que no
-- sea digito o punto antes de convertirlos (ej. "50,000 km" -> 50000).
ALTER TABLE camiones
    ALTER COLUMN kilometraje TYPE NUMERIC
    USING COALESCE(NULLIF(regexp_replace(kilometraje, '[^0-9.]', '', 'g'), ''), '0')::NUMERIC;

ALTER TABLE camiones
    ALTER COLUMN kilometraje SET DEFAULT 0,
    ALTER COLUMN kilometraje SET NOT NULL;

-- kilometraje_ultimo_cambio: valor de "kilometraje" en el momento del
-- ultimo cambio de aceite registrado (lo pone a mano registrarCambioAceite.js).
-- intervalo_cambio_aceite: cada cuantos km toca cambiar aceite, por camion.
ALTER TABLE camiones
    ADD COLUMN IF NOT EXISTS kilometraje_ultimo_cambio NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS intervalo_cambio_aceite INTEGER NOT NULL DEFAULT 10000;
