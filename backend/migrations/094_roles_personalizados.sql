-- Perfiles de permisos reutilizables. No modifica roles base ni accesos existentes.
CREATE TABLE app_access_profile (
  id_profile integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(80) NOT NULL CHECK (length(btrim(name)) > 0),
  description varchar(500) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX app_access_profile_name_uq ON app_access_profile (lower(btrim(name)));
CREATE TABLE app_access_profile_permission (
  id_profile integer NOT NULL REFERENCES app_access_profile ON DELETE CASCADE,
  permission_code varchar(80) NOT NULL REFERENCES app_permission(code),
  PRIMARY KEY (id_profile, permission_code)
);
CREATE TABLE app_user_access_profile (
  id_user integer PRIMARY KEY REFERENCES auth_user ON DELETE CASCADE,
  id_profile integer NOT NULL REFERENCES app_access_profile
);
CREATE INDEX app_user_access_profile_profile_idx ON app_user_access_profile(id_profile);

CREATE FUNCTION fn_effective_permission(p_user integer, p_role text, p_code text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT granted FROM app_user_permission WHERE id_user=p_user AND permission_code=p_code),
    (SELECT EXISTS(SELECT 1 FROM app_access_profile_permission pp
       WHERE pp.id_profile=assigned.id_profile AND pp.permission_code=p_code)
     FROM app_user_access_profile assigned WHERE assigned.id_user=p_user AND p_role='user'),
    EXISTS(SELECT 1 FROM app_role_permission WHERE role=p_role AND permission_code=p_code),
    false
  )
$$;
COMMENT ON FUNCTION fn_effective_permission(integer,text,text) IS
  'Excepción individual > lista permitida del perfil del operador > rol base. Un perfil no concede rol administrador.';
