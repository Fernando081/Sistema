-- Migration 010: JSONB Audit Trigger

-- 1. Create or replace the auditoria table
DROP TABLE IF EXISTS auditoria_jsonb CASCADE;

CREATE TABLE auditoria_jsonb (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE
    old_record JSONB,
    new_record JSONB,
    db_user VARCHAR(100) DEFAULT current_user,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create the trigger function
CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    old_data JSONB := NULL;
    new_data JSONB := NULL;
BEGIN
    IF TG_OP = 'INSERT' THEN
        new_data := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        old_data := to_jsonb(OLD);
    END IF;

    INSERT INTO auditoria_jsonb (table_name, action, old_record, new_record, db_user, timestamp)
    VALUES (TG_TABLE_NAME::TEXT, TG_OP, old_data, new_data, current_user, CURRENT_TIMESTAMP);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 3. Apply to critical tables
DO $$
DECLARE
    t_name TEXT;
    table_list TEXT[] := ARRAY['producto', 'factura', 'compra', 'pago', 'gasto', 'cliente'];
BEGIN
    FOREACH t_name IN ARRAY table_list
    LOOP
        -- Drop if exists
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_jsonb_%I ON %I', t_name, t_name);
        
        -- Create Trigger
        EXECUTE format('
            CREATE TRIGGER trg_audit_jsonb_%I
            AFTER INSERT OR UPDATE OR DELETE ON %I
            FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
        ', t_name, t_name);
    END LOOP;
END
$$;
