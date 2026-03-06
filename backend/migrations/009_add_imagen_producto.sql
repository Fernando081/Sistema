-- Migration 009: Add imagen_url to producto

ALTER TABLE producto
ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(255);
