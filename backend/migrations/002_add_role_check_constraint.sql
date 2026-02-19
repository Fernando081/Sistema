-- Migration: Add CHECK constraint to auth_user.role column
-- Description: Enforces that role can only be 'admin' or 'user' at the database level
-- Date: 2026-02-18

-- Add CHECK constraint to role column
ALTER TABLE auth_user
ADD CONSTRAINT check_auth_user_role
CHECK (role IN ('admin', 'user'));

-- Add comment
COMMENT ON CONSTRAINT check_auth_user_role ON auth_user IS 'Ensures role is either admin or user';
