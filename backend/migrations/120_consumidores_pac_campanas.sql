-- O01.2c (28/10/2026) · Consumidores en segundo plano sobre contratos existentes, sólo mock/local.
-- 1) Seguimiento de cancelaciones fiscales pendientes del SAT (reutiliza fiscal_documento/fiscal_evento).
-- 2) Ejecución simulada de campañas desde una preparación C01 vigente, revalidando bajas por destinatario.
-- Ninguna parte envía mensajes ni cambia de proveedor fiscal: el proveedor sigue siendo el configurado.

-- 1 · Cancelaciones fiscales -------------------------------------------------------------------------
ALTER TABLE fiscal_documento ADD COLUMN proxima_consulta timestamptz;
ALTER TABLE fiscal_documento ADD COLUMN consultas_estado integer NOT NULL DEFAULT 0 CHECK (consultas_estado >= 0);
CREATE INDEX idx_fiscal_documento_seguimiento ON fiscal_documento (proxima_consulta)
  WHERE estado = 'Cancelacion solicitada';
-- Las pendientes anteriores se consultan en el primer ciclo.
UPDATE fiscal_documento SET proxima_consulta = clock_timestamp() WHERE estado = 'Cancelacion solicitada';

-- 2 · Ejecución simulada de campañas ---------------------------------------------------------------------
CREATE TABLE crm_campana_ejecucion (
  id_ejecucion serial PRIMARY KEY,
  id_campana integer NOT NULL REFERENCES crm_campana(id_campana) ON DELETE RESTRICT,
  id_preparacion integer NOT NULL REFERENCES crm_campana_preparacion(id_preparacion) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  huella char(64) NOT NULL CHECK (huella ~ '^[a-f0-9]{64}$'),
  -- Único modo disponible: el canal real exige C01.2 (baja accesible, autorización del propietario).
  modo varchar(12) NOT NULL DEFAULT 'Simulacion' CHECK (modo = 'Simulacion'),
  canal varchar(10) NOT NULL CHECK (canal IN ('Correo','WhatsApp','Llamada')),
  estado varchar(10) NOT NULL DEFAULT 'En curso' CHECK (estado IN ('En curso','Terminada','Cancelada')),
  -- Huella de asunto+contenido de la plantilla al iniciar; si cambia, los pendientes se omiten.
  plantilla_sha256 char(64) NOT NULL CHECK (plantilla_sha256 ~ '^[a-f0-9]{64}$'),
  motivo varchar(500) NOT NULL CHECK (length(btrim(motivo)) > 0),
  id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  terminada_en timestamptz,
  motivo_cierre varchar(500),
  id_user_cierre integer REFERENCES auth_user(id_user) ON DELETE RESTRICT,
  CHECK ((estado = 'En curso') = (terminada_en IS NULL)),
  CHECK (estado <> 'Cancelada' OR (motivo_cierre IS NOT NULL AND length(btrim(motivo_cierre)) > 0))
);
-- Una ejecución en curso por campaña.
CREATE UNIQUE INDEX ux_crm_campana_ejecucion_en_curso ON crm_campana_ejecucion (id_campana) WHERE estado = 'En curso';

CREATE TABLE crm_campana_ejecucion_destino (
  id_ejecucion integer NOT NULL REFERENCES crm_campana_ejecucion(id_ejecucion) ON DELETE RESTRICT,
  id_contacto integer NOT NULL CHECK (id_contacto > 0),
  id_cliente integer NOT NULL REFERENCES cliente("IdCliente") ON DELETE RESTRICT,
  destino_hash char(64) NOT NULL CHECK (destino_hash ~ '^[a-f0-9]{64}$'),
  id_consentimiento integer NOT NULL REFERENCES crm_consentimiento_comercial(id_consentimiento) ON DELETE RESTRICT,
  estado varchar(10) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Simulado','Omitido','Cancelado')),
  motivo varchar(40),
  -- Huella del mensaje personalizado que se habría enviado; no se guarda el texto ni el destino.
  mensaje_sha256 char(64) CHECK (mensaje_sha256 ~ '^[a-f0-9]{64}$'),
  procesado_en timestamptz,
  PRIMARY KEY (id_ejecucion, id_contacto),
  CHECK ((estado = 'Pendiente') = (procesado_en IS NULL)),
  CHECK ((estado = 'Simulado') = (mensaje_sha256 IS NOT NULL)),
  CHECK (estado NOT IN ('Omitido','Cancelado') OR motivo IS NOT NULL)
);
CREATE INDEX idx_crm_campana_ejecucion_destino_pendiente ON crm_campana_ejecucion_destino (id_ejecucion)
  WHERE estado = 'Pendiente';

-- Conservación: no se borran ejecuciones ni destinatarios; sólo avanzan desde su estado inicial.
CREATE OR REPLACE FUNCTION fn_crm_campana_ejecucion_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Las ejecuciones de campaña se conservan'; END IF;
  IF TG_TABLE_NAME = 'crm_campana_ejecucion' THEN
    IF OLD.estado <> 'En curso' THEN RAISE EXCEPTION 'La ejecución ya terminó'; END IF;
    IF (NEW.id_campana, NEW.id_preparacion, NEW.request_id, NEW.huella, NEW.modo, NEW.canal, NEW.plantilla_sha256, NEW.motivo, NEW.id_user, NEW.creada_en)
       IS DISTINCT FROM (OLD.id_campana, OLD.id_preparacion, OLD.request_id, OLD.huella, OLD.modo, OLD.canal, OLD.plantilla_sha256, OLD.motivo, OLD.id_user, OLD.creada_en) THEN
      RAISE EXCEPTION 'Los datos de origen de la ejecución no cambian';
    END IF;
  ELSE
    IF OLD.estado <> 'Pendiente' THEN RAISE EXCEPTION 'El destinatario ya fue procesado'; END IF;
    IF (NEW.id_ejecucion, NEW.id_contacto, NEW.id_cliente, NEW.destino_hash, NEW.id_consentimiento)
       IS DISTINCT FROM (OLD.id_ejecucion, OLD.id_contacto, OLD.id_cliente, OLD.destino_hash, OLD.id_consentimiento) THEN
      RAISE EXCEPTION 'Los datos de origen del destinatario no cambian';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_campana_ejecucion_transicion BEFORE UPDATE OR DELETE ON crm_campana_ejecucion
  FOR EACH ROW EXECUTE FUNCTION fn_crm_campana_ejecucion_transicion();
CREATE TRIGGER crm_campana_ejecucion_destino_transicion BEFORE UPDATE OR DELETE ON crm_campana_ejecucion_destino
  FOR EACH ROW EXECUTE FUNCTION fn_crm_campana_ejecucion_transicion();
CREATE TRIGGER crm_campana_ejecucion_truncate BEFORE TRUNCATE ON crm_campana_ejecucion
  FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_campana_conservar();
CREATE TRIGGER crm_campana_ejecucion_destino_truncate BEFORE TRUNCATE ON crm_campana_ejecucion_destino
  FOR EACH STATEMENT EXECUTE FUNCTION fn_crm_campana_conservar();
ALTER TABLE crm_campana_ejecucion ENABLE ALWAYS TRIGGER crm_campana_ejecucion_transicion;
ALTER TABLE crm_campana_ejecucion_destino ENABLE ALWAYS TRIGGER crm_campana_ejecucion_destino_transicion;
ALTER TABLE crm_campana_ejecucion ENABLE ALWAYS TRIGGER crm_campana_ejecucion_truncate;
ALTER TABLE crm_campana_ejecucion_destino ENABLE ALWAYS TRIGGER crm_campana_ejecucion_destino_truncate;
CREATE TRIGGER crm_campana_ejecucion_auditoria AFTER INSERT OR UPDATE ON crm_campana_ejecucion
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- Procesos automáticos: seguimiento fiscal cada 5 min (latido 30 min) y simulación cada minuto (latido 10 min).
INSERT INTO operational_job(name,interval_seconds,grace_seconds) VALUES
  ('fiscal_followup',1800,600),
  ('campaign_simulation',600,300)
ON CONFLICT (name) DO NOTHING;
