-- Impide que dos dueños tengan el mismo codigo de acceso aunque solo cambien
-- mayusculas/minusculas (el login y el socket comparan sin distinguirlas, asi
-- que dos codigos asi abririan la misma puerta a cuentas distintas).
--
-- Correr en el droplet:  sudo -u postgres psql fleet_system -f migracion_token_unico.sql
--
-- 1) Debe devolver 0 filas. Si devuelve algo, hay codigos repetidos: hay que
--    cambiarle el codigo a una de las cuentas ANTES de seguir, o el paso 2 falla
--    (sin tocar nada).
SELECT COUNT(*) AS filas, array_agg(owner_id) AS cuentas
FROM duenos
GROUP BY LOWER(token)
HAVING COUNT(*) > 1;

-- 2) El indice. La tabla es chica: se crea en milisegundos y solo bloquea
--    escrituras en duenos durante ese instante (los logins siguen funcionando).
--    Se puede correr con el servidor encendido.
CREATE UNIQUE INDEX IF NOT EXISTS duenos_token_lower_unico ON duenos (LOWER(token));

-- 3) Comprobacion: debe mostrar el indice.
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'duenos' AND indexname = 'duenos_token_lower_unico';

-- Para deshacerlo (si hiciera falta):  DROP INDEX duenos_token_lower_unico;
