# Prueba de Campo GT06

Checklist para validar con hardware real lo que hoy solo existe en código: el bit de ACC
del paquete 0x13, los comandos de corte/restauración del relé (`DYD`/`HFYD`), el bloqueo de
reencendido remoto y el recordatorio de motor encendido (Etapa D).

**Versión interactiva (con comparador de bytes automático y progreso guardado):**
https://claude.ai/code/artifact/12e2ee05-2e3e-43b4-ac6d-b3e9f5fa7209

> ⚠️ **Antes de tocar la llave:** vehículo detenido, freno de mano puesto, en un lugar
> seguro (no en tránsito). Si `DYD,000000#` corta el motor de verdad, un vehículo en
> movimiento se quedaría sin dirección asistida/frenos con el motor apagado.

## Ya desplegado / datos de referencia

| Campo | Valor |
|---|---|
| Ya desplegado | commit `5d7e9ed3` · migración corrida · pm2 reiniciado |
| Droplet | `137.184.48.248` |
| Máscara ACC actual (a confirmar) | `MASCARA_BIT_ACC = 0x02` (byte 0) |
| Comandos de relé (sin validar) | `DYD,000000#` / `HFYD,000000#` |
| Recordatorio de motor | cada 10 min mientras esté encendido |
| Log en vivo | `pm2 logs <nombre> --lines 0` |

---

## Parte A — Identificar el bit de ACC

Capturar el "cuerpo hex" del heartbeat 0x13 con el motor apagado y encendido, para saber
cuál bit cambia de verdad.

- [ ] 1. SSH al droplet y correr `pm2 list` para confirmar el nombre exacto del proceso.
- [ ] 2. Dejar el log en vivo abierto: `pm2 logs <nombre> --lines 0`
- [ ] 3. Motor apagado (llave afuera): esperar un heartbeat y copiar su cuerpo hex.
      ```
      📟 [GT06] Estado (0x13) de IMEI ..., cuerpo hex: ...
      ```
- [ ] 4. Guardar ese hex como "Motor apagado" (o pegarlo en el comparador de la versión interactiva).
- [ ] 5. Repetir 2-3 veces con el motor apagado para confirmar que el hex es estable (no cambia solo).
- [ ] 6. Encender el motor con la llave, esperar el siguiente heartbeat y copiar su hex.
- [ ] 7. Guardarlo como "Motor encendido" y comparar byte por byte contra el de apagado.
- [ ] 8. Apagar de nuevo y confirmar que el hex vuelve a parecerse al de "apagado" (descarta
      que el cambio fuera ruido de otro campo del paquete, no del ACC).

*Para comparar automáticamente (XOR byte por byte y detección del bit exacto), usa el
comparador en la versión interactiva enlazada arriba.*

## Parte B — Ajustar el código (solo si hace falta)

Solo si el comparador señaló un bit o byte distinto al que ya está en `server.js`.

- [ ] 1. Si el bit no es 0x02: actualizar `MASCARA_BIT_ACC` en `ServidorSocketsCamiones/server.js`.
- [ ] 2. Si el cambio está en un byte distinto al 0: además hay que cambiar qué byte lee
      `interpretarEstadoTerminal()`, no solo la máscara.
- [ ] 3. Commit + push a `origin/main` con el ajuste.
- [ ] 4. En el droplet: `git pull` dentro de `ServidorSocketsCamiones/`, luego `pm2 restart <nombre>`.
- [ ] 5. Opcional para no esperar 10 min por prueba: bajar temporalmente
      `RECORDATORIO_MOTOR_INTERVALO_MS` a algo como 30 segundos (recuerda revertirlo en la Parte G).

## Parte C — Encendido / apagado / recordatorio

Con el bit de ACC ya confirmado, probar que las tres alertas suenan como se diseñaron.

- [ ] 1. Confirmar que la app está abierta, logueada, y con permisos de notificación activos.
- [ ] 2. Encender el motor con la llave y buscar la alerta en el log:
      ```
      🔔 Alerta "encendido" para IMEI ...
      ```
- [ ] 3. Confirmar en el celular: 3 beeps seguidos (pin-pin-pin) **una sola vez**, y push
      "🔧 Motor encendido".
- [ ] 4. Sin apagar el motor, esperar un intervalo completo (10 min, o el que hayas puesto en B.5).
- [ ] 5. Confirmar que llega un push adicional "🔔 Motor encendido" con un beep leve, y que
      se repite cada intervalo mientras el motor siga prendido.
- [ ] 6. Apagar el motor con la llave y buscar la alerta en el log:
      ```
      🔔 Alerta "apagado" para IMEI ...
      ```
- [ ] 7. Confirmar: un beep normal, **una sola vez**, y push "🔧 Motor apagado". Esperar un
      intervalo más y confirmar que YA NO llegan recordatorios.

## Parte D — Bloqueo de reencendido remoto ⚠️ (prueba crítica)

Esto es lo que evita que alguien arranque el vehículo con la llave después de un apagado
remoto. Probarlo a fondo antes de confiarlo con un vehículo real.

- [ ] 1. Con el motor apagado y el vehículo detenido, presionar "APAGAR" en la app.
- [ ] 2. Buscar en el log el comando y la alerta:
      ```
      🔴 Comando de apagado enviado al camion IMEI: ...
      🔔 Alerta "apagado" ... origen: remoto
      ```
- [ ] 3. **Intentar arrancar el motor con la llave. NO debe encender.**
- [ ] 4. Si el ACC llega a mostrar encendido un instante, debe aparecer el refuerzo del
      corte en el log:
      ```
      🔒 Intento de encendido con llave bloqueado (remoto) en IMEI ..., reforzando corte
      ```
- [ ] 5. Repetir el intento con la llave 2-3 veces más para confirmar que el bloqueo es consistente.
- [ ] 6. Quitarle corriente al GPS un momento (desconectar/reconectar su alimentación) para
      simular que el dispositivo se reinició.
- [ ] 7. Al reconectar, buscar el login y el refuerzo defensivo, y volver a intentar
      arrancar con la llave — debe seguir bloqueado:
      ```
      🔐 [GT06] Login recibido, IMEI: ...
      🔒 Reforzando bloqueo remoto tras reconexión, IMEI ...
      ```

## Parte E — Reactivación y uso normal

Confirmar que, una vez reactivado desde la app, la llave vuelve a funcionar libre — sin
ningún corte sorpresa.

- [ ] 1. En la app, presionar "REACTIVAR".
- [ ] 2. Buscar en el log el comando y la alerta:
      ```
      🟢 Comando de reactivacion enviado al camion IMEI: ...
      🔔 Alerta "desbloqueo" ...
      ```
- [ ] 3. Confirmar push "🔓 Vehículo reactivado" en el celular.
- [ ] 4. Arrancar el motor con la llave — debe encender sin problema.
- [ ] 5. Apagar y encender con la llave 3-4 veces seguidas — debe funcionar todas las
      veces, sin que el servidor vuelva a cortar el motor por su cuenta.

## Parte F — Kilometraje automático (GPS) y alerta de cambio de aceite

Verificar que el kilometraje se acumule solo con el GPS real, que las guardas contra ruido
(`KM_TRAMO_MIN_METROS = 15`, `KM_TRAMO_MAX_KM = 5` en `server.js`) no lo arruinen, y que la
alerta de aceite se dispare bien. Requiere que la migración `migracion_kilometraje.sql` ya
haya corrido en el droplet.

- [ ] 1. Antes de arrancar, anotar el kilometraje actual del camión en la app (TrucksScreen
      o TruckDetailScreen).
- [ ] 2. Recorrer un tramo de distancia conocida (ideal 2-3 km o más, medido en un mapa, para
      que el error relativo sea chico).
- [ ] 3. Al terminar, comparar el kilometraje nuevo en la app contra el inicial: la diferencia
      debería acercarse a la distancia real recorrida (Haversine mide línea recta entre
      puntos consecutivos, no la curva exacta de la ruta — un margen de unos pocos % es
      normal, no un error).
- [ ] 4. En el log del servidor (`pm2 logs <nombre>`) durante el tramo, confirmar que NO
      aparece `⚠️ Salto GPS descartado` (si aparece, hay coordenadas erráticas en ese punto,
      revisar señal/hardware ahí).
- [ ] 5. Guarda de reposo (<15m): dejar el camión detenido varios minutos con el GPS
      reportando y confirmar que el kilometraje en la app NO sube mientras está parado (a lo
      sumo un par de metros de flotación normal, nunca kilómetros).
- [ ] 6. Guarda de salto (>5km): no hay forma segura de simularlo en campo. Si en el uso
      normal llega a aparecer `⚠️ Salto GPS descartado` en el log, anotar IMEI y hora para
      revisar después si el umbral de 5 km sigue siendo el correcto.
- [ ] 7. Carga inicial: correr en el droplet `DB_PASSWORD=... node registrarKilometrajeInicial.js
      <IMEI> <KM_INICIAL>` y confirmar que el número en la app cambia al valor puesto.
- [ ] 8. Para forzar la alerta sin esperar miles de km: correr
      `DB_PASSWORD=... node registrarKilometrajeInicial.js <IMEI> <KM> <INTERVALO_CHICO>`
      (ej. intervalo de 1 km) para que el kilometraje quede a menos de 300 km del próximo
      cambio, o directamente por encima.
- [ ] 9. Mover el camión (o esperar el próximo paquete GPS) y confirmar en el log:
      ```
      🔔 Alerta "aceite" para IMEI ...
      ```
- [ ] 10. Confirmar en el celular: sonido normal una sola vez, y push "🛢️ Cambio de aceite"
      con el mensaje de aviso (`Faltan X km...`) o el crítico (`¡MANTENIMIENTO CRÍTICO!...`)
      según corresponda.
- [ ] 11. Correr `DB_PASSWORD=... node registrarCambioAceite.js <IMEI>` y confirmar que el
      "próximo cambio" calculado sube correctamente, y que la alerta deja de dispararse en
      los siguientes paquetes GPS.
- [ ] 12. Revertir cualquier valor de prueba (ej. el intervalo chico del paso 8) antes de
      dejar el camión en uso normal.

## Parte G — Cierre

Dejar todo en el estado correcto para producción, y anotar lo que confirmaste.

- [ ] 1. Si bajaste `RECORDATORIO_MOTOR_INTERVALO_MS` en B.5, regresarlo a `10 * 60 * 1000`,
      commit, push, y `git pull` + `pm2 restart` en el droplet.
- [ ] 2. Anotar (commit o CLAUDE.md) el valor final confirmado de `MASCARA_BIT_ACC` y si
      `DYD`/`HFYD` funcionaron tal cual o hubo que cambiarlos según el manual del rastreador.
- [ ] 3. Dejar el vehículo reactivado antes de devolver las llaves.
