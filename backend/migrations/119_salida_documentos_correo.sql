-- O01.2b (28/10/2026) · Envío real de documentos por correo con ejecutor persistente.
-- Las solicitudes "Local" de O01.2a siguen siendo locales para siempre; el envío exige modo "Correo"
-- elegido al preparar. Ningún estado "Simulado" se convierte en envío.

ALTER TABLE documento_salida DROP CONSTRAINT documento_salida_modo_check;
ALTER TABLE documento_salida ADD CONSTRAINT documento_salida_modo_check CHECK (modo IN ('Local','Correo'));

-- Cierres nuevos: Aceptado (el servidor SMTP respondió 250; no es constancia de entrega) y Fallido.
ALTER TABLE documento_salida_cierre DROP CONSTRAINT documento_salida_cierre_accion_check;
ALTER TABLE documento_salida_cierre ADD CONSTRAINT documento_salida_cierre_accion_check
  CHECK (accion IN ('Simulado','Cancelado','Obsoleto','Aceptado','Fallido'));
ALTER TABLE documento_salida_cierre DROP CONSTRAINT documento_salida_cierre_check;
ALTER TABLE documento_salida_cierre ADD CONSTRAINT documento_salida_cierre_check CHECK (
  (accion IN ('Cancelado','Fallido') AND motivo IS NOT NULL AND length(btrim(motivo)) > 0)
  OR (accion NOT IN ('Cancelado','Fallido') AND motivo IS NULL));
-- Cierres automáticos del ejecutor no tienen persona; los manuales conservan su actor.
ALTER TABLE documento_salida_cierre ALTER COLUMN id_actor DROP NOT NULL;

CREATE OR REPLACE FUNCTION fn_documento_salida_cierre_modo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_modo text;
BEGIN
  SELECT modo INTO v_modo FROM documento_salida WHERE id = NEW.id;
  IF NEW.accion = 'Simulado' AND v_modo <> 'Local' THEN
    RAISE EXCEPTION 'Una solicitud de correo no se simula; se envía o se cancela';
  END IF;
  IF NEW.accion IN ('Aceptado','Fallido') AND v_modo <> 'Correo' THEN
    RAISE EXCEPTION 'Una solicitud local nunca se envía';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documento_salida_cierre_modo BEFORE INSERT ON documento_salida_cierre
  FOR EACH ROW EXECUTE FUNCTION fn_documento_salida_cierre_modo();
ALTER TABLE documento_salida_cierre ENABLE ALWAYS TRIGGER documento_salida_cierre_modo;

-- Estado de trabajo del ejecutor (mutable). El historial inmutable vive en intentos y conciliaciones.
CREATE TABLE documento_salida_envio (
  id uuid PRIMARY KEY REFERENCES documento_salida(id) ON DELETE RESTRICT,
  estado varchar(12) NOT NULL DEFAULT 'Pendiente'
    CHECK (estado IN ('Pendiente','EnCurso','Reintento','Aceptado','Incierto','Fallido','Cancelado','Obsoleto')),
  intentos smallint NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 20),
  max_intentos smallint NOT NULL DEFAULT 4 CHECK (max_intentos BETWEEN 1 AND 10),
  proximo_intento timestamptz,
  reserva_token uuid,
  reserva_hasta timestamptz,
  message_id varchar(200) NOT NULL UNIQUE,
  ultimo_error varchar(500),
  respuesta_smtp varchar(500),
  actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((estado = 'EnCurso') = (reserva_token IS NOT NULL AND reserva_hasta IS NOT NULL))
);
CREATE INDEX idx_documento_salida_envio_pendiente ON documento_salida_envio (proximo_intento)
  WHERE estado IN ('Pendiente','Reintento');
CREATE INDEX idx_documento_salida_envio_en_curso ON documento_salida_envio (reserva_hasta) WHERE estado = 'EnCurso';

CREATE TABLE documento_salida_intento (
  id bigserial PRIMARY KEY,
  id_salida uuid NOT NULL REFERENCES documento_salida(id) ON DELETE RESTRICT,
  numero smallint NOT NULL CHECK (numero >= 1),
  inicio timestamptz NOT NULL,
  fin timestamptz NOT NULL DEFAULT clock_timestamp(),
  resultado varchar(12) NOT NULL CHECK (resultado IN ('Aceptado','Reintento','Fallido','Incierto','Obsoleto')),
  codigo_smtp smallint,
  detalle varchar(500),
  UNIQUE (id_salida, numero)
);

-- Decisiones humanas sobre un envío Incierto (respuesta perdida): nunca automáticas.
CREATE TABLE documento_salida_conciliacion (
  id bigserial PRIMARY KEY,
  id_salida uuid NOT NULL REFERENCES documento_salida(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  accion varchar(20) NOT NULL CHECK (accion IN ('ConfirmarAceptado','Reintentar','DarPorFallido')),
  motivo varchar(300) NOT NULL CHECK (length(btrim(motivo)) > 0),
  id_actor integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER documento_salida_intento_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON documento_salida_intento
  FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
CREATE TRIGGER documento_salida_conciliacion_conservar BEFORE UPDATE OR DELETE OR TRUNCATE ON documento_salida_conciliacion
  FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_secuencia_conservar();
ALTER TABLE documento_salida_intento ENABLE ALWAYS TRIGGER documento_salida_intento_conservar;
ALTER TABLE documento_salida_conciliacion ENABLE ALWAYS TRIGGER documento_salida_conciliacion_conservar;
CREATE TRIGGER documento_salida_conciliacion_auditoria AFTER INSERT ON documento_salida_conciliacion
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- Ejecutor de correos: revisa cada minuto y registra cuando hay trabajo o cada 10 minutos como latido,
-- así aparece en Procesos automáticos y sus fallos o atrasos avisan como los demás jobs.
INSERT INTO operational_job(name,interval_seconds,grace_seconds) VALUES ('document_mail',600,300) ON CONFLICT (name) DO NOTHING;
