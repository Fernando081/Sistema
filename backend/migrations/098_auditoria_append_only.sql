-- Protege el historial existente sin inventar actor ni eventos anteriores.
ALTER TABLE auditoria_jsonb
  ADD COLUMN actor_name text,
  ADD COLUMN protection_version smallint NOT NULL DEFAULT 0,
  ADD COLUMN credential_changed boolean;

-- El borrado de un usuario no debe reescribir eventos históricos (antes SET NULL).
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='auditoria_jsonb'::regclass AND contype='f'
    AND (SELECT attnum FROM pg_attribute WHERE attrelid='auditoria_jsonb'::regclass AND attname='app_user_id')=ANY(conkey)
  LOOP EXECUTE format('ALTER TABLE auditoria_jsonb DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;

CREATE FUNCTION fn_audit_enrich() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[]; BEGIN
  IF NEW.table_name IN ('auth_session','auth_mfa','auth_mfa_challenge','auth_mfa_recovery','auth_password_recovery') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Los secretos de autenticación no se copian a auditoría. Registra un evento explícito sin secretos.';
  END IF;
  NEW.protection_version:=1;
  NEW.actor_name:=NULL;
  IF NEW.app_user_id IS NOT NULL THEN
    SELECT username INTO NEW.actor_name FROM auth_user WHERE id_user=NEW.app_user_id;
    IF NEW.actor_name IS NULL THEN NEW.app_user_id:=NULL; END IF;
  END IF;
  NEW.credential_changed:=NULL;
  allowed:=CASE NEW.table_name
    WHEN 'auth_user' THEN ARRAY['id_user','username','role','is_active','token_version']
    WHEN 'app_permission' THEN ARRAY['code','description']
    WHEN 'app_role_permission' THEN ARRAY['role','permission_code']
    WHEN 'app_user_permission' THEN ARRAY['id_user','permission_code','granted']
    WHEN 'app_access_profile' THEN ARRAY['id_profile','name','description','version','created_at','updated_at']
    WHEN 'app_access_profile_permission' THEN ARRAY['id_profile','permission_code']
    WHEN 'app_user_access_profile' THEN ARRAY['id_user','id_profile'] ELSE NULL END;
  IF allowed IS NOT NULL THEN
    IF NEW.table_name='auth_user' THEN
      NEW.credential_changed:=NEW.action='UPDATE' AND
        (NEW.old_record->'password_hash' IS DISTINCT FROM NEW.new_record->'password_hash');
    END IF;
    IF NEW.old_record IS NOT NULL THEN SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb)
      INTO NEW.old_record FROM jsonb_each(NEW.old_record) WHERE key=ANY(allowed); END IF;
    IF NEW.new_record IS NOT NULL THEN SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb)
      INTO NEW.new_record FROM jsonb_each(NEW.new_record) WHERE key=ANY(allowed); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_enrich BEFORE INSERT ON auditoria_jsonb FOR EACH ROW EXECUTE FUNCTION fn_audit_enrich();
ALTER TABLE auditoria_jsonb ENABLE ALWAYS TRIGGER trg_audit_enrich;

CREATE FUNCTION fn_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='La auditoría solo admite nuevos registros; no se puede modificar, borrar ni truncar.'; END $$;
CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON auditoria_jsonb
  FOR EACH STATEMENT EXECUTE FUNCTION fn_audit_append_only();
ALTER TABLE auditoria_jsonb ENABLE ALWAYS TRIGGER trg_audit_append_only;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria_jsonb FROM PUBLIC;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['auth_user','app_permission','app_role_permission','app_user_permission',
    'app_access_profile','app_access_profile_permission','app_user_access_profile'] LOOP
    EXECUTE format('CREATE TRIGGER trg_access_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger()',t);
  END LOOP;
END $$;
COMMENT ON COLUMN auditoria_jsonb.protection_version IS '0: histórico sin instantánea retroactiva;1: evento nuevo enriquecido. Todos sujetos al guard actual. No prueba integridad criptográfica ni protege frente a DDL del propietario/superusuario.';
