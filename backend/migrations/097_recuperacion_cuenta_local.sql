-- Recuperación local previamente inscrita. Sin correo inferido ni claves de ejemplo.
CREATE TABLE auth_password_recovery (
  id_user integer PRIMARY KEY REFERENCES auth_user(id_user) ON DELETE CASCADE,
  active_hash char(64),
  credential_digest char(64),
  confirmed_at timestamptz,
  expires_at timestamptz,
  pending_hash char(64),
  pending_credential_digest char(64),
  pending_version integer,
  pending_expires_at timestamptz,
  CHECK ((active_hash IS NULL AND credential_digest IS NULL AND confirmed_at IS NULL AND expires_at IS NULL)
    OR (active_hash IS NOT NULL AND credential_digest IS NOT NULL AND confirmed_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at>confirmed_at)),
  CHECK ((pending_hash IS NULL AND pending_credential_digest IS NULL AND pending_version IS NULL AND pending_expires_at IS NULL)
    OR (pending_hash IS NOT NULL AND pending_credential_digest IS NOT NULL AND pending_version IS NOT NULL AND pending_version>=0 AND pending_expires_at IS NOT NULL))
);
COMMENT ON TABLE auth_password_recovery IS 'Clave offline de recuperación de contraseña, SHA-256 solamente. Pendiente10min, confirmada365d; un uso y vinculada a credencial. No aplicar trigger de auditoría que copie hashes.';
