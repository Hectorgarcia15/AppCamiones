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
      `RECORDATORIO_MOTOR_INTERVALO_MS` a algo como 30 segundos (recuerda revertirlo en la Parte F).

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

## Parte F — Cierre

Dejar todo en el estado correcto para producción, y anotar lo que confirmaste.

- [ ] 1. Si bajaste `RECORDATORIO_MOTOR_INTERVALO_MS` en B.5, regresarlo a `10 * 60 * 1000`,
      commit, push, y `git pull` + `pm2 restart` en el droplet.
- [ ] 2. Anotar (commit o CLAUDE.md) el valor final confirmado de `MASCARA_BIT_ACC` y si
      `DYD`/`HFYD` funcionaron tal cual o hubo que cambiarlos según el manual del rastreador.
- [ ] 3. Dejar el vehículo reactivado antes de devolver las llaves.
