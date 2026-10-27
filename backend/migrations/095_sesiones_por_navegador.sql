-- Sesiones individuales para cuentas persistidas; sin tokens, IP ni User-Agent completo.
CREATE TABLE auth_session (
  id_session uuid PRIMARY KEY,
  id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE CASCADE,
  token_version integer NOT NULL CHECK (token_version >= 0),
  client_label varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_session_user_active_idx ON auth_session(id_user,created_at DESC,id_session)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_session_expiry_idx ON auth_session(id_user,expires_at);
COMMENT ON TABLE auth_session IS 'Una fila por login, no por equipo físico. ID técnico no autoriza sin JWT válido. Sesiones anteriores sin sid requieren nuevo login.';
