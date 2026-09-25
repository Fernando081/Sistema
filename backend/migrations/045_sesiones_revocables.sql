-- Permite invalidar inmediatamente las sesiones al cambiar contraseña, rol o estado.
ALTER TABLE auth_user ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
ALTER TABLE auth_user ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE auth_user ADD CONSTRAINT auth_user_token_version_nonnegative CHECK (token_version >= 0);
COMMENT ON COLUMN auth_user.password_hash IS 'Hash bcrypt de la contraseña; no se devuelve por API';
COMMENT ON COLUMN auth_user.token_version IS 'Versión de sesión; incrementarla revoca todos los JWT previos';
