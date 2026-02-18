-- Migration: Create auth_user table for JWT authentication
-- Description: Creates the auth_user table with columns for storing user credentials
-- Date: 2026-02-17

-- Create auth_user table
CREATE TABLE IF NOT EXISTS auth_user (
    id_user SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on username for faster lookups
CREATE INDEX IF NOT EXISTS idx_auth_user_username ON auth_user(username);

-- Create index on is_active for filtering active users
CREATE INDEX IF NOT EXISTS idx_auth_user_is_active ON auth_user(is_active);

-- Add comment to the table
COMMENT ON TABLE auth_user IS 'Stores authentication credentials for system users';
COMMENT ON COLUMN auth_user.id_user IS 'Primary key - unique user identifier';
COMMENT ON COLUMN auth_user.username IS 'Unique username for login';
COMMENT ON COLUMN auth_user.password_hash IS 'Hashed password using scrypt (format: salt:hash)';
COMMENT ON COLUMN auth_user.role IS 'User role (e.g., admin, user)';
COMMENT ON COLUMN auth_user.is_active IS 'Flag to enable/disable user access';
COMMENT ON COLUMN auth_user.created_at IS 'Timestamp when user was created';
COMMENT ON COLUMN auth_user.updated_at IS 'Timestamp when user was last updated';

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_auth_user_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function before updates
CREATE TRIGGER trigger_auth_user_updated_at
    BEFORE UPDATE ON auth_user
    FOR EACH ROW
    EXECUTE FUNCTION update_auth_user_updated_at();
