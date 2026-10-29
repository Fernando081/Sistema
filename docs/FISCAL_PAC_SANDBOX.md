# Integración fiscal y PAC sandbox

El módulo fiscal separa el ciclo comercial del ciclo CFDI. Una factura o REP se crea primero como borrador; después se genera el XML, se envía al PAC y se guarda el XML timbrado, UUID, certificados, sellos y eventos de auditoría. La cancelación local sólo revierte inventario y saldos cuando SAT confirma que el CFDI está cancelado.

## Modos

| `FISCAL_MODE` | Proveedor | Uso |
| --- | --- | --- |
| `mock` | interno | Desarrollo local. Genera UUID y XML deterministas, claramente marcados sin validez fiscal y sin llamadas externas. |
| `sandbox` | SW pruebas | Timbrado y cancelación contra los servicios de prueba del PAC. |
| `production` | SW producción | Operación real. También exige `FISCAL_PRODUCTION_ENABLED=true`. |

El backend nunca guarda la contraseña ni el token del PAC en PostgreSQL. Se leen del entorno y las respuestas de error no incluyen credenciales.
Un CFDI conserva el ambiente y proveedor con los que se creó. El sistema bloquea timbrados y cancelaciones si se cambia de `mock` a `sandbox` o de `sandbox` a producción sobre el mismo documento, para evitar enviar UUID de pruebas al servicio equivocado.

## Preparar el sandbox

1. Crear una cuenta en el ambiente de pruebas de SW y registrar allí el CSD de pruebas que corresponda al RFC emisor.
2. Copiar `backend/.env.example` a `backend/.env` si todavía no existe.
3. Configurar los datos fiscales del emisor y una de estas formas de acceso:

```dotenv
FISCAL_MODE=sandbox
PAC_PROVIDER=sw
FISCAL_ISSUER_RFC=RFC_DE_PRUEBAS
FISCAL_ISSUER_NAME=RAZON_SOCIAL_DE_PRUEBAS
FISCAL_ISSUER_TAX_REGIME=601
FISCAL_ISSUER_POSTAL_CODE=89000

# Opción A: token del portal
PAC_SW_TOKEN=token_de_pruebas

# Opción B: autenticación en cada inicio
PAC_SW_USER=usuario_de_pruebas
PAC_SW_PASSWORD=contrasena_de_pruebas
```

4. Reiniciar el backend y consultar `GET /api/v1/fiscal/configuracion`. Debe responder `environment: sandbox`, `provider: sw`, `ready: true` y `missing: []`.
5. Timbrar primero una factura PPD antes de crear y timbrar su REP. El REP usa el UUID real de la factura relacionada.

No se deben enviar credenciales por chat ni agregarlas a Git. `backend/.env` está excluido del repositorio.

## Operaciones disponibles

Los tipos de URL son `facturas` y `reps`.

| Método y ruta | Acción |
| --- | --- |
| `GET /api/v1/fiscal/configuracion` | Estado seguro de la configuración, sin secretos. |
| `GET /api/v1/fiscal/:tipo/:id` | Estado, UUID, error y metadatos del documento. |
| `GET /api/v1/fiscal/:tipo/:id/eventos` | Historial auditable del ciclo fiscal. |
| `POST /api/v1/fiscal/:tipo/:id/timbrar` | Genera y timbra el CFDI. Requiere `fiscal.timbrar`. |
| `GET /api/v1/fiscal/:tipo/:id/xml` | Descarga el XML timbrado. |
| `GET /api/v1/fiscal/:tipo/:id/acuse` | Descarga el acuse de cancelación. |

La cancelación se inicia desde los endpoints existentes de factura o REP y recibe:

```json
{
  "motivo": "02",
  "uuidSustitucion": null
}
```

El motivo `01` exige el UUID del CFDI sustituto. Si SAT responde que la solicitud sigue pendiente, el documento queda en `CancelacionSolicitada`; una nueva consulta de cancelación reconcilia el estado antes de modificar la operación local.

## Estados y reglas

- `Borrador`: todavía no se ha enviado al PAC.
- `Procesando`: hay una operación de timbrado en curso.
- `Timbrado`: existe XML y UUID emitidos por el PAC.
- `CancelacionSolicitada`: el PAC aceptó la solicitud y SAT aún no confirma la cancelación.
- `Cancelado`: SAT confirmó la cancelación y ya puede ejecutarse el reverso local.
- `Error`: se conserva un mensaje sanitizado y el número de intento para diagnóstico.

Las facturas relacionadas deben usar un solo `TipoRelacion`. Los REP actualmente admiten documentos y pagos en MXN; una moneda distinta se bloquea hasta que se capture y valide su equivalencia.

## Verificación antes de liberar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run db:check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/node24.ps1 run verify:release
```

`verify:release` restaura el respaldo más reciente en una base temporal y valida timbrado/cancelación mock de factura y REP junto con los reversos transaccionales. El ambiente sandbox real requiere las credenciales y el CSD configurados en el portal del PAC.

## O01.2c — seguimiento automático de cancelaciones (28/10/2026)

Cuando el SAT deja una cancelación **pendiente** (el receptor debe aceptarla), el documento queda en `Cancelacion solicitada` y la operación no se revierte. Antes sólo se volvía a revisar si alguien pulsaba "Cancelar" otra vez. Ahora el proceso automático **Seguimiento de cancelaciones fiscales** (`fiscal_followup`, cada 5 minutos) lo consulta solo:

| Consulta | Espera antes de la siguiente |
| --- | --- |
| 1.ª | 15 minutos después de solicitar |
| 2.ª | 1 hora |
| 3.ª | 4 horas |
| Siguientes | cada 12 horas |

- **SAT confirma:** el documento pasa a `Cancelado` y se completa la misma reversión del botón (factura: `sp_cancelar_factura`; REP: `cancelarRep`), con el usuario que pidió la cancelación. Si ya se hizo a mano, no se repite. Aviso informativo.
- **Receptor rechaza** (`EstatusCancelacion` con "rechaz" y CFDI vigente): vuelve a `Timbrado`, la operación no cambia, evento `CANCELACION_RECHAZADA` y aviso de advertencia.
- **Consulta fallida o sin respuesta:** sigue pendiente, evento `CONSULTA_ERROR`/`ESTADO_CONSULTADO` y nueva espera. Tras unos 7 días avisa una vez y sigue consultando.
- **Reversión fallida** (por ejemplo, porque después se emitió un REP): el estado fiscal queda `Cancelado` y llega un aviso crítico para completarla a mano con "Cancelar".
- **Timbrado interrumpido:** un documento en `Procesando` sin respuesta por más de 15 minutos pasa a `Error` con el evento `TIMBRADO_INTERRUMPIDO`; al timbrar de nuevo se usa la misma clave de idempotencia.
- Si el ambiente o proveedor del documento no coincide con la configuración actual, no se consulta; se registra y se reprograma.

Los avisos llegan al centro de notificaciones de quien pidió la cancelación, o a los administradores si esa cuenta ya no está activa. Todos los eventos automáticos llevan `"automatico": true` en su detalle.

### Probar sin PAC

`FISCAL_MOCK_CANCELACION` (sólo con `FISCAL_MODE=mock`): vacío o `inmediata` cancela al instante, como antes; `pendiente` deja la cancelación en espera y la primera consulta la confirma; `rechazada` la deja en espera y la consulta informa el rechazo. `npm run test:pac-campaigns` prueba el ciclo completo en una copia aislada.

### Límites

- No se probó contra el servicio de consulta real del SAT; la detección del rechazo sigue el texto que devuelve `EstatusCancelacion`.
- El proceso corre dentro del backend; si está apagado, las consultas esperan.
