-- O01.3a (28/10/2026) · Revisión periódica de acumulación, capacidad y retención de las salidas.
-- Sólo registra el proceso automático: la revisión lee tablas existentes y avisa a los administradores
-- (app_notification, una vez al día por área). No elimina datos ni activa canales.
INSERT INTO operational_job(name,interval_seconds,grace_seconds) VALUES ('outputs_health',1800,900)
ON CONFLICT (name) DO NOTHING;
