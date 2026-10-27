-- S02.3: MFA opcional. Ninguna cuenta se inscribe automáticamente.
CREATE TABLE auth_mfa (
  id_user integer PRIMARY KEY REFERENCES auth_user(id_user) ON DELETE CASCADE,
  secret_box text NOT NULL,
  enabled_at timestamptz,
  pending_expires_at timestamptz NOT NULL,
  last_step bigint NOT NULL DEFAULT -1,
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 5),
  blocked_until timestamptz
);
CREATE TABLE auth_mfa_challenge (
  token_hash char(64) PRIMARY KEY,
  id_user integer NOT NULL REFERENCES auth_user(id_user) ON DELETE CASCADE,
  token_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX auth_mfa_challenge_user_idx ON auth_mfa_challenge(id_user,expires_at);
CREATE TABLE auth_mfa_recovery (
  id_user integer NOT NULL REFERENCES auth_mfa(id_user) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  used_at timestamptz,
  PRIMARY KEY(id_user,code_hash)
);
COMMENT ON TABLE auth_mfa IS 'Secreto AES-256-GCM con clave externa AUTH_MFA_ENCRYPTION_KEY; no registrar ni exportar al catálogo público.';
COMMENT ON TABLE auth_mfa_challenge IS 'Reto opaco de cinco minutos; solo hash; no autoriza acceso a la API.';
