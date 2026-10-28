-- O05 · Esquema base generado por "node backend/schema-baseline.js export" (2026-10-28).
-- Incluye migraciones hasta 117_iva_acreditable_compras.sql. No editar a mano; las nuevas estructuras van en migraciones.
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.2
-- Dumped by pg_dump version 18.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: estatus_compra_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estatus_compra_enum AS ENUM (
    'Pendiente',
    'Abonada',
    'Pagada'
);


--
-- Name: estatus_factura_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.estatus_factura_enum AS ENUM (
    'Pendiente',
    'Timbrada',
    'Cancelada',
    'Pagada'
);


--
-- Name: moneda_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.moneda_enum AS ENUM (
    'MXN',
    'USD',
    'EUR'
);


--
-- Name: operacion_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.operacion_enum AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE'
);


--
-- Name: tipo_comprobante_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_comprobante_enum AS ENUM (
    'I',
    'E',
    'T',
    'N',
    'P'
);


--
-- Name: tipo_efecto_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_efecto_enum AS ENUM (
    'Traslado',
    'Retenido'
);


--
-- Name: tipo_equivalencia_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_equivalencia_enum AS ENUM (
    'Marca',
    'Reemplazo',
    'Alternativo',
    'OE'
);


--
-- Name: tipo_factor_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_factor_enum AS ENUM (
    'Tasa',
    'Cuota',
    'Exento'
);


--
-- Name: tipo_impuesto_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_impuesto_enum AS ENUM (
    'IVA',
    'ISR',
    'IEPS'
);


--
-- Name: tipo_movimiento_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_movimiento_enum AS ENUM (
    'COMPRA',
    'VENTA',
    'AJUSTE_MANUAL_STOCK',
    'CAMBIO_PRECIO',
    'INVENTARIO_INICIAL',
    'ENTRADA POR DEVOLUCION',
    'ENTRADA POR AJUSTE',
    'SALIDA POR MERMA/AJUSTE'
);


--
-- Name: tipo_telefono_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tipo_telefono_enum AS ENUM (
    'Fijo',
    'Movil'
);


--
-- Name: directory_search_document(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.directory_search_document(parts text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT lower(concat_ws(' ',VARIADIC parts)); $$;


--
-- Name: fn_actualizar_inventario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_actualizar_inventario() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Asegurarse de que el producto exista en la tabla de inventario
    INSERT INTO inventario ("IdProducto", "Existencias")
    VALUES (NEW."IdProducto", 0)
    ON CONFLICT ("IdProducto") DO NOTHING;

    -- Actualizar las existencias
    IF (NEW."Tipo" = 'Entrada' OR NEW."Tipo" = 'Ajuste') THEN
        UPDATE inventario
        SET "Existencias" = "Existencias" + NEW."Cantidad"
        WHERE "IdProducto" = NEW."IdProducto";
    ELSIF (NEW."Tipo" = 'Salida') THEN
        UPDATE inventario
        SET "Existencias" = "Existencias" - NEW."Cantidad"
        WHERE "IdProducto" = NEW."IdProducto";
        -- Se podría añadir un CHECK para existencias < 0 si la lógica de negocio lo requiere
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: fn_agregar_equivalente(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_agregar_equivalente(p_id_producto integer, p_id_equivalente integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Validar que no sean el mismo
    IF p_id_producto = p_id_equivalente THEN
        RAISE EXCEPTION 'Un producto no puede ser equivalente de sí mismo.';
    END IF;

    -- Insertar relación bidireccional (opcional, aquí hacemos unidireccional A -> B)
    INSERT INTO producto_equivalente ("IdProducto", "IdProductoEquivalente", "TipoEquivalencia")
    VALUES (p_id_producto, p_id_equivalente, 'Marca')
    ON CONFLICT DO NOTHING; -- Si ya existe, no pasa nada
END;
$$;


--
-- Name: fn_almacen_verificar_picking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_almacen_verificar_picking() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE pedido record; partida record; original record; acumulado numeric;
BEGIN
 SELECT estado INTO pedido FROM pedido_venta WHERE id_pedido=NEW.id_pedido FOR UPDATE;
 SELECT * INTO partida FROM pedido_surtido_ubicacion WHERE id_surtido=NEW.id_surtido FOR UPDATE;
 IF partida.id_surtido IS NULL OR partida.id_pedido<>NEW.id_pedido OR partida.estado<>'Reservada'
    OR pedido.estado NOT IN('Parcialmente surtido','Surtido') THEN
   RAISE EXCEPTION 'El picking no está disponible para verificación';
 END IF;
 IF NEW.accion='Anular' THEN
   SELECT * INTO original FROM almacen_picking_verificacion WHERE id=NEW.id_anulada;
   IF original.id IS NULL OR original.accion<>'Verificar' OR original.id_pedido<>NEW.id_pedido
      OR original.id_surtido<>NEW.id_surtido OR original.cantidad<>NEW.cantidad THEN
     RAISE EXCEPTION 'La anulación no corresponde a la verificación';
   END IF;
 END IF;
 SELECT coalesce(sum(CASE accion WHEN 'Verificar' THEN cantidad ELSE -cantidad END),0)
   INTO acumulado FROM almacen_picking_verificacion WHERE id_surtido=NEW.id_surtido;
 acumulado=acumulado+CASE NEW.accion WHEN 'Verificar' THEN NEW.cantidad ELSE -NEW.cantidad END;
 IF acumulado<0 OR acumulado>partida.cantidad THEN RAISE EXCEPTION 'La cantidad verificada supera el picking'; END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_asignar_costo_venta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_asignar_costo_venta() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_fecha_venta timestamptz;
BEGIN
  IF NEW.id_producto IS NULL OR NEW.costo_unitario_snapshot IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT fecha_emision INTO v_fecha_venta
    FROM factura WHERE id_factura = NEW.id_factura;

  SELECT SUM(dc.importe) / NULLIF(SUM(dc.cantidad), 0)
    INTO NEW.costo_unitario_snapshot
    FROM detalle_compra dc
    JOIN compra c ON c.id_compra = dc.id_compra
   WHERE dc.id_producto = NEW.id_producto
     AND c.fecha_compra <= v_fecha_venta
     AND c.estatus::text NOT IN ('Cancelada', 'Cancelado');

  RETURN NEW;
END;
$$;


--
-- Name: fn_audit_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='La auditoría solo admite nuevos registros; no se puede modificar, borrar ni truncar.'; END $$;


--
-- Name: fn_audit_enrich(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_enrich() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE allowed text[]; BEGIN
  IF NEW.table_name IN ('auth_session','auth_mfa','auth_mfa_challenge','auth_mfa_recovery','auth_password_recovery') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Los secretos de autenticación no se copian a auditoría. Registra un evento explícito sin secretos.';
  END IF;
  NEW.protection_version:=1;
  NEW.actor_name:=NULL;
  IF NEW.app_user_id IS NOT NULL THEN
    SELECT username INTO NEW.actor_name FROM auth_user WHERE id_user=NEW.app_user_id;
    IF NEW.actor_name IS NULL THEN NEW.app_user_id:=NULL; END IF;
  END IF;
  NEW.credential_changed:=NULL;
  allowed:=CASE NEW.table_name
    WHEN 'auth_user' THEN ARRAY['id_user','username','role','is_active','token_version']
    WHEN 'app_permission' THEN ARRAY['code','description']
    WHEN 'app_role_permission' THEN ARRAY['role','permission_code']
    WHEN 'app_user_permission' THEN ARRAY['id_user','permission_code','granted']
    WHEN 'app_access_profile' THEN ARRAY['id_profile','name','description','version','created_at','updated_at']
    WHEN 'app_access_profile_permission' THEN ARRAY['id_profile','permission_code']
    WHEN 'app_user_access_profile' THEN ARRAY['id_user','id_profile'] ELSE NULL END;
  IF allowed IS NOT NULL THEN
    IF NEW.table_name='auth_user' THEN
      NEW.credential_changed:=NEW.action='UPDATE' AND
        (NEW.old_record->'password_hash' IS DISTINCT FROM NEW.new_record->'password_hash');
    END IF;
    IF NEW.old_record IS NOT NULL THEN SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb)
      INTO NEW.old_record FROM jsonb_each(NEW.old_record) WHERE key=ANY(allowed); END IF;
    IF NEW.new_record IS NOT NULL THEN SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb)
      INTO NEW.new_record FROM jsonb_each(NEW.new_record) WHERE key=ANY(allowed); END IF;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: fn_audit_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_data jsonb := NULL;
  new_data jsonb := NULL;
  v_app_user_id integer := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
  ELSE
    old_data := to_jsonb(OLD);
  END IF;

  BEGIN
    v_app_user_id := NULLIF(current_setting('app.current_user_id', true), '')::integer;
  EXCEPTION WHEN invalid_text_representation THEN
    v_app_user_id := NULL;
  END;

  INSERT INTO auditoria_jsonb
    (table_name, action, old_record, new_record, db_user, app_user_id, timestamp)
  VALUES
    (TG_TABLE_NAME::text, TG_OP, old_data, new_data, current_user, v_app_user_id, CURRENT_TIMESTAMP);

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: fn_auditoria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_auditoria() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_old_data TEXT;
    v_new_data TEXT;
BEGIN
    -- Determinar el usuario de la sesión (si se configura en el backend)
    -- O usar el usuario de la base de datos
    -- DECLARE v_usuario VARCHAR(50) := current_setting('app.usuario', true);

    IF (TG_OP = 'UPDATE') THEN
        v_old_data := ROW_TO_JSON(OLD)::TEXT;
        v_new_data := ROW_TO_JSON(NEW)::TEXT;
        INSERT INTO auditoria ("TablaAfectada", "IdRegistroAfectado", "Operacion", "Detalles")
        VALUES (TG_TABLE_NAME, OLD."IdCliente", 'UPDATE', JSON_BUILD_OBJECT('old', v_old_data, 'new', v_new_data)::TEXT);
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        v_old_data := ROW_TO_JSON(OLD)::TEXT;
        INSERT INTO auditoria ("TablaAfectada", "IdRegistroAfectado", "Operacion", "Detalles")
        VALUES (TG_TABLE_NAME, OLD."IdCliente", 'DELETE', JSON_BUILD_OBJECT('deleted', v_old_data)::TEXT);
        RETURN OLD;
    ELSIF (TG_OP = 'INSERT') THEN
        v_new_data := ROW_TO_JSON(NEW)::TEXT;
        INSERT INTO auditoria ("TablaAfectada", "IdRegistroAfectado", "Operacion", "Detalles")
        VALUES (TG_TABLE_NAME, NEW."IdCliente", 'INSERT', JSON_BUILD_OBJECT('new', v_new_data)::TEXT);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: fn_auditoria_generica(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_auditoria_generica() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_old_data TEXT;
    v_new_data TEXT;
    v_id_registro INTEGER;
    -- TG_ARGV[0] captura el primer argumento pasado al trigger (ej. 'IdCliente')
    v_pk_col_name TEXT := TG_ARGV[0]; 
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        v_old_data := ROW_TO_JSON(OLD)::TEXT;
        v_new_data := ROW_TO_JSON(NEW)::TEXT;
        -- Extrae el valor de la llave primaria dinámicamente
        EXECUTE format('SELECT ($1).%I', v_pk_col_name) INTO v_id_registro USING OLD;
        
        INSERT INTO auditoria ("TablaAfectada", "IdRegistroAfectado", "Operacion", "Detalles")
        VALUES (TG_TABLE_NAME, v_id_registro, 'UPDATE', JSON_BUILD_OBJECT('old', v_old_data, 'new', v_new_data)::TEXT);
        RETURN NEW;
        
    ELSIF (TG_OP = 'DELETE') THEN
        v_old_data := ROW_TO_JSON(OLD)::TEXT;
        EXECUTE format('SELECT ($1).%I', v_pk_col_name) INTO v_id_registro USING OLD;

        INSERT INTO auditoria ("TablaAfectada", "IdRegistroAfectado", "Operacion", "Detalles")
        VALUES (TG_TABLE_NAME, v_id_registro, 'DELETE', JSON_BUILD_OBJECT('deleted', v_old_data)::TEXT);
        RETURN OLD;
        
    ELSIF (TG_OP = 'INSERT') THEN
        v_new_data := ROW_TO_JSON(NEW)::TEXT;
        EXECUTE format('SELECT ($1).%I', v_pk_col_name) INTO v_id_registro USING NEW;

        INSERT INTO auditoria ("TablaAfectada", "IdRegistroAfectado", "Operacion", "Detalles")
        VALUES (TG_TABLE_NAME, v_id_registro, 'INSERT', JSON_BUILD_OBJECT('new', v_new_data)::TEXT);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$_$;


--
-- Name: fn_bloquear_detalle_periodo_cerrado(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_bloquear_detalle_periodo_cerrado() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_poliza bigint; v_fecha date;
BEGIN
  v_poliza:=coalesce(NEW.id_poliza,OLD.id_poliza);
  SELECT fecha INTO v_fecha FROM poliza_contable WHERE id_poliza=v_poliza;
  IF EXISTS(SELECT 1 FROM periodo_contable WHERE estado='Cerrado' AND v_fecha BETWEEN fecha_inicio AND fecha_fin) THEN
    RAISE EXCEPTION 'El periodo contable de % está cerrado',to_char(v_fecha,'MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;


--
-- Name: fn_bloquear_folio_cotizacion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_bloquear_folio_cotizacion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cotizacion-folio'));
  SELECT coalesce(max(folio),0)+1 INTO NEW.folio FROM cotizacion;
  RETURN NEW;
END;
$$;


--
-- Name: fn_bloquear_periodo_cerrado(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_bloquear_periodo_cerrado() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_fecha date;
BEGIN
  v_fecha:=coalesce(NEW.fecha,OLD.fecha);
  IF EXISTS(SELECT 1 FROM periodo_contable WHERE estado='Cerrado' AND v_fecha BETWEEN fecha_inicio AND fecha_fin) THEN
    RAISE EXCEPTION 'El periodo contable de % está cerrado',to_char(v_fecha,'MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;


--
-- Name: fn_bloquear_tesoreria_cerrada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_bloquear_tesoreria_cerrada() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cuenta integer;v_fecha date;
BEGIN
  v_cuenta:=coalesce(NEW.id_cuenta,OLD.id_cuenta);v_fecha:=coalesce(NEW.fecha,OLD.fecha);
  IF EXISTS(SELECT 1 FROM tesoreria_cierre WHERE id_cuenta=v_cuenta
    AND (make_date(anio,mes,1)+interval '1 month'-interval '1 day')::date>=v_fecha) THEN
    RAISE EXCEPTION 'Tesorería está cerrada hasta una fecha posterior o igual a %',to_char(v_fecha,'DD/MM/YYYY') USING ERRCODE='23514';
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: claveproductooservicio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claveproductooservicio (
    "IdClaveProdOServ" integer NOT NULL,
    "Clave" character varying(10) NOT NULL,
    "Descripcion" character varying(255) NOT NULL
);


--
-- Name: fn_buscar_claveprodserv(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_buscar_claveprodserv(p_termino character varying) RETURNS SETOF public.claveproductooservicio
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_termino_like VARCHAR := '%' || p_termino || '%';
    v_termino_like_ini VARCHAR := p_termino || '%';
BEGIN
    RETURN QUERY 
    SELECT * FROM "claveproductooservicio"
    WHERE "Descripcion" ILIKE v_termino_like OR "Clave" LIKE v_termino_like_ini
    LIMIT 15;
END;
$$;


--
-- Name: claveunidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claveunidad (
    "IdClaveUnidad" integer NOT NULL,
    "Clave" character varying(5) NOT NULL,
    "Descripcion" text NOT NULL
);


--
-- Name: fn_buscar_claveunidad(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_buscar_claveunidad(p_termino character varying) RETURNS SETOF public.claveunidad
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_termino_like VARCHAR := '%' || p_termino || '%';
    v_termino_like_ini VARCHAR := p_termino || '%';
BEGIN
    RETURN QUERY 
    SELECT * FROM "claveunidad"
    WHERE "Descripcion" ILIKE v_termino_like OR "Clave" LIKE v_termino_like_ini
    LIMIT 15;
END;
$$;


--
-- Name: fn_capturar_valor_inventario_diario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_capturar_valor_inventario_diario() RETURNS void
    LANGUAGE sql
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH costos AS (
    SELECT id_producto,CASE WHEN bool_and(precio_unitario IS NOT NULL AND precio_unitario>=0)
      THEN sum(cantidad*precio_unitario)/NULLIF(sum(cantidad),0) END AS costo
    FROM kardex WHERE tipo_movimiento::text='COMPRA' AND cantidad>0
      AND fecha<=now()
    GROUP BY id_producto
  ), valoracion AS (
    SELECT count(*) FILTER(WHERE p."Existencia" IS NULL OR p."Existencia"<0
      OR (p."Existencia">0 AND c.costo IS NULL)) AS desconocidos,
      COALESCE(sum(p."Existencia"*c.costo),0) AS valor
    FROM producto p LEFT JOIN costos c ON c.id_producto=p."IdProducto"
  ) INSERT INTO analytics_inventario_diario(fecha,valor,productos_sin_costo)
    SELECT (now() AT TIME ZONE 'America/Mexico_City')::date,
      CASE WHEN desconocidos=0 THEN valor END,desconocidos FROM valoracion
    ON CONFLICT(fecha) DO NOTHING;
$$;


--
-- Name: fn_centro_general(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_centro_general() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT id_centro FROM centro_costo WHERE codigo='GENERAL'
$$;


--
-- Name: fn_comision_nota_credito(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_comision_nota_credito() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_devuelto numeric;
BEGIN
  IF NEW.id_factura_origen IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(subtotal),0) INTO v_devuelto FROM factura
    WHERE id_factura_origen=NEW.id_factura_origen AND estatus::text<>'Cancelada';
  UPDATE factura SET comision_vendedor=CASE WHEN id_vendedor IS NULL THEN 0
    ELSE greatest(0,round((subtotal-v_devuelto)*0.02,2)) END WHERE id_factura=NEW.id_factura_origen;
  RETURN NEW;
END;
$$;


--
-- Name: fn_convertir_cotizacion_a_venta(integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_convertir_cotizacion_a_venta(p_id_cotizacion integer, p_id_forma_pago integer, p_id_metodo_pago integer, p_id_vendedor integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    r_cot record;
    v_conceptos_json JSONB;
    v_id_factura INT;
    
    -- Variable para guardar el producto que falle
    v_prod_insuficiente record; 
BEGIN
    -- 1. Obtener datos de la cotización
    SELECT * INTO r_cot FROM cotizacion WHERE id_cotizacion = p_id_cotizacion;

    IF r_cot.estatus = 'Convertida' THEN
        RAISE EXCEPTION 'Esta cotización ya fue convertida anteriormente.';
    END IF;

    -- [NUEVA VALIDACIÓN] Verificar Stock antes de proceder
    SELECT p."Descripcion", p."Existencia", cc.cantidad
    INTO v_prod_insuficiente
    FROM conceptocotizacion cc
    JOIN producto p ON cc.id_producto = p."IdProducto"
    WHERE cc.id_cotizacion = p_id_cotizacion
    AND p."Existencia" < cc.cantidad -- Aquí detectamos si falta stock
    LIMIT 1;

    -- Si encontramos un producto insuficiente, lanzamos el error AHORA
    IF v_prod_insuficiente IS NOT NULL THEN
        RAISE EXCEPTION 'Stock insuficiente: El producto "%" solo tiene % existencias y necesitas %.', 
            v_prod_insuficiente."Descripcion", 
            v_prod_insuficiente."Existencia", 
            v_prod_insuficiente.cantidad;
    END IF;
    -- [FIN NUEVA VALIDACIÓN]

    -- 2. Construir el JSON de productos
    SELECT jsonb_agg(jsonb_build_object(
        'idProducto', cc.id_producto,
        'cantidad', cc.cantidad,
        'valorUnitario', cc.valor_unitario,
        'importe', cc.importe,
        'descuento', 0,
        'claveProdServ', cps."Clave",
        'claveUnidad', cu."Clave",
        'objetoImpuesto', p."ObjetoImpuesto",
        'descripcion', cc.descripcion,
        'unidadDescripcion', cc.unidad,
        'baseIva', cc.importe,
        'tasaIva', p."TasaIVA",
        'importeIva', cc.importe_iva,
        'baseRetIsr', cc.importe,
        'tasaRetIsr', CASE WHEN cc.importe_ret_isr > 0 THEN 0.0125 ELSE 0 END,
        'importeRetIsr', cc.importe_ret_isr
    )) INTO v_conceptos_json
    FROM conceptocotizacion cc
    JOIN producto p ON cc.id_producto = p."IdProducto"
    LEFT JOIN claveproductooservicio cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN claveunidad cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    WHERE cc.id_cotizacion = p_id_cotizacion;

    -- 3. Llamar a la función de venta, pasando p_id_vendedor como parámetro #17
    SELECT fn_crear_venta(
        r_cot.id_cliente,
        r_cot.rfc_receptor,
        r_cot.nombre_receptor,
        '00000', '616', 'G03', p_id_forma_pago, p_id_metodo_pago, 'MXN', 1,
        r_cot.subtotal,
        r_cot.total_impuestos,
        r_cot.total_retenciones,
        r_cot.total,
        'Venta generada desde Cotización C-' || r_cot.folio,
        v_conceptos_json,
        p_id_vendedor
    ) INTO v_id_factura;

    -- 4. Actualizar estatus
    UPDATE cotizacion SET estatus = 'Convertida' WHERE id_cotizacion = p_id_cotizacion;

    RETURN v_id_factura;
END;
$$;


--
-- Name: fn_cotizacion_evidencia_inmutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cotizacion_evidencia_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'La evidencia de revisión/respuesta se conserva; crea una nueva revisión'; END $$;


--
-- Name: fn_crear_compra(integer, character varying, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crear_compra(p_id_proveedor integer, p_folio_factura character varying, p_total numeric, p_observaciones text, p_conceptos_json jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id_compra INT;
BEGIN
    -- 1. Insertar Encabezado
    INSERT INTO compra (
        id_proveedor, folio_factura_proveedor, total, observaciones
    ) VALUES (
        p_id_proveedor, p_folio_factura, p_total, p_observaciones
    ) RETURNING id_compra INTO v_id_compra;

    -- 2. Insertar Detalles desde el JSON
    INSERT INTO detalle_compra (
        id_compra, id_producto, descripcion_producto,
        cantidad, costo_unitario, importe
    )
    SELECT 
        v_id_compra,
        (item->>'idProducto')::INT,
        item->>'descripcion',
        (item->>'cantidad')::NUMERIC,
        (item->>'costoUnitario')::NUMERIC, -- Ojo: Aquí usamos 'costo', no 'precio'
        (item->>'importe')::NUMERIC
    FROM jsonb_array_elements(p_conceptos_json) AS item;

    RETURN v_id_compra;
END;
$$;


--
-- Name: fn_crear_compra(integer, character varying, boolean, numeric, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crear_compra(p_id_proveedor integer, p_folio_factura character varying, p_es_credito boolean, p_total numeric, p_observaciones text, p_conceptos_json jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id_compra INT;
    v_saldo_inicial NUMERIC := 0;
    v_estatus VARCHAR;
BEGIN
    -- Lógica de Crédito
    IF p_es_credito THEN
        v_saldo_inicial := p_total;
        v_estatus := 'Pendiente';
    ELSE
        v_saldo_inicial := 0;
        v_estatus := 'Completada';
    END IF;

    -- Insertar Compra
    INSERT INTO compra (
        id_proveedor, folio_factura_proveedor, 
        total, saldo_pendiente, estatus, observaciones,
        fecha_compra
    ) VALUES (
        p_id_proveedor, p_folio_factura, 
        p_total, v_saldo_inicial, v_estatus, p_observaciones,
        NOW()
    ) RETURNING id_compra INTO v_id_compra;

    -- Insertar Detalles y Aumentar Stock
    INSERT INTO detalle_compra (
        id_compra, id_producto, descripcion_producto, cantidad, costo_unitario, importe
    )
    SELECT 
        v_id_compra,
        (item->>'idProducto')::INT,
        item->>'descripcion',
        (item->>'cantidad')::NUMERIC,
        (item->>'costoUnitario')::NUMERIC,
        (item->>'importe')::NUMERIC
    FROM jsonb_array_elements(p_conceptos_json) AS item;

    RETURN v_id_compra;
END;
$$;


--
-- Name: fn_crear_cotizacion(integer, character varying, character varying, numeric, numeric, numeric, numeric, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crear_cotizacion(p_id_cliente integer, p_nombre_receptor character varying, p_rfc_receptor character varying, p_subtotal numeric, p_total_impuestos numeric, p_total_retenciones numeric, p_total numeric, p_conceptos_json jsonb) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id_cotizacion INT;
    v_folio INT;
BEGIN
    -- Generar Folio Cotización
    SELECT COALESCE(MAX(folio), 0) + 1 INTO v_folio FROM cotizacion;

    -- Insertar Encabezado
    INSERT INTO cotizacion (
        id_cliente, folio, nombre_receptor, rfc_receptor,
        subtotal, total_impuestos, total_retenciones, total
    ) VALUES (
        p_id_cliente, v_folio, p_nombre_receptor, p_rfc_receptor,
        p_subtotal, p_total_impuestos, p_total_retenciones, p_total
    ) RETURNING id_cotizacion INTO v_id_cotizacion;

    -- Insertar Detalles
    INSERT INTO conceptocotizacion (
        id_cotizacion, id_producto, descripcion, unidad,
        cantidad, valor_unitario, importe,
        importe_iva, importe_ret_isr
    )
    SELECT 
        v_id_cotizacion,
        (item->>'idProducto')::INT,
        item->>'descripcion',
        item->>'unidadDescripcion',
        (item->>'cantidad')::NUMERIC,
        (item->>'valorUnitario')::NUMERIC,
        (item->>'importe')::NUMERIC,
        (item->>'importeIva')::NUMERIC,
        (item->>'importeRetIsr')::NUMERIC
    FROM jsonb_array_elements(p_conceptos_json) AS item;

    RETURN v_id_cotizacion;
END;
$$;


--
-- Name: fn_crear_venta(integer, character varying, character varying, character varying, character varying, character varying, integer, integer, character varying, numeric, numeric, numeric, numeric, numeric, text, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crear_venta(p_id_cliente integer, p_rfc_receptor character varying, p_nombre_receptor character varying, p_cp_receptor character varying, p_regimen_receptor character varying, p_uso_cfdi character varying, p_id_forma_pago integer, p_id_metodo_pago integer, p_moneda character varying, p_tipo_cambio numeric, p_subtotal numeric, p_total_impuestos_trasladados numeric, p_total_impuestos_retenidos numeric, p_total numeric, p_observaciones text, p_conceptos_json jsonb, p_id_vendedor integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id_factura INT;
    v_folio INT;
    v_metodo_clave VARCHAR;
    v_saldo_inicial NUMERIC;
    v_estatus_inicial VARCHAR;
    v_comision NUMERIC(18,2);
BEGIN
    SELECT "Clave" INTO v_metodo_clave FROM metododepago WHERE "IdMetodoDePago" = p_id_metodo_pago;

    IF v_metodo_clave = 'PUE' THEN
        v_saldo_inicial := 0;
        v_estatus_inicial := 'Pagada';
    ELSE
        v_saldo_inicial := p_total;
        v_estatus_inicial := 'Pendiente';
    END IF;

    IF p_id_vendedor IS NOT NULL THEN
        v_comision := ROUND((p_subtotal * 0.02), 2);
    ELSE
        v_comision := 0;
    END IF;

    SELECT COALESCE(MAX(folio), 0) + 1 INTO v_folio FROM factura;

    INSERT INTO factura (
        id_cliente, serie, folio, fecha_emision, 
        estatus, 
        saldo_pendiente,
        rfc_receptor, nombre_receptor, codigo_postal_receptor, 
        regimen_fiscal_receptor_clave, uso_cfdi_clave, id_uso_cfdi,
        id_forma_pago, id_metodo_pago, moneda, tipo_cambio,
        subtotal, total_impuestos_trasladados, total_impuestos_retenidos, total,
        id_vendedor, comision_vendedor
    ) VALUES (
        p_id_cliente, 'A', v_folio, NOW(), 
        v_estatus_inicial::estatus_factura_enum, 
        v_saldo_inicial,
        p_rfc_receptor, p_nombre_receptor, p_cp_receptor,
        p_regimen_receptor, 
        p_uso_cfdi, (SELECT "IdUsoCFDI" FROM usocfdi WHERE "Clave" = p_uso_cfdi LIMIT 1),
        p_id_forma_pago, p_id_metodo_pago, p_moneda, p_tipo_cambio,
        p_subtotal, p_total_impuestos_trasladados, p_total_impuestos_retenidos, p_total,
        p_id_vendedor, v_comision
    ) RETURNING id_factura INTO v_id_factura;

    INSERT INTO conceptofactura (
        id_factura, id_producto, 
        id_clave_prod_serv, id_clave_unidad, id_objeto_impuesto,
        clave_sat, unidad_sat, objeto_impuesto_sat,
        descripcion, cantidad, valor_unitario, importe, descuento,
        base_iva, tasa_iva, importe_iva,
        base_ret_isr, tasa_ret_isr, importe_ret_isr
    )
    SELECT 
        v_id_factura,
        (item->>'idProducto')::INT,
        (SELECT "IdClaveProdOServ" FROM claveproductooservicio WHERE "Clave" = (item->>'claveProdServ') LIMIT 1),
        (SELECT "IdClaveUnidad" FROM claveunidad WHERE "Clave" = (item->>'claveUnidad') LIMIT 1),
        (SELECT "IdObjetoImpuesto" FROM objetoimpuesto WHERE "Clave" = (item->>'objetoImpuesto') LIMIT 1),
        item->>'claveProdServ',
        item->>'claveUnidad',
        item->>'objetoImpuesto',
        item->>'descripcion',
        (item->>'cantidad')::NUMERIC,
        (item->>'valorUnitario')::NUMERIC,
        (item->>'importe')::NUMERIC,
        COALESCE((item->>'descuento')::NUMERIC, 0),
        (item->>'baseIva')::NUMERIC,
        (item->>'tasaIva')::NUMERIC,
        (item->>'importeIva')::NUMERIC,
        (item->>'baseRetIsr')::NUMERIC,
        (item->>'tasaRetIsr')::NUMERIC,
        (item->>'importeRetIsr')::NUMERIC
    FROM jsonb_array_elements(p_conceptos_json) AS item;

    -- Registrar Pago automático si es de Contado (PUE)
    IF v_metodo_clave = 'PUE' THEN
        DECLARE
            v_forma_pago_nombre VARCHAR;
        BEGIN
            SELECT "Nombre" INTO v_forma_pago_nombre 
            FROM formadepago 
            WHERE "IdFormaPago" = p_id_forma_pago LIMIT 1;

            INSERT INTO pago (
                id_factura, fecha_pago, monto, forma_pago, referencia, notas
            ) VALUES (
                v_id_factura, NOW(), p_total, COALESCE(v_forma_pago_nombre, 'Efectivo'), '', 'Pago automático Venta PUE'
            );
        END;
    END IF;

    RETURN v_id_factura;
END;
$$;


--
-- Name: fn_crear_venta(integer, character varying, character varying, character varying, character varying, character varying, integer, integer, character varying, numeric, numeric, numeric, numeric, numeric, text, jsonb, integer, integer, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crear_venta(p_id_cliente integer, p_rfc_receptor character varying, p_nombre_receptor character varying, p_cp_receptor character varying, p_regimen_receptor character varying, p_uso_cfdi character varying, p_id_forma_pago integer, p_id_metodo_pago integer, p_moneda character varying, p_tipo_cambio numeric, p_subtotal numeric, p_total_impuestos_trasladados numeric, p_total_impuestos_retenidos numeric, p_total numeric, p_observaciones text, p_conceptos_json jsonb, p_id_vendedor integer DEFAULT NULL::integer, p_folio integer DEFAULT NULL::integer, p_serie character varying DEFAULT 'A'::character varying, p_tipo_comprobante character varying DEFAULT 'I'::character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id_factura INT;
    v_metodo_clave VARCHAR;
    v_saldo_inicial NUMERIC;
    v_estatus_inicial VARCHAR;
    v_comision NUMERIC(18,2);
BEGIN
    SELECT "Clave" INTO v_metodo_clave FROM metododepago WHERE "IdMetodoDePago" = p_id_metodo_pago;

    IF v_metodo_clave = 'PUE' THEN
        v_saldo_inicial := 0;
        v_estatus_inicial := 'Pagada';
    ELSE
        v_saldo_inicial := p_total;
        v_estatus_inicial := 'Pendiente';
    END IF;

    IF p_id_vendedor IS NOT NULL THEN
        v_comision := ROUND((p_subtotal * 0.02), 2);
    ELSE
        v_comision := 0;
    END IF;

    INSERT INTO factura (
        id_cliente, serie, folio, fecha_emision, 
        estatus, 
        saldo_pendiente,
        rfc_receptor, nombre_receptor, codigo_postal_receptor, 
        regimen_fiscal_receptor_clave, uso_cfdi_clave, id_uso_cfdi,
        id_forma_pago, id_metodo_pago, moneda, tipo_cambio,
        subtotal, total_impuestos_trasladados, total_impuestos_retenidos, total,
        id_vendedor, comision_vendedor,
        tipo_comprobante
    ) VALUES (
        p_id_cliente, p_serie, p_folio, NOW(), 
        v_estatus_inicial::estatus_factura_enum, 
        v_saldo_inicial,
        p_rfc_receptor, p_nombre_receptor, p_cp_receptor,
        p_regimen_receptor, 
        p_uso_cfdi, (SELECT "IdUsoCFDI" FROM usocfdi WHERE "Clave" = p_uso_cfdi LIMIT 1),
        p_id_forma_pago, p_id_metodo_pago, p_moneda, p_tipo_cambio,
        p_subtotal, p_total_impuestos_trasladados, p_total_impuestos_retenidos, p_total,
        p_id_vendedor, v_comision,
        p_tipo_comprobante
    ) RETURNING id_factura INTO v_id_factura;

    INSERT INTO conceptofactura (
        id_factura, id_producto, 
        id_clave_prod_serv, id_clave_unidad, id_objeto_impuesto,
        clave_sat, unidad_sat, objeto_impuesto_sat,
        descripcion, cantidad, valor_unitario, importe, descuento,
        base_iva, tasa_iva, importe_iva,
        base_ret_isr, tasa_ret_isr, importe_ret_isr
    )
    SELECT 
        v_id_factura,
        (item->>'idProducto')::INT,
        (SELECT "IdClaveProdOServ" FROM claveproductooservicio WHERE "Clave" = (item->>'claveProdServ') LIMIT 1),
        (SELECT "IdClaveUnidad" FROM claveunidad WHERE "Clave" = (item->>'claveUnidad') LIMIT 1),
        (SELECT "IdObjetoImpuesto" FROM objetoimpuesto WHERE "Clave" = (item->>'objetoImpuesto') LIMIT 1),
        item->>'claveProdServ',
        item->>'claveUnidad',
        item->>'objetoImpuesto',
        item->>'descripcion',
        (item->>'cantidad')::NUMERIC,
        (item->>'valorUnitario')::NUMERIC,
        (item->>'importe')::NUMERIC,
        COALESCE((item->>'descuento')::NUMERIC, 0),
        (item->>'baseIva')::NUMERIC,
        (item->>'tasaIva')::NUMERIC,
        (item->>'importeIva')::NUMERIC,
        (item->>'baseRetIsr')::NUMERIC,
        (item->>'tasaRetIsr')::NUMERIC,
        (item->>'importeRetIsr')::NUMERIC
    FROM jsonb_array_elements(p_conceptos_json) AS item;

    -- Registrar Pago automático si es de Contado (PUE)
    IF v_metodo_clave = 'PUE' THEN
        DECLARE
            v_forma_pago_nombre VARCHAR;
        BEGIN
            SELECT "Nombre" INTO v_forma_pago_nombre 
            FROM formadepago 
            WHERE "IdFormaPago" = p_id_forma_pago LIMIT 1;

            INSERT INTO pago (
                id_factura, fecha_pago, monto, forma_pago, referencia, notas
            ) VALUES (
                v_id_factura, NOW(), p_total, COALESCE(v_forma_pago_nombre, 'Efectivo'), '', 'Pago automático Venta PUE'
            );
        END;
    END IF;

    RETURN v_id_factura;
END;
$$;


--
-- Name: categoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categoria (
    "IdCategoria" integer NOT NULL,
    "Descripcion" character varying(100) NOT NULL
);


--
-- Name: fn_create_categoria(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_categoria(p_descripcion character varying) RETURNS public.categoria
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_nueva_categoria "categoria";
BEGIN
    INSERT INTO "categoria" ("Descripcion")
    VALUES (p_descripcion)
    RETURNING * INTO v_nueva_categoria;
    
    RETURN v_nueva_categoria;
END;
$$;


--
-- Name: cliente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cliente (
    "IdCliente" integer NOT NULL,
    "RFC" character varying(13) NOT NULL,
    "RazonSocial" character varying(255) NOT NULL,
    "Pais" character varying(50) DEFAULT 'México'::character varying,
    "IdEstado" integer,
    "IdMunicipio" integer,
    "Ciudad" character varying(50),
    "Colonia" character varying(100),
    "Calle" character varying(100),
    "CodigoPostal" character varying(5) NOT NULL,
    "NumeroExterior" character varying(20),
    "NumeroInterior" character varying(20),
    "Referencia" character varying(100),
    "IdMetodoDePago" integer,
    "IdUsoCFDI" integer,
    "IdFormaPago" integer,
    "IdRegimenFiscal" integer NOT NULL,
    "ClaveEstado" character varying(3),
    "ClaveMunicipio" character varying(3),
    email character varying(150),
    saldo_a_favor numeric(10,2) DEFAULT 0 NOT NULL
);


--
-- Name: fn_create_cliente(character varying, character varying, character varying, integer, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_cliente(p_rfc character varying, p_razon_social character varying, p_pais character varying, p_id_estado integer, p_id_municipio integer, p_ciudad character varying, p_colonia character varying, p_calle character varying, p_codigo_postal character varying, p_num_ext character varying, p_num_int character varying, p_referencia character varying, p_id_metodo_pago integer, p_id_uso_cfdi integer, p_id_forma_pago integer, p_id_regimen_fiscal integer) RETURNS public.cliente
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_nuevo_cliente "cliente";
BEGIN
    INSERT INTO "cliente" (
        "RFC", "RazonSocial", "Pais", "IdEstado", "IdMunicipio", "Ciudad", "Colonia", "Calle", 
        "CodigoPostal", "NumeroExterior", "NumeroInterior", "Referencia", "IdMetodoDePago", 
        "IdUsoCFDI", "IdFormaPago", "IdRegimenFiscal"
    ) VALUES (
        p_rfc, p_razon_social, p_pais, p_id_estado, p_id_municipio, p_ciudad, p_colonia, p_calle, 
        p_codigo_postal, p_num_ext, p_num_int, p_referencia, p_id_metodo_pago, 
        p_id_uso_cfdi, p_id_forma_pago, p_id_regimen_fiscal
    )
    RETURNING * INTO v_nuevo_cliente; -- Captura la fila insertada
    
    RETURN v_nuevo_cliente;
END;
$$;


--
-- Name: fn_create_cliente(character varying, character varying, character varying, integer, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, integer, integer, integer, integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_cliente(p_rfc character varying, p_razon_social character varying, p_pais character varying, p_id_estado integer, p_id_municipio integer, p_ciudad character varying, p_colonia character varying, p_calle character varying, p_codigo_postal character varying, p_num_ext character varying, p_num_int character varying, p_referencia character varying, p_id_metodo_pago integer, p_id_uso_cfdi integer, p_id_forma_pago integer, p_id_regimen_fiscal integer, p_email character varying) RETURNS SETOF public.cliente
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    INSERT INTO cliente (
        "RFC", "RazonSocial", "Pais", "IdEstado", "IdMunicipio", 
        "Ciudad", "Colonia", "Calle", "CodigoPostal", "NumeroExterior", 
        "NumeroInterior", "Referencia", "IdMetodoDePago", "IdUsoCFDI", 
        "IdFormaPago", "IdRegimenFiscal", 
        email -- <--- NUEVO CAMPO
    ) VALUES (
        p_rfc, p_razon_social, p_pais, p_id_estado, p_id_municipio, 
        p_ciudad, p_colonia, p_calle, p_codigo_postal, p_num_ext, 
        p_num_int, p_referencia, p_id_metodo_pago, p_id_uso_cfdi, 
        p_id_forma_pago, p_id_regimen_fiscal, 
        p_email
    )
    RETURNING *;
END;
$$;


--
-- Name: fn_create_producto(character varying, integer, integer, character varying, numeric, integer, character varying, integer, integer, character varying, character varying, numeric, boolean, boolean, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_producto(p_codigo character varying, p_id_unidad integer, p_id_objeto_impuesto integer, p_descripcion character varying, p_precio_unitario numeric, p_id_categoria integer, p_ubicacion character varying, p_id_clave_prod_o_serv integer, p_id_clave_unidad integer, p_marca character varying, p_objeto_impuesto_sat character varying DEFAULT '02'::character varying, p_tasa_iva numeric DEFAULT 0.16, p_aplica_retencion_isr boolean DEFAULT false, p_aplica_retencion_iva boolean DEFAULT false, p_imagenes jsonb DEFAULT '[]'::jsonb) RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, imagenes jsonb)
    LANGUAGE plpgsql
    AS $$
DECLARE
    new_id integer;
BEGIN
    INSERT INTO "producto" (
        "Codigo", "IdUnidad", "IdObjetoImpuesto", "Descripcion", 
        "PrecioUnitario", "IdCategoria", "Ubicacion", "IdClaveProdOServ", 
        "IdClaveUnidad", "Marca", "ObjetoImpuesto", "TasaIVA", 
        "AplicaRetencionISR", "AplicaRetencionIVA", "imagenes"
    ) VALUES (
        p_codigo, p_id_unidad, p_id_objeto_impuesto, p_descripcion, 
        p_precio_unitario, p_id_categoria, p_ubicacion, p_id_clave_prod_o_serv, 
        p_id_clave_unidad, p_marca, p_objeto_impuesto_sat, p_tasa_iva, 
        p_aplica_retencion_isr, p_aplica_retencion_iva, p_imagenes
    )
    RETURNING "producto"."IdProducto" INTO new_id;

    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA", p."imagenes"
    FROM "producto" p
    WHERE p."IdProducto" = new_id;
END;
$$;


--
-- Name: producto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto (
    "IdProducto" integer NOT NULL,
    "Codigo" character varying(30) NOT NULL,
    "IdUnidad" integer,
    "IdObjetoImpuesto" integer NOT NULL,
    "Descripcion" character varying(255) NOT NULL,
    "PrecioUnitario" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "IdCategoria" integer,
    "Ubicacion" character varying(50),
    "IdClaveProdOServ" integer,
    "IdClaveUnidad" integer,
    "Marca" character varying(50),
    "ObjetoImpuesto" character varying(2) DEFAULT '02'::character varying,
    "TasaIVA" numeric(18,6) DEFAULT 0.160000,
    "AplicaRetencionISR" boolean DEFAULT false,
    "AplicaRetencionIVA" boolean DEFAULT false,
    "Existencia" numeric(18,6) DEFAULT 0 NOT NULL,
    imagenes jsonb DEFAULT '[]'::jsonb,
    imagen_url character varying(255),
    costo_reposicion numeric(18,6),
    margen_minimo numeric(9,4) DEFAULT 0.15 NOT NULL,
    CONSTRAINT chk_producto_preciounitario CHECK (("PrecioUnitario" >= (0)::numeric)),
    CONSTRAINT chk_stock_no_negativo CHECK (("Existencia" >= (0)::numeric)),
    CONSTRAINT producto_costo_reposicion_check CHECK ((costo_reposicion >= (0)::numeric)),
    CONSTRAINT producto_margen_minimo_check CHECK (((margen_minimo >= (0)::numeric) AND (margen_minimo < (1)::numeric)))
);


--
-- Name: COLUMN producto."AplicaRetencionISR"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.producto."AplicaRetencionISR" IS 'True para Honorarios/Servicios a Personas Morales';


--
-- Name: fn_create_producto(character varying, integer, integer, character varying, numeric, integer, character varying, integer, integer, character varying, character varying, numeric, boolean, boolean, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_producto(p_codigo character varying, p_id_unidad integer, p_id_objeto_impuesto integer, p_descripcion character varying, p_precio_unitario numeric, p_id_categoria integer, p_ubicacion character varying, p_id_clave_prod_serv integer, p_id_clave_unidad integer, p_marca character varying, p_objeto_impuesto_sat character varying DEFAULT '02'::character varying, p_tasa_iva numeric DEFAULT 0.16, p_aplica_retencion_isr boolean DEFAULT false, p_aplica_retencion_iva boolean DEFAULT false, p_imagen_url character varying DEFAULT NULL::character varying) RETURNS SETOF public.producto
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_nuevo_producto "producto";
BEGIN
    INSERT INTO "producto" (
        "Codigo", "IdUnidad", "IdObjetoImpuesto", "Descripcion", 
        "PrecioUnitario", "IdCategoria", "Ubicacion", 
        "IdClaveProdOServ", "IdClaveUnidad", "Marca",
        "ObjetoImpuesto", "TasaIVA", "AplicaRetencionISR", "AplicaRetencionIVA",
        "imagen_url"
    ) VALUES (
        p_codigo, p_id_unidad, p_id_objeto_impuesto, p_descripcion, 
        p_precio_unitario, p_id_categoria, p_ubicacion, 
        p_id_clave_prod_serv, p_id_clave_unidad, p_marca,
        p_objeto_impuesto_sat, p_tasa_iva, p_aplica_retencion_isr, p_aplica_retencion_iva,
        p_imagen_url
    )
    RETURNING * INTO v_nuevo_producto;

    -- IMPORTANTE: También inicializamos su registro en la tabla de inventario
    INSERT INTO "inventario" ("IdProducto", "Existencias")
    VALUES (v_nuevo_producto."IdProducto", 0);
    
    RETURN NEXT v_nuevo_producto;
    RETURN;
END;
$$;


--
-- Name: proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedor (
    "IdProveedor" integer NOT NULL,
    "RFC" character varying(13) NOT NULL,
    "RazonSocial" character varying(255) NOT NULL,
    "Pais" character varying(50) DEFAULT 'México'::character varying,
    "IdEstado" integer,
    "IdMunicipio" integer,
    "Ciudad" character varying(50),
    "Colonia" character varying(100),
    "Calle" character varying(100),
    "CodigoPostal" character varying(5) NOT NULL,
    "NumeroExterior" character varying(20),
    "NumeroInterior" character varying(20),
    "Referencia" character varying(100),
    "IdMetodoDePago" integer,
    "IdUsoCFDI" integer,
    "IdFormaPago" integer,
    "IdRegimenFiscal" integer NOT NULL,
    "ClaveEstado" character varying(3),
    "ClaveMunicipio" character varying(3),
    "DiasCredito" integer DEFAULT 30 NOT NULL,
    CONSTRAINT ck_proveedor_dias_credito CHECK ((("DiasCredito" >= 0) AND ("DiasCredito" <= 365)))
);


--
-- Name: fn_create_proveedor(character varying, character varying, character varying, integer, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_create_proveedor(p_rfc character varying, p_razon_social character varying, p_pais character varying, p_id_estado integer, p_id_municipio integer, p_ciudad character varying, p_colonia character varying, p_calle character varying, p_codigo_postal character varying, p_num_ext character varying, p_num_int character varying, p_referencia character varying, p_id_metodo_pago integer, p_id_uso_cfdi integer, p_id_forma_pago integer, p_id_regimen_fiscal integer) RETURNS public.proveedor
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_nuevo_proveedor "proveedor";
BEGIN
    INSERT INTO "proveedor" (
        "RFC", "RazonSocial", "Pais", "IdEstado", "IdMunicipio", "Ciudad", "Colonia", "Calle", 
        "CodigoPostal", "NumeroExterior", "NumeroInterior", "Referencia", "IdMetodoDePago", 
        "IdUsoCFDI", "IdFormaPago", "IdRegimenFiscal"
    ) VALUES (
        p_rfc, p_razon_social, p_pais, p_id_estado, p_id_municipio, p_ciudad, p_colonia, p_calle, 
        p_codigo_postal, p_num_ext, p_num_int, p_referencia, p_id_metodo_pago, 
        p_id_uso_cfdi, p_id_forma_pago, p_id_regimen_fiscal
    )
    RETURNING * INTO v_nuevo_proveedor;
    
    RETURN v_nuevo_proveedor;
END;
$$;


--
-- Name: fn_crm_campana_conservar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_campana_conservar() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Autorizaciones, bajas y preparaciones se conservan sin reescribir'; END $$;


--
-- Name: fn_crm_etapa_evento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_etapa_evento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.etapa IS DISTINCT FROM OLD.etapa OR NEW.id_cliente IS DISTINCT FROM OLD.id_cliente OR NEW.id_responsable IS DISTINCT FROM OLD.id_responsable THEN
  INSERT INTO crm_etapa_evento(id_oportunidad,version_origen,tipo,etapa,id_cliente,id_responsable) VALUES(NEW.id_oportunidad,NEW.version,CASE WHEN TG_OP='INSERT' THEN 'Alta' WHEN NEW.etapa IS DISTINCT FROM OLD.etapa THEN 'Etapa' ELSE 'Asignacion' END,NEW.etapa,NEW.id_cliente,NEW.id_responsable);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_crm_regla_vinculo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_regla_vinculo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crm_secuencia_regla r JOIN crm_etapa_evento e ON e.id_evento=NEW.id_evento JOIN crm_secuencia s ON s.id_secuencia=NEW.id_secuencia
  WHERE r.id_regla=NEW.id_regla AND r.id_modelo=NEW.id_modelo AND s.id_modelo=r.id_modelo AND s.id_cliente=e.id_cliente AND s.id_responsable=e.id_responsable
   AND r.etapa=e.etapa AND e.id_evento>r.evento_desde AND e.creada_en>=r.creada_en) THEN RAISE EXCEPTION 'La aplicación no corresponde a la regla y al evento'; END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_crm_reporte_cola_control(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_reporte_cola_control() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.estado<>'Pendiente' OR NEW.intentos<>0 OR NEW.version<>1 THEN RAISE EXCEPTION 'La cola comienza pendiente'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.id_resultado<>OLD.id_resultado OR NEW.creada_en<>OLD.creada_en OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Identidad y versión de cola inválidas';
 END IF;
 IF OLD.estado='Pendiente' AND NEW.estado='EnCurso' AND NEW.intentos=OLD.intentos+1 THEN RETURN NEW; END IF;
 IF OLD.estado='Pendiente' AND NEW.estado='Cancelado' AND NEW.intentos=OLD.intentos THEN RETURN NEW; END IF;
 IF OLD.estado='EnCurso' AND NEW.estado IN('Pendiente','Completado','Agotado','Cancelado') AND NEW.intentos=OLD.intentos THEN
   IF NEW.estado='Completado' AND NOT EXISTS(SELECT 1 FROM crm_reporte_recuperacion WHERE id_resultado=OLD.id_resultado AND token=OLD.token) THEN
     RAISE EXCEPTION 'No existe resultado conservado del intento';
   END IF;
   RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Transición de cola inválida';
END $$;


--
-- Name: fn_crm_reporte_cola_vinculo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_reporte_cola_vinculo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_TABLE_NAME='crm_reporte_reintento' THEN
   IF NOT EXISTS(SELECT 1 FROM crm_reporte_resultado WHERE id_resultado=NEW.id_resultado AND estado='Error') THEN
     RAISE EXCEPTION 'Sólo se recuperan resultados fallidos conservados';
   END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM crm_reporte_reintento WHERE id_resultado=NEW.id_resultado AND estado='EnCurso' AND token=NEW.token AND lease_hasta>clock_timestamp()) THEN
     RAISE EXCEPTION 'El intento ya no tiene autoridad para conservar el resultado';
   END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_crm_reporte_programa_control(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_reporte_programa_control() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.creada_en=clock_timestamp(); NEW.vigente_desde=NEW.creada_en; RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['activa','version','vigente_desde']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['activa','version','vigente_desde']) OR NEW.version<>OLD.version+1 OR NEW.activa=OLD.activa THEN
   RAISE EXCEPTION 'La configuración se conserva; sólo se permite suspender o reanudar con versión';
 END IF;
 NEW.vigente_desde=CASE WHEN NEW.activa THEN clock_timestamp() ELSE OLD.vigente_desde END;
 RETURN NEW;
END $$;


--
-- Name: fn_crm_secuencia_conservar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_secuencia_conservar() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'El modelo y el historial de secuencias se conservan'; END $$;


--
-- Name: fn_crm_secuencia_tarea(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crm_secuencia_tarea() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE s crm_secuencia%ROWTYPE; modelo crm_secuencia_modelo%ROWTYPE; siguiente jsonb; tarea bigint; actor integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.id_secuencia IS NOT NULL THEN RAISE EXCEPTION 'Las tareas de secuencia conservan su historial'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.id_secuencia IS DISTINCT FROM OLD.id_secuencia OR NEW.paso_secuencia IS DISTINCT FROM OLD.paso_secuencia THEN
  RAISE EXCEPTION 'No se puede cambiar el vínculo de una tarea de secuencia';
 END IF;
 IF OLD.id_secuencia IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO STRICT s FROM crm_secuencia WHERE id_secuencia=OLD.id_secuencia FOR UPDATE;
 IF s.estado NOT IN('Activa','Pausada') OR s.paso_actual<>OLD.paso_secuencia OR OLD.estado IN('Completada','Cancelada') THEN
  RAISE EXCEPTION 'El paso ya cambió o está cerrado; actualiza la secuencia';
 END IF;
 actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
 IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=actor AND is_active AND (role='admin' OR id_user IN(s.id_creador,s.id_responsable))) THEN
  RAISE EXCEPTION 'La tarea requiere un actor activo autorizado';
 END IF;
 IF current_setting('app.crm_sequence_control',true)=s.id_secuencia::text THEN
  IF NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=actor AND fn_effective_permission(id_user,role,'crm.secuencias.gestionar')) THEN RAISE EXCEPTION 'El permiso de secuencias cambió'; END IF;
  IF (to_jsonb(NEW)-ARRAY['id_responsable','fecha_vencimiento','updated_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['id_responsable','fecha_vencimiento','updated_at','version']) OR NEW.id_responsable<>s.id_responsable THEN
   RAISE EXCEPTION 'El control conserva el contenido y estado de la tarea';
  END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(NEW)-ARRAY['estado','completada_at','updated_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','completada_at','updated_at','version']) THEN
  RAISE EXCEPTION 'La tarea conserva el contexto del modelo de secuencia';
 END IF;
 IF s.estado='Pausada' AND NEW.estado<>'Cancelada' THEN RAISE EXCEPTION 'Reanuda la secuencia antes de avanzar el paso'; END IF;
 IF NEW.estado NOT IN('Completada','Cancelada') THEN
  UPDATE crm_secuencia SET version=version+1 WHERE id_secuencia=s.id_secuencia; RETURN NEW;
 END IF;
 INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES(s.id_secuencia,OLD.id_tarea,NEW.estado,OLD.paso_secuencia,actor);
 SELECT * INTO STRICT modelo FROM crm_secuencia_modelo WHERE id_modelo=s.id_modelo;
 IF NEW.estado='Cancelada' OR s.paso_actual=jsonb_array_length(modelo.pasos) THEN
  UPDATE crm_secuencia SET estado=NEW.estado,cerrada_en=clock_timestamp(),pausada_en=NULL,plazo_restante=NULL,version=version+1 WHERE id_secuencia=s.id_secuencia;
 ELSE
  PERFORM id_user FROM auth_user WHERE id_user=s.id_responsable AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El responsable está inactivo; reasigna o cancela la secuencia'; END IF;
  siguiente:=modelo.pasos->s.paso_actual;
  INSERT INTO crm_tarea(titulo,descripcion,prioridad,fecha_vencimiento,id_responsable,id_cliente,id_creador,id_secuencia,paso_secuencia)
   VALUES(siguiente->>'titulo',siguiente->>'descripcion',siguiente->>'prioridad',clock_timestamp()+make_interval(hours=>(siguiente->>'horas')::integer),s.id_responsable,s.id_cliente,s.id_creador,s.id_secuencia,s.paso_actual+1) RETURNING id_tarea INTO tarea;
  UPDATE crm_secuencia SET paso_actual=paso_actual+1,version=version+1 WHERE id_secuencia=s.id_secuencia;
  INSERT INTO crm_secuencia_evento(id_secuencia,id_tarea,evento,paso,id_actor) VALUES(s.id_secuencia,tarea,'Creada',s.paso_actual+1,actor);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_cuenta_contable_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_cuenta_contable_id(p_codigo text) RETURNS integer
    LANGUAGE sql STABLE
    AS $$ SELECT id_cuenta FROM cuenta_contable WHERE codigo=p_codigo AND activa $$;


--
-- Name: fn_dashboard_refresh_status(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dashboard_refresh_status(p_now timestamp with time zone DEFAULT clock_timestamp()) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
WITH local_time AS (SELECT p_now AT TIME ZONE 'America/Mexico_City' AS t),
schedule AS (SELECT ((t::date + time '02:00') -
  CASE WHEN t::time < time '02:00' THEN interval '1 day' ELSE interval '0' END)
  AT TIME ZONE 'America/Mexico_City' AS expected FROM local_time),
last_run AS (SELECT * FROM operational_job_run WHERE job_name='dashboard_refresh' ORDER BY started_at DESC,id DESC LIMIT 1),
success AS (SELECT max(finished_at) AS at FROM operational_job_run WHERE job_name='dashboard_refresh' AND status='success'),
state AS (SELECT s.expected,j.installed_at,su.at AS last_success,
  (s.expected>=j.installed_at AND p_now>=s.expected+interval '30 minutes'
    AND (su.at IS NULL OR su.at<s.expected)) AS overdue
  FROM schedule s CROSS JOIN success su JOIN operational_job j ON j.name='dashboard_refresh')
SELECT jsonb_build_object('checkedAt',p_now,'expectedAt',expected,
  'lastSuccessAt',last_success,'overdue',overdue,
  'freshness',CASE WHEN overdue THEN 'overdue' WHEN last_success>=expected THEN 'current' ELSE 'pending' END,
  'lastRun',(SELECT jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status) FROM last_run),
  'recentRuns',coalesce((SELECT jsonb_agg(r.data ORDER BY r.started_at DESC,r.id DESC) FROM
    (SELECT id,started_at,jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status) AS data
     FROM operational_job_run WHERE job_name='dashboard_refresh' ORDER BY started_at DESC,id DESC LIMIT 20) r),'[]'::jsonb))
FROM state;
$$;


--
-- Name: fn_delete_categoria(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_delete_categoria(p_id_categoria integer) RETURNS public.categoria
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_categoria_eliminada "categoria";
BEGIN
    DELETE FROM "categoria"
    WHERE "IdCategoria" = p_id_categoria
    RETURNING * INTO v_categoria_eliminada;
    
    RETURN v_categoria_eliminada;
END;
$$;


--
-- Name: fn_delete_cliente(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_delete_cliente(p_id_cliente integer) RETURNS public.cliente
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cliente_eliminado "cliente";
BEGIN
    DELETE FROM "cliente"
    WHERE "IdCliente" = p_id_cliente
    RETURNING * INTO v_cliente_eliminado;
    
    RETURN v_cliente_eliminado;
END;
$$;


--
-- Name: fn_delete_producto(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_delete_producto(p_id_producto integer) RETURNS public.producto
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_producto_eliminado "producto";
BEGIN
    -- NOTA: Si tienes "ON DELETE CASCADE" en la FK de inventario,
    -- se borrará automáticamente.
    DELETE FROM "producto"
    WHERE "IdProducto" = p_id_producto
    RETURNING * INTO v_producto_eliminado;
    
    RETURN v_producto_eliminado;
END;
$$;


--
-- Name: fn_delete_proveedor(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_delete_proveedor(p_id_proveedor integer) RETURNS public.proveedor
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_proveedor_eliminado "proveedor";
BEGIN
    DELETE FROM "proveedor"
    WHERE "IdProveedor" = p_id_proveedor
    RETURNING * INTO v_proveedor_eliminado;
    
    RETURN v_proveedor_eliminado;
END;
$$;


--
-- Name: fn_documento_salida_archivo_privado(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_documento_salida_archivo_privado() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'No registrar destinatarios, cuerpo o archivos de salida en auditoría'; END $$;


--
-- Name: fn_documento_salida_vinculo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_documento_salida_vinculo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_TABLE_NAME='documento_salida' THEN
   IF NOT EXISTS(SELECT 1 FROM factura WHERE id_factura=NEW.id_factura AND id_cliente=NEW.id_cliente AND estatus<>'Cancelada' AND id_factura_global IS NULL) THEN
     RAISE EXCEPTION 'Origen de salida no disponible';
   END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM documento_salida WHERE id=NEW.id AND bytes=octet_length(NEW.contenido)) THEN RAISE EXCEPTION 'Archivo y metadatos de salida no coinciden'; END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_effective_permission(integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_effective_permission(p_user integer, p_role text, p_code text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    (SELECT granted FROM app_user_permission WHERE id_user=p_user AND permission_code=p_code),
    (SELECT EXISTS(SELECT 1 FROM app_access_profile_permission pp
       WHERE pp.id_profile=assigned.id_profile AND pp.permission_code=p_code)
     FROM app_user_access_profile assigned WHERE assigned.id_user=p_user AND p_role='user'),
    EXISTS(SELECT 1 FROM app_role_permission WHERE role=p_role AND permission_code=p_code),
    false
  )
$$;


--
-- Name: FUNCTION fn_effective_permission(p_user integer, p_role text, p_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_effective_permission(p_user integer, p_role text, p_code text) IS 'Excepción individual > lista permitida del perfil del operador > rol base. Un perfil no concede rol administrador.';


--
-- Name: fn_gasto_saldos_y_landed_cost(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_gasto_saldos_y_landed_cost() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_total_compra numeric;
BEGIN
  IF NEW.metodo_pago ILIKE '%Efectivo%' THEN
    UPDATE saldos SET caja_chica=caja_chica-NEW.monto, updated_at=now();
  ELSE
    UPDATE saldos SET cuenta_banco=cuenta_banco-NEW.monto, updated_at=now();
  END IF;
  IF NEW.categoria='Flete/Paquetería' AND NEW.id_compra IS NOT NULL THEN
    PERFORM 1 FROM compra WHERE id_compra=NEW.id_compra FOR UPDATE;
    SELECT SUM(importe) INTO v_total_compra FROM detalle_compra WHERE id_compra=NEW.id_compra;
    IF v_total_compra > 0 THEN
      UPDATE detalle_compra
         SET costo_unitario=costo_unitario+((NEW.monto*importe/v_total_compra)/cantidad),
             importe=importe+(NEW.monto*importe/v_total_compra)
       WHERE id_compra=NEW.id_compra AND cantidad>0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_get_categoria_by_id(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_categoria_by_id(p_id_categoria integer) RETURNS public.categoria
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_categoria "categoria";
BEGIN
    SELECT * INTO v_categoria
    FROM "categoria"
    WHERE "IdCategoria" = p_id_categoria;
    
    RETURN v_categoria;
END;
$$;


--
-- Name: fn_get_categorias(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_categorias() RETURNS SETOF public.categoria
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM "categoria"
    ORDER BY "Descripcion";
END;
$$;


--
-- Name: fn_get_cliente_by_id(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_cliente_by_id(p_id_cliente integer) RETURNS public.cliente
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cliente "cliente";
BEGIN
    SELECT * INTO v_cliente
    FROM "cliente"
    WHERE "IdCliente" = p_id_cliente;
    
    RETURN v_cliente;
END;
$$;


--
-- Name: fn_get_clientes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_clientes() RETURNS SETOF public.cliente
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM "cliente"
    ORDER BY "RazonSocial";
END;
$$;


--
-- Name: fn_get_comisiones_semanales(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_comisiones_semanales() RETURNS TABLE(semana text, id_vendedor integer, vendedor_nombre character varying, ventas_realizadas bigint, total_ventas_brutas numeric, comisiones_acumuladas numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        to_char(f.fecha_emision, 'IYYY-"W"IW') AS semana,
        f.id_vendedor,
        u.username AS vendedor_nombre,
        COUNT(f.id_factura) AS ventas_realizadas,
        SUM(f.subtotal) AS total_ventas_brutas,
        SUM(f.comision_vendedor) AS comisiones_acumuladas
    FROM 
        factura f
    JOIN 
        auth_user u ON f.id_vendedor = u.id_user
    WHERE 
        f.id_vendedor IS NOT NULL
        AND f.estatus != 'Cancelada'::estatus_factura_enum
        AND f.tipo_comprobante = 'I'  -- IMPORTANTE: Solo Ingresos
    GROUP BY 
        semana, f.id_vendedor, vendedor_nombre
    ORDER BY 
        semana DESC, vendedor_nombre ASC;
END;
$$;


--
-- Name: fn_get_compras(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_compras() RETURNS TABLE(id_compra integer, fecha_compra timestamp with time zone, folio_factura character varying, total numeric, estatus character varying, nombre_proveedor character varying, rfc_proveedor character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id_compra,
        c.fecha_compra,
        c.folio_factura_proveedor,
        c.total,
        c.estatus,
        p."RazonSocial",
        p."RFC"
    FROM compra c
    JOIN proveedor p ON c.id_proveedor = p."IdProveedor"
    ORDER BY c.id_compra DESC;
END;
$$;


--
-- Name: cotizacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizacion (
    id_cotizacion integer NOT NULL,
    id_cliente integer NOT NULL,
    folio integer,
    fecha_emision timestamp with time zone DEFAULT now(),
    fecha_vencimiento timestamp with time zone DEFAULT (now() + '15 days'::interval),
    nombre_receptor character varying(255),
    rfc_receptor character varying(13),
    subtotal numeric(18,2) DEFAULT 0 NOT NULL,
    total_impuestos numeric(18,2) DEFAULT 0,
    total_retenciones numeric(18,2) DEFAULT 0,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    estatus character varying(20) DEFAULT 'Vigente'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    id_unidad integer
);


--
-- Name: fn_get_cotizaciones(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_cotizaciones(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_term text DEFAULT ''::text) RETURNS SETOF public.cotizacion
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM cotizacion
    WHERE (p_term = '' OR 
           folio::text ILIKE '%' || p_term || '%' OR
           ('C-' || folio::text) ILIKE '%' || p_term || '%' OR
           nombre_receptor ILIKE '%' || p_term || '%' OR
           rfc_receptor ILIKE '%' || p_term || '%')
    ORDER BY id_cotizacion DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: fn_get_dashboard_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_dashboard_metrics() RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_ventas_hoy NUMERIC;
    v_ventas_mes NUMERIC;
    v_por_cobrar NUMERIC;
    v_por_pagar NUMERIC;
    v_conteo_bajos INT;
    v_lista_bajos JSONB;
    v_grafica JSONB;
    v_top_productos JSONB;
    
    -- Variable auxiliar para saber qué día es HOY en México
    v_fecha_actual_mx DATE;
BEGIN
    -- 1. Calculamos la fecha actual en México (Tampico/CDMX)
    v_fecha_actual_mx := (NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date;

    -- 2. Ventas de HOY (Solo Ingresos y No Canceladas)
    SELECT COALESCE(SUM(total), 0) INTO v_ventas_hoy 
    FROM factura 
    WHERE (fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date = v_fecha_actual_mx
      AND tipo_comprobante = 'I'
      AND estatus != 'Cancelada'::estatus_factura_enum;

    -- 3. Ventas del MES (Solo Ingresos y No Canceladas)
    SELECT COALESCE(SUM(total), 0) INTO v_ventas_mes 
    FROM factura 
    WHERE date_part('month', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') = date_part('month', v_fecha_actual_mx)
      AND date_part('year', fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') = date_part('year', v_fecha_actual_mx)
      AND tipo_comprobante = 'I'
      AND estatus != 'Cancelada'::estatus_factura_enum;

    -- 4. Cuentas por Cobrar (Clientes me deben)
    -- NOTA: Las Notas de Crédito (Egresos) ya restan del saldo a favor o de la deuda en otras lógicas,
    -- pero para "facturas que me deben", contamos solo los Ingresos que no han sido pagados
    SELECT COALESCE(SUM(saldo_pendiente), 0) INTO v_por_cobrar 
    FROM factura 
    WHERE (estatus = 'Pendiente' OR saldo_pendiente > 0.01)
      AND tipo_comprobante = 'I';

    -- 5. Cuentas por Pagar (Debo a proveedores)
    SELECT COALESCE(SUM(saldo_pendiente), 0) INTO v_por_pagar 
    FROM compra 
    WHERE estatus = 'Pendiente' OR saldo_pendiente > 0.01;

    -- 6. Productos Bajos en Stock
    SELECT COUNT(*) INTO v_conteo_bajos FROM producto WHERE "Existencia" <= 10;

    SELECT jsonb_agg(t) INTO v_lista_bajos FROM (
        SELECT "Codigo" as codigo, "Descripcion" as descripcion, "Existencia" as existencia
        FROM producto WHERE "Existencia" <= 10 
        ORDER BY "Existencia" ASC 
        LIMIT 5
    ) t;

    -- 7. Gráfica Histórica (Últimos 7 días) - Solo Ingresos y No Canceladas
    SELECT jsonb_agg(t) INTO v_grafica FROM (
        SELECT 
            TO_CHAR(fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City', 'DD/MM') as name, 
            SUM(total) as value
        FROM factura
        WHERE fecha_emision >= NOW() - INTERVAL '7 days'
          AND tipo_comprobante = 'I'
          AND estatus != 'Cancelada'::estatus_factura_enum
        GROUP BY 1, date(fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')
        ORDER BY date(fecha_emision AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') ASC
    ) t;

    -- 8. Top 5 Productos más vendidos - Solo Ingresos y No Canceladas
    SELECT jsonb_agg(t) INTO v_top_productos FROM (
        SELECT 
            LEFT(p."Descripcion", 15) as name,
            SUM(d.cantidad) as value
        FROM conceptofactura d
        JOIN factura f ON d.id_factura = f.id_factura
        JOIN producto p ON d.id_producto = p."IdProducto"
        WHERE f.tipo_comprobante = 'I' 
          AND f.estatus != 'Cancelada'::estatus_factura_enum
        GROUP BY p."Descripcion"
        ORDER BY value DESC
        LIMIT 5
    ) t;

    -- 9. Retorno Final
    RETURN jsonb_build_object(
        'ventasHoy', v_ventas_hoy,
        'ventasMes', v_ventas_mes,
        'porCobrar', v_por_cobrar,
        'porPagar', v_por_pagar,
        'conteoBajos', v_conteo_bajos,
        'grafica', COALESCE(v_grafica, '[]'::jsonb),
        'listaBajos', COALESCE(v_lista_bajos, '[]'::jsonb),
        'topProductos', COALESCE(v_top_productos, '[]'::jsonb)
    );
END;
$$;


--
-- Name: fn_get_datos_cotizacion_pdf(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_datos_cotizacion_pdf(p_id integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_json JSONB;
BEGIN
    SELECT jsonb_build_object(
        'folio', concat('C-', c.folio),
        'fecha', to_char(c.fecha_emision, 'DD/MM/YYYY'),
        'vencimiento', to_char(c.fecha_vencimiento, 'DD/MM/YYYY'),
        'cliente', jsonb_build_object('nombre', c.nombre_receptor, 'rfc', c.rfc_receptor),
        'subtotal', c.subtotal,
        'iva', c.total_impuestos,
        'retenciones', c.total_retenciones,
        'total', c.total,
        'conceptos', (
            SELECT jsonb_agg(jsonb_build_object(
                'cantidad', det.cantidad,
                'descripcion', det.descripcion,
                'precio', det.valor_unitario,
                'importe', det.importe
            ))
            FROM conceptocotizacion det WHERE det.id_cotizacion = c.id_cotizacion
        )
    ) INTO v_json
    FROM cotizacion c WHERE c.id_cotizacion = p_id;
    RETURN v_json;
END;
$$;


--
-- Name: fn_get_datos_ticket(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_datos_ticket(p_id_factura integer) RETURNS TABLE(datos jsonb)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT jsonb_build_object(
        -- DATOS FACTURA (Tabla 'factura' usa minúsculas)
        'folio', f.folio,
        'serie', f.serie,
        'fecha', f.fecha_emision,
        'total', f.total,
        'subtotal', f.subtotal,
        'iva', f.total_impuestos_trasladados,
        'retenciones', f.total_impuestos_retenidos,
        'moneda', f.moneda,
        'tipo_cambio', f.tipo_cambio,
        
        -- CATÁLOGOS: Usamos "Nombre" (con comillas) tal como confirmaste
        'forma_pago', (SELECT "Nombre" FROM formadepago WHERE "IdFormaPago" = f.id_forma_pago LIMIT 1),
        'metodo_pago', (SELECT "Nombre" FROM metododepago WHERE "IdMetodoDePago" = f.id_metodo_pago LIMIT 1),
        
        'total_letras', '', 
        
        'cliente', (
            SELECT jsonb_build_object(
                -- TABLA CLIENTE (Usa comillas y Mayúsculas según tu esquema)
                'nombre', c."RazonSocial",
                'rfc', c."RFC",
                'cp', c."CodigoPostal",
                -- Dirección
                'calle', c."Calle",
                'numero_exterior', c."NumeroExterior",
                'numero_interior', c."NumeroInterior",
                'colonia', c."Colonia",
                'ciudad', c."Ciudad",
                
                -- Régimen (Catálogo, buscamos "Nombre")
                'regimen', (SELECT "Nombre" FROM regimenfiscal WHERE "IdRegimenFiscal" = c."IdRegimenFiscal" LIMIT 1),
                
                -- Ubicación (Catálogos, buscamos "Nombre")
                'municipio', (SELECT "Nombre" FROM municipio WHERE "IdMunicipio" = c."IdMunicipio" LIMIT 1),
                'estado', (SELECT "Nombre" FROM estado WHERE "IdEstado" = c."IdEstado" LIMIT 1)
            )
            FROM cliente c 
            WHERE c."IdCliente" = f.id_cliente
        ),
        
        -- Uso CFDI (Catálogo, buscamos "Nombre")
        'uso_cfdi', (SELECT "Nombre" FROM usocfdi WHERE "IdUsoCFDI" = f.id_uso_cfdi LIMIT 1),
        
        'conceptos', (
            SELECT jsonb_agg(jsonb_build_object(
                -- TABLA CONCEPTOFACTURA (Usa minúsculas)
                'cantidad', d.cantidad,
                'descripcion', d.descripcion, 
                'valor_unitario', d.valor_unitario,
                'precio', d.valor_unitario,
                'importe', d.importe,
                'clave_prod_serv', d.clave_sat,
                'clave_unidad', d.unidad_sat,
                
                -- PRODUCTO (Asumimos PK "IdProducto" y columna "Codigo" con comillas)
                'no_identificacion', (SELECT "Codigo" FROM producto p WHERE p."IdProducto" = d.id_producto),
                'codigo', (SELECT "Codigo" FROM producto p WHERE p."IdProducto" = d.id_producto)
            ))
            FROM conceptofactura d 
            WHERE d.id_factura = f.id_factura
        )
    )
    FROM factura f
    WHERE f.id_factura = p_id_factura;
END;
$$;


--
-- Name: fn_get_detalle_compra(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_detalle_compra(p_id_compra integer) RETURNS TABLE(cantidad numeric, costo_unitario numeric, importe numeric, descripcion text, codigo text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.cantidad,
        d.costo_unitario,
        d.importe,
        -- CORRECCIÓN: Convertimos explícitamente a ::TEXT para evitar el error de tipos
        COALESCE(prod."Descripcion", d.descripcion_producto)::TEXT as descripcion,
        COALESCE(prod."Codigo", 'ELIMINADO')::TEXT as codigo
    FROM detalle_compra d
    LEFT JOIN producto prod ON d.id_producto = prod."IdProducto"
    WHERE d.id_compra = p_id_compra;
END;
$$;


--
-- Name: fn_get_detalle_factura(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_detalle_factura(p_id_factura integer) RETURNS TABLE(id_concepto integer, id_producto integer, codigo_producto character varying, descripcion_producto text, unidad character varying, cantidad numeric, cantidad_devuelta numeric, precio_unitario numeric, importe numeric, pct_iva numeric, importe_iva numeric, pct_ret_isr numeric, importe_ret_isr numeric)
    LANGUAGE sql STABLE
    AS $$
SELECT d.id_concepto,p."IdProducto",p."Codigo",d.descripcion::text,d.unidad_sat,d.cantidad,
  (coalesce((SELECT sum(dd.cantidad) FROM devolucion_detalle dd JOIN devolucion dev ON dev.id_devolucion=dd.id_devolucion
     WHERE dev.id_factura=p_id_factura AND dd.id_producto=d.id_producto),0)
   +coalesce((SELECT sum(nc.cantidad) FROM conceptofactura nc JOIN factura nf ON nf.id_factura=nc.id_factura
     WHERE nf.id_factura_origen=p_id_factura AND nf.estatus::text<>'Cancelada' AND nc.id_producto=d.id_producto),0))::numeric,
  d.valor_unitario,d.importe,d.tasa_iva,d.importe_iva,d.tasa_ret_isr,d.importe_ret_isr
FROM conceptofactura d LEFT JOIN producto p ON p."IdProducto"=d.id_producto
WHERE d.id_factura=p_id_factura ORDER BY d.id_concepto;
$$;


--
-- Name: fn_get_devoluciones(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_devoluciones(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_term text DEFAULT ''::text) RETURNS TABLE(id_devolucion integer, id_factura integer, folio_factura character varying, fecha timestamp without time zone, monto_total numeric, metodo_reembolso character varying, cliente text, rfc text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id_devolucion,
        d.id_factura,
        f.folio::varchar as folio_factura,
        d.fecha,
        d.monto_total,
        d.metodo_reembolso,
        c."RazonSocial"::text as cliente,
        c."RFC"::text as rfc
    FROM devolucion d
    JOIN factura f ON d.id_factura = f.id_factura
    LEFT JOIN cliente c ON f.id_cliente = c."IdCliente"
    WHERE (p_term = '' OR
           f.folio::text ILIKE '%' || p_term || '%' OR
           ('NC-' || d.id_devolucion::text) ILIKE '%' || p_term || '%' OR
           c."RazonSocial"::text ILIKE '%' || p_term || '%' OR
           c."RFC"::text ILIKE '%' || p_term || '%')
    ORDER BY d.id_devolucion DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: fn_get_devoluciones_count(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_devoluciones_count(p_term text DEFAULT ''::text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_count bigint;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM devolucion d
    JOIN factura f ON d.id_factura = f.id_factura
    LEFT JOIN cliente c ON f.id_cliente = c."IdCliente"
    WHERE (p_term = '' OR
           f.folio::text ILIKE '%' || p_term || '%' OR
           ('NC-' || d.id_devolucion::text) ILIKE '%' || p_term || '%' OR
           c."RazonSocial"::text ILIKE '%' || p_term || '%' OR
           c."RFC"::text ILIKE '%' || p_term || '%');
    RETURN v_count;
END;
$$;


--
-- Name: fn_get_equivalentes(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_equivalentes(p_id_producto integer) RETURNS TABLE(id_producto_eq integer, codigo character varying, descripcion character varying, precio numeric, existencia numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p."IdProducto",
        p."Codigo",
        p."Descripcion",
        p."PrecioUnitario",
        p."Existencia"
    FROM producto_equivalente pe
    JOIN producto p ON pe."IdProductoEquivalente" = p."IdProducto"
    WHERE pe."IdProducto" = p_id_producto;
END;
$$;


--
-- Name: estado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estado (
    "IdEstado" integer NOT NULL,
    "Nombre" character varying(50) NOT NULL,
    "Clave" character varying(3)
);


--
-- Name: fn_get_estados(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_estados() RETURNS SETOF public.estado
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY SELECT * FROM "estado" ORDER BY "Nombre";
END;
$$;


--
-- Name: factura; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura (
    id_factura integer NOT NULL,
    id_cliente integer NOT NULL,
    serie character varying(10),
    folio integer,
    fecha_emision timestamp with time zone DEFAULT now(),
    estatus public.estatus_factura_enum DEFAULT 'Pendiente'::public.estatus_factura_enum,
    rfc_receptor character varying(13) NOT NULL,
    nombre_receptor character varying(255) NOT NULL,
    codigo_postal_receptor character varying(5) NOT NULL,
    regimen_fiscal_receptor_clave character varying(3) NOT NULL,
    uso_cfdi_clave character varying(3) NOT NULL,
    id_forma_pago integer,
    id_metodo_pago integer,
    id_uso_cfdi integer,
    tipo_comprobante character(1) DEFAULT 'I'::character varying,
    exportacion character varying(2) DEFAULT '01'::character varying,
    moneda character varying(3) DEFAULT 'MXN'::character varying,
    tipo_cambio numeric(18,6) DEFAULT 1,
    subtotal numeric(18,2) DEFAULT 0 NOT NULL,
    descuento numeric(18,2) DEFAULT 0,
    total_impuestos_trasladados numeric(18,2) DEFAULT 0,
    total_impuestos_retenidos numeric(18,2) DEFAULT 0,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    uuid uuid,
    xml_timbrado text,
    created_at timestamp with time zone DEFAULT now(),
    saldo_pendiente numeric(18,2) DEFAULT 0,
    id_vendedor integer,
    comision_vendedor numeric(18,2) DEFAULT 0,
    id_cotizacion integer,
    id_factura_global integer,
    id_factura_origen integer,
    metodo_reembolso character varying(30),
    id_gasto_reembolso integer,
    id_pedido integer,
    id_unidad integer,
    CONSTRAINT chk_tipo_cambio_valido CHECK ((tipo_cambio > (0)::numeric)),
    CONSTRAINT chk_tipo_comprobante CHECK ((tipo_comprobante = ANY (ARRAY['I'::bpchar, 'E'::bpchar]))),
    CONSTRAINT factura_descuento_check CHECK ((descuento >= (0)::numeric)),
    CONSTRAINT factura_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT factura_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: fn_get_facturas(integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_facturas(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_term text DEFAULT ''::text, p_tipo text DEFAULT ''::text) RETURNS SETOF public.factura
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM factura
    WHERE (p_term = '' OR 
           folio::text ILIKE '%' || p_term || '%' OR
           ('A' || folio::text) ILIKE '%' || p_term || '%' OR
           nombre_receptor ILIKE '%' || p_term || '%' OR
           rfc_receptor ILIKE '%' || p_term || '%')
      AND (p_tipo = '' OR p_tipo IS NULL OR tipo_comprobante = p_tipo)
    ORDER BY id_factura DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: formadepago; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.formadepago (
    "IdFormaPago" integer NOT NULL,
    "Clave" character varying(2) NOT NULL,
    "Nombre" character varying(100) NOT NULL
);


--
-- Name: fn_get_formaspago(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_formaspago() RETURNS SETOF public.formadepago
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY SELECT * FROM "formadepago" ORDER BY "Clave";
END;
$$;


--
-- Name: fn_get_margen_productos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_margen_productos() RETURNS TABLE(id_producto integer, codigo character varying, descripcion character varying, cantidad_vendida numeric, ingresos_totales numeric, costo_total numeric, utilidad_bruta numeric, margen_porcentaje numeric, costo_conocido boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
WITH ventas AS (
  SELECT cf.id_factura,cf.id_producto,sum(cf.cantidad) AS cantidad,
    sum(cf.importe-coalesce(cf.descuento,0)) AS neto,
    sum(cf.cantidad*cf.costo_unitario_snapshot) AS costo,
    bool_and(cf.costo_unitario_snapshot IS NOT NULL) AS conocido
  FROM conceptofactura cf JOIN factura f ON f.id_factura=cf.id_factura
  WHERE f.estatus::text<>'Cancelada' AND coalesce(f.tipo_comprobante,'I')='I' AND cf.id_producto IS NOT NULL
  GROUP BY cf.id_factura,cf.id_producto
), devoluciones AS (
  SELECT d.id_factura,dd.id_producto,sum(dd.cantidad) AS cantidad
  FROM devolucion d JOIN devolucion_detalle dd ON dd.id_devolucion=d.id_devolucion
  GROUP BY d.id_factura,dd.id_producto
), notas AS (
  SELECT f.id_factura_origen,cf.id_producto,sum(cf.cantidad) AS cantidad,
    sum(cf.importe-coalesce(cf.descuento,0)) AS neto
  FROM factura f JOIN conceptofactura cf ON cf.id_factura=f.id_factura
  WHERE f.tipo_comprobante='E' AND f.estatus::text<>'Cancelada' AND f.id_factura_origen IS NOT NULL
  GROUP BY f.id_factura_origen,cf.id_producto
), netas AS (
  SELECT v.id_producto,
    v.cantidad-coalesce(d.cantidad,0)-coalesce(n.cantidad,0) AS cantidad,
    v.neto-round(v.neto*coalesce(d.cantidad,0)/nullif(v.cantidad,0),2)-coalesce(n.neto,0) AS ingreso,
    v.costo*(v.cantidad-coalesce(d.cantidad,0)-coalesce(n.cantidad,0))/nullif(v.cantidad,0) AS costo,
    v.conocido
  FROM ventas v LEFT JOIN devoluciones d USING(id_factura,id_producto)
  LEFT JOIN notas n ON n.id_factura_origen=v.id_factura AND n.id_producto=v.id_producto
), totales AS (
  SELECT n.id_producto,sum(n.cantidad) AS cantidad,sum(n.ingreso) AS ingreso,
    CASE WHEN bool_and(n.conocido) THEN sum(n.costo) END AS costo,bool_and(n.conocido) AS conocido
  FROM netas n GROUP BY n.id_producto
)
SELECT p."IdProducto",p."Codigo",p."Descripcion",t.cantidad,t.ingreso,t.costo,
  t.ingreso-t.costo,(t.ingreso-t.costo)/nullif(t.ingreso,0)*100,t.conocido
FROM totales t JOIN producto p ON p."IdProducto"=t.id_producto ORDER BY 7 DESC NULLS LAST;
$$;


--
-- Name: metododepago; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metododepago (
    "IdMetodoDePago" integer NOT NULL,
    "Clave" character varying(3) NOT NULL,
    "Nombre" character varying(50) NOT NULL
);


--
-- Name: fn_get_metodospago(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_metodospago() RETURNS SETOF public.metododepago
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY SELECT * FROM "metododepago" ORDER BY "Clave";
END;
$$;


--
-- Name: municipio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.municipio (
    "IdMunicipio" integer NOT NULL,
    "Nombre" character varying(100) NOT NULL,
    "Clave" character varying(3),
    "ClaveEstado" character varying(3)
);


--
-- Name: fn_get_municipios_por_estado(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_municipios_por_estado(p_clave_estado character varying) RETURNS SETOF public.municipio
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM "municipio"
    WHERE "ClaveEstado" = p_clave_estado
    ORDER BY "Nombre";
END;
$$;


--
-- Name: fn_get_producto_by_id(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_producto_by_id(p_id integer) RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, imagenes jsonb)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA",
        -- Joins
        c."Descripcion" AS "CategoriaNombre",
        cps."Clave" AS "ClaveProdServ",
        CAST(cps."Descripcion" AS text) AS "DescripcionProdServ",
        cu."Clave" AS "ClaveUnidadSat",
        CAST(cu."Descripcion" AS text) AS "DescripcionUnidadSat",
        p."imagenes"
    FROM "producto" p
    LEFT JOIN "categoria" c ON p."IdCategoria" = c."IdCategoria"
    LEFT JOIN "claveproductooservicio" cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN "claveunidad" cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    WHERE p."IdProducto" = p_id;
END;
$$;


--
-- Name: fn_get_productos(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_productos(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_term text DEFAULT ''::text) RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, "Existencia" numeric, "CategoriaNombre" character varying, "ClaveProdServ" character varying, "DescripcionProdServ" text, "ClaveUnidadSat" character varying, "DescripcionUnidadSat" text, "EquivalentesJSON" jsonb, imagenes jsonb)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion",
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ",
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA",
        p."AplicaRetencionISR", p."AplicaRetencionIVA",
        p."Existencia",
        c."Descripcion" AS "CategoriaNombre",
        cps."Clave" AS "ClaveProdServ",
        CAST(cps."Descripcion" AS text) AS "DescripcionProdServ",
        cu."Clave" AS "ClaveUnidadSat",
        CAST(cu."Descripcion" AS text) AS "DescripcionUnidadSat",

        COALESCE((
            SELECT jsonb_agg(pe."IdProductoEquivalente")
            FROM producto_equivalente pe
            WHERE pe."IdProducto" = p."IdProducto"
        ), '[]'::jsonb) AS "EquivalentesJSON",
        p."imagenes"

    FROM "producto" p
    LEFT JOIN "categoria" c ON p."IdCategoria" = c."IdCategoria"
    LEFT JOIN "claveproductooservicio" cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
    LEFT JOIN "claveunidad" cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
    WHERE (
        p_term = '' OR
        p."Descripcion" ILIKE '%' || p_term || '%' OR
        p."Codigo" ILIKE '%' || p_term || '%' OR
        p."Marca" ILIKE '%' || p_term || '%' OR
        c."Descripcion" ILIKE '%' || p_term || '%'
    )
    ORDER BY p."IdProducto" DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;


--
-- Name: fn_get_proveedor_by_id(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_proveedor_by_id(p_id_proveedor integer) RETURNS public.proveedor
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_proveedor "proveedor";
BEGIN
    SELECT * INTO v_proveedor
    FROM "proveedor"
    WHERE "IdProveedor" = p_id_proveedor;
    
    RETURN v_proveedor;
END;
$$;


--
-- Name: fn_get_proveedores(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_proveedores() RETURNS SETOF public.proveedor
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM "proveedor"
    ORDER BY "RazonSocial";
END;
$$;


--
-- Name: regimenfiscal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regimenfiscal (
    "IdRegimenFiscal" integer NOT NULL,
    "Clave" character varying(3) NOT NULL,
    "Nombre" character varying(255) NOT NULL
);


--
-- Name: fn_get_regimenesfiscales(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_regimenesfiscales() RETURNS SETOF public.regimenfiscal
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY SELECT * FROM "regimenfiscal" ORDER BY "Clave";
END;
$$;


--
-- Name: usocfdi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usocfdi (
    "IdUsoCFDI" integer NOT NULL,
    "Clave" character varying(4) NOT NULL,
    "Nombre" character varying(100) NOT NULL
);


--
-- Name: fn_get_usoscfdi(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_usoscfdi() RETURNS SETOF public.usocfdi
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY SELECT * FROM "usocfdi" ORDER BY "Clave";
END;
$$;


--
-- Name: fn_get_utilidad_productos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_get_utilidad_productos() RETURNS TABLE(id_producto integer, codigo character varying, descripcion character varying, cantidad_vendida numeric, ingresos_totales numeric, costo_total numeric, utilidad_neta numeric, margen_porcentaje numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH ventas_cte AS (
        -- Suma de las cantidades e importes vendidos por cada producto, 
        -- considerando solo facturas que no estén canceladas. 
        SELECT 
            cf.id_producto as prod_id,
            SUM(cf.cantidad) AS cant_vendida,
            SUM(cf.importe) AS total_ingresos
        FROM conceptofactura cf
        JOIN factura f ON cf.id_factura = f.id_factura
        WHERE f.estatus != 'Cancelada'
        GROUP BY cf.id_producto
    ),
    costos_cte AS (
        -- Costo promedio histórico por producto (en base a las compras registradas)
        SELECT 
            dc.id_producto AS prod_id,
            CASE 
                WHEN SUM(dc.cantidad) > 0 THEN SUM(dc.importe) / SUM(dc.cantidad)
                ELSE 0
            END AS costo_unitario_promedio
        FROM detalle_compra dc
        JOIN compra c ON dc.id_compra = c.id_compra
        WHERE c.estatus != 'Cancelada' AND c.estatus != 'Cancelado'
        GROUP BY dc.id_producto
    )
    SELECT 
        p."IdProducto" as id_producto,
        p."Codigo" as codigo,
        p."Descripcion" as descripcion,
        COALESCE(v.cant_vendida, 0) AS cantidad_vendida,
        COALESCE(v.total_ingresos, 0) AS ingresos_totales,
        -- El costo total es la cantidad vendida por el costo unitario promedio, o por el precio unitario del catálogo si no hay compras
        (COALESCE(v.cant_vendida, 0) * COALESCE(c.costo_unitario_promedio, p."PrecioUnitario" * 0.5)) AS costo_total, -- Asumiendo 50% de margen si no hay historial de compras, para no dejar 0
        -- Utilidad = Ingresos - Costos
        (COALESCE(v.total_ingresos, 0) - (COALESCE(v.cant_vendida, 0) * COALESCE(c.costo_unitario_promedio, p."PrecioUnitario" * 0.5))) AS utilidad_neta,
        -- Margen % = (Utilidad / Ingresos) * 100
        CASE 
            WHEN COALESCE(v.total_ingresos, 0) > 0 
            THEN ((COALESCE(v.total_ingresos, 0) - (COALESCE(v.cant_vendida, 0) * COALESCE(c.costo_unitario_promedio, p."PrecioUnitario" * 0.5))) / v.total_ingresos) * 100
            ELSE 0 
        END AS margen_porcentaje
    FROM producto p
    JOIN ventas_cte v ON p."IdProducto" = v.prod_id
    LEFT JOIN costos_cte c ON p."IdProducto" = c.prod_id
    ORDER BY utilidad_neta DESC;
END;
$$;


--
-- Name: fn_gmroi_90d(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_gmroi_90d() RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH periodo AS (
    SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS hoy
  ), promedio AS (
    SELECT CASE WHEN count(*)=90 AND count(valor)=90 THEN avg(valor) END AS valor
    FROM analytics_inventario_diario,periodo WHERE fecha BETWEEN hoy-89 AND hoy
  ), ventas AS (
    SELECT cf.id_factura,cf.id_producto,sum(cf.cantidad) AS cantidad,
      sum(cf.importe-COALESCE(cf.descuento,0)) AS ingreso,
      sum(cf.cantidad*cf.costo_unitario_snapshot) AS costo,
      bool_and(cf.costo_unitario_snapshot IS NOT NULL) AS conocido
    FROM conceptofactura cf JOIN factura f USING(id_factura),periodo
    WHERE f.estatus::text<>'Cancelada' AND COALESCE(f.tipo_comprobante,'I')='I'
      AND (f.fecha_emision AT TIME ZONE 'America/Mexico_City')::date BETWEEN hoy-89 AND hoy
    GROUP BY cf.id_factura,cf.id_producto
  ), devoluciones AS (
    SELECT d.id_factura,dd.id_producto,sum(dd.cantidad) AS cantidad
    FROM devolucion d JOIN devolucion_detalle dd USING(id_devolucion)
    GROUP BY d.id_factura,dd.id_producto
  ), notas AS (
    SELECT f.id_factura_origen,cf.id_producto,sum(cf.cantidad) AS cantidad,
      sum(cf.importe-COALESCE(cf.descuento,0)) AS ingreso
    FROM factura f JOIN conceptofactura cf USING(id_factura)
    WHERE f.tipo_comprobante='E' AND f.estatus::text<>'Cancelada'
    GROUP BY f.id_factura_origen,cf.id_producto
  ), margen AS (
    SELECT CASE WHEN COALESCE(bool_and(v.conocido),true) THEN COALESCE(sum(
      v.ingreso-round(v.ingreso*COALESCE(d.cantidad,0)/NULLIF(v.cantidad,0),2)-COALESCE(n.ingreso,0)
      -v.costo*(v.cantidad-COALESCE(d.cantidad,0)-COALESCE(n.cantidad,0))/NULLIF(v.cantidad,0)
    ),0) END AS valor
    FROM ventas v LEFT JOIN devoluciones d USING(id_factura,id_producto)
    LEFT JOIN notas n ON n.id_factura_origen=v.id_factura AND n.id_producto=v.id_producto
  ) SELECT m.valor/NULLIF(p.valor,0) FROM margen m CROSS JOIN promedio p;
$$;


--
-- Name: fn_iva_proporcional_factura_proveedor(bigint, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_iva_proporcional_factura_proveedor(p_id bigint, p_monto numeric) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
 SELECT CASE WHEN f.impuestos>0 AND f.total>0 THEN round(p_monto*f.impuestos/f.total,2) ELSE 0 END
   FROM factura_proveedor f WHERE f.id_factura_proveedor=p_id $$;


--
-- Name: fn_kardex_cambios_producto(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_kardex_cambios_producto() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD."PrecioUnitario" <> NEW."PrecioUnitario" THEN
    INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia)
    VALUES(NEW."IdProducto",'CAMBIO_PRECIO',0,NEW."Existencia",NEW."Existencia",NEW."PrecioUnitario",'Actualización Manual de Precio');
  END IF;
  IF OLD."Existencia" <> NEW."Existencia"
     AND COALESCE(current_setting('app.stock_movement_managed',true),'false') <> 'true' THEN
    INSERT INTO kardex(id_producto,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia)
    VALUES(NEW."IdProducto",'AJUSTE_MANUAL_STOCK',NEW."Existencia"-OLD."Existencia",OLD."Existencia",NEW."Existencia",NEW."PrecioUnitario",'Ajuste directo de Inventario');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_kardex_compra(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_kardex_compra() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_stock_actual numeric;
BEGIN
    -- Obtener Stock actual (usando "Existencia" y "IdProducto")
    SELECT "Existencia" INTO v_stock_actual 
    FROM producto 
    WHERE "IdProducto" = NEW.id_producto;

    -- Insertar en Kardex (Entrada = Positivo)
    INSERT INTO kardex (
        id_producto, 
        tipo_movimiento, 
        cantidad, 
        stock_anterior, 
        stock_resultante, 
        precio_unitario, 
        referencia, 
        id_referencia
    ) VALUES (
        NEW.id_producto,
        'COMPRA',
        NEW.cantidad,
        v_stock_actual,
        v_stock_actual + NEW.cantidad,
        NEW.costo_unitario, -- Asumiendo que tu tabla detalle_compra tiene costo_unitario
        CONCAT('Compra ID: ', NEW.id_compra),
        NEW.id_compra
    );

    -- Aumentar Inventario
    UPDATE producto 
    SET "Existencia" = "Existencia" + NEW.cantidad 
    WHERE "IdProducto" = NEW.id_producto;

    RETURN NEW;
END;
$$;


--
-- Name: fn_kardex_venta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_kardex_venta() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_stock_actual numeric;
  v_folio_factura varchar;
  v_tipo_comprobante char(1);
  v_multiplicador int;
  v_tipo_movimiento varchar;
  v_referencia varchar;
  v_stock_resultante numeric;
BEGIN
  IF NEW.id_producto IS NULL THEN RETURN NEW; END IF;
  IF NEW.cantidad IS NULL OR NEW.cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad del concepto debe ser mayor a cero';
  END IF;

  SELECT "Existencia" INTO v_stock_actual
    FROM producto WHERE "IdProducto" = NEW.id_producto FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no encontrado', NEW.id_producto; END IF;

  SELECT CONCAT(serie, '-', folio), tipo_comprobante
    INTO v_folio_factura, v_tipo_comprobante
    FROM factura WHERE id_factura = NEW.id_factura;

  IF v_tipo_comprobante = 'E' THEN
    v_multiplicador := 1;
    v_tipo_movimiento := 'ENTRADA POR DEVOLUCION';
    v_referencia := CONCAT('Devolución/Egreso: ', v_folio_factura);
  ELSE
    v_multiplicador := -1;
    v_tipo_movimiento := 'VENTA';
    v_referencia := CONCAT('Venta Factura: ', v_folio_factura);
  END IF;

  v_stock_resultante := v_stock_actual + (NEW.cantidad * v_multiplicador);
  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, solicitado: %',
      NEW.id_producto, v_stock_actual, NEW.cantidad;
  END IF;

  UPDATE producto SET "Existencia" = v_stock_resultante
   WHERE "IdProducto" = NEW.id_producto;

  INSERT INTO kardex (
    id_producto, tipo_movimiento, cantidad, stock_anterior,
    stock_resultante, precio_unitario, referencia, id_referencia
  ) VALUES (
    NEW.id_producto, v_tipo_movimiento::tipo_movimiento_enum,
    NEW.cantidad * v_multiplicador, v_stock_actual,
    v_stock_resultante, NEW.valor_unitario, v_referencia, NEW.id_factura
  );
  RETURN NEW;
END;
$$;


--
-- Name: fn_pedido_entrega_inmutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_pedido_entrega_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'El comprobante de entrega se conserva sin reescribir'; END $$;


--
-- Name: fn_plazo_pago_proveedores_90d(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_plazo_pago_proveedores_90d() RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH pagos AS (
    SELECT (p.fecha-f.fecha_emision) AS dias,p.monto
    FROM factura_proveedor_pago p JOIN factura_proveedor f USING(id_factura_proveedor)
    WHERE p.estado='Activo' AND f.estado<>'Cancelada' AND p.fecha>=f.fecha_emision
      AND p.fecha>=CURRENT_DATE-89 AND p.fecha<=CURRENT_DATE
    UNION ALL
    SELECT (p.fecha_pago::date-c.fecha_compra::date),p.monto
    FROM pago_proveedor p JOIN compra c USING(id_compra)
    WHERE c.estatus::text NOT IN ('Cancelada','Cancelado')
      AND p.fecha_pago::date>=c.fecha_compra::date
      AND p.fecha_pago::date>=CURRENT_DATE-89 AND p.fecha_pago::date<=CURRENT_DATE
  ) SELECT sum(dias*monto)/NULLIF(sum(monto),0) FROM pagos WHERE monto>0;
$$;


--
-- Name: fn_poliza_anticipo_proveedor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_poliza_anticipo_proveedor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_id bigint;
BEGIN
 v_id:=fn_preparar_poliza_automatica('AnticipoProveedor',NEW.id_anticipo,NEW.fecha,'Egreso','Anticipo a proveedor '||NEW.id_proveedor,NEW.estado<>'Cancelado');
 IF NEW.estado='Cancelado' THEN RETURN NEW; END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1150'),'Anticipo a proveedor',NEW.monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id(CASE WHEN NEW.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',NEW.monto);
 RETURN NEW;
END $$;


--
-- Name: fn_poliza_aplicacion_proveedor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_poliza_aplicacion_proveedor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_id bigint; v_activa boolean; v_iva numeric(18,2);
BEGIN
 v_activa:=NEW.estado='Activa';
 v_id:=fn_preparar_poliza_automatica('AplicacionProveedor',NEW.id_aplicacion,NEW.created_at::date,'Diario','Aplicacion de '||NEW.tipo||' a factura '||NEW.id_factura_proveedor,v_activa);
 IF NOT v_activa THEN RETURN NEW; END IF;
 v_iva:=fn_iva_proporcional_factura_proveedor(NEW.id_factura_proveedor,NEW.monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Disminucion de cuenta por pagar',NEW.monto);
 IF NEW.tipo='Anticipo' THEN
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1150'),'Aplicacion de saldo a favor',NEW.monto);
  IF v_iva>0 THEN
   INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1170'),'IVA acreditable pagado',v_iva);
   INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA pendiente que se paga',v_iva);
  END IF;
 ELSE
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1130'),'Aplicacion de saldo a favor',NEW.monto-v_iva);
  IF v_iva>0 THEN
   INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA de nota de credito',v_iva);
  END IF;
 END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_poliza_factura_proveedor(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_poliza_factura_proveedor(p_id bigint) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE f record; v_id bigint; v_activa boolean; v_total numeric(18,2); v_iva numeric(18,2);
BEGIN
 SELECT * INTO f FROM factura_proveedor WHERE id_factura_proveedor=p_id; IF NOT FOUND THEN RETURN; END IF;
 v_activa:=f.estado IN ('Aprobada','Parcialmente pagada','Pagada');
 v_id:=fn_preparar_poliza_automatica('FacturaProveedor',p_id,f.fecha_emision,'Diario','Factura proveedor '||coalesce(f.serie||'-','')||f.folio,v_activa);
 IF NOT v_activa THEN RETURN; END IF;
 v_total:=round(f.total*f.tipo_cambio,2);
 v_iva:=least(v_total,round(f.impuestos*f.tipo_cambio,2));
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Mercancia facturada',v_total-v_iva);
 IF v_iva>0 THEN
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA acreditable pendiente de pago',v_iva);
 END IF;
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('2100'),'Cuenta por pagar',v_total);
END $$;


--
-- Name: fn_poliza_factura_proveedor_pago(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_poliza_factura_proveedor_pago() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_id bigint; v_tipo_cambio numeric(18,6); v_activa boolean; v_monto numeric(18,2); v_iva numeric(18,2);
BEGIN
 SELECT tipo_cambio INTO v_tipo_cambio FROM factura_proveedor WHERE id_factura_proveedor=NEW.id_factura_proveedor;
 v_activa:=NEW.estado='Activo';
 v_id:=fn_preparar_poliza_automatica('PagoFacturaProveedor',NEW.id_pago,NEW.fecha,'Egreso','Pago factura proveedor '||NEW.id_factura_proveedor,v_activa);
 IF NOT v_activa THEN RETURN NEW; END IF;
 v_monto:=round(NEW.monto*v_tipo_cambio,2);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Aplicacion a proveedor',v_monto);
 INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id(CASE WHEN NEW.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',v_monto);
 v_iva:=fn_iva_proporcional_factura_proveedor(NEW.id_factura_proveedor,v_monto);
 IF v_iva>0 THEN
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1170'),'IVA acreditable pagado',v_iva);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1160'),'IVA pendiente que se paga',v_iva);
 END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_portal_cliente_fijo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_portal_cliente_fijo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.id_cliente<>OLD.id_cliente OR NEW.alias<>OLD.alias THEN RAISE EXCEPTION 'El cliente y alias de un acceso no se reasignan'; END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_portal_evento_inmutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_portal_evento_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Los eventos del portal se conservan sin reescribir'; END $$;


--
-- Name: fn_portal_proteger_secretos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_portal_proteger_secretos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.table_name IN('portal_credencial','portal_invitacion','portal_sesion','portal_publicacion_archivo') THEN RAISE EXCEPTION 'No registrar secretos ni archivos del portal en auditoria_jsonb'; END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_portal_publicacion_inmutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_portal_publicacion_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Publicaciones, archivos y retiros se conservan sin reescribir'; END $$;


--
-- Name: fn_preparar_envio_correo(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_preparar_envio_correo(p_id_factura integer) RETURNS TABLE(destinatario character varying, asunto text, cuerpo_mensaje text, nombre_archivo character varying)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_cliente_email VARCHAR;
    v_cliente_nombre VARCHAR;
    v_folio_factura VARCHAR;
    v_fecha VARCHAR;
    v_total NUMERIC;
BEGIN
    -- Obtener datos
    SELECT 
        c.email, 
        c."RazonSocial",
        concat(f.serie, f.folio),
        to_char(f.fecha_emision, 'DD/MM/YYYY'),
        f.total
    INTO 
        v_cliente_email, 
        v_cliente_nombre, 
        v_folio_factura,
        v_fecha,
        v_total
    FROM factura f
    JOIN cliente c ON f.id_cliente = c."IdCliente"
    WHERE f.id_factura = p_id_factura;

    -- VALIDACIÓN 1: ¿Existe la factura?
    IF v_folio_factura IS NULL THEN
        RAISE EXCEPTION 'La factura ID % no existe.', p_id_factura;
    END IF;

    -- VALIDACIÓN 2: ¿El cliente tiene correo?
    IF v_cliente_email IS NULL OR v_cliente_email = '' THEN
        RAISE EXCEPTION 'El cliente "%" no tiene un correo electrónico registrado. Actualízalo en el catálogo.', v_cliente_nombre;
    END IF;

    -- CONSTRUCCIÓN DEL MENSAJE (Lógica en BD)
    RETURN QUERY SELECT 
        v_cliente_email,
        -- Asunto
        CAST('Factura ' || v_folio_factura || ' - Refacciones y Tractorepuestos' AS TEXT),
        -- Cuerpo del Mensaje
        CAST('Estimado(a) ' || v_cliente_nombre || E',\n\n' ||
             'Adjunto encontrará su factura con folio ' || v_folio_factura || 
             ' emitida el ' || v_fecha || E'.\n' ||
             'Total: $' || v_total || E'\n\n' ||
             'Gracias por su preferencia.\n' ||
             'Atentamente,\nRefacciones y Tractorepuestos' AS TEXT),
        -- Nombre sugerido del archivo
        CAST('Factura_' || v_folio_factura || '.pdf' AS VARCHAR);
        
    -- Registrar el intento en historial (Opcional, se puede hacer al confirmar éxito)
    INSERT INTO historial_correos (id_factura, destinatario, asunto)
    VALUES (p_id_factura, v_cliente_email, 'Factura ' || v_folio_factura);
END;
$_$;


--
-- Name: fn_preparar_poliza_automatica(text, bigint, date, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_preparar_poliza_automatica(p_origen_tipo text, p_origen_id bigint, p_fecha date, p_tipo text, p_concepto text, p_activa boolean) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE v_id bigint; v_usuario integer;
BEGIN
  v_usuario:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF v_usuario IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=v_usuario) THEN v_usuario:=NULL; END IF;
  INSERT INTO poliza_contable(fecha,tipo,concepto,estado,origen_tipo,origen_id,automatica,id_usuario,contabilizada_at)
  VALUES(p_fecha,p_tipo,p_concepto,CASE WHEN p_activa THEN 'Contabilizada' ELSE 'Cancelada' END,
    p_origen_tipo,p_origen_id,true,v_usuario,CASE WHEN p_activa THEN clock_timestamp() END)
  ON CONFLICT (origen_tipo,origen_id) WHERE origen_tipo IS NOT NULL DO UPDATE SET
    fecha=EXCLUDED.fecha,tipo=EXCLUDED.tipo,concepto=EXCLUDED.concepto,
    estado=EXCLUDED.estado,id_usuario=coalesce(EXCLUDED.id_usuario,poliza_contable.id_usuario),
    contabilizada_at=EXCLUDED.contabilizada_at,updated_at=clock_timestamp()
  RETURNING id_poliza INTO v_id;
  DELETE FROM poliza_contable_detalle WHERE id_poliza=v_id;
  RETURN v_id;
END $$;


--
-- Name: fn_proteger_bitacora_caja(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_proteger_bitacora_caja() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'La bitácora de caja es inmutable; registra un movimiento compensatorio'; END;
$$;


--
-- Name: fn_proteger_entrega_evidenciada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_proteger_entrega_evidenciada() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pedido_entrega_evidencia WHERE id_entrega=OLD.id_entrega) THEN
  RAISE EXCEPTION 'La entrega evidenciada se conserva sin reescribir';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;


--
-- Name: fn_recalcular_comision_devolucion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recalcular_comision_devolucion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_total numeric; v_subtotal numeric; v_vendedor integer; v_devuelto numeric;
BEGIN
  IF NEW.monto_total <= 0 THEN RETURN NEW; END IF;
  SELECT total, subtotal, id_vendedor INTO v_total, v_subtotal, v_vendedor
    FROM factura WHERE id_factura=NEW.id_factura FOR UPDATE;
  IF v_vendedor IS NOT NULL AND v_total > 0 THEN
    SELECT COALESCE(SUM(monto_total),0) INTO v_devuelto FROM devolucion WHERE id_factura=NEW.id_factura;
    IF v_devuelto > v_total THEN RAISE EXCEPTION 'El reembolso acumulado excede el total de la factura'; END IF;
    UPDATE factura SET comision_vendedor=greatest(0,round(v_subtotal*0.02*(1-v_devuelto/v_total),2))
      WHERE id_factura=NEW.id_factura;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_reconstruir_poliza_compra(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reconstruir_poliza_compra(p_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE c record; v_id bigint; v_total numeric(18,2); v_activa boolean;
BEGIN
  SELECT * INTO c FROM compra WHERE id_compra=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_activa:=c.estatus::text NOT IN ('Cancelada','Cancelado');
  v_id:=fn_preparar_poliza_automatica('Compra',p_id,c.fecha_compra::date,'Diario','Compra '||coalesce(c.folio_factura_proveedor,p_id::text),v_activa);
  IF NOT v_activa THEN RETURN; END IF;
  SELECT coalesce(sum(importe),c.total,0) INTO v_total FROM detalle_compra WHERE id_compra=p_id;
  IF v_total>0 THEN
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Entrada de inventario',v_total);
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('2100'),'Cuenta por pagar',v_total);
  END IF;
END $$;


--
-- Name: fn_reconstruir_poliza_factura(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reconstruir_poliza_factura(p_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE f record; v_id bigint; v_costo numeric(18,2); v_ingreso numeric(18,2); v_activa boolean;
BEGIN
  SELECT * INTO f FROM factura WHERE id_factura=p_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_activa:=f.estatus::text <> 'Cancelada';
  v_id:=fn_preparar_poliza_automatica('Factura',p_id,f.fecha_emision::date,'Diario',
    'Factura '||coalesce(f.serie,'')||'-'||coalesce(f.folio::text,p_id::text),v_activa);
  IF NOT v_activa THEN RETURN; END IF;
  -- Se deriva del total fiscal para conservar el centavo de redondeo del CFDI.
  v_ingreso:=greatest(0,coalesce(f.total,0)+coalesce(f.total_impuestos_retenidos,0)-coalesce(f.total_impuestos_trasladados,0));
  SELECT coalesce(sum(cantidad*coalesce(costo_unitario_snapshot,0)),0) INTO v_costo FROM conceptofactura WHERE id_factura=p_id;
  IF coalesce(f.tipo_comprobante,'I')='E' THEN
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('4100'),'Nota de crédito',v_ingreso WHERE v_ingreso>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('2200'),'IVA devuelto',coalesce(f.total_impuestos_trasladados,0) WHERE coalesce(f.total_impuestos_trasladados,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('1120'),'Disminución de saldo del cliente',coalesce(f.total,0) WHERE coalesce(f.total,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('1140'),'Reverso de retención',coalesce(f.total_impuestos_retenidos,0) WHERE coalesce(f.total_impuestos_retenidos,0)>0;
    IF v_costo>0 THEN
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('1130'),'Retorno a inventario',v_costo);
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('5000'),'Reverso de costo',v_costo);
    END IF;
  ELSE
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('1120'),'Cuenta por cobrar',coalesce(f.total,0) WHERE coalesce(f.total,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe)
      SELECT v_id,fn_cuenta_contable_id('1140'),'ISR retenido',coalesce(f.total_impuestos_retenidos,0) WHERE coalesce(f.total_impuestos_retenidos,0)>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('4000'),'Venta',v_ingreso WHERE v_ingreso>0;
    INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber)
      SELECT v_id,fn_cuenta_contable_id('2200'),'IVA trasladado',coalesce(f.total_impuestos_trasladados,0) WHERE coalesce(f.total_impuestos_trasladados,0)>0;
    IF v_costo>0 THEN
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('5000'),'Costo de venta',v_costo);
      INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1130'),'Salida de inventario',v_costo);
    END IF;
  END IF;
END $$;


--
-- Name: fn_reconstruir_poliza_gasto(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reconstruir_poliza_gasto(p_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE g record; v_id bigint;
BEGIN
  SELECT * INTO g FROM gasto WHERE id_gasto=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_id:=fn_preparar_poliza_automatica('Gasto',p_id,g.fecha::date,'Egreso',g.concepto,NOT coalesce(g.anulado,false));
  IF coalesce(g.anulado,false) THEN RETURN; END IF;
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('6000'),g.categoria,g.monto);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES
    (v_id,fn_cuenta_contable_id(CASE WHEN g.metodo_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Pago del gasto',g.monto);
END $$;


--
-- Name: fn_reconstruir_poliza_pago(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reconstruir_poliza_pago(p_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE p record; v_id bigint;
BEGIN
  SELECT * INTO p FROM pago WHERE id_pago=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_id:=fn_preparar_poliza_automatica('PagoCliente',p_id,p.fecha_pago::date,'Ingreso','Cobro de factura '||p.id_factura,true);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES
    (v_id,fn_cuenta_contable_id(CASE WHEN p.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Cobro recibido',p.monto);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES(v_id,fn_cuenta_contable_id('1120'),'Aplicación a cliente',p.monto);
END $$;


--
-- Name: fn_reconstruir_poliza_pago_proveedor(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_reconstruir_poliza_pago_proveedor(p_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE p record; v_id bigint;
BEGIN
  SELECT * INTO p FROM pago_proveedor WHERE id_pago_proveedor=p_id; IF NOT FOUND THEN RETURN; END IF;
  v_id:=fn_preparar_poliza_automatica('PagoProveedor',p_id,p.fecha_pago::date,'Egreso','Pago de compra '||p.id_compra,true);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,debe) VALUES(v_id,fn_cuenta_contable_id('2100'),'Aplicación a proveedor',p.monto);
  INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,haber) VALUES
    (v_id,fn_cuenta_contable_id(CASE WHEN p.forma_pago ILIKE '%Efectivo%' THEN '1100' ELSE '1110' END),'Salida de fondos',p.monto);
END $$;


--
-- Name: fn_registrar_movimiento_caja(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_registrar_movimiento_caja() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_usuario integer;
BEGIN
  IF NEW.caja_chica IS NOT DISTINCT FROM OLD.caja_chica AND NEW.cuenta_banco IS NOT DISTINCT FROM OLD.cuenta_banco THEN RETURN NEW; END IF;
  v_usuario := nullif(current_setting('app.current_user_id',true),'')::integer;
  IF v_usuario IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth_user WHERE id_user=v_usuario) THEN v_usuario:=NULL; END IF;
  INSERT INTO caja_movimiento(id_saldo,efectivo,banco,saldo_efectivo,saldo_banco,id_usuario,origen)
  VALUES(NEW.id_saldo,NEW.caja_chica-OLD.caja_chica,NEW.cuenta_banco-OLD.cuenta_banco,
         NEW.caja_chica,NEW.cuenta_banco,v_usuario,
         coalesce(nullif(current_setting('app.movement_origin',true),''),'Movimiento del sistema'));
  RETURN NEW;
END;
$$;


--
-- Name: fn_registrar_pago(integer, numeric, character varying, character varying, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_registrar_pago(p_id_factura integer, p_monto numeric, p_forma_pago character varying, p_referencia character varying, p_notas text) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_saldo_actual NUMERIC;
    v_id_pago INT;
BEGIN
    -- 1. Obtener saldo actual
    SELECT saldo_pendiente INTO v_saldo_actual FROM factura WHERE id_factura = p_id_factura;

    -- Validar que no pague de más
    IF v_saldo_actual < p_monto THEN
        RAISE EXCEPTION 'El abono ($%) es mayor a la deuda pendiente ($%)', p_monto, v_saldo_actual;
    END IF;

    -- 2. Insertar el pago
    INSERT INTO pago (id_factura, monto, forma_pago, referencia, notas)
    VALUES (p_id_factura, p_monto, p_forma_pago, p_referencia, p_notas)
    RETURNING id_pago INTO v_id_pago;

    -- 3. Actualizar saldo de la factura (AQUÍ ESTÁ LA CORRECCIÓN ::estatus_factura_enum)
    UPDATE factura 
    SET saldo_pendiente = saldo_pendiente - p_monto,
        estatus = CASE 
            WHEN (saldo_pendiente - p_monto) <= 0.01 
            THEN 'Pagada'::estatus_factura_enum  -- <--- CASTRAR A ENUM
            ELSE 'Pendiente'::estatus_factura_enum -- <--- CASTRAR A ENUM
        END
    WHERE id_factura = p_id_factura;

    RETURN v_id_pago;
END;
$_$;


--
-- Name: fn_registrar_pago_proveedor(integer, numeric, character varying, character varying, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_registrar_pago_proveedor(p_id_compra integer, p_monto numeric, p_forma_pago character varying, p_referencia character varying, p_notas text) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_saldo_actual NUMERIC;
    v_id_pago INT;
BEGIN
    -- Obtener saldo actual
    SELECT saldo_pendiente INTO v_saldo_actual FROM compra WHERE id_compra = p_id_compra;

    -- Validaciones
    IF v_saldo_actual IS NULL THEN 
        RAISE EXCEPTION 'La compra no tiene saldo inicializado.';
    END IF;

    IF v_saldo_actual < p_monto THEN
        RAISE EXCEPTION 'Estás pagando de más. Deuda actual: $%, Intentas pagar: $%', v_saldo_actual, p_monto;
    END IF;

    -- Insertar el pago
    INSERT INTO pago_proveedor (id_compra, monto, forma_pago, referencia, notas)
    VALUES (p_id_compra, p_monto, p_forma_pago, p_referencia, p_notas)
    RETURNING id_pago_proveedor INTO v_id_pago;

    -- Actualizar saldo de la compra
    UPDATE compra 
    SET saldo_pendiente = saldo_pendiente - p_monto,
        -- Cambiar estatus si se liquida
        estatus = CASE WHEN (saldo_pendiente - p_monto) <= 0.01 THEN 'Pagada' ELSE 'Pendiente' END
    WHERE id_compra = p_id_compra;

    RETURN v_id_pago;
END;
$_$;


--
-- Name: fn_resolucion_web_solo_insercion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_resolucion_web_solo_insercion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Las decisiones de solicitudes web no se editan ni se eliminan' USING ERRCODE='23514';
END;
$$;


--
-- Name: fn_scheduled_job_status(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_scheduled_job_status(p_now timestamp with time zone DEFAULT clock_timestamp()) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
SELECT coalesce(jsonb_agg(data ORDER BY name),'[]'::jsonb) FROM (
  SELECT j.name,jsonb_build_object(
    'name',j.name,'checkedAt',p_now,'expectedAt',s.expected,
    'lastSuccessAt',success.at,'overdue',
      s.expected>=j.installed_at AND p_now>=s.expected+make_interval(secs=>j.grace_seconds)
        AND (success.at IS NULL OR success.at<s.expected),
    'lastRun',(SELECT jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status)
      FROM operational_job_run WHERE job_name=j.name ORDER BY started_at DESC,id DESC LIMIT 1),
    'recentRuns',coalesce((SELECT jsonb_agg(r.data ORDER BY r.started_at DESC,r.id DESC) FROM
      (SELECT id,started_at,jsonb_build_object('id',id,'startedAt',started_at,'finishedAt',finished_at,'status',status) AS data
       FROM operational_job_run WHERE job_name=j.name ORDER BY started_at DESC,id DESC LIMIT 20) r),'[]'::jsonb)
  ) AS data FROM operational_job j
  CROSS JOIN LATERAL (SELECT to_timestamp(floor(extract(epoch FROM p_now)/j.interval_seconds)*j.interval_seconds) AS expected) s
  CROSS JOIN LATERAL (SELECT max(finished_at) AS at FROM operational_job_run WHERE job_name=j.name AND status='success') success
  WHERE j.interval_seconds IS NOT NULL
) rows;
$$;


--
-- Name: fn_sincronizar_existencia_ubicaciones(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sincronizar_existencia_ubicaciones() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_delta numeric(18,6);
  v_pendiente numeric(18,6);
  v_tomar numeric(18,6);
  v_id_general integer;
  v_id_pedido integer;
  v_fila record;
BEGIN
  IF COALESCE(current_setting('app.skip_location_stock_sync', true), 'false') = 'true' THEN RETURN NEW; END IF;
  v_delta := COALESCE(NEW."Existencia",0)-CASE WHEN TG_OP='INSERT' THEN 0 ELSE COALESCE(OLD."Existencia",0) END;
  IF abs(v_delta)<0.000001 THEN RETURN NEW; END IF;

  IF v_delta>0 THEN
    SELECT u.id_ubicacion INTO v_id_general FROM almacen_ubicacion u JOIN almacen a ON a.id_almacen=u.id_almacen
     WHERE a.es_principal AND u.activa AND u.codigo='GENERAL' ORDER BY u.id_ubicacion LIMIT 1;
    IF v_id_general IS NULL THEN RAISE EXCEPTION 'No existe la ubicación GENERAL del almacén principal'; END IF;
    INSERT INTO inventario_ubicacion(id_ubicacion,id_producto,cantidad) VALUES(v_id_general,NEW."IdProducto",v_delta)
    ON CONFLICT(id_ubicacion,id_producto) DO UPDATE SET cantidad=inventario_ubicacion.cantidad+excluded.cantidad,updated_at=now();
    RETURN NEW;
  END IF;

  v_pendiente := -v_delta;
  v_id_pedido := NULLIF(current_setting('app.current_order_id',true),'')::integer;
  IF v_id_pedido IS NOT NULL THEN
    FOR v_fila IN
      SELECT ps.id_surtido,ps.id_ubicacion,ps.cantidad-ps.cantidad_consumida AS cantidad
        FROM pedido_surtido_ubicacion ps
       WHERE ps.id_pedido=v_id_pedido AND ps.id_producto=NEW."IdProducto" AND ps.estado='Reservada'
       ORDER BY ps.id_surtido FOR UPDATE OF ps
    LOOP
      EXIT WHEN v_pendiente<0.000001;
      v_tomar:=LEAST(v_pendiente,v_fila.cantidad);
      UPDATE inventario_ubicacion SET cantidad=cantidad-v_tomar,updated_at=now()
       WHERE id_ubicacion=v_fila.id_ubicacion AND id_producto=NEW."IdProducto" AND cantidad>=v_tomar;
      IF NOT FOUND THEN RAISE EXCEPTION 'Existencia insuficiente en la ubicación surtida para el producto %',NEW."IdProducto"; END IF;
      UPDATE pedido_surtido_ubicacion SET cantidad_consumida=cantidad_consumida+v_tomar,
        estado=CASE WHEN cantidad_consumida+v_tomar>=cantidad THEN 'Consumida' ELSE estado END,updated_at=now()
       WHERE id_surtido=v_fila.id_surtido;
      v_pendiente:=v_pendiente-v_tomar;
    END LOOP;
  END IF;

  FOR v_fila IN
    SELECT i.id_ubicacion,i.cantidad FROM inventario_ubicacion i
    JOIN almacen_ubicacion u ON u.id_ubicacion=i.id_ubicacion JOIN almacen a ON a.id_almacen=u.id_almacen
    WHERE i.id_producto=NEW."IdProducto" AND i.cantidad>0
    ORDER BY(a.es_principal AND u.codigo='GENERAL')DESC,a.es_principal DESC,i.id_ubicacion FOR UPDATE OF i
  LOOP
    EXIT WHEN v_pendiente<0.000001;
    v_tomar:=LEAST(v_pendiente,v_fila.cantidad);
    UPDATE inventario_ubicacion SET cantidad=cantidad-v_tomar,updated_at=now()
     WHERE id_ubicacion=v_fila.id_ubicacion AND id_producto=NEW."IdProducto";
    v_pendiente:=v_pendiente-v_tomar;
  END LOOP;
  IF v_pendiente>=0.000001 THEN RAISE EXCEPTION 'Existencia por ubicaciones insuficiente para el producto %',NEW."IdProducto"; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_sincronizar_existencia_ubicaciones(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_sincronizar_existencia_ubicaciones() IS 'Sincroniza automáticamente cada cambio de existencia global con el inventario físico por ubicación.';


--
-- Name: fn_sync_ingreso_saldos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_ingreso_saldos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.forma_pago ILIKE '%Efectivo%' THEN
        UPDATE saldos SET caja_chica = caja_chica + NEW.monto, updated_at = NOW();
    ELSE
        UPDATE saldos SET cuenta_banco = cuenta_banco + NEW.monto, updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: fn_sync_pago_proveedor_saldos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_pago_proveedor_saldos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.forma_pago ILIKE '%Efectivo%' THEN
    UPDATE saldos SET caja_chica=caja_chica-NEW.monto,updated_at=now();
  ELSE
    UPDATE saldos SET cuenta_banco=cuenta_banco-NEW.monto,updated_at=now();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_sync_poliza_compra(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_compra() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_compra(coalesce(NEW.id_compra,OLD.id_compra)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_concepto(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_concepto() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_factura(coalesce(NEW.id_factura,OLD.id_factura)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_detalle_compra(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_detalle_compra() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_compra(coalesce(NEW.id_compra,OLD.id_compra)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_factura(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_factura() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_factura(coalesce(NEW.id_factura,OLD.id_factura)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_factura_proveedor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_factura_proveedor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_poliza_factura_proveedor(coalesce(NEW.id_factura_proveedor,OLD.id_factura_proveedor)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_gasto(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_gasto() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_gasto(coalesce(NEW.id_gasto,OLD.id_gasto)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_pago(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_pago() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_pago(coalesce(NEW.id_pago,OLD.id_pago)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_poliza_pago_proveedor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_poliza_pago_proveedor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN PERFORM fn_reconstruir_poliza_pago_proveedor(coalesce(NEW.id_pago_proveedor,OLD.id_pago_proveedor)); RETURN coalesce(NEW,OLD); END $$;


--
-- Name: fn_sync_reverso_saldos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_reverso_saldos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.forma_pago ILIKE '%Efectivo%' THEN
    UPDATE saldos SET caja_chica = caja_chica - OLD.monto, updated_at = NOW();
  ELSE
    UPDATE saldos SET cuenta_banco = cuenta_banco - OLD.monto, updated_at = NOW();
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: FUNCTION fn_sync_reverso_saldos(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_sync_reverso_saldos() IS 'Revierte caja/banco cuando se elimina un pago dentro de una cancelación transaccional.';


--
-- Name: fn_update_categoria(integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_categoria(p_id_categoria integer, p_descripcion character varying) RETURNS public.categoria
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_categoria_actualizada "categoria";
BEGIN
    UPDATE "categoria"
    SET "Descripcion" = p_descripcion
    WHERE "IdCategoria" = p_id_categoria
    RETURNING * INTO v_categoria_actualizada;
    
    RETURN v_categoria_actualizada;
END;
$$;


--
-- Name: fn_update_cliente(integer, character varying, character varying, character varying, integer, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_cliente(p_id_cliente integer, p_rfc character varying, p_razon_social character varying, p_pais character varying, p_id_estado integer, p_id_municipio integer, p_ciudad character varying, p_colonia character varying, p_calle character varying, p_codigo_postal character varying, p_num_ext character varying, p_num_int character varying, p_referencia character varying, p_id_metodo_pago integer, p_id_uso_cfdi integer, p_id_forma_pago integer, p_id_regimen_fiscal integer) RETURNS public.cliente
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cliente_actualizado "cliente";
BEGIN
    UPDATE "cliente"
    SET
        "RFC" = p_rfc,
        "RazonSocial" = p_razon_social,
        "Pais" = p_pais,
        "IdEstado" = p_id_estado,
        "IdMunicipio" = p_id_municipio,
        "Ciudad" = p_ciudad,
        "Colonia" = p_colonia,
        "Calle" = p_calle,
        "CodigoPostal" = p_codigo_postal,
        "NumeroExterior" = p_num_ext,
        "NumeroInterior" = p_num_int,
        "Referencia" = p_referencia,
        "IdMetodoDePago" = p_id_metodo_pago,
        "IdUsoCFDI" = p_id_uso_cfdi,
        "IdFormaPago" = p_id_forma_pago,
        "IdRegimenFiscal" = p_id_regimen_fiscal
    WHERE 
        "IdCliente" = p_id_cliente
    RETURNING * INTO v_cliente_actualizado;
    
    RETURN v_cliente_actualizado;
END;
$$;


--
-- Name: fn_update_cliente(integer, character varying, character varying, character varying, integer, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, integer, integer, integer, integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_cliente(p_id_cliente integer, p_rfc character varying, p_razon_social character varying, p_pais character varying, p_id_estado integer, p_id_municipio integer, p_ciudad character varying, p_colonia character varying, p_calle character varying, p_codigo_postal character varying, p_num_ext character varying, p_num_int character varying, p_referencia character varying, p_id_metodo_pago integer, p_id_uso_cfdi integer, p_id_forma_pago integer, p_id_regimen_fiscal integer, p_email character varying) RETURNS SETOF public.cliente
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    UPDATE cliente SET
        "RFC" = p_rfc,
        "RazonSocial" = p_razon_social,
        "Pais" = p_pais,
        "IdEstado" = p_id_estado,
        "IdMunicipio" = p_id_municipio,
        "Ciudad" = p_ciudad,
        "Colonia" = p_colonia,
        "Calle" = p_calle,
        "CodigoPostal" = p_codigo_postal,
        "NumeroExterior" = p_num_ext,
        "NumeroInterior" = p_num_int,
        "Referencia" = p_referencia,
        "IdMetodoDePago" = p_id_metodo_pago,
        "IdUsoCFDI" = p_id_uso_cfdi,
        "IdFormaPago" = p_id_forma_pago,
        "IdRegimenFiscal" = p_id_regimen_fiscal,
        email = p_email -- <--- ACTUALIZAR CAMPO
    WHERE "IdCliente" = p_id_cliente
    RETURNING *;
END;
$$;


--
-- Name: fn_update_producto(integer, character varying, integer, integer, character varying, numeric, integer, character varying, integer, integer, character varying, character varying, numeric, boolean, boolean, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_producto(p_id_producto integer, p_codigo character varying, p_id_unidad integer, p_id_objeto_impuesto integer, p_descripcion character varying, p_precio_unitario numeric, p_id_categoria integer, p_ubicacion character varying, p_id_clave_prod_o_serv integer, p_id_clave_unidad integer, p_marca character varying, p_objeto_impuesto_sat character varying DEFAULT '02'::character varying, p_tasa_iva numeric DEFAULT 0.16, p_aplica_retencion_isr boolean DEFAULT false, p_aplica_retencion_iva boolean DEFAULT false, p_imagenes jsonb DEFAULT '[]'::jsonb) RETURNS TABLE("IdProducto" integer, "Codigo" character varying, "IdUnidad" integer, "IdObjetoImpuesto" integer, "Descripcion" character varying, "PrecioUnitario" numeric, "IdCategoria" integer, "Ubicacion" character varying, "IdClaveProdOServ" integer, "IdClaveUnidad" integer, "Marca" character varying, "ObjetoImpuesto" character varying, "TasaIVA" numeric, "AplicaRetencionISR" boolean, "AplicaRetencionIVA" boolean, imagenes jsonb)
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE "producto"
    SET 
        "Codigo" = p_codigo,
        "IdUnidad" = p_id_unidad,
        "IdObjetoImpuesto" = p_id_objeto_impuesto,
        "Descripcion" = p_descripcion,
        "PrecioUnitario" = p_precio_unitario,
        "IdCategoria" = p_id_categoria,
        "Ubicacion" = p_ubicacion,
        "IdClaveProdOServ" = p_id_clave_prod_o_serv,
        "IdClaveUnidad" = p_id_clave_unidad,
        "Marca" = p_marca,
        "ObjetoImpuesto" = p_objeto_impuesto_sat,
        "TasaIVA" = p_tasa_iva,
        "AplicaRetencionISR" = p_aplica_retencion_isr,
        "AplicaRetencionIVA" = p_aplica_retencion_iva,
        "imagenes" = p_imagenes
    WHERE "producto"."IdProducto" = p_id_producto;

    RETURN QUERY
    SELECT 
        p."IdProducto", p."Codigo", p."IdUnidad", p."IdObjetoImpuesto", p."Descripcion", 
        p."PrecioUnitario", p."IdCategoria", p."Ubicacion", p."IdClaveProdOServ", 
        p."IdClaveUnidad", p."Marca", p."ObjetoImpuesto", p."TasaIVA", 
        p."AplicaRetencionISR", p."AplicaRetencionIVA", p."imagenes"
    FROM "producto" p
    WHERE p."IdProducto" = p_id_producto;
END;
$$;


--
-- Name: fn_update_producto(integer, character varying, integer, integer, character varying, numeric, integer, character varying, integer, integer, character varying, character varying, numeric, boolean, boolean, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_producto(p_id_producto integer, p_codigo character varying, p_id_unidad integer, p_id_objeto_impuesto integer, p_descripcion character varying, p_precio_unitario numeric, p_id_categoria integer, p_ubicacion character varying, p_id_clave_prod_serv integer, p_id_clave_unidad integer, p_marca character varying, p_objeto_impuesto_sat character varying, p_tasa_iva numeric, p_aplica_retencion_isr boolean, p_aplica_retencion_iva boolean, p_imagen_url character varying) RETURNS SETOF public.producto
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    UPDATE "producto" SET
        "Codigo" = p_codigo,
        "IdUnidad" = p_id_unidad,
        "IdObjetoImpuesto" = p_id_objeto_impuesto,
        "Descripcion" = p_descripcion,
        "PrecioUnitario" = p_precio_unitario,
        "IdCategoria" = p_id_categoria,
        "Ubicacion" = p_ubicacion,
        "IdClaveProdOServ" = p_id_clave_prod_serv,
        "IdClaveUnidad" = p_id_clave_unidad,
        "Marca" = p_marca,
        "ObjetoImpuesto" = p_objeto_impuesto_sat,
        "TasaIVA" = p_tasa_iva,
        "AplicaRetencionISR" = p_aplica_retencion_isr,
        "AplicaRetencionIVA" = p_aplica_retencion_iva,
        "imagen_url" = p_imagen_url
    WHERE "IdProducto" = p_id_producto
    RETURNING *;
END;
$$;


--
-- Name: fn_update_proveedor(integer, character varying, character varying, character varying, integer, integer, character varying, character varying, character varying, character varying, character varying, character varying, character varying, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_proveedor(p_id_proveedor integer, p_rfc character varying, p_razon_social character varying, p_pais character varying, p_id_estado integer, p_id_municipio integer, p_ciudad character varying, p_colonia character varying, p_calle character varying, p_codigo_postal character varying, p_num_ext character varying, p_num_int character varying, p_referencia character varying, p_id_metodo_pago integer, p_id_uso_cfdi integer, p_id_forma_pago integer, p_id_regimen_fiscal integer) RETURNS public.proveedor
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_proveedor_actualizado "proveedor";
BEGIN
    UPDATE "proveedor"
    SET
        "RFC" = p_rfc,
        "RazonSocial" = p_razon_social,
        "Pais" = p_pais,
        "IdEstado" = p_id_estado,
        "IdMunicipio" = p_id_municipio,
        "Ciudad" = p_ciudad,
        "Colonia" = p_colonia,
        "Calle" = p_calle,
        "CodigoPostal" = p_codigo_postal,
        "NumeroExterior" = p_num_ext,
        "NumeroInterior" = p_num_int,
        "Referencia" = p_referencia,
        "IdMetodoDePago" = p_id_metodo_pago,
        "IdUsoCFDI" = p_id_uso_cfdi,
        "IdFormaPago" = p_id_forma_pago,
        "IdRegimenFiscal" = p_id_regimen_fiscal
    WHERE 
        "IdProveedor" = p_id_proveedor
    RETURNING * INTO v_proveedor_actualizado;
    
    RETURN v_proveedor_actualizado;
END;
$$;


--
-- Name: fn_validar_cancelacion_financiera(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_cancelacion_financiera() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.estatus::text <> 'Cancelada' OR OLD.estatus::text = 'Cancelada' THEN RETURN NEW; END IF;
  IF OLD.id_factura_global IS NOT NULL THEN
    RAISE EXCEPTION 'Cancela primero la factura global que agrupa este ticket';
  END IF;
  IF EXISTS (SELECT 1 FROM rep_factura rf JOIN rep r ON r.id_rep=rf.id_rep
              WHERE rf.id_factura=OLD.id_factura AND r.estado <> 'Cancelado') THEN
    RAISE EXCEPTION 'Cancela primero los REP vigentes de la factura';
  END IF;
  IF EXISTS (SELECT 1 FROM factura nc WHERE nc.id_factura_origen=OLD.id_factura
              AND nc.estatus::text <> 'Cancelada') THEN
    RAISE EXCEPTION 'Cancela primero las notas de crédito vigentes de la factura';
  END IF;
  IF EXISTS (SELECT 1 FROM garantia WHERE id_factura=OLD.id_factura AND estado NOT IN ('Rechazada','Cerrada')) THEN
    RAISE EXCEPTION 'Resuelve las garantías abiertas antes de cancelar la factura';
  END IF;
  IF OLD.tipo_comprobante = 'E' THEN
    IF OLD.id_factura_origen IS NULL OR OLD.metodo_reembolso IS NULL THEN
      RAISE EXCEPTION 'Nota de crédito histórica sin vínculo financiero: requiere conciliación antes de cancelarse';
    END IF;
    IF OLD.metodo_reembolso = 'Saldo a Favor' THEN
      UPDATE cliente SET saldo_a_favor = saldo_a_favor - OLD.total
        WHERE "IdCliente" = OLD.id_cliente AND saldo_a_favor >= OLD.total;
      IF NOT FOUND THEN RAISE EXCEPTION 'El saldo a favor ya se utilizó; concilia antes de cancelar'; END IF;
    ELSIF OLD.metodo_reembolso = 'Efectivo' THEN
      IF OLD.id_gasto_reembolso IS NULL THEN
        RAISE EXCEPTION 'No se encontró el gasto del reembolso';
      END IF;
      -- La factura mantiene el vínculo para auditoría; el gasto se marca anulado
      -- y los reportes lo excluyen. No se borra la evidencia del desembolso.
      UPDATE gasto SET anulado = true WHERE id_gasto = OLD.id_gasto_reembolso AND NOT anulado;
      IF NOT FOUND THEN RAISE EXCEPTION 'El gasto del reembolso ya fue revertido'; END IF;
      UPDATE saldos SET caja_chica = caja_chica + OLD.total, updated_at=now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_validar_devolucion_pagada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_devolucion_pagada() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_factura factura%ROWTYPE;
BEGIN
  SELECT * INTO v_factura FROM factura WHERE id_factura=NEW.id_factura FOR UPDATE;
  IF v_factura.saldo_pendiente <> 0 THEN
    RAISE EXCEPTION 'Liquida o concilia el saldo de la factura antes de reembolsar';
  END IF;
  IF v_factura.id_factura_global IS NOT NULL OR v_factura.serie='G' THEN
    RAISE EXCEPTION 'Cancela o concilia la factura global antes de devolver sus tickets';
  END IF;
  IF EXISTS (SELECT 1 FROM factura WHERE id_factura_origen=NEW.id_factura AND estatus::text <> 'Cancelada') THEN
    RAISE EXCEPTION 'La factura ya tiene notas de crédito: continúa con ese flujo';
  END IF;
  IF EXISTS (SELECT 1 FROM garantia WHERE id_factura=NEW.id_factura AND estado NOT IN ('Rechazada','Cerrada')) THEN
    RAISE EXCEPTION 'Resuelve las garantías abiertas antes de devolver la factura';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: product_application_text(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_application_text(parts text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$SELECT concat_ws(' ',VARIADIC parts)$$;


--
-- Name: sp_ajustar_inventario(integer, numeric, character varying, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_ajustar_inventario(IN p_id_producto integer, IN p_cantidad numeric, IN p_tipo character varying, IN p_motivo character varying)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_existencia_actual NUMERIC;
  v_stock_resultante NUMERIC;
  v_kardex_cantidad NUMERIC;
  v_precio_unitario NUMERIC;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a ajustar debe ser mayor a cero.';
  END IF;
  IF p_tipo NOT IN ('ENTRADA POR AJUSTE', 'SALIDA POR MERMA/AJUSTE') THEN
    RAISE EXCEPTION 'Tipo de movimiento no válido.';
  END IF;
  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo del ajuste es obligatorio.';
  END IF;

  SELECT "Existencia", "PrecioUnitario"
    INTO v_existencia_actual, v_precio_unitario
    FROM producto WHERE "IdProducto" = p_id_producto FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado.'; END IF;

  IF p_tipo = 'ENTRADA POR AJUSTE' THEN
    v_kardex_cantidad := p_cantidad;
  ELSE
    v_kardex_cantidad := -p_cantidad;
  END IF;
  v_stock_resultante := v_existencia_actual + v_kardex_cantidad;
  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION 'El ajuste dejaría stock negativo (%).', v_stock_resultante;
  END IF;

  UPDATE producto SET "Existencia" = v_stock_resultante
   WHERE "IdProducto" = p_id_producto;
  INSERT INTO kardex (
    id_producto, tipo_movimiento, cantidad, stock_anterior,
    stock_resultante, precio_unitario, referencia
  ) VALUES (
    p_id_producto, p_tipo::tipo_movimiento_enum, v_kardex_cantidad,
    v_existencia_actual, v_stock_resultante, v_precio_unitario, TRIM(p_motivo)
  );
END;
$$;


--
-- Name: sp_cancelar_factura(integer, integer); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_cancelar_factura(IN p_id_venta integer, IN p_id_user integer DEFAULT NULL::integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_estatus varchar;
  v_tipo_comprobante char(1);
  v_item record;
  v_stock_anterior numeric;
  v_stock_resultante numeric;
  v_delta numeric;
  v_tipo_movimiento tipo_movimiento_enum;
  v_managed text;
BEGIN
  PERFORM set_config('app.current_user_id', COALESCE(p_id_user::text, ''), true);

  SELECT estatus::varchar, tipo_comprobante
    INTO v_estatus, v_tipo_comprobante
    FROM factura
   WHERE id_factura = p_id_venta
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF v_estatus = 'Cancelada' THEN
    RAISE EXCEPTION 'La factura ya se encuentra cancelada';
  END IF;
  IF EXISTS (SELECT 1 FROM devolucion WHERE id_factura = p_id_venta) THEN
    RAISE EXCEPTION 'La factura tiene devoluciones parciales; concílialas antes de cancelarla';
  END IF;

  -- Orden estable para evitar interbloqueos cuando dos movimientos comparten productos.
  PERFORM p."IdProducto"
    FROM producto p
   WHERE EXISTS (
     SELECT 1 FROM conceptofactura cf
      WHERE cf.id_factura = p_id_venta
        AND cf.id_producto = p."IdProducto"
   )
   ORDER BY p."IdProducto"
   FOR UPDATE OF p;

  FOR v_item IN
    SELECT id_producto, SUM(cantidad) AS cantidad, MAX(valor_unitario) AS valor_unitario
      FROM conceptofactura
     WHERE id_factura = p_id_venta AND id_producto IS NOT NULL
     GROUP BY id_producto
     ORDER BY id_producto
  LOOP
    SELECT "Existencia" INTO v_stock_anterior
      FROM producto WHERE "IdProducto" = v_item.id_producto;

    IF v_tipo_comprobante = 'E' THEN
      v_delta := -v_item.cantidad;
      v_tipo_movimiento := 'VENTA'::tipo_movimiento_enum;
    ELSE
      v_delta := v_item.cantidad;
      v_tipo_movimiento := 'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum;
    END IF;

    v_stock_resultante := v_stock_anterior + v_delta;
    IF v_stock_resultante < 0 THEN
      RAISE EXCEPTION
        'No se puede cancelar: el producto % quedaría con stock negativo (%)',
        v_item.id_producto, v_stock_resultante;
    END IF;

    v_managed:=current_setting('app.stock_movement_managed',true);
    PERFORM set_config('app.stock_movement_managed','true',true);
    UPDATE producto SET "Existencia" = v_stock_resultante
     WHERE "IdProducto" = v_item.id_producto;
    PERFORM set_config('app.stock_movement_managed',coalesce(nullif(v_managed,''),'false'),true);

    INSERT INTO kardex (
      id_producto, fecha, tipo_movimiento, cantidad, stock_anterior,
      stock_resultante, precio_unitario, referencia, id_referencia
    ) VALUES (
      v_item.id_producto, NOW(), v_tipo_movimiento, v_delta, v_stock_anterior,
      v_stock_resultante, v_item.valor_unitario,
      CASE WHEN v_tipo_comprobante = 'E'
        THEN 'Cancelación de nota de crédito'
        ELSE 'Cancelación de factura'
      END,
      p_id_venta
    );
  END LOOP;

  UPDATE factura
     SET estatus = 'Cancelada'::estatus_factura_enum,
         saldo_pendiente = 0,
         comision_vendedor = 0
   WHERE id_factura = p_id_venta;

  DELETE FROM pago WHERE id_factura = p_id_venta;
  UPDATE factura SET id_factura_global = NULL WHERE id_factura_global = p_id_venta;
END;
$$;


--
-- Name: PROCEDURE sp_cancelar_factura(IN p_id_venta integer, IN p_id_user integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_cancelar_factura(IN p_id_venta integer, IN p_id_user integer) IS 'Cancela una factura con bloqueo de filas, revierte inventario según el tipo y conserva el usuario.';


--
-- Name: sp_procesar_devolucion_parcial(integer, character varying, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_procesar_devolucion_parcial(p_id_factura integer, p_metodo_reembolso character varying, p_articulos jsonb, p_id_user integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id integer; v_factura factura%ROWTYPE; v_item jsonb;
  v_producto integer; v_cantidad numeric; v_vendido numeric; v_devuelto numeric;
  v_importe_previo numeric; v_total_linea numeric; v_importe numeric;
  v_total numeric(14,2):=0; v_stock numeric; v_gasto integer; v_managed text;
BEGIN
  IF p_metodo_reembolso IS NULL OR p_metodo_reembolso NOT IN ('Efectivo','Saldo a Favor') THEN
    RAISE EXCEPTION 'Método de reembolso no válido';
  END IF;
  IF p_articulos IS NULL OR jsonb_typeof(p_articulos)<>'array' OR jsonb_array_length(p_articulos)=0 THEN
    RAISE EXCEPTION 'Incluye al menos un artículo para devolver';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_articulos) x GROUP BY x->>'idProducto' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'No repitas productos dentro de la devolución';
  END IF;
  PERFORM set_config('app.current_user_id',coalesce(p_id_user::text,''),true);
  SELECT * INTO v_factura FROM factura WHERE id_factura=p_id_factura FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF v_factura.estatus::text='Cancelada' OR v_factura.tipo_comprobante<>'I' THEN
    RAISE EXCEPTION 'Solo se admiten devoluciones sobre facturas de ingreso vigentes';
  END IF;
  IF v_factura.id_cliente IS NULL THEN RAISE EXCEPTION 'La factura no tiene cliente asignado'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_articulos) LOOP
    v_producto:=(v_item->>'idProducto')::integer;
    v_cantidad:=(v_item->>'cantidad')::numeric;
    IF v_producto IS NULL OR v_producto<1 OR v_cantidad IS NULL OR v_cantidad<=0 OR v_cantidad<>round(v_cantidad,4) THEN
      RAISE EXCEPTION 'Producto y cantidad deben ser válidos (máximo cuatro decimales)';
    END IF;
  END LOOP;
  PERFORM p."IdProducto" FROM producto p WHERE p."IdProducto" IN
    (SELECT (value->>'idProducto')::integer FROM jsonb_array_elements(p_articulos))
    ORDER BY p."IdProducto" FOR UPDATE;
  INSERT INTO devolucion(id_factura,metodo_reembolso) VALUES(p_id_factura,p_metodo_reembolso)
    RETURNING id_devolucion INTO v_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_articulos) ORDER BY (value->>'idProducto')::integer LOOP
    v_producto:=(v_item->>'idProducto')::integer;
    v_cantidad:=(v_item->>'cantidad')::numeric;
    SELECT sum(cantidad), sum(importe-coalesce(descuento,0)+coalesce(importe_iva,0)-coalesce(importe_ret_isr,0))
      INTO v_vendido,v_total_linea FROM conceptofactura WHERE id_factura=p_id_factura AND id_producto=v_producto;
    IF v_vendido IS NULL THEN RAISE EXCEPTION 'El producto % no pertenece a la factura',v_producto; END IF;
    SELECT coalesce(sum(dd.cantidad),0),coalesce(sum(dd.importe_reembolso),0)
      INTO v_devuelto,v_importe_previo FROM devolucion_detalle dd
      JOIN devolucion d ON d.id_devolucion=dd.id_devolucion
      WHERE d.id_factura=p_id_factura AND dd.id_producto=v_producto;
    IF v_devuelto+v_cantidad>v_vendido THEN RAISE EXCEPTION 'La devolución excede la cantidad vendida del producto %',v_producto; END IF;
    v_importe:=round(v_total_linea*(v_devuelto+v_cantidad)/v_vendido,2)-v_importe_previo;
    IF v_importe<0 THEN RAISE EXCEPTION 'Reembolsos históricos inconsistentes; concilia la factura'; END IF;
    v_total:=v_total+v_importe;
    INSERT INTO devolucion_detalle(id_devolucion,id_producto,cantidad,precio_unitario,importe_reembolso)
      VALUES(v_id,v_producto,v_cantidad,round(v_importe/v_cantidad,2),v_importe);
    SELECT "Existencia" INTO v_stock FROM producto WHERE "IdProducto"=v_producto;
    v_managed:=current_setting('app.stock_movement_managed',true);
    PERFORM set_config('app.stock_movement_managed','true',true);
    UPDATE producto SET "Existencia"=v_stock+v_cantidad WHERE "IdProducto"=v_producto;
    PERFORM set_config('app.stock_movement_managed',coalesce(nullif(v_managed,''),'false'),true);
    INSERT INTO kardex(id_producto,fecha,tipo_movimiento,cantidad,stock_anterior,stock_resultante,precio_unitario,referencia,id_referencia)
      VALUES(v_producto,now(),'ENTRADA POR DEVOLUCION'::tipo_movimiento_enum,v_cantidad,v_stock,v_stock+v_cantidad,
        round(v_importe/v_cantidad,2),'Devolución parcial',p_id_factura);
  END LOOP;
  UPDATE devolucion SET monto_total=v_total WHERE id_devolucion=v_id;
  IF p_metodo_reembolso='Saldo a Favor' THEN
    UPDATE cliente SET saldo_a_favor=saldo_a_favor+v_total WHERE "IdCliente"=v_factura.id_cliente;
  ELSIF v_total>0 THEN
    INSERT INTO gasto(concepto,monto,categoria,metodo_pago,id_user)
      VALUES('DEVOLUCIÓN EFECTIVO FACTURA '||p_id_factura,v_total,'Devoluciones y Reembolsos','Efectivo',p_id_user)
      RETURNING id_gasto INTO v_gasto;
    UPDATE devolucion SET id_gasto_reembolso=v_gasto WHERE id_devolucion=v_id;
  END IF;
  RETURN v_id;
END;
$$;


--
-- Name: FUNCTION sp_procesar_devolucion_parcial(p_id_factura integer, p_metodo_reembolso character varying, p_articulos jsonb, p_id_user integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sp_procesar_devolucion_parcial(p_id_factura integer, p_metodo_reembolso character varying, p_articulos jsonb, p_id_user integer) IS 'Devuelve solo cantidades originalmente vendidas y calcula el reembolso desde la factura.';


--
-- Name: sp_refresh_analytics_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_refresh_analytics_views() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM fn_capturar_valor_inventario_diario();
  REFRESH MATERIALIZED VIEW mv_ventas_facturacion;
  REFRESH MATERIALIZED VIEW mv_inventario_almacen;
  REFRESH MATERIALIZED VIEW mv_clientes_cobranza;
  REFRESH MATERIALIZED VIEW mv_operaciones_avanzadas;
END;
$$;


--
-- Name: update_auth_user_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_auth_user_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: almacen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.almacen (
    id_almacen integer NOT NULL,
    codigo character varying(20) NOT NULL,
    nombre character varying(100) NOT NULL,
    direccion character varying(300),
    activo boolean DEFAULT true NOT NULL,
    es_principal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: almacen_id_almacen_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.almacen ALTER COLUMN id_almacen ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.almacen_id_almacen_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: almacen_picking_verificacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.almacen_picking_verificacion (
    id uuid NOT NULL,
    id_pedido integer NOT NULL,
    id_surtido bigint NOT NULL,
    accion character varying(10) NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    id_anulada uuid,
    metodo character varying(10),
    motivo character varying(300),
    id_actor integer NOT NULL,
    huella character(64) NOT NULL,
    snapshot jsonb NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT almacen_picking_verificacion_accion_check CHECK (((accion)::text = ANY ((ARRAY['Verificar'::character varying, 'Anular'::character varying])::text[]))),
    CONSTRAINT almacen_picking_verificacion_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT almacen_picking_verificacion_check CHECK (((((accion)::text = 'Verificar'::text) AND (id_anulada IS NULL) AND (metodo IS NOT NULL) AND (motivo IS NULL)) OR (((accion)::text = 'Anular'::text) AND (id_anulada IS NOT NULL) AND (metodo IS NULL) AND (length(TRIM(BOTH FROM motivo)) > 0)))),
    CONSTRAINT almacen_picking_verificacion_huella_check CHECK ((huella ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT almacen_picking_verificacion_metodo_check CHECK (((metodo)::text = ANY ((ARRAY['Manual'::character varying, 'Lector'::character varying, 'Camara'::character varying])::text[]))),
    CONSTRAINT almacen_picking_verificacion_snapshot_check CHECK (((jsonb_typeof(snapshot) = 'object'::text) AND (octet_length((snapshot)::text) <= 8192)))
);


--
-- Name: almacen_ubicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.almacen_ubicacion (
    id_ubicacion integer NOT NULL,
    id_almacen integer NOT NULL,
    codigo character varying(50) NOT NULL,
    zona character varying(50),
    pasillo character varying(30),
    anaquel character varying(30),
    nivel character varying(30),
    contenedor character varying(50),
    activa boolean DEFAULT true NOT NULL
);


--
-- Name: almacen_ubicacion_id_ubicacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.almacen_ubicacion ALTER COLUMN id_ubicacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.almacen_ubicacion_id_ubicacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: analytics_inventario_diario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_inventario_diario (
    fecha date NOT NULL,
    capturado_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    valor numeric(24,6),
    productos_sin_costo integer NOT NULL,
    CONSTRAINT analytics_inventario_diario_productos_sin_costo_check CHECK ((productos_sin_costo >= 0))
);


--
-- Name: anticipo_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anticipo_proveedor (
    id_anticipo bigint NOT NULL,
    request_id uuid NOT NULL,
    id_proveedor integer NOT NULL,
    fecha date NOT NULL,
    monto numeric(18,2) NOT NULL,
    saldo_disponible numeric(18,2) NOT NULL,
    forma_pago character varying(40) NOT NULL,
    referencia character varying(120),
    estado character varying(15) DEFAULT 'Disponible'::character varying NOT NULL,
    notas character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT anticipo_proveedor_estado_check CHECK (((estado)::text = ANY ((ARRAY['Disponible'::character varying, 'Aplicado'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT anticipo_proveedor_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT anticipo_proveedor_saldo_disponible_check CHECK ((saldo_disponible >= (0)::numeric))
);


--
-- Name: anticipo_proveedor_id_anticipo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.anticipo_proveedor_id_anticipo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: anticipo_proveedor_id_anticipo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.anticipo_proveedor_id_anticipo_seq OWNED BY public.anticipo_proveedor.id_anticipo;


--
-- Name: aplicacion_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aplicacion_proveedor (
    id_aplicacion bigint NOT NULL,
    id_factura_proveedor bigint NOT NULL,
    tipo character varying(12) NOT NULL,
    id_nota bigint,
    id_anticipo bigint,
    monto numeric(18,2) NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    estado character varying(12) DEFAULT 'Activa'::character varying NOT NULL,
    revertida_por integer,
    revertida_at timestamp with time zone,
    motivo_reversion character varying(1000),
    CONSTRAINT aplicacion_proveedor_check CHECK (((((tipo)::text = 'NotaCredito'::text) AND (id_nota IS NOT NULL) AND (id_anticipo IS NULL)) OR (((tipo)::text = 'Anticipo'::text) AND (id_anticipo IS NOT NULL) AND (id_nota IS NULL)))),
    CONSTRAINT aplicacion_proveedor_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Revertida'::character varying])::text[]))),
    CONSTRAINT aplicacion_proveedor_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT aplicacion_proveedor_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['NotaCredito'::character varying, 'Anticipo'::character varying])::text[])))
);


--
-- Name: aplicacion_proveedor_id_aplicacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.aplicacion_proveedor_id_aplicacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: aplicacion_proveedor_id_aplicacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.aplicacion_proveedor_id_aplicacion_seq OWNED BY public.aplicacion_proveedor.id_aplicacion;


--
-- Name: app_access_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_access_profile (
    id_profile integer NOT NULL,
    name character varying(80) NOT NULL,
    description character varying(500) DEFAULT ''::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT app_access_profile_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT app_access_profile_version_check CHECK ((version > 0))
);


--
-- Name: app_access_profile_id_profile_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.app_access_profile ALTER COLUMN id_profile ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_access_profile_id_profile_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: app_access_profile_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_access_profile_permission (
    id_profile integer NOT NULL,
    permission_code character varying(80) NOT NULL
);


--
-- Name: app_notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_notification (
    id_notification bigint NOT NULL,
    id_user integer NOT NULL,
    type character varying(40) NOT NULL,
    title character varying(160) NOT NULL,
    message character varying(500) NOT NULL,
    severity character varying(12) DEFAULT 'info'::character varying NOT NULL,
    route character varying(240),
    source_type character varying(50),
    source_id bigint,
    dedupe_key character varying(180) NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT app_notification_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: app_notification_id_notification_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.app_notification ALTER COLUMN id_notification ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.app_notification_id_notification_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: app_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_permission (
    code character varying(80) NOT NULL,
    description character varying(240) NOT NULL
);


--
-- Name: app_role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_role_permission (
    role character varying(20) NOT NULL,
    permission_code character varying(80) NOT NULL,
    CONSTRAINT app_role_permission_role_chk CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'user'::character varying])::text[])))
);


--
-- Name: app_user_access_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_access_profile (
    id_user integer NOT NULL,
    id_profile integer NOT NULL
);


--
-- Name: app_user_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_permission (
    id_user integer NOT NULL,
    permission_code character varying(80) NOT NULL,
    granted boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: TABLE app_user_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_user_permission IS 'Conceder o negar permisos por usuario; prevalece sobre el permiso heredado del rol';


--
-- Name: auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria (
    "IdAuditoria" integer NOT NULL,
    "TablaAfectada" character varying(50) NOT NULL,
    "IdRegistroAfectado" integer,
    "Operacion" public.operacion_enum NOT NULL,
    "Fecha" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "Usuario" character varying(50),
    "IP" character varying(45),
    "Detalles" text
);


--
-- Name: auditoria_IdAuditoria_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auditoria ALTER COLUMN "IdAuditoria" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."auditoria_IdAuditoria_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auditoria_jsonb; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_jsonb (
    id integer NOT NULL,
    table_name character varying(100) NOT NULL,
    action character varying(20) NOT NULL,
    old_record jsonb,
    new_record jsonb,
    db_user character varying(100) DEFAULT CURRENT_USER,
    "timestamp" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    app_user_id integer,
    actor_name text,
    protection_version smallint DEFAULT 0 NOT NULL,
    credential_changed boolean
);


--
-- Name: COLUMN auditoria_jsonb.protection_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auditoria_jsonb.protection_version IS '0: histórico sin instantánea retroactiva;1: evento nuevo enriquecido. Todos sujetos al guard actual. No prueba integridad criptográfica ni protege frente a DDL del propietario/superusuario.';


--
-- Name: auditoria_jsonb_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auditoria_jsonb_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auditoria_jsonb_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auditoria_jsonb_id_seq OWNED BY public.auditoria_jsonb.id;


--
-- Name: auth_mfa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa (
    id_user integer NOT NULL,
    secret_box text NOT NULL,
    enabled_at timestamp with time zone,
    pending_expires_at timestamp with time zone NOT NULL,
    last_step bigint DEFAULT '-1'::integer NOT NULL,
    failures integer DEFAULT 0 NOT NULL,
    blocked_until timestamp with time zone,
    CONSTRAINT auth_mfa_failures_check CHECK (((failures >= 0) AND (failures <= 5)))
);


--
-- Name: TABLE auth_mfa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_mfa IS 'Secreto AES-256-GCM con clave externa AUTH_MFA_ENCRYPTION_KEY; no registrar ni exportar al catálogo público.';


--
-- Name: auth_mfa_challenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa_challenge (
    token_hash character(64) NOT NULL,
    id_user integer NOT NULL,
    token_version integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone
);


--
-- Name: TABLE auth_mfa_challenge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_mfa_challenge IS 'Reto opaco de cinco minutos; solo hash; no autoriza acceso a la API.';


--
-- Name: auth_mfa_recovery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa_recovery (
    id_user integer NOT NULL,
    code_hash character(64) NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: auth_password_recovery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_password_recovery (
    id_user integer NOT NULL,
    active_hash character(64),
    credential_digest character(64),
    confirmed_at timestamp with time zone,
    expires_at timestamp with time zone,
    pending_hash character(64),
    pending_credential_digest character(64),
    pending_version integer,
    pending_expires_at timestamp with time zone,
    CONSTRAINT auth_password_recovery_check CHECK ((((active_hash IS NULL) AND (credential_digest IS NULL) AND (confirmed_at IS NULL) AND (expires_at IS NULL)) OR ((active_hash IS NOT NULL) AND (credential_digest IS NOT NULL) AND (confirmed_at IS NOT NULL) AND (expires_at IS NOT NULL) AND (expires_at > confirmed_at)))),
    CONSTRAINT auth_password_recovery_check1 CHECK ((((pending_hash IS NULL) AND (pending_credential_digest IS NULL) AND (pending_version IS NULL) AND (pending_expires_at IS NULL)) OR ((pending_hash IS NOT NULL) AND (pending_credential_digest IS NOT NULL) AND (pending_version IS NOT NULL) AND (pending_version >= 0) AND (pending_expires_at IS NOT NULL))))
);


--
-- Name: TABLE auth_password_recovery; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_password_recovery IS 'Clave offline de recuperación de contraseña, SHA-256 solamente. Pendiente10min, confirmada365d; un uso y vinculada a credencial. No aplicar trigger de auditoría que copie hashes.';


--
-- Name: auth_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_session (
    id_session uuid NOT NULL,
    id_user integer NOT NULL,
    token_version integer NOT NULL,
    client_label character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT auth_session_check CHECK ((expires_at > created_at)),
    CONSTRAINT auth_session_token_version_check CHECK ((token_version >= 0))
);


--
-- Name: TABLE auth_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_session IS 'Una fila por login, no por equipo físico. ID técnico no autoriza sin JWT válido. Sesiones anteriores sin sid requieren nuevo login.';


--
-- Name: auth_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_user (
    id_user integer NOT NULL,
    username character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'user'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT auth_user_token_version_nonnegative CHECK ((token_version >= 0)),
    CONSTRAINT check_auth_user_role CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('user'::character varying)::text])))
);


--
-- Name: TABLE auth_user; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_user IS 'Stores authentication credentials for system users';


--
-- Name: COLUMN auth_user.id_user; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.id_user IS 'Primary key - unique user identifier';


--
-- Name: COLUMN auth_user.username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.username IS 'Unique username for login';


--
-- Name: COLUMN auth_user.password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.password_hash IS 'Hash bcrypt de la contraseña; no se devuelve por API';


--
-- Name: COLUMN auth_user.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.role IS 'User role (e.g., admin, user)';


--
-- Name: COLUMN auth_user.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.is_active IS 'Flag to enable/disable user access';


--
-- Name: COLUMN auth_user.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.created_at IS 'Timestamp when user was created';


--
-- Name: COLUMN auth_user.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.updated_at IS 'Timestamp when user was last updated';


--
-- Name: COLUMN auth_user.token_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.auth_user.token_version IS 'Versión de sesión; incrementarla revoca todos los JWT previos';


--
-- Name: CONSTRAINT check_auth_user_role ON auth_user; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT check_auth_user_role ON public.auth_user IS 'Ensures role is either admin or user';


--
-- Name: auth_user_id_user_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auth_user_id_user_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auth_user_id_user_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auth_user_id_user_seq OWNED BY public.auth_user.id_user;


--
-- Name: backorder_cliente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backorder_cliente (
    id_backorder integer NOT NULL,
    id_pedido integer NOT NULL,
    id_detalle integer NOT NULL,
    id_cliente integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    cantidad_asignada numeric(18,6) DEFAULT 0 NOT NULL,
    prioridad smallint DEFAULT 3 NOT NULL,
    estado character varying(20) DEFAULT 'Pendiente'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT backorder_cliente_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT backorder_cliente_check CHECK (((cantidad_asignada >= (0)::numeric) AND (cantidad_asignada <= cantidad))),
    CONSTRAINT backorder_cliente_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Parcial'::character varying, 'Cubierto'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT backorder_cliente_prioridad_check CHECK (((prioridad >= 1) AND (prioridad <= 5)))
);


--
-- Name: TABLE backorder_cliente; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.backorder_cliente IS 'Demanda confirmada de pedidos que no pudo reservarse por falta de existencia.';


--
-- Name: backorder_cliente_id_backorder_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.backorder_cliente ALTER COLUMN id_backorder ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.backorder_cliente_id_backorder_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: bancos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bancos (
    "IdBanco" integer NOT NULL,
    "NombreBanco" character varying(50) NOT NULL,
    "RFCBanco" character varying(13),
    "NombreCorto" character varying(40),
    "ClaveSAT" character varying(5)
);


--
-- Name: bancos_IdBanco_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.bancos ALTER COLUMN "IdBanco" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."bancos_IdBanco_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: caja_movimiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.caja_movimiento (
    id_movimiento bigint NOT NULL,
    id_saldo integer NOT NULL,
    fecha timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    efectivo numeric(18,2) NOT NULL,
    banco numeric(18,2) NOT NULL,
    saldo_efectivo numeric(18,2) NOT NULL,
    saldo_banco numeric(18,2) NOT NULL,
    id_usuario integer,
    origen text DEFAULT 'Movimiento del sistema'::text NOT NULL
);


--
-- Name: caja_movimiento_id_movimiento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.caja_movimiento_id_movimiento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: caja_movimiento_id_movimiento_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.caja_movimiento_id_movimiento_seq OWNED BY public.caja_movimiento.id_movimiento;


--
-- Name: caja_turno; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.caja_turno (
    id_turno integer NOT NULL,
    apertura timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    cierre timestamp with time zone,
    abierto_por integer NOT NULL,
    cerrado_por integer,
    estado character varying(10) DEFAULT 'Abierta'::character varying NOT NULL,
    contado_apertura numeric(18,2) NOT NULL,
    saldo_sistema_apertura numeric(18,2) NOT NULL,
    id_movimiento_inicio bigint NOT NULL,
    id_movimiento_fin bigint,
    esperado_cierre numeric(18,2),
    contado_cierre numeric(18,2),
    diferencia numeric(18,2),
    notas_apertura character varying(1000),
    notas_cierre character varying(1000),
    CONSTRAINT caja_turno_check CHECK (((((estado)::text = 'Abierta'::text) AND (cierre IS NULL) AND (contado_cierre IS NULL)) OR (((estado)::text = 'Cerrada'::text) AND (cierre IS NOT NULL) AND (contado_cierre IS NOT NULL) AND (cerrado_por IS NOT NULL)))),
    CONSTRAINT caja_turno_contado_apertura_check CHECK ((contado_apertura >= (0)::numeric)),
    CONSTRAINT caja_turno_contado_cierre_check CHECK ((contado_cierre >= (0)::numeric)),
    CONSTRAINT caja_turno_estado_check CHECK (((estado)::text = ANY ((ARRAY['Abierta'::character varying, 'Cerrada'::character varying])::text[])))
);


--
-- Name: caja_turno_id_turno_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.caja_turno_id_turno_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: caja_turno_id_turno_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.caja_turno_id_turno_seq OWNED BY public.caja_turno.id_turno;


--
-- Name: casco_recuperable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.casco_recuperable (
    id_casco bigint NOT NULL,
    id_producto integer NOT NULL,
    id_cliente integer,
    estado character varying(20) DEFAULT 'Pendiente'::character varying NOT NULL,
    deposito numeric(18,2) DEFAULT 0 NOT NULL,
    referencia character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id_user integer,
    notas character varying(500),
    CONSTRAINT casco_recuperable_deposito_check CHECK ((deposito >= (0)::numeric)),
    CONSTRAINT casco_recuperable_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Recibido'::character varying, 'Enviado'::character varying, 'Acreditado'::character varying, 'Descartado'::character varying])::text[])))
);


--
-- Name: casco_recuperable_id_casco_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.casco_recuperable ALTER COLUMN id_casco ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.casco_recuperable_id_casco_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: categoria_IdCategoria_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.categoria ALTER COLUMN "IdCategoria" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."categoria_IdCategoria_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: centro_costo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.centro_costo (
    id_centro integer NOT NULL,
    codigo character varying(20) NOT NULL,
    nombre character varying(120) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: centro_costo_id_centro_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.centro_costo_id_centro_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: centro_costo_id_centro_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.centro_costo_id_centro_seq OWNED BY public.centro_costo.id_centro;


--
-- Name: cfdi_relacionado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cfdi_relacionado (
    id_relacion integer NOT NULL,
    id_factura integer NOT NULL,
    tipo_relacion character varying(2) NOT NULL,
    uuid_relacionado character varying(36) NOT NULL
);


--
-- Name: cfdi_relacionado_id_relacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cfdi_relacionado_id_relacion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cfdi_relacionado_id_relacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cfdi_relacionado_id_relacion_seq OWNED BY public.cfdi_relacionado.id_relacion;


--
-- Name: claveproductooservicio_IdClaveProdOServ_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.claveproductooservicio ALTER COLUMN "IdClaveProdOServ" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."claveproductooservicio_IdClaveProdOServ_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: claveunidad_IdClaveUnidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.claveunidad ALTER COLUMN "IdClaveUnidad" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."claveunidad_IdClaveUnidad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cliente_IdCliente_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cliente ALTER COLUMN "IdCliente" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."cliente_IdCliente_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cliente_comercial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cliente_comercial (
    id_cliente integer NOT NULL,
    id_lista integer,
    limite_credito numeric(18,2) DEFAULT 0 NOT NULL,
    dias_credito integer DEFAULT 0 NOT NULL,
    bloqueado boolean DEFAULT false NOT NULL,
    motivo_bloqueo character varying(500),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cliente_comercial_dias_credito_check CHECK (((dias_credito >= 0) AND (dias_credito <= 365))),
    CONSTRAINT cliente_comercial_limite_credito_check CHECK ((limite_credito >= (0)::numeric))
);


--
-- Name: cliente_contacto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cliente_contacto (
    id_contacto integer NOT NULL,
    id_cliente integer NOT NULL,
    nombre character varying(150) NOT NULL,
    cargo character varying(100),
    telefono character varying(30),
    email character varying(150),
    canal_preferido character varying(20) DEFAULT 'Telefono'::character varying NOT NULL,
    es_principal boolean DEFAULT false NOT NULL,
    notas character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cliente_contacto_canal_preferido_check CHECK (((canal_preferido)::text = ANY ((ARRAY['Telefono'::character varying, 'WhatsApp'::character varying, 'Email'::character varying, 'Otro'::character varying])::text[]))),
    CONSTRAINT cliente_contacto_check CHECK (((telefono IS NOT NULL) OR (email IS NOT NULL))),
    CONSTRAINT cliente_contacto_nombre_check CHECK ((length(btrim((nombre)::text)) > 0))
);


--
-- Name: cliente_contacto_id_contacto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cliente_contacto ALTER COLUMN id_contacto ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.cliente_contacto_id_contacto_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: colonia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.colonia (
    "IdColonia" integer NOT NULL,
    "Clave" character varying(4) NOT NULL,
    "CodigoPostal" character varying(5) NOT NULL,
    "Nombre" character varying(255) NOT NULL
);


--
-- Name: colonia_IdColonia_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.colonia ALTER COLUMN "IdColonia" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."colonia_IdColonia_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: comercial_limite_aprobador; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comercial_limite_aprobador (
    id_usuario integer NOT NULL,
    operacion character varying(15) NOT NULL,
    monto_maximo numeric(18,2),
    version integer DEFAULT 1 NOT NULL,
    motivo character varying(1000) NOT NULL,
    CONSTRAINT comercial_limite_aprobador_monto_maximo_check CHECK ((monto_maximo >= (0)::numeric)),
    CONSTRAINT comercial_limite_aprobador_operacion_check CHECK (((operacion)::text = ANY ((ARRAY['Venta'::character varying, 'Pedido'::character varying, 'Cotizacion'::character varying])::text[]))),
    CONSTRAINT comercial_limite_aprobador_version_check CHECK ((version > 0))
);


--
-- Name: comercial_regla_aprobacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comercial_regla_aprobacion (
    operacion character varying(15) NOT NULL,
    tipo character varying(25) NOT NULL,
    monto_maximo numeric(18,2),
    requiere_distinto boolean DEFAULT false NOT NULL,
    vigencia_maxima_horas integer DEFAULT 24 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    motivo character varying(1000) NOT NULL,
    CONSTRAINT comercial_regla_aprobacion_monto_maximo_check CHECK ((monto_maximo >= (0)::numeric)),
    CONSTRAINT comercial_regla_aprobacion_operacion_check CHECK (((operacion)::text = ANY ((ARRAY['Venta'::character varying, 'Pedido'::character varying, 'Cotizacion'::character varying])::text[]))),
    CONSTRAINT comercial_regla_aprobacion_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Descuento'::character varying, 'Margen bajo'::character varying, 'Exceso credito'::character varying])::text[]))),
    CONSTRAINT comercial_regla_aprobacion_version_check CHECK ((version > 0)),
    CONSTRAINT comercial_regla_aprobacion_vigencia_maxima_horas_check CHECK (((vigencia_maxima_horas >= 1) AND (vigencia_maxima_horas <= 720)))
);


--
-- Name: complementodepago; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complementodepago (
    "IdComplementoPago" integer NOT NULL,
    "IdCliente" integer NOT NULL,
    "FechaPago" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "IdFormaPago" integer NOT NULL,
    "Moneda" public.moneda_enum DEFAULT 'MXN'::public.moneda_enum,
    "TipoDeCambio" numeric(10,6) DEFAULT 1.000000,
    "TotalPagado" numeric(10,6) NOT NULL,
    CONSTRAINT chk_complementodepago_total CHECK (("TotalPagado" > (0)::numeric))
);


--
-- Name: complementodepago_IdComplementoPago_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.complementodepago ALTER COLUMN "IdComplementoPago" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."complementodepago_IdComplementoPago_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: compra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compra (
    id_compra integer NOT NULL,
    id_proveedor integer NOT NULL,
    folio_factura_proveedor character varying(50),
    fecha_compra timestamp with time zone DEFAULT now(),
    observaciones text,
    total numeric(18,2) DEFAULT 0 NOT NULL,
    estatus character varying(20) DEFAULT 'Completada'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    saldo_pendiente numeric(18,2) DEFAULT 0,
    fecha_vencimiento timestamp with time zone DEFAULT (now() + '30 days'::interval),
    CONSTRAINT compra_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: compra_id_compra_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.compra ALTER COLUMN id_compra ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.compra_id_compra_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: conceptocotizacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conceptocotizacion (
    id_concepto integer NOT NULL,
    id_cotizacion integer NOT NULL,
    id_producto integer,
    descripcion text NOT NULL,
    unidad character varying(50),
    cantidad numeric(18,6) NOT NULL,
    valor_unitario numeric(18,6) NOT NULL,
    importe numeric(18,2) NOT NULL,
    importe_iva numeric(18,2) DEFAULT 0,
    importe_ret_isr numeric(18,2) DEFAULT 0,
    estatus character varying(20) DEFAULT 'Pendiente'::character varying,
    motivo_rechazo character varying(100),
    precio_cierre numeric(10,2),
    CONSTRAINT chk_conceptocotizacion_estatus CHECK (((estatus)::text = ANY ((ARRAY['Pendiente'::character varying, 'Comprada'::character varying, 'Rechazada'::character varying])::text[])))
);


--
-- Name: conceptocotizacion_id_concepto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.conceptocotizacion ALTER COLUMN id_concepto ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.conceptocotizacion_id_concepto_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: conceptofactura; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conceptofactura (
    id_concepto integer NOT NULL,
    id_factura integer NOT NULL,
    id_producto integer,
    id_clave_prod_serv integer,
    id_clave_unidad integer,
    id_objeto_impuesto integer,
    clave_sat character varying(20),
    descripcion text NOT NULL,
    unidad_sat character varying(50),
    cantidad numeric(18,6) NOT NULL,
    valor_unitario numeric(18,6) NOT NULL,
    importe numeric(18,2) NOT NULL,
    descuento numeric(18,2) DEFAULT 0,
    objeto_impuesto_sat character varying(2) NOT NULL,
    base_iva numeric(18,2),
    tasa_iva numeric(18,6) DEFAULT 0.160000,
    importe_iva numeric(18,2) DEFAULT 0,
    base_ret_isr numeric(18,2),
    tasa_ret_isr numeric(18,6) DEFAULT 0.012500,
    importe_ret_isr numeric(18,2) DEFAULT 0,
    costo_unitario_snapshot numeric(18,6),
    CONSTRAINT conceptofactura_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT conceptofactura_descuento_check CHECK ((descuento >= (0)::numeric)),
    CONSTRAINT conceptofactura_valor_unitario_check CHECK ((valor_unitario >= (0)::numeric))
);


--
-- Name: COLUMN conceptofactura.costo_unitario_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.conceptofactura.costo_unitario_snapshot IS 'Costo promedio conocido congelado al crear la venta; NULL significa costo desconocido.';


--
-- Name: conceptofactura_id_concepto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.conceptofactura ALTER COLUMN id_concepto ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.conceptofactura_id_concepto_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: conteo_inventario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conteo_inventario (
    id_conteo integer NOT NULL,
    request_id uuid NOT NULL,
    id_ubicacion integer NOT NULL,
    estado character varying(20) DEFAULT 'Abierto'::character varying NOT NULL,
    notas character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    tipo character varying(20) DEFAULT 'Ciclico'::character varying NOT NULL,
    ciego boolean DEFAULT true NOT NULL,
    id_autorizador integer,
    authorized_at timestamp with time zone,
    motivo_rechazo character varying(500),
    CONSTRAINT conteo_inventario_estado_check CHECK (((estado)::text = ANY ((ARRAY['Abierto'::character varying, 'Pendiente'::character varying, 'Aplicado'::character varying, 'Rechazado'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT conteo_inventario_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Ciclico'::character varying, 'General'::character varying])::text[])))
);


--
-- Name: conteo_inventario_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conteo_inventario_detalle (
    id_detalle bigint NOT NULL,
    id_conteo integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad_sistema numeric(18,6) NOT NULL,
    cantidad_contada numeric(18,6) NOT NULL,
    diferencia numeric(18,6) GENERATED ALWAYS AS ((cantidad_contada - cantidad_sistema)) STORED,
    CONSTRAINT conteo_inventario_detalle_cantidad_contada_check CHECK ((cantidad_contada >= (0)::numeric))
);


--
-- Name: conteo_inventario_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.conteo_inventario_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.conteo_inventario_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: conteo_inventario_id_conteo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.conteo_inventario ALTER COLUMN id_conteo ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.conteo_inventario_id_conteo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cotizacion_id_cotizacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cotizacion ALTER COLUMN id_cotizacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.cotizacion_id_cotizacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cotizacion_invitacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizacion_invitacion (
    id_invitacion integer NOT NULL,
    id_revision integer NOT NULL,
    request_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    autor_nombre text NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    vence_en timestamp with time zone NOT NULL,
    revocada boolean DEFAULT false NOT NULL,
    motivo_revocacion character varying(1000),
    CONSTRAINT cotizacion_invitacion_check CHECK ((vence_en > creada_en)),
    CONSTRAINT cotizacion_invitacion_check1 CHECK (((revocada AND (motivo_revocacion IS NOT NULL) AND (length(btrim((motivo_revocacion)::text)) > 0)) OR ((NOT revocada) AND (motivo_revocacion IS NULL))))
);


--
-- Name: cotizacion_invitacion_id_invitacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cotizacion_invitacion ALTER COLUMN id_invitacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.cotizacion_invitacion_id_invitacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cotizacion_respuesta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizacion_respuesta (
    id_respuesta integer NOT NULL,
    id_revision integer NOT NULL,
    id_invitacion integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    decision character varying(10) NOT NULL,
    nombre character varying(150) NOT NULL,
    comentario character varying(1000) NOT NULL,
    confirmacion boolean NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cotizacion_respuesta_comentario_check CHECK ((length(btrim((comentario)::text)) > 0)),
    CONSTRAINT cotizacion_respuesta_confirmacion_check CHECK (confirmacion),
    CONSTRAINT cotizacion_respuesta_decision_check CHECK (((decision)::text = ANY ((ARRAY['Aceptada'::character varying, 'Rechazada'::character varying])::text[]))),
    CONSTRAINT cotizacion_respuesta_nombre_check CHECK ((length(btrim((nombre)::text)) > 0))
);


--
-- Name: cotizacion_respuesta_id_respuesta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cotizacion_respuesta ALTER COLUMN id_respuesta ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.cotizacion_respuesta_id_respuesta_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cotizacion_revision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizacion_revision (
    id_revision integer NOT NULL,
    id_cotizacion integer NOT NULL,
    id_raiz integer NOT NULL,
    numero integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    snapshot jsonb NOT NULL,
    sha256 character(64) NOT NULL,
    motivo character varying(1000) NOT NULL,
    autor_nombre text NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cotizacion_revision_motivo_check CHECK ((length(btrim((motivo)::text)) > 0)),
    CONSTRAINT cotizacion_revision_numero_check CHECK ((numero > 0)),
    CONSTRAINT cotizacion_revision_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text))
);


--
-- Name: cotizacion_revision_id_revision_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cotizacion_revision ALTER COLUMN id_revision ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.cotizacion_revision_id_revision_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_campana; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_campana (
    id_campana integer NOT NULL,
    nombre character varying(150) NOT NULL,
    id_segmento integer,
    id_plantilla integer,
    estado character varying(20) DEFAULT 'Borrador'::character varying NOT NULL,
    fecha_inicio date,
    fecha_fin date,
    objetivo character varying(500),
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_campana_check CHECK (((fecha_fin IS NULL) OR (fecha_inicio IS NULL) OR (fecha_fin >= fecha_inicio))),
    CONSTRAINT crm_campana_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Activa'::character varying, 'Finalizada'::character varying, 'Cancelada'::character varying])::text[])))
);


--
-- Name: crm_campana_id_campana_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_campana ALTER COLUMN id_campana ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_campana_id_campana_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_campana_preparacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_campana_preparacion (
    id_preparacion integer NOT NULL,
    id_campana integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    evaluacion_sha256 character(64) NOT NULL,
    snapshot jsonb NOT NULL,
    sha256 character(64) NOT NULL,
    motivo character varying(500) NOT NULL,
    id_user integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_campana_preparacion_evaluacion_sha256_check CHECK ((evaluacion_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT crm_campana_preparacion_motivo_check CHECK ((length(btrim((motivo)::text)) > 0)),
    CONSTRAINT crm_campana_preparacion_sha256_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT crm_campana_preparacion_snapshot_check CHECK (((jsonb_typeof(snapshot) = 'object'::text) AND (octet_length((snapshot)::text) <= 524288)))
);


--
-- Name: crm_campana_preparacion_id_preparacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_campana_preparacion ALTER COLUMN id_preparacion ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.crm_campana_preparacion_id_preparacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_comunicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_comunicacion (
    id_comunicacion bigint NOT NULL,
    canal character varying(20) NOT NULL,
    direccion character varying(12) NOT NULL,
    resumen character varying(2000) NOT NULL,
    fecha timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    id_cliente integer,
    id_unidad integer,
    id_oportunidad integer,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_comunicacion_canal_check CHECK (((canal)::text = ANY ((ARRAY['Llamada'::character varying, 'Correo'::character varying, 'WhatsApp'::character varying, 'Visita'::character varying, 'Otro'::character varying])::text[]))),
    CONSTRAINT crm_comunicacion_check CHECK (((id_cliente IS NOT NULL) OR (id_unidad IS NOT NULL) OR (id_oportunidad IS NOT NULL))),
    CONSTRAINT crm_comunicacion_direccion_check CHECK (((direccion)::text = ANY ((ARRAY['Entrante'::character varying, 'Saliente'::character varying])::text[])))
);


--
-- Name: crm_comunicacion_id_comunicacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_comunicacion ALTER COLUMN id_comunicacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_comunicacion_id_comunicacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_consentimiento_comercial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_consentimiento_comercial (
    id_consentimiento integer NOT NULL,
    id_cliente integer NOT NULL,
    id_contacto integer NOT NULL,
    canal character varying(10) NOT NULL,
    finalidad character varying(20) DEFAULT 'Promociones'::character varying NOT NULL,
    destino_hash character(64) NOT NULL,
    estado character varying(10) NOT NULL,
    version integer NOT NULL,
    ocurrida_en timestamp with time zone NOT NULL,
    vence_en timestamp with time zone,
    fuente character varying(12) NOT NULL,
    referencia character varying(500) NOT NULL,
    motivo character varying(500) NOT NULL,
    id_user integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_consentimiento_comercial_canal_check CHECK (((canal)::text = ANY ((ARRAY['Correo'::character varying, 'WhatsApp'::character varying, 'Llamada'::character varying])::text[]))),
    CONSTRAINT crm_consentimiento_comercial_check CHECK (((vence_en IS NULL) OR (((estado)::text = 'Autorizado'::text) AND (vence_en > ocurrida_en)))),
    CONSTRAINT crm_consentimiento_comercial_destino_hash_check CHECK ((destino_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT crm_consentimiento_comercial_estado_check CHECK (((estado)::text = ANY ((ARRAY['Autorizado'::character varying, 'Baja'::character varying])::text[]))),
    CONSTRAINT crm_consentimiento_comercial_finalidad_check CHECK (((finalidad)::text = 'Promociones'::text)),
    CONSTRAINT crm_consentimiento_comercial_fuente_check CHECK (((fuente)::text = ANY ((ARRAY['Presencial'::character varying, 'Llamada'::character varying, 'Correo'::character varying, 'WhatsApp'::character varying, 'Documento'::character varying])::text[]))),
    CONSTRAINT crm_consentimiento_comercial_id_contacto_check CHECK ((id_contacto > 0)),
    CONSTRAINT crm_consentimiento_comercial_motivo_check CHECK ((length(btrim((motivo)::text)) > 0)),
    CONSTRAINT crm_consentimiento_comercial_referencia_check CHECK ((length(btrim((referencia)::text)) > 0)),
    CONSTRAINT crm_consentimiento_comercial_version_check CHECK ((version > 0))
);


--
-- Name: crm_consentimiento_comercial_id_consentimiento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_consentimiento_comercial ALTER COLUMN id_consentimiento ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.crm_consentimiento_comercial_id_consentimiento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_encuesta_satisfaccion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_encuesta_satisfaccion (
    id_encuesta bigint NOT NULL,
    id_cliente integer,
    id_oportunidad integer,
    calificacion smallint NOT NULL,
    comentario character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_encuesta_satisfaccion_calificacion_check CHECK (((calificacion >= 1) AND (calificacion <= 5)))
);


--
-- Name: crm_encuesta_satisfaccion_id_encuesta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_encuesta_satisfaccion ALTER COLUMN id_encuesta ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_encuesta_satisfaccion_id_encuesta_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_etapa_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_etapa_evento (
    id_evento bigint NOT NULL,
    id_oportunidad integer NOT NULL,
    version_origen integer NOT NULL,
    tipo character varying(10) NOT NULL,
    etapa character varying(20) NOT NULL,
    id_cliente integer,
    id_responsable integer,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_etapa_evento_etapa_check CHECK (((etapa)::text = ANY ((ARRAY['Prospecto'::character varying, 'Contactado'::character varying, 'Cotizando'::character varying, 'Negociacion'::character varying, 'Ganada'::character varying, 'Perdida'::character varying])::text[]))),
    CONSTRAINT crm_etapa_evento_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Alta'::character varying, 'Etapa'::character varying, 'Asignacion'::character varying])::text[])))
);


--
-- Name: crm_etapa_evento_id_evento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_etapa_evento ALTER COLUMN id_evento ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.crm_etapa_evento_id_evento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_meta_vendedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_meta_vendedor (
    id_meta integer NOT NULL,
    id_user integer NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_fin date NOT NULL,
    monto_objetivo numeric(18,2) NOT NULL,
    oportunidades_objetivo integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_meta_vendedor_check CHECK ((fecha_fin >= fecha_inicio)),
    CONSTRAINT crm_meta_vendedor_monto_objetivo_check CHECK ((monto_objetivo >= (0)::numeric)),
    CONSTRAINT crm_meta_vendedor_oportunidades_objetivo_check CHECK ((oportunidades_objetivo >= 0))
);


--
-- Name: crm_meta_vendedor_id_meta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_meta_vendedor ALTER COLUMN id_meta ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_meta_vendedor_id_meta_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_oportunidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_oportunidad (
    id_oportunidad integer NOT NULL,
    id_cliente integer,
    empresa character varying(180) NOT NULL,
    contacto character varying(150),
    telefono character varying(30),
    email character varying(150),
    tipo_cliente character varying(30) DEFAULT 'Otro'::character varying NOT NULL,
    etapa character varying(30) DEFAULT 'Prospecto'::character varying NOT NULL,
    monto_estimado numeric(18,2) DEFAULT 0 NOT NULL,
    siguiente_accion character varying(255),
    fecha_siguiente_accion timestamp with time zone,
    motivo_perdida character varying(100),
    id_responsable integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT crm_oportunidad_etapa_check CHECK (((etapa)::text = ANY ((ARRAY['Prospecto'::character varying, 'Contactado'::character varying, 'Cotizando'::character varying, 'Negociacion'::character varying, 'Ganada'::character varying, 'Perdida'::character varying])::text[]))),
    CONSTRAINT crm_oportunidad_monto_estimado_check CHECK ((monto_estimado >= (0)::numeric)),
    CONSTRAINT crm_oportunidad_tipo_cliente_check CHECK (((tipo_cliente)::text = ANY ((ARRAY['Flotilla'::character varying, 'Taller'::character varying, 'Transportista'::character varying, 'Mostrador'::character varying, 'Otro'::character varying])::text[])))
);


--
-- Name: crm_oportunidad_consulta_web; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_oportunidad_consulta_web (
    id_oportunidad integer NOT NULL,
    request_id uuid NOT NULL,
    piezas jsonb NOT NULL,
    id_autor integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_oportunidad_consulta_web_piezas_check CHECK (((jsonb_typeof(piezas) = 'array'::text) AND ((jsonb_array_length(piezas) >= 1) AND (jsonb_array_length(piezas) <= 10))))
);


--
-- Name: crm_oportunidad_cotizacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_oportunidad_cotizacion (
    id_cotizacion integer NOT NULL,
    id_oportunidad integer NOT NULL,
    id_cliente integer NOT NULL,
    id_autor integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: TABLE crm_oportunidad_cotizacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_oportunidad_cotizacion IS 'Cotización de un único origen CRM confirmado; cliente común exigido por FK y cambios trazados en seguimiento/auditoría';


--
-- Name: crm_oportunidad_id_oportunidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_oportunidad ALTER COLUMN id_oportunidad ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_oportunidad_id_oportunidad_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_plantilla; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_plantilla (
    id_plantilla integer NOT NULL,
    nombre character varying(120) NOT NULL,
    canal character varying(20) NOT NULL,
    asunto character varying(180),
    contenido text NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_plantilla_canal_check CHECK (((canal)::text = ANY ((ARRAY['Llamada'::character varying, 'Correo'::character varying, 'WhatsApp'::character varying])::text[])))
);


--
-- Name: crm_plantilla_id_plantilla_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_plantilla ALTER COLUMN id_plantilla ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_plantilla_id_plantilla_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_reporte_intento_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_reporte_intento_evento (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_resultado uuid NOT NULL,
    intento smallint NOT NULL,
    fase character varying(12) NOT NULL,
    codigo character varying(40),
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_reporte_intento_evento_check CHECK (((((fase)::text = ANY ((ARRAY['Inicio'::character varying, 'Generado'::character varying])::text[])) AND (codigo IS NULL)) OR (((fase)::text <> ALL ((ARRAY['Inicio'::character varying, 'Generado'::character varying])::text[])) AND (codigo IS NOT NULL)))),
    CONSTRAINT crm_reporte_intento_evento_codigo_check CHECK (((codigo)::text = ANY ((ARRAY['GENERACION_FALLIDA'::character varying, 'EJECUCION_INTERRUMPIDA'::character varying, 'AUTORIZACION_O_CONFIGURACION'::character varying, 'CANCELADO_POR_PROPIETARIO'::character varying])::text[]))),
    CONSTRAINT crm_reporte_intento_evento_fase_check CHECK (((fase)::text = ANY ((ARRAY['Inicio'::character varying, 'Generado'::character varying, 'Error'::character varying, 'Interrumpido'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT crm_reporte_intento_evento_intento_check CHECK (((intento >= 0) AND (intento <= 3)))
);


--
-- Name: crm_reporte_programa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_reporte_programa (
    id_programa uuid NOT NULL,
    nombre character varying(120) NOT NULL,
    id_propietario integer NOT NULL,
    frecuencia character varying(10) NOT NULL,
    hora smallint NOT NULL,
    minuto smallint NOT NULL,
    dia smallint,
    tipo character varying(15) NOT NULL,
    plazo character varying(15) NOT NULL,
    zona character varying(40) DEFAULT 'America/Mexico_City'::character varying NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    huella character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    vigente_desde timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_reporte_programa_check CHECK (((((frecuencia)::text = 'Diaria'::text) AND (dia IS NULL)) OR (((frecuencia)::text = 'Semanal'::text) AND (dia IS NOT NULL)))),
    CONSTRAINT crm_reporte_programa_dia_check CHECK (((dia >= 1) AND (dia <= 7))),
    CONSTRAINT crm_reporte_programa_frecuencia_check CHECK (((frecuencia)::text = ANY ((ARRAY['Diaria'::character varying, 'Semanal'::character varying])::text[]))),
    CONSTRAINT crm_reporte_programa_hora_check CHECK (((hora >= 0) AND (hora <= 23))),
    CONSTRAINT crm_reporte_programa_huella_check CHECK ((huella ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT crm_reporte_programa_minuto_check CHECK ((minuto = ANY (ARRAY[0, 10, 20, 30, 40, 50]))),
    CONSTRAINT crm_reporte_programa_nombre_check CHECK ((length(TRIM(BOTH FROM nombre)) > 0)),
    CONSTRAINT crm_reporte_programa_plazo_check CHECK (((plazo)::text = ANY ((ARRAY['todos'::character varying, 'vencidas'::character varying, 'hoy'::character varying, 'proximas'::character varying, 'sin-fecha'::character varying])::text[]))),
    CONSTRAINT crm_reporte_programa_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['todos'::character varying, 'tarea'::character varying, 'oportunidad'::character varying, 'cotizacion'::character varying, 'web'::character varying])::text[]))),
    CONSTRAINT crm_reporte_programa_version_check CHECK ((version > 0)),
    CONSTRAINT crm_reporte_programa_zona_check CHECK (((zona)::text = 'America/Mexico_City'::text))
);


--
-- Name: crm_reporte_recuperacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_reporte_recuperacion (
    id_resultado uuid NOT NULL,
    token uuid NOT NULL,
    generada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    snapshot jsonb NOT NULL,
    CONSTRAINT crm_reporte_recuperacion_snapshot_check CHECK (((jsonb_typeof(snapshot) = 'object'::text) AND (octet_length((snapshot)::text) <= 8192) AND (NOT ((snapshot ->> 'version'::text) IS DISTINCT FROM '1'::text))))
);


--
-- Name: crm_reporte_reintento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_reporte_reintento (
    id_resultado uuid NOT NULL,
    estado character varying(12) DEFAULT 'Pendiente'::character varying NOT NULL,
    intentos smallint DEFAULT 0 NOT NULL,
    disponible_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    token uuid,
    lease_hasta timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_reporte_reintento_check CHECK (((((estado)::text = 'EnCurso'::text) AND (token IS NOT NULL) AND (lease_hasta IS NOT NULL) AND (intentos > 0)) OR (((estado)::text <> 'EnCurso'::text) AND (token IS NULL) AND (lease_hasta IS NULL)))),
    CONSTRAINT crm_reporte_reintento_check1 CHECK ((((estado)::text <> 'Agotado'::text) OR (intentos = 3))),
    CONSTRAINT crm_reporte_reintento_check2 CHECK ((((estado)::text <> 'Completado'::text) OR (intentos > 0))),
    CONSTRAINT crm_reporte_reintento_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'EnCurso'::character varying, 'Completado'::character varying, 'Agotado'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT crm_reporte_reintento_intentos_check CHECK (((intentos >= 0) AND (intentos <= 3))),
    CONSTRAINT crm_reporte_reintento_version_check CHECK ((version > 0))
);


--
-- Name: crm_reporte_resultado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_reporte_resultado (
    id_resultado uuid DEFAULT gen_random_uuid() NOT NULL,
    id_programa uuid NOT NULL,
    programada_en timestamp with time zone NOT NULL,
    generada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    estado character varying(10) NOT NULL,
    snapshot jsonb,
    codigo character varying(30),
    CONSTRAINT crm_reporte_resultado_check CHECK (((((estado)::text = 'Generado'::text) AND (snapshot IS NOT NULL) AND (codigo IS NULL)) OR (((estado)::text = 'Error'::text) AND (snapshot IS NULL) AND ((codigo)::text = 'GENERACION_FALLIDA'::text)))),
    CONSTRAINT crm_reporte_resultado_estado_check CHECK (((estado)::text = ANY ((ARRAY['Generado'::character varying, 'Error'::character varying])::text[]))),
    CONSTRAINT crm_reporte_resultado_snapshot_check CHECK (((snapshot IS NULL) OR ((jsonb_typeof(snapshot) = 'object'::text) AND (octet_length((snapshot)::text) <= 8192) AND ((snapshot ->> 'version'::text) = '1'::text))))
);


--
-- Name: crm_secuencia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_secuencia (
    id_secuencia uuid NOT NULL,
    id_modelo uuid NOT NULL,
    id_cliente integer NOT NULL,
    id_responsable integer NOT NULL,
    id_creador integer NOT NULL,
    motivo character varying(500) NOT NULL,
    huella character(64) NOT NULL,
    estado character varying(12) DEFAULT 'Activa'::character varying NOT NULL,
    paso_actual integer DEFAULT 1 NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    cerrada_en timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    pausada_en timestamp with time zone,
    plazo_restante interval,
    CONSTRAINT crm_secuencia_cierre CHECK ((((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Pausada'::character varying])::text[])) = (cerrada_en IS NULL))),
    CONSTRAINT crm_secuencia_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Pausada'::character varying, 'Completada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT crm_secuencia_motivo_check CHECK ((length(btrim((motivo)::text)) > 0)),
    CONSTRAINT crm_secuencia_paso_actual_check CHECK (((paso_actual >= 1) AND (paso_actual <= 8))),
    CONSTRAINT crm_secuencia_pausa CHECK (((((estado)::text = 'Pausada'::text) AND (pausada_en IS NOT NULL) AND (plazo_restante IS NOT NULL)) OR (((estado)::text <> 'Pausada'::text) AND (pausada_en IS NULL) AND (plazo_restante IS NULL)))),
    CONSTRAINT crm_secuencia_version_check CHECK ((version > 0))
);


--
-- Name: crm_secuencia_aplicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_secuencia_aplicacion (
    request_id uuid NOT NULL,
    id_regla uuid NOT NULL,
    id_evento bigint NOT NULL,
    id_modelo uuid NOT NULL,
    id_secuencia uuid NOT NULL,
    id_actor integer NOT NULL,
    motivo character varying(500) NOT NULL,
    evaluacion_sha256 character(64) NOT NULL,
    huella character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_secuencia_aplicacion_motivo_check CHECK ((length(btrim((motivo)::text)) > 0))
);


--
-- Name: crm_secuencia_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_secuencia_control (
    request_id uuid NOT NULL,
    id_secuencia uuid NOT NULL,
    id_tarea bigint NOT NULL,
    accion character varying(12) NOT NULL,
    motivo character varying(500) NOT NULL,
    id_actor integer NOT NULL,
    id_anterior integer NOT NULL,
    id_nuevo integer NOT NULL,
    vence_antes timestamp with time zone NOT NULL,
    vence_despues timestamp with time zone NOT NULL,
    version_anterior integer NOT NULL,
    version_resultante integer NOT NULL,
    huella character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_secuencia_control_accion_check CHECK (((accion)::text = ANY ((ARRAY['Pausar'::character varying, 'Reanudar'::character varying, 'Reasignar'::character varying])::text[]))),
    CONSTRAINT crm_secuencia_control_check CHECK ((version_resultante = (version_anterior + 1))),
    CONSTRAINT crm_secuencia_control_motivo_check CHECK ((length(btrim((motivo)::text)) > 0)),
    CONSTRAINT crm_secuencia_control_version_anterior_check CHECK ((version_anterior > 0))
);


--
-- Name: crm_secuencia_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_secuencia_evento (
    id_evento bigint NOT NULL,
    id_secuencia uuid NOT NULL,
    id_tarea bigint NOT NULL,
    evento character varying(12) NOT NULL,
    paso integer NOT NULL,
    id_actor integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_secuencia_evento_evento_check CHECK (((evento)::text = ANY ((ARRAY['Creada'::character varying, 'Completada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT crm_secuencia_evento_paso_check CHECK (((paso >= 1) AND (paso <= 8)))
);


--
-- Name: crm_secuencia_evento_id_evento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_secuencia_evento ALTER COLUMN id_evento ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.crm_secuencia_evento_id_evento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_secuencia_modelo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_secuencia_modelo (
    id_modelo uuid NOT NULL,
    nombre character varying(120) NOT NULL,
    pasos jsonb NOT NULL,
    id_creador integer NOT NULL,
    huella character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_secuencia_modelo_nombre_check CHECK ((length(btrim((nombre)::text)) > 0)),
    CONSTRAINT crm_secuencia_modelo_pasos_check CHECK (((jsonb_typeof(pasos) = 'array'::text) AND ((jsonb_array_length(pasos) >= 1) AND (jsonb_array_length(pasos) <= 8)) AND (octet_length((pasos)::text) <= 20000)))
);


--
-- Name: crm_secuencia_regla; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_secuencia_regla (
    id_regla uuid NOT NULL,
    nombre character varying(120) NOT NULL,
    id_modelo uuid NOT NULL,
    etapa character varying(20) NOT NULL,
    evento_desde bigint NOT NULL,
    id_creador integer NOT NULL,
    huella character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_secuencia_regla_etapa_check CHECK (((etapa)::text = ANY ((ARRAY['Prospecto'::character varying, 'Contactado'::character varying, 'Cotizando'::character varying, 'Negociacion'::character varying, 'Ganada'::character varying, 'Perdida'::character varying])::text[]))),
    CONSTRAINT crm_secuencia_regla_evento_desde_check CHECK ((evento_desde >= 0)),
    CONSTRAINT crm_secuencia_regla_nombre_check CHECK ((length(btrim((nombre)::text)) > 0))
);


--
-- Name: crm_segmento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_segmento (
    id_segmento integer NOT NULL,
    nombre character varying(120) NOT NULL,
    descripcion character varying(500),
    tipo_cliente character varying(30),
    dias_inactivo integer,
    activo boolean DEFAULT true NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_segmento_dias_inactivo_check CHECK (((dias_inactivo IS NULL) OR (dias_inactivo >= 0)))
);


--
-- Name: crm_segmento_id_segmento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_segmento ALTER COLUMN id_segmento ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_segmento_id_segmento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_seguimiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_seguimiento (
    id_seguimiento integer NOT NULL,
    id_oportunidad integer NOT NULL,
    tipo character varying(30) NOT NULL,
    detalle text NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_seguimiento_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Llamada'::character varying, 'WhatsApp'::character varying, 'Correo'::character varying, 'Visita'::character varying, 'Nota'::character varying])::text[])))
);


--
-- Name: crm_seguimiento_id_seguimiento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_seguimiento ALTER COLUMN id_seguimiento ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_seguimiento_id_seguimiento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_solicitud_web; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_solicitud_web (
    request_id uuid NOT NULL,
    fingerprint character varying(64) NOT NULL,
    payload jsonb,
    estado character varying(20) DEFAULT 'Pendiente'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone DEFAULT (clock_timestamp() + '90 days'::interval) NOT NULL,
    revisada_por integer,
    id_oportunidad integer,
    CONSTRAINT crm_solicitud_web_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Revisada'::character varying, 'Descartada'::character varying])::text[]))),
    CONSTRAINT crm_solicitud_web_fingerprint_check CHECK (((fingerprint)::text ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT crm_solicitud_web_payload_check CHECK (((payload IS NULL) OR ((jsonb_typeof(payload) = 'object'::text) AND ((payload ->> 'origin'::text) = 'public-web'::text)))),
    CONSTRAINT crm_solicitud_web_version_check CHECK ((version > 0))
);


--
-- Name: crm_solicitud_web_resolucion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_solicitud_web_resolucion (
    operation_id uuid NOT NULL,
    request_id uuid NOT NULL,
    motivo character varying(20) NOT NULL,
    decision character varying(24) DEFAULT 'ConservarOriginal'::character varying NOT NULL,
    expected_version integer NOT NULL,
    version_resultante integer NOT NULL,
    contenido character varying(12) NOT NULL,
    id_oportunidad integer,
    id_autor integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT crm_solicitud_web_resolucion_check CHECK ((version_resultante = (expected_version + 1))),
    CONSTRAINT crm_solicitud_web_resolucion_contenido_check CHECK (((contenido)::text = ANY ((ARRAY['Vigente'::character varying, 'Vencido'::character varying, 'Purgado'::character varying])::text[]))),
    CONSTRAINT crm_solicitud_web_resolucion_decision_check CHECK (((decision)::text = 'ConservarOriginal'::text)),
    CONSTRAINT crm_solicitud_web_resolucion_expected_version_check CHECK ((expected_version > 0)),
    CONSTRAINT crm_solicitud_web_resolucion_motivo_check CHECK (((motivo)::text = ANY ((ARRAY['Contenido'::character varying, 'Catalogo'::character varying, 'Clave'::character varying, 'Confirmacion'::character varying])::text[])))
);


--
-- Name: crm_tarea; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_tarea (
    id_tarea bigint NOT NULL,
    titulo character varying(180) NOT NULL,
    descripcion character varying(2000),
    prioridad character varying(12) DEFAULT 'Media'::character varying NOT NULL,
    estado character varying(20) DEFAULT 'Pendiente'::character varying NOT NULL,
    fecha_vencimiento timestamp with time zone NOT NULL,
    id_responsable integer NOT NULL,
    id_cliente integer,
    id_unidad integer,
    id_oportunidad integer,
    id_cotizacion integer,
    id_pedido integer,
    id_creador integer,
    completada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    id_secuencia uuid,
    paso_secuencia integer,
    CONSTRAINT crm_tarea_check CHECK (((id_cliente IS NOT NULL) OR (id_unidad IS NOT NULL) OR (id_oportunidad IS NOT NULL) OR (id_cotizacion IS NOT NULL) OR (id_pedido IS NOT NULL))),
    CONSTRAINT crm_tarea_check1 CHECK (((((estado)::text = 'Completada'::text) AND (completada_at IS NOT NULL)) OR (((estado)::text <> 'Completada'::text) AND (completada_at IS NULL)))),
    CONSTRAINT crm_tarea_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'En progreso'::character varying, 'Completada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT crm_tarea_prioridad_check CHECK (((prioridad)::text = ANY ((ARRAY['Baja'::character varying, 'Media'::character varying, 'Alta'::character varying, 'Urgente'::character varying])::text[]))),
    CONSTRAINT crm_tarea_secuencia_paso CHECK ((((id_secuencia IS NULL) AND (paso_secuencia IS NULL)) OR ((id_secuencia IS NOT NULL) AND ((paso_secuencia >= 1) AND (paso_secuencia <= 8)))))
);


--
-- Name: crm_tarea_id_tarea_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_tarea ALTER COLUMN id_tarea ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_tarea_id_tarea_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_unidad_archivo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_archivo (
    id_archivo integer NOT NULL,
    id_unidad integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    titulo character varying(150) NOT NULL,
    nombre character varying(200) NOT NULL,
    tipo character varying(15) NOT NULL,
    mime character varying(40) NOT NULL,
    bytes integer NOT NULL,
    sha256 character(64) NOT NULL,
    id_autor integer,
    autor_nombre text NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    retirado boolean DEFAULT false NOT NULL,
    motivo_retiro character varying(1000),
    CONSTRAINT crm_unidad_archivo_bytes_check CHECK (((bytes >= 1) AND (bytes <= 5242880))),
    CONSTRAINT crm_unidad_archivo_check CHECK (((retirado AND (motivo_retiro IS NOT NULL) AND (length(btrim((motivo_retiro)::text)) > 0)) OR ((NOT retirado) AND (motivo_retiro IS NULL)))),
    CONSTRAINT crm_unidad_archivo_mime_check CHECK (((mime)::text = ANY ((ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying, 'application/pdf'::character varying])::text[]))),
    CONSTRAINT crm_unidad_archivo_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Foto'::character varying, 'Documento'::character varying])::text[]))),
    CONSTRAINT crm_unidad_archivo_titulo_check CHECK ((length(btrim((titulo)::text)) > 0))
);


--
-- Name: crm_unidad_archivo_contenido; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_archivo_contenido (
    id_archivo integer NOT NULL,
    contenido bytea NOT NULL,
    CONSTRAINT crm_unidad_archivo_contenido_contenido_check CHECK (((octet_length(contenido) >= 1) AND (octet_length(contenido) <= 5242880)))
);


--
-- Name: crm_unidad_archivo_id_archivo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_unidad_archivo ALTER COLUMN id_archivo ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_unidad_archivo_id_archivo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_unidad_cliente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_cliente (
    id_unidad integer NOT NULL,
    id_cliente integer,
    id_oportunidad integer,
    vin character varying(17),
    esn character varying(50),
    numero_economico character varying(50),
    marca character varying(80),
    modelo character varying(100),
    anio smallint,
    motor character varying(120),
    notas character varying(1000),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transmision character varying(120),
    diferencial character varying(120),
    placas character varying(20),
    CONSTRAINT crm_unidad_cliente_anio_check CHECK (((anio >= 1900) AND (anio <= 2200))),
    CONSTRAINT crm_unidad_esn_no_vacio CHECK (((esn IS NULL) OR (length(btrim((esn)::text)) >= 3))),
    CONSTRAINT crm_unidad_identificador CHECK (((vin IS NOT NULL) OR (esn IS NOT NULL))),
    CONSTRAINT crm_unidad_propietario CHECK (((id_cliente IS NOT NULL) OR (id_oportunidad IS NOT NULL))),
    CONSTRAINT crm_unidad_vin_valido CHECK (((vin IS NULL) OR ((vin)::text ~ '^[A-HJ-NPR-Z0-9]{17}$'::text)))
);


--
-- Name: crm_unidad_cliente_id_unidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_unidad_cliente ALTER COLUMN id_unidad ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_unidad_cliente_id_unidad_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_unidad_lectura; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_lectura (
    id_lectura integer NOT NULL,
    id_unidad integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    fecha timestamp with time zone NOT NULL,
    kilometraje numeric(14,2),
    horas numeric(14,2),
    notas character varying(1000) DEFAULT ''::character varying NOT NULL,
    id_autor integer,
    autor_nombre text NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    anulada boolean DEFAULT false NOT NULL,
    motivo_anulacion character varying(1000),
    CONSTRAINT crm_unidad_lectura_check CHECK (((kilometraje IS NOT NULL) OR (horas IS NOT NULL))),
    CONSTRAINT crm_unidad_lectura_check1 CHECK (((anulada AND (motivo_anulacion IS NOT NULL) AND (length(btrim((motivo_anulacion)::text)) > 0)) OR ((NOT anulada) AND (motivo_anulacion IS NULL)))),
    CONSTRAINT crm_unidad_lectura_horas_check CHECK ((horas >= (0)::numeric)),
    CONSTRAINT crm_unidad_lectura_kilometraje_check CHECK ((kilometraje >= (0)::numeric))
);


--
-- Name: crm_unidad_lectura_id_lectura_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_unidad_lectura ALTER COLUMN id_lectura ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_unidad_lectura_id_lectura_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_unidad_mantenimiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_mantenimiento (
    id_mantenimiento integer NOT NULL,
    id_unidad integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    titulo character varying(150) NOT NULL,
    notas character varying(1000) DEFAULT ''::character varying NOT NULL,
    fecha_objetivo date,
    kilometraje_objetivo numeric(14,2),
    horas_objetivo numeric(14,2),
    estado character varying(15) DEFAULT 'Pendiente'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    fecha_realizada timestamp with time zone,
    detalle_cierre character varying(1000),
    id_autor integer,
    autor_nombre text NOT NULL,
    id_cierre integer,
    cierre_nombre text,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_unidad_mantenimiento_check CHECK (((fecha_objetivo IS NOT NULL) OR (kilometraje_objetivo IS NOT NULL) OR (horas_objetivo IS NOT NULL))),
    CONSTRAINT crm_unidad_mantenimiento_check1 CHECK (((((estado)::text = 'Pendiente'::text) AND (fecha_realizada IS NULL) AND (detalle_cierre IS NULL)) OR (((estado)::text = 'Realizado'::text) AND (fecha_realizada IS NOT NULL) AND (detalle_cierre IS NOT NULL) AND (length(btrim((detalle_cierre)::text)) > 0)) OR (((estado)::text = 'Cancelado'::text) AND (fecha_realizada IS NULL) AND (detalle_cierre IS NOT NULL) AND (length(btrim((detalle_cierre)::text)) > 0)))),
    CONSTRAINT crm_unidad_mantenimiento_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Realizado'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT crm_unidad_mantenimiento_horas_objetivo_check CHECK ((horas_objetivo >= (0)::numeric)),
    CONSTRAINT crm_unidad_mantenimiento_kilometraje_objetivo_check CHECK ((kilometraje_objetivo >= (0)::numeric)),
    CONSTRAINT crm_unidad_mantenimiento_titulo_check CHECK ((length(btrim((titulo)::text)) > 0)),
    CONSTRAINT crm_unidad_mantenimiento_version_check CHECK ((version > 0))
);


--
-- Name: crm_unidad_mantenimiento_id_mantenimiento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_unidad_mantenimiento ALTER COLUMN id_mantenimiento ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_unidad_mantenimiento_id_mantenimiento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_unidad_pieza; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_pieza (
    id_pieza integer NOT NULL,
    id_unidad integer NOT NULL,
    id_concepto integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    fecha timestamp with time zone NOT NULL,
    detalle character varying(1000) NOT NULL,
    codigo text NOT NULL,
    descripcion text NOT NULL,
    vin text,
    esn text,
    compatibilidad character varying(20) NOT NULL,
    referencia character varying(1000) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    id_autor integer,
    autor_nombre text NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    revision_nombre text NOT NULL,
    revision_en timestamp with time zone DEFAULT now() NOT NULL,
    anulada boolean DEFAULT false NOT NULL,
    motivo_anulacion character varying(1000),
    CONSTRAINT crm_unidad_pieza_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT crm_unidad_pieza_check CHECK (((anulada AND (motivo_anulacion IS NOT NULL) AND (length(btrim((motivo_anulacion)::text)) > 0)) OR ((NOT anulada) AND (motivo_anulacion IS NULL)))),
    CONSTRAINT crm_unidad_pieza_compatibilidad_check CHECK (((compatibilidad)::text = ANY ((ARRAY['Pendiente'::character varying, 'Verificada'::character varying, 'Incompatible'::character varying])::text[]))),
    CONSTRAINT crm_unidad_pieza_detalle_check CHECK ((length(btrim((detalle)::text)) > 0)),
    CONSTRAINT crm_unidad_pieza_referencia_check CHECK ((length(btrim((referencia)::text)) > 0)),
    CONSTRAINT crm_unidad_pieza_version_check CHECK ((version > 0))
);


--
-- Name: crm_unidad_pieza_garantia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_unidad_pieza_garantia (
    id_vinculo integer NOT NULL,
    id_pieza integer NOT NULL,
    id_garantia integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    motivo character varying(1000) NOT NULL,
    id_autor integer,
    autor_nombre text NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    retirado boolean DEFAULT false NOT NULL,
    motivo_retiro character varying(1000),
    CONSTRAINT crm_unidad_pieza_garantia_check CHECK (((retirado AND (motivo_retiro IS NOT NULL) AND (length(btrim((motivo_retiro)::text)) > 0)) OR ((NOT retirado) AND (motivo_retiro IS NULL)))),
    CONSTRAINT crm_unidad_pieza_garantia_motivo_check CHECK ((length(btrim((motivo)::text)) > 0))
);


--
-- Name: crm_unidad_pieza_garantia_id_vinculo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_unidad_pieza_garantia ALTER COLUMN id_vinculo ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_unidad_pieza_garantia_id_vinculo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: crm_unidad_pieza_id_pieza_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.crm_unidad_pieza ALTER COLUMN id_pieza ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.crm_unidad_pieza_id_pieza_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cuenta_contable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuenta_contable (
    id_cuenta integer NOT NULL,
    codigo character varying(20) NOT NULL,
    nombre character varying(150) NOT NULL,
    tipo character varying(20) NOT NULL,
    naturaleza character(1) NOT NULL,
    id_padre integer,
    acepta_movimientos boolean DEFAULT true NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT cuenta_contable_naturaleza_check CHECK ((naturaleza = ANY (ARRAY['D'::bpchar, 'A'::bpchar]))),
    CONSTRAINT cuenta_contable_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Activo'::character varying, 'Pasivo'::character varying, 'Capital'::character varying, 'Ingreso'::character varying, 'Gasto'::character varying])::text[])))
);


--
-- Name: cuenta_contable_id_cuenta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cuenta_contable_id_cuenta_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cuenta_contable_id_cuenta_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cuenta_contable_id_cuenta_seq OWNED BY public.cuenta_contable.id_cuenta;


--
-- Name: cuentabancaria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuentabancaria (
    "IdCuentaBancaria" integer NOT NULL,
    "IdTipoEntidad" integer NOT NULL,
    "IdEntidad" integer NOT NULL,
    "IdBanco" integer NOT NULL,
    "NombreCorto" character varying(40) NOT NULL,
    "NumeroCuenta" character varying(20) NOT NULL,
    "CuentaActiva" boolean DEFAULT true,
    "Predeterminada" boolean DEFAULT false
);


--
-- Name: cuentabancaria_IdCuentaBancaria_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cuentabancaria ALTER COLUMN "IdCuentaBancaria" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."cuentabancaria_IdCuentaBancaria_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: detalle_compra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_compra (
    id_detalle integer NOT NULL,
    id_compra integer NOT NULL,
    id_producto integer,
    descripcion_producto text,
    cantidad numeric(18,6) NOT NULL,
    costo_unitario numeric(18,6) NOT NULL,
    importe numeric(18,2) NOT NULL,
    CONSTRAINT detalle_compra_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT detalle_compra_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric))
);


--
-- Name: detalle_compra_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.detalle_compra ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.detalle_compra_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: devolucion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devolucion (
    id_devolucion integer NOT NULL,
    id_factura integer NOT NULL,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    monto_total numeric(10,2) DEFAULT 0 NOT NULL,
    metodo_reembolso character varying(50) NOT NULL,
    uuid_cfdi_egreso character varying(36),
    cfdi_json jsonb,
    id_gasto_reembolso integer
);


--
-- Name: COLUMN devolucion.id_gasto_reembolso; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.devolucion.id_gasto_reembolso IS 'Gasto creado en la misma transacción de una nueva devolución en efectivo; NULL histórico requiere conciliación.';


--
-- Name: devolucion_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devolucion_detalle (
    id_devolucion integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(14,4) NOT NULL,
    precio_unitario numeric(10,2) NOT NULL,
    importe_reembolso numeric(14,2),
    CONSTRAINT ck_devolucion_detalle_cantidad_positiva CHECK ((cantidad > (0)::numeric))
);


--
-- Name: devolucion_id_devolucion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.devolucion_id_devolucion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: devolucion_id_devolucion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.devolucion_id_devolucion_seq OWNED BY public.devolucion.id_devolucion;


--
-- Name: devolucion_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devolucion_proveedor (
    id_devolucion bigint NOT NULL,
    request_id uuid NOT NULL,
    id_recepcion integer NOT NULL,
    id_proveedor integer NOT NULL,
    motivo character varying(500) NOT NULL,
    estado character varying(20) DEFAULT 'Enviada'::character varying NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT devolucion_proveedor_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Enviada'::character varying, 'Acreditada'::character varying, 'Cancelada'::character varying])::text[])))
);


--
-- Name: devolucion_proveedor_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devolucion_proveedor_detalle (
    id_detalle bigint NOT NULL,
    id_devolucion bigint NOT NULL,
    id_recepcion_detalle integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    costo_unitario numeric(18,6) NOT NULL,
    CONSTRAINT devolucion_proveedor_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT devolucion_proveedor_detalle_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric))
);


--
-- Name: devolucion_proveedor_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.devolucion_proveedor_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.devolucion_proveedor_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: devolucion_proveedor_id_devolucion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.devolucion_proveedor ALTER COLUMN id_devolucion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.devolucion_proveedor_id_devolucion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documento_salida; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_salida (
    id uuid NOT NULL,
    id_factura integer NOT NULL,
    id_cliente integer NOT NULL,
    id_actor integer NOT NULL,
    modo character varying(10) DEFAULT 'Local'::character varying NOT NULL,
    origen_sha256 character(64) NOT NULL,
    contenido_sha256 character(64) NOT NULL,
    pdf_sha256 character(64) NOT NULL,
    huella character(64) NOT NULL,
    ambiente character varying(12) NOT NULL,
    bytes integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT documento_salida_ambiente_check CHECK (((ambiente)::text = ANY ((ARRAY['mock'::character varying, 'sandbox'::character varying, 'production'::character varying])::text[]))),
    CONSTRAINT documento_salida_bytes_check CHECK (((bytes >= 1) AND (bytes <= 2097152))),
    CONSTRAINT documento_salida_contenido_sha256_check CHECK ((contenido_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT documento_salida_huella_check CHECK ((huella ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT documento_salida_modo_check CHECK (((modo)::text = 'Local'::text)),
    CONSTRAINT documento_salida_origen_sha256_check CHECK ((origen_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT documento_salida_pdf_sha256_check CHECK ((pdf_sha256 ~ '^[a-f0-9]{64}$'::text))
);


--
-- Name: documento_salida_archivo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_salida_archivo (
    id uuid NOT NULL,
    destinatario character varying(254) NOT NULL,
    asunto character varying(300) NOT NULL,
    cuerpo character varying(4000) NOT NULL,
    contenido bytea NOT NULL,
    CONSTRAINT documento_salida_archivo_contenido_check CHECK ((((octet_length(contenido) >= 1) AND (octet_length(contenido) <= 2097152)) AND (SUBSTRING(contenido FROM 1 FOR 4) = decode('25504446'::text, 'hex'::text))))
);


--
-- Name: documento_salida_cierre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_salida_cierre (
    id uuid NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    accion character varying(10) NOT NULL,
    motivo character varying(300),
    id_actor integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT documento_salida_cierre_accion_check CHECK (((accion)::text = ANY ((ARRAY['Simulado'::character varying, 'Cancelado'::character varying, 'Obsoleto'::character varying])::text[]))),
    CONSTRAINT documento_salida_cierre_check CHECK (((((accion)::text = 'Cancelado'::text) AND (motivo IS NOT NULL) AND (length(TRIM(BOTH FROM motivo)) > 0)) OR (((accion)::text <> 'Cancelado'::text) AND (motivo IS NULL)))),
    CONSTRAINT documento_salida_cierre_huella_check CHECK ((huella ~ '^[a-f0-9]{64}$'::text))
);


--
-- Name: email; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email (
    "IdEmail" integer NOT NULL,
    "IdEntidad" integer NOT NULL,
    "IdTipoEntidad" integer NOT NULL,
    "Nombre" character varying(40) NOT NULL,
    "Correo" character varying(100) NOT NULL,
    "Principal" boolean DEFAULT false
);


--
-- Name: email_IdEmail_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.email ALTER COLUMN "IdEmail" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."email_IdEmail_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: emisor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emisor (
    "IdEmisor" integer NOT NULL,
    "RFC" character varying(13) NOT NULL,
    "RazonSocial" character varying(255) NOT NULL,
    "Pais" character varying(50) DEFAULT 'México'::character varying,
    "IdEstado" integer,
    "IdMunicipio" integer,
    "Ciudad" character varying(50),
    "Colonia" character varying(100),
    "Calle" character varying(100),
    "CodigoPostal" character varying(5) NOT NULL,
    "NumeroExterior" character varying(20),
    "NumeroInterior" character varying(20),
    "Referencia" character varying(100),
    "IdRegimenFiscal" integer NOT NULL,
    "ClaveEstado" character varying(3),
    "ClaveMunicipio" character varying(3)
);


--
-- Name: emisor_IdEmisor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.emisor ALTER COLUMN "IdEmisor" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."emisor_IdEmisor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: entrega_pedido; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrega_pedido (
    id_entrega bigint NOT NULL,
    id_pedido integer NOT NULL,
    recibido_por character varying(200),
    notas character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: entrega_pedido_id_entrega_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.entrega_pedido ALTER COLUMN id_entrega ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.entrega_pedido_id_entrega_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: estado_IdEstado_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.estado ALTER COLUMN "IdEstado" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."estado_IdEstado_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: evaluacion_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluacion_proveedor (
    id_evaluacion bigint NOT NULL,
    id_proveedor integer NOT NULL,
    id_orden integer,
    precio smallint NOT NULL,
    entrega smallint NOT NULL,
    calidad smallint NOT NULL,
    atencion smallint NOT NULL,
    comentario character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT evaluacion_proveedor_atencion_check CHECK (((atencion >= 1) AND (atencion <= 5))),
    CONSTRAINT evaluacion_proveedor_calidad_check CHECK (((calidad >= 1) AND (calidad <= 5))),
    CONSTRAINT evaluacion_proveedor_entrega_check CHECK (((entrega >= 1) AND (entrega <= 5))),
    CONSTRAINT evaluacion_proveedor_precio_check CHECK (((precio >= 1) AND (precio <= 5)))
);


--
-- Name: evaluacion_proveedor_id_evaluacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.evaluacion_proveedor ALTER COLUMN id_evaluacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.evaluacion_proveedor_id_evaluacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: factura_id_factura_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.factura ALTER COLUMN id_factura ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.factura_id_factura_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: factura_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura_proveedor (
    id_factura_proveedor bigint NOT NULL,
    request_id uuid NOT NULL,
    id_proveedor integer NOT NULL,
    id_orden integer NOT NULL,
    serie character varying(30),
    folio character varying(80) NOT NULL,
    uuid uuid,
    fecha_emision date NOT NULL,
    fecha_recepcion date DEFAULT CURRENT_DATE NOT NULL,
    fecha_vencimiento date NOT NULL,
    moneda character varying(3) DEFAULT 'MXN'::character varying NOT NULL,
    tipo_cambio numeric(18,6) DEFAULT 1 NOT NULL,
    subtotal numeric(18,2) NOT NULL,
    impuestos numeric(18,2) DEFAULT 0 NOT NULL,
    retenciones numeric(18,2) DEFAULT 0 NOT NULL,
    total numeric(18,2) NOT NULL,
    saldo_pendiente numeric(18,2) NOT NULL,
    estado character varying(30) DEFAULT 'Por conciliar'::character varying NOT NULL,
    xml_original text,
    pdf_original bytea,
    pdf_mime character varying(80),
    xml_sha256 character(64),
    pdf_sha256 character(64),
    observaciones character varying(1000),
    id_user integer,
    aprobada_por integer,
    aprobada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    cancelada_por integer,
    cancelada_at timestamp with time zone,
    motivo_cancelacion character varying(1000),
    CONSTRAINT factura_proveedor_estado_check CHECK (((estado)::text = ANY ((ARRAY['Por conciliar'::character varying, 'Con discrepancias'::character varying, 'Conciliada'::character varying, 'Aprobada'::character varying, 'Parcialmente pagada'::character varying, 'Pagada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT factura_proveedor_impuestos_check CHECK ((impuestos >= (0)::numeric)),
    CONSTRAINT factura_proveedor_retenciones_check CHECK ((retenciones >= (0)::numeric)),
    CONSTRAINT factura_proveedor_saldo_pendiente_check CHECK ((saldo_pendiente >= (0)::numeric)),
    CONSTRAINT factura_proveedor_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT factura_proveedor_tipo_cambio_check CHECK ((tipo_cambio > (0)::numeric)),
    CONSTRAINT factura_proveedor_total_check CHECK ((total > (0)::numeric))
);


--
-- Name: factura_proveedor_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura_proveedor_detalle (
    id_detalle bigint NOT NULL,
    id_factura_proveedor bigint NOT NULL,
    id_orden_detalle integer NOT NULL,
    id_producto integer NOT NULL,
    descripcion character varying(500) NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    costo_unitario numeric(18,6) NOT NULL,
    tasa_iva numeric(9,6) DEFAULT 0 NOT NULL,
    importe numeric(18,2) NOT NULL,
    CONSTRAINT factura_proveedor_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT factura_proveedor_detalle_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric)),
    CONSTRAINT factura_proveedor_detalle_importe_check CHECK ((importe >= (0)::numeric)),
    CONSTRAINT factura_proveedor_detalle_tasa_iva_check CHECK ((tasa_iva >= (0)::numeric))
);


--
-- Name: factura_proveedor_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.factura_proveedor_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: factura_proveedor_detalle_id_detalle_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.factura_proveedor_detalle_id_detalle_seq OWNED BY public.factura_proveedor_detalle.id_detalle;


--
-- Name: factura_proveedor_discrepancia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura_proveedor_discrepancia (
    id_discrepancia bigint NOT NULL,
    id_factura_proveedor bigint NOT NULL,
    id_factura_detalle bigint,
    tipo character varying(25) NOT NULL,
    esperado numeric(18,6),
    recibido numeric(18,6),
    diferencia numeric(18,6),
    estado character varying(15) DEFAULT 'Pendiente'::character varying NOT NULL,
    justificacion character varying(1000),
    resuelta_por integer,
    resuelta_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT factura_proveedor_discrepancia_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Aprobada'::character varying, 'Rechazada'::character varying])::text[]))),
    CONSTRAINT factura_proveedor_discrepancia_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Cantidad'::character varying, 'Precio'::character varying, 'Impuesto'::character varying, 'Sin recepcion'::character varying])::text[])))
);


--
-- Name: factura_proveedor_discrepancia_id_discrepancia_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.factura_proveedor_discrepancia_id_discrepancia_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: factura_proveedor_discrepancia_id_discrepancia_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.factura_proveedor_discrepancia_id_discrepancia_seq OWNED BY public.factura_proveedor_discrepancia.id_discrepancia;


--
-- Name: factura_proveedor_id_factura_proveedor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.factura_proveedor_id_factura_proveedor_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: factura_proveedor_id_factura_proveedor_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.factura_proveedor_id_factura_proveedor_seq OWNED BY public.factura_proveedor.id_factura_proveedor;


--
-- Name: factura_proveedor_pago; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura_proveedor_pago (
    id_pago bigint NOT NULL,
    request_id uuid NOT NULL,
    id_factura_proveedor bigint NOT NULL,
    id_programacion bigint,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    monto numeric(18,2) NOT NULL,
    forma_pago character varying(40) NOT NULL,
    referencia character varying(120),
    notas character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    estado character varying(12) DEFAULT 'Activo'::character varying NOT NULL,
    revertido_por integer,
    revertido_at timestamp with time zone,
    motivo_reversion character varying(1000),
    CONSTRAINT factura_proveedor_pago_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'Revertido'::character varying])::text[]))),
    CONSTRAINT factura_proveedor_pago_monto_check CHECK ((monto > (0)::numeric))
);


--
-- Name: factura_proveedor_pago_id_pago_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.factura_proveedor_pago_id_pago_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: factura_proveedor_pago_id_pago_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.factura_proveedor_pago_id_pago_seq OWNED BY public.factura_proveedor_pago.id_pago;


--
-- Name: factura_proveedor_programacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura_proveedor_programacion (
    id_programacion bigint NOT NULL,
    id_factura_proveedor bigint NOT NULL,
    fecha_programada date NOT NULL,
    monto numeric(18,2) NOT NULL,
    estado character varying(15) DEFAULT 'Pendiente'::character varying NOT NULL,
    notas character varying(500),
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT factura_proveedor_programacion_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Pagada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT factura_proveedor_programacion_monto_check CHECK ((monto > (0)::numeric))
);


--
-- Name: factura_proveedor_programacion_id_programacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.factura_proveedor_programacion_id_programacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: factura_proveedor_programacion_id_programacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.factura_proveedor_programacion_id_programacion_seq OWNED BY public.factura_proveedor_programacion.id_programacion;


--
-- Name: factura_proveedor_recepcion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.factura_proveedor_recepcion (
    id_factura_detalle bigint NOT NULL,
    id_recepcion_detalle integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    CONSTRAINT factura_proveedor_recepcion_cantidad_check CHECK ((cantidad > (0)::numeric))
);


--
-- Name: fiscal_documento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_documento (
    id_documento bigint NOT NULL,
    tipo character varying(12) NOT NULL,
    id_factura integer,
    id_rep integer,
    proveedor character varying(30) NOT NULL,
    ambiente character varying(15) NOT NULL,
    estado character varying(30) DEFAULT 'Borrador'::character varying NOT NULL,
    uuid uuid,
    xml_timbrado text,
    acuse_cancelacion text,
    fecha_timbrado timestamp with time zone,
    fecha_cancelacion timestamp with time zone,
    no_certificado_sat character varying(40),
    no_certificado_cfdi character varying(40),
    sello_sat text,
    sello_cfdi text,
    cadena_original_sat text,
    motivo_cancelacion character(2),
    folio_sustitucion uuid,
    codigo_cancelacion character varying(20),
    mensaje_cancelacion text,
    ultimo_error text,
    intentos integer DEFAULT 0 NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT fiscal_documento_ambiente_check CHECK (((ambiente)::text = ANY ((ARRAY['mock'::character varying, 'sandbox'::character varying, 'production'::character varying])::text[]))),
    CONSTRAINT fiscal_documento_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Procesando'::character varying, 'Timbrado'::character varying, 'Cancelacion solicitada'::character varying, 'Cancelado'::character varying, 'Error'::character varying])::text[]))),
    CONSTRAINT fiscal_documento_intentos_check CHECK ((intentos >= 0)),
    CONSTRAINT fiscal_documento_origen_chk CHECK (((((tipo)::text = 'FACTURA'::text) AND (id_factura IS NOT NULL) AND (id_rep IS NULL)) OR (((tipo)::text = 'REP'::text) AND (id_rep IS NOT NULL) AND (id_factura IS NULL)))),
    CONSTRAINT fiscal_documento_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['FACTURA'::character varying, 'REP'::character varying])::text[])))
);


--
-- Name: TABLE fiscal_documento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fiscal_documento IS 'Estado fiscal autoritativo, XML timbrado y acuse. Las facturas y REP conservan su ciclo operativo por separado.';


--
-- Name: COLUMN fiscal_documento.xml_timbrado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fiscal_documento.xml_timbrado IS 'XML fiscal devuelto por el PAC. Debe incluirse en respaldos protegidos.';


--
-- Name: fiscal_documento_id_documento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fiscal_documento_id_documento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fiscal_documento_id_documento_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fiscal_documento_id_documento_seq OWNED BY public.fiscal_documento.id_documento;


--
-- Name: fiscal_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_evento (
    id_evento bigint NOT NULL,
    id_documento bigint NOT NULL,
    tipo character varying(40) NOT NULL,
    exito boolean NOT NULL,
    codigo character varying(80),
    mensaje text,
    detalle jsonb DEFAULT '{}'::jsonb NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: TABLE fiscal_evento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fiscal_evento IS 'Bitácora sin secretos de intentos de timbrado, cancelación y conciliación.';


--
-- Name: fiscal_evento_id_evento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fiscal_evento_id_evento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fiscal_evento_id_evento_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fiscal_evento_id_evento_seq OWNED BY public.fiscal_evento.id_evento;


--
-- Name: formadepago_IdFormaPago_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.formadepago ALTER COLUMN "IdFormaPago" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."formadepago_IdFormaPago_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: garantia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.garantia (
    id_garantia integer NOT NULL,
    id_factura integer NOT NULL,
    id_concepto integer NOT NULL,
    id_proveedor integer,
    estado character varying(30) DEFAULT 'Recibida'::character varying NOT NULL,
    motivo character varying(255) NOT NULL,
    resolucion text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cantidad numeric(14,4) DEFAULT 1 NOT NULL,
    destino_producto character varying(20) DEFAULT 'Revision'::character varying NOT NULL,
    evidencias jsonb DEFAULT '[]'::jsonb NOT NULL,
    id_user integer,
    fecha_compromiso timestamp with time zone DEFAULT (clock_timestamp() + '7 days'::interval) NOT NULL,
    CONSTRAINT ck_garantia_cantidad_positiva CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT ck_garantia_destino_producto CHECK (((destino_producto)::text = ANY ((ARRAY['Vendible'::character varying, 'Revision'::character varying, 'Proveedor'::character varying, 'Merma'::character varying])::text[]))),
    CONSTRAINT ck_garantia_evidencias_array CHECK ((jsonb_typeof(evidencias) = 'array'::text)),
    CONSTRAINT garantia_estado_check CHECK (((estado)::text = ANY ((ARRAY['Recibida'::character varying, 'En revision'::character varying, 'Enviada proveedor'::character varying, 'Aprobada'::character varying, 'Rechazada'::character varying, 'Cerrada'::character varying])::text[])))
);


--
-- Name: TABLE garantia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.garantia IS 'Seguimiento de reclamaciones vinculadas al renglón original de una venta.';


--
-- Name: garantia_id_garantia_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.garantia ALTER COLUMN id_garantia ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.garantia_id_garantia_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: gasto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gasto (
    id_gasto integer NOT NULL,
    fecha timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    concepto character varying(255) NOT NULL,
    monto numeric(18,2) NOT NULL,
    categoria character varying(100) NOT NULL,
    metodo_pago character varying(50) NOT NULL,
    id_user integer,
    id_compra integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    anulado boolean DEFAULT false NOT NULL
);


--
-- Name: gasto_id_gasto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gasto_id_gasto_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gasto_id_gasto_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gasto_id_gasto_seq OWNED BY public.gasto.id_gasto;


--
-- Name: historial_correos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_correos (
    id_historial integer NOT NULL,
    id_factura integer,
    fecha_envio timestamp with time zone DEFAULT now(),
    destinatario character varying(150),
    asunto character varying(200),
    estatus character varying(20) DEFAULT 'Enviado'::character varying
);


--
-- Name: historial_correos_id_historial_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.historial_correos ALTER COLUMN id_historial ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.historial_correos_id_historial_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: impuesto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impuesto (
    "IdImpuesto" bigint NOT NULL,
    "Clave" character varying,
    "Descripcion" character varying,
    "Retencion" character varying,
    "Traslado" character varying
);


--
-- Name: impuesto_IdImpuesto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.impuesto ALTER COLUMN "IdImpuesto" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."impuesto_IdImpuesto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: impuestoproducto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impuestoproducto (
    "IdImpuestoProducto" integer NOT NULL,
    "IdProducto" integer NOT NULL,
    "TipoEfecto" public.tipo_efecto_enum DEFAULT 'Traslado'::public.tipo_efecto_enum NOT NULL,
    "TipoImpuesto" public.tipo_impuesto_enum DEFAULT 'IVA'::public.tipo_impuesto_enum NOT NULL,
    "TipoFactor" public.tipo_factor_enum DEFAULT 'Tasa'::public.tipo_factor_enum NOT NULL,
    "TasaOCuota" numeric(10,6) DEFAULT 0.000000 NOT NULL,
    "IVAsobreIEPS" boolean DEFAULT false
);


--
-- Name: impuestoproducto_IdImpuestoProducto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.impuestoproducto ALTER COLUMN "IdImpuestoProducto" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."impuestoproducto_IdImpuestoProducto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario (
    "IdProducto" integer NOT NULL,
    "Existencias" numeric(10,2) DEFAULT 0.00 NOT NULL
);


--
-- Name: inventario_lote; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_lote (
    id_lote bigint NOT NULL,
    id_producto integer NOT NULL,
    id_ubicacion integer NOT NULL,
    lote character varying(80) NOT NULL,
    fecha_caducidad date,
    cantidad numeric(18,6) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventario_lote_cantidad_check CHECK ((cantidad >= (0)::numeric))
);


--
-- Name: inventario_lote_id_lote_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventario_lote ALTER COLUMN id_lote ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.inventario_lote_id_lote_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventario_serie; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_serie (
    id_serie bigint NOT NULL,
    id_producto integer NOT NULL,
    id_ubicacion integer,
    numero_serie character varying(120) NOT NULL,
    estado character varying(20) DEFAULT 'Disponible'::character varying NOT NULL,
    notas character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventario_serie_estado_check CHECK (((estado)::text = ANY ((ARRAY['Disponible'::character varying, 'Reservada'::character varying, 'Vendida'::character varying, 'Garantia'::character varying, 'Baja'::character varying])::text[])))
);


--
-- Name: inventario_serie_id_serie_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventario_serie ALTER COLUMN id_serie ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.inventario_serie_id_serie_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventario_ubicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_ubicacion (
    id_ubicacion integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(18,6) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventario_ubicacion_cantidad_check CHECK ((cantidad >= (0)::numeric))
);


--
-- Name: kardex; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kardex (
    id_kardex integer NOT NULL,
    id_producto integer NOT NULL,
    fecha timestamp with time zone DEFAULT now(),
    tipo_movimiento public.tipo_movimiento_enum NOT NULL,
    cantidad numeric(18,6) DEFAULT 0,
    stock_anterior numeric(18,6) DEFAULT 0 NOT NULL,
    stock_resultante numeric(18,6) DEFAULT 0 NOT NULL,
    precio_unitario numeric(18,2) NOT NULL,
    referencia character varying(255),
    id_referencia integer
);


--
-- Name: kardex_id_kardex_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.kardex ALTER COLUMN id_kardex ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.kardex_id_kardex_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lista_precio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lista_precio (
    id_lista integer NOT NULL,
    nombre character varying(100) NOT NULL,
    moneda character varying(3) DEFAULT 'MXN'::character varying NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lista_precio_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from)))
);


--
-- Name: lista_precio_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lista_precio_detalle (
    id_detalle integer NOT NULL,
    id_lista integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad_minima numeric(18,6) DEFAULT 1 NOT NULL,
    precio numeric(18,6) NOT NULL,
    CONSTRAINT lista_precio_detalle_cantidad_minima_check CHECK ((cantidad_minima > (0)::numeric)),
    CONSTRAINT lista_precio_detalle_precio_check CHECK ((precio >= (0)::numeric))
);


--
-- Name: lista_precio_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lista_precio_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.lista_precio_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lista_precio_id_lista_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.lista_precio ALTER COLUMN id_lista ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.lista_precio_id_lista_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: localidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.localidad (
    "IdLocalidad" integer NOT NULL,
    "Clave" character varying(2) NOT NULL,
    "ClaveEstado" character varying(3) NOT NULL,
    "Nombre" character varying(255) NOT NULL
);


--
-- Name: localidad_IdLocalidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.localidad ALTER COLUMN "IdLocalidad" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."localidad_IdLocalidad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: meses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meses (
    "IdMeses" bigint NOT NULL,
    "Clave" character varying,
    "Descripcion" character varying
);


--
-- Name: meses_IdMeses_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.meses ALTER COLUMN "IdMeses" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."meses_IdMeses_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: metododepago_IdMetodoDePago_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.metododepago ALTER COLUMN "IdMetodoDePago" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."metododepago_IdMetodoDePago_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: moneda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moneda (
    "IdMoneda" bigint NOT NULL,
    "Clave" character varying,
    "Descripcion" character varying,
    "Decimales" numeric
);


--
-- Name: moneda_IdMoneda_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.moneda ALTER COLUMN "IdMoneda" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."moneda_IdMoneda_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: municipio_IdMunicipio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.municipio ALTER COLUMN "IdMunicipio" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."municipio_IdMunicipio_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mv_clientes_cobranza; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_clientes_cobranza AS
 WITH historial AS (
         SELECT factura.id_cliente,
            count(*) AS compras,
            sum(factura.total) AS ingresos,
            sum(
                CASE
                    WHEN ((factura.saldo_pendiente > (0)::numeric) AND (factura.fecha_emision >= (CURRENT_DATE - '30 days'::interval))) THEN factura.saldo_pendiente
                    ELSE (0)::numeric
                END) AS deuda_0_30,
            sum(
                CASE
                    WHEN ((factura.saldo_pendiente > (0)::numeric) AND (factura.fecha_emision < (CURRENT_DATE - '30 days'::interval)) AND (factura.fecha_emision >= (CURRENT_DATE - '60 days'::interval))) THEN factura.saldo_pendiente
                    ELSE (0)::numeric
                END) AS deuda_31_60,
            sum(
                CASE
                    WHEN ((factura.saldo_pendiente > (0)::numeric) AND (factura.fecha_emision < (CURRENT_DATE - '60 days'::interval))) THEN factura.saldo_pendiente
                    ELSE (0)::numeric
                END) AS deuda_60_mas
           FROM public.factura
          WHERE (((factura.estatus)::text <> 'Cancelada'::text) AND (COALESCE(factura.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar))
          GROUP BY factura.id_cliente
        )
 SELECT 1 AS id,
    ((100.0 * (count(*) FILTER (WHERE (h.compras > 1)))::numeric) / (NULLIF(count(*), 0))::numeric) AS tasa_retencion_clientes,
    avg(COALESCE(h.ingresos, (0)::numeric)) AS valor_tiempo_vida,
    public.fn_plazo_pago_proveedores_90d() AS dias_cuentas_por_pagar,
    json_build_array(json_build_object('rango', '0-30 días', 'monto', COALESCE(sum(h.deuda_0_30), (0)::numeric)), json_build_object('rango', '31-60 días', 'monto', COALESCE(sum(h.deuda_31_60), (0)::numeric)), json_build_object('rango', '> 60 días', 'monto', COALESCE(sum(h.deuda_60_mas), (0)::numeric))) AS cuentas_por_cobrar
   FROM (public.cliente c
     LEFT JOIN historial h ON ((h.id_cliente = c."IdCliente")))
  WITH NO DATA;


--
-- Name: mv_inventario_almacen; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_inventario_almacen AS
 WITH entradapromedio AS (
         SELECT kardex.id_producto,
                CASE
                    WHEN bool_and(((kardex.precio_unitario IS NOT NULL) AND (kardex.precio_unitario >= (0)::numeric))) THEN (sum((kardex.cantidad * kardex.precio_unitario)) / NULLIF(sum(kardex.cantidad), (0)::numeric))
                    ELSE NULL::numeric
                END AS costo_promedio_entrada
           FROM public.kardex
          WHERE ((kardex.tipo_movimiento = 'COMPRA'::public.tipo_movimiento_enum) AND (kardex.cantidad > (0)::numeric) AND (kardex.fecha <= now()))
          GROUP BY kardex.id_producto
        ), ventasrecientes AS (
         SELECT cf.id_producto,
            sum(cf.cantidad) AS vendidos_90_dias,
            count(DISTINCT f.id_factura) AS facturas_90_dias
           FROM (public.conceptofactura cf
             JOIN public.factura f ON ((cf.id_factura = f.id_factura)))
          WHERE ((f.fecha_emision >= (CURRENT_DATE - '90 days'::interval)) AND (f.estatus = ANY (ARRAY['Timbrada'::public.estatus_factura_enum, 'Pagada'::public.estatus_factura_enum])) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar))
          GROUP BY cf.id_producto
        ), productostats AS (
         SELECT p."IdProducto" AS id_producto,
            p."Codigo" AS codigo_producto,
            p."Descripcion" AS descripcion_producto,
            p."Existencia" AS stock_actual,
            ep.costo_promedio_entrada AS costo_unitario_estimado,
            COALESCE(vr.vendidos_90_dias, (0)::numeric) AS vendidos_90_dias,
            COALESCE(vr.facturas_90_dias, (0)::bigint) AS facturas_90_dias,
            ( SELECT count(*) AS count
                   FROM public.kardex k
                  WHERE ((k.id_producto = p."IdProducto") AND (k.stock_resultante = (0)::numeric) AND (k.cantidad < (0)::numeric) AND (k.fecha >= (CURRENT_DATE - '365 days'::interval)))) AS eventos_quiebre_stock,
            ( SELECT COALESCE(sum((abs(k.cantidad) * k.precio_unitario)), (0)::numeric) AS "coalesce"
                   FROM public.kardex k
                  WHERE ((k.id_producto = p."IdProducto") AND ((k.tipo_movimiento = 'AJUSTE_MANUAL_STOCK'::public.tipo_movimiento_enum) OR ((k.referencia)::text ~~* '%merma%'::text)) AND (k.cantidad < (0)::numeric) AND (k.fecha >= (CURRENT_DATE - '365 days'::interval)))) AS valor_merma_anual
           FROM ((public.producto p
             LEFT JOIN entradapromedio ep ON ((p."IdProducto" = ep.id_producto)))
             LEFT JOIN ventasrecientes vr ON ((p."IdProducto" = vr.id_producto)))
        ), ultimaventa AS (
         SELECT cf.id_producto,
            max((f.fecha_emision)::date) AS ultima_venta
           FROM (public.conceptofactura cf
             JOIN public.factura f ON ((f.id_factura = cf.id_factura)))
          WHERE ((f.estatus = ANY (ARRAY['Timbrada'::public.estatus_factura_enum, 'Pagada'::public.estatus_factura_enum])) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar))
          GROUP BY cf.id_producto
        ), lentomovimiento AS (
         SELECT ps.codigo_producto AS codigo,
            ps.descripcion_producto AS descripcion,
                CASE
                    WHEN (uv.ultima_venta IS NOT NULL) THEN (CURRENT_DATE - uv.ultima_venta)
                    ELSE NULL::integer
                END AS dias_sin_ventas,
            ps.stock_actual AS existencia
           FROM (productostats ps
             LEFT JOIN ultimaventa uv ON ((uv.id_producto = ps.id_producto)))
          WHERE ((ps.facturas_90_dias = 0) AND (ps.stock_actual > (0)::numeric))
        ), shrinkagemensual AS (
         SELECT to_char(k.fecha, 'YYYY-MM'::text) AS mes,
            sum((abs(k.cantidad) * k.precio_unitario)) AS valor
           FROM public.kardex k
          WHERE (((k.tipo_movimiento = 'AJUSTE_MANUAL_STOCK'::public.tipo_movimiento_enum) OR ((k.referencia)::text ~~* '%merma%'::text)) AND (k.cantidad < (0)::numeric) AND (k.fecha >= (CURRENT_DATE - '365 days'::interval)))
          GROUP BY (to_char(k.fecha, 'YYYY-MM'::text))
          ORDER BY (to_char(k.fecha, 'YYYY-MM'::text))
        )
 SELECT 1 AS id,
        CASE
            WHEN (count(*) FILTER (WHERE ((stock_actual IS NULL) OR (stock_actual < (0)::numeric) OR ((stock_actual > (0)::numeric) AND (costo_unitario_estimado IS NULL)))) = 0) THEN COALESCE(sum((stock_actual * costo_unitario_estimado)), (0)::numeric)
            ELSE NULL::numeric
        END AS valor_total_inventario,
    sum(valor_merma_anual) AS merma_shrinkage,
    (sum((vendidos_90_dias * (4)::numeric)) / NULLIF(sum(stock_actual), (0)::numeric)) AS tasa_rotacion_inventario,
    sum(eventos_quiebre_stock) AS indice_quiebre_stock,
    (sum(stock_actual) / NULLIF((sum(vendidos_90_dias) / 90.0), (0)::numeric)) AS dias_inventario,
        CASE
            WHEN (count(*) FILTER (WHERE ((stock_actual IS NULL) OR (stock_actual < (0)::numeric) OR ((stock_actual > (0)::numeric) AND (costo_unitario_estimado IS NULL)))) = 0) THEN (sum((stock_actual * costo_unitario_estimado)) / NULLIF(sum(stock_actual), (0)::numeric))
            ELSE NULL::numeric
        END AS costo_aterrizado,
    NULL::numeric AS retorno_inversion_inventario,
    ( SELECT COALESCE(json_agg(json_build_object('codigo', lentomovimiento.codigo, 'descripcion', lentomovimiento.descripcion, 'dias_sin_ventas', lentomovimiento.dias_sin_ventas, 'existencia', lentomovimiento.existencia)), '[]'::json) AS "coalesce"
           FROM lentomovimiento) AS mercancia_lento_movimiento,
    ( SELECT COALESCE(json_agg(json_build_object('mes', shrinkagemensual.mes, 'valor', shrinkagemensual.valor)), '[]'::json) AS "coalesce"
           FROM shrinkagemensual) AS shrinkage_historico_json
   FROM productostats
  WITH NO DATA;


--
-- Name: pedido_venta_folio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedido_venta_folio_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedido_venta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_venta (
    id_pedido integer NOT NULL,
    folio bigint DEFAULT nextval('public.pedido_venta_folio_seq'::regclass) NOT NULL,
    request_id uuid NOT NULL,
    id_cliente integer NOT NULL,
    id_unidad integer,
    id_cotizacion integer,
    estado character varying(30) DEFAULT 'Borrador'::character varying NOT NULL,
    notas character varying(2000),
    subtotal numeric(18,2) NOT NULL,
    impuestos numeric(18,2) NOT NULL,
    total numeric(18,2) NOT NULL,
    id_vendedor integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pedido_venta_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Confirmado'::character varying, 'En espera'::character varying, 'Parcialmente surtido'::character varying, 'Surtido'::character varying, 'Entregado'::character varying, 'Facturado'::character varying, 'Cancelado'::character varying])::text[]))),
    CONSTRAINT pedido_venta_impuestos_check CHECK ((impuestos >= (0)::numeric)),
    CONSTRAINT pedido_venta_subtotal_check CHECK ((subtotal >= (0)::numeric)),
    CONSTRAINT pedido_venta_total_check CHECK ((total >= (0)::numeric))
);


--
-- Name: pedido_venta_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_venta_detalle (
    id_detalle integer NOT NULL,
    id_pedido integer NOT NULL,
    id_producto integer NOT NULL,
    descripcion character varying(500) NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    valor_unitario numeric(18,6) NOT NULL,
    tasa_iva numeric(9,6) DEFAULT 0 NOT NULL,
    importe numeric(18,2) NOT NULL,
    importe_iva numeric(18,2) NOT NULL,
    cantidad_reservada numeric(18,6) DEFAULT 0 NOT NULL,
    cantidad_surtida numeric(18,6) DEFAULT 0 NOT NULL,
    CONSTRAINT pedido_venta_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT pedido_venta_detalle_check CHECK (((cantidad_reservada >= (0)::numeric) AND (cantidad_reservada <= cantidad))),
    CONSTRAINT pedido_venta_detalle_check1 CHECK (((cantidad_surtida >= (0)::numeric) AND (cantidad_surtida <= cantidad_reservada))),
    CONSTRAINT pedido_venta_detalle_importe_check CHECK ((importe >= (0)::numeric)),
    CONSTRAINT pedido_venta_detalle_importe_iva_check CHECK ((importe_iva >= (0)::numeric)),
    CONSTRAINT pedido_venta_detalle_tasa_iva_check CHECK (((tasa_iva >= (0)::numeric) AND (tasa_iva <= (1)::numeric))),
    CONSTRAINT pedido_venta_detalle_valor_unitario_check CHECK ((valor_unitario >= (0)::numeric))
);


--
-- Name: mv_operaciones_avanzadas; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_operaciones_avanzadas AS
 WITH pedidos AS (
         SELECT sum(d.cantidad) AS solicitado,
            sum(d.cantidad_surtida) AS surtido
           FROM (public.pedido_venta p
             JOIN public.pedido_venta_detalle d USING (id_pedido))
          WHERE (((p.estado)::text <> ALL ((ARRAY['Borrador'::character varying, 'Cancelado'::character varying])::text[])) AND (p.created_at >= (CURRENT_DATE - '89 days'::interval)) AND (p.created_at < (CURRENT_DATE + '1 day'::interval)))
        ), cotizaciones AS (
         SELECT c.id_cotizacion,
            (EXISTS ( SELECT 1
                   FROM (public.factura f
                     LEFT JOIN public.pedido_venta pv ON ((pv.id_pedido = f.id_pedido)))
                  WHERE ((COALESCE(f.id_cotizacion, pv.id_cotizacion) = c.id_cotizacion) AND ((f.estatus)::text <> 'Cancelada'::text) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar)))) AS convertida
           FROM public.cotizacion c
          WHERE ((c.fecha_emision >= (CURRENT_DATE - '89 days'::interval)) AND (c.fecha_emision < (CURRENT_DATE + '1 day'::interval)))
        ), ventas AS (
         SELECT sum(cf.cantidad) AS cantidad
           FROM (public.conceptofactura cf
             JOIN public.factura f USING (id_factura))
          WHERE (((f.estatus)::text <> 'Cancelada'::text) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar) AND (f.fecha_emision >= (CURRENT_DATE - '89 days'::interval)) AND (f.fecha_emision < (CURRENT_DATE + '1 day'::interval)))
        ), devoluciones AS (
         SELECT to_char(d.fecha, 'YYYY-MM'::text) AS mes,
            sum(dd.cantidad) AS cantidad
           FROM ((public.devolucion d
             JOIN public.devolucion_detalle dd USING (id_devolucion))
             JOIN public.factura f ON ((f.id_factura = d.id_factura)))
          WHERE (((f.estatus)::text <> 'Cancelada'::text) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar) AND (d.fecha >= (CURRENT_DATE - '89 days'::interval)) AND (d.fecha < (CURRENT_DATE + '1 day'::interval)))
          GROUP BY (to_char(d.fecha, 'YYYY-MM'::text))
        ), marcas AS (
         SELECT p."Marca" AS marca,
                CASE
                    WHEN bool_and(m.costo_conocido) THEN sum(m.utilidad_bruta)
                    ELSE NULL::numeric
                END AS rentabilidad
           FROM (public.fn_get_margen_productos() m(id_producto, codigo, descripcion, cantidad_vendida, ingresos_totales, costo_total, utilidad_bruta, margen_porcentaje, costo_conocido)
             JOIN public.producto p ON ((p."IdProducto" = m.id_producto)))
          GROUP BY p."Marca"
        )
 SELECT 1 AS id,
    ( SELECT ((100.0 * (count(*) FILTER (WHERE cotizaciones.convertida))::numeric) / (NULLIF(count(*), 0))::numeric)
           FROM cotizaciones) AS tasa_conversion_cotizaciones,
    ( SELECT ((100.0 * COALESCE(sum(devoluciones.cantidad), (0)::numeric)) / ( SELECT NULLIF(ventas.cantidad, (0)::numeric) AS "nullif"
                   FROM ventas))
           FROM devoluciones) AS tasa_devoluciones,
    ( SELECT ((100.0 * pedidos.surtido) / NULLIF(pedidos.solicitado, (0)::numeric))
           FROM pedidos) AS tasa_cumplimiento,
    ( SELECT avg(v.distintos) AS avg
           FROM ( SELECT count(DISTINCT cf.id_producto) AS distintos
                   FROM (public.conceptofactura cf
                     JOIN public.factura f USING (id_factura))
                  WHERE (((f.estatus)::text <> 'Cancelada'::text) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar) AND (f.fecha_emision >= (CURRENT_DATE - '89 days'::interval)) AND (f.fecha_emision < (CURRENT_DATE + '1 day'::interval)))
                  GROUP BY f.id_factura) v) AS indice_ventas_cruzadas,
    ( SELECT COALESCE(json_agg(json_build_object('proveedor', 'Sin atribución a proveedor', 'marca', marcas.marca, 'rentabilidad', marcas.rentabilidad) ORDER BY marcas.marca), '[]'::json) AS "coalesce"
           FROM marcas) AS rentabilidad_proveedor_marca,
    ( SELECT COALESCE(json_agg(json_build_object('mes', devoluciones.mes, 'valor', devoluciones.cantidad) ORDER BY devoluciones.mes), '[]'::json) AS "coalesce"
           FROM devoluciones) AS tasa_de_devoluciones_historico
  WITH NO DATA;


--
-- Name: mv_ventas_facturacion; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_ventas_facturacion AS
 WITH margenes AS (
         SELECT fn_get_margen_productos.id_producto,
            fn_get_margen_productos.codigo,
            fn_get_margen_productos.descripcion,
            fn_get_margen_productos.cantidad_vendida,
            fn_get_margen_productos.ingresos_totales,
            fn_get_margen_productos.costo_total,
            fn_get_margen_productos.utilidad_bruta,
            fn_get_margen_productos.margen_porcentaje,
            fn_get_margen_productos.costo_conocido
           FROM public.fn_get_margen_productos() fn_get_margen_productos(id_producto, codigo, descripcion, cantidad_vendida, ingresos_totales, costo_total, utilidad_bruta, margen_porcentaje, costo_conocido)
        ), resumen AS (
         SELECT COALESCE(sum(margenes.ingresos_totales), (0)::numeric) AS ingresos,
                CASE
                    WHEN COALESCE(bool_and(margenes.costo_conocido), true) THEN COALESCE(sum(margenes.costo_total), (0)::numeric)
                    ELSE NULL::numeric
                END AS costo
           FROM margenes
        ), facturas AS (
         SELECT factura.id_factura,
            factura.id_cliente,
            factura.serie,
            factura.folio,
            factura.fecha_emision,
            factura.estatus,
            factura.rfc_receptor,
            factura.nombre_receptor,
            factura.codigo_postal_receptor,
            factura.regimen_fiscal_receptor_clave,
            factura.uso_cfdi_clave,
            factura.id_forma_pago,
            factura.id_metodo_pago,
            factura.id_uso_cfdi,
            factura.tipo_comprobante,
            factura.exportacion,
            factura.moneda,
            factura.tipo_cambio,
            factura.subtotal,
            factura.descuento,
            factura.total_impuestos_trasladados,
            factura.total_impuestos_retenidos,
            factura.total,
            factura.uuid,
            factura.xml_timbrado,
            factura.created_at,
            factura.saldo_pendiente,
            factura.id_vendedor,
            factura.comision_vendedor,
            factura.id_cotizacion,
            factura.id_factura_global,
            factura.id_factura_origen,
            factura.metodo_reembolso,
            factura.id_gasto_reembolso,
            factura.id_pedido,
            factura.id_unidad
           FROM public.factura
          WHERE (((factura.estatus)::text <> 'Cancelada'::text) AND (COALESCE(factura.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar))
        ), categorias AS (
         SELECT c."Descripcion" AS categoria,
            sum(m.ingresos_totales) AS ventas
           FROM ((margenes m
             JOIN public.producto p ON ((p."IdProducto" = m.id_producto)))
             JOIN public.categoria c ON ((c."IdCategoria" = p."IdCategoria")))
          GROUP BY c."Descripcion"
        ), actividad AS (
         SELECT EXTRACT(dow FROM facturas.fecha_emision) AS dia,
            EXTRACT(hour FROM facturas.fecha_emision) AS hora,
            sum(facturas.total) AS ventas
           FROM facturas
          GROUP BY (EXTRACT(dow FROM facturas.fecha_emision)), (EXTRACT(hour FROM facturas.fecha_emision))
        )
 SELECT 1 AS id,
    ( SELECT COALESCE(sum(facturas.subtotal), (0)::numeric) AS "coalesce"
           FROM facturas) AS ingresos_brutos,
    ingresos AS ingresos_netos,
    ( SELECT avg(facturas.total) AS avg
           FROM facturas) AS ticket_promedio,
    ((100.0 * (ingresos - costo)) / NULLIF(ingresos, (0)::numeric)) AS margen_utilidad_bruta,
    ( SELECT ((100.0 * sum(facturas.descuento)) / NULLIF(sum(facturas.subtotal), (0)::numeric))
           FROM facturas) AS descuento_promedio_otorgado,
    ( SELECT COALESCE(json_agg(json_build_object('categoria', categorias.categoria, 'ventas', categorias.ventas) ORDER BY categorias.categoria), '[]'::json) AS "coalesce"
           FROM categorias) AS ventas_por_categoria,
    ( SELECT COALESCE(json_agg(json_build_object('dia', actividad.dia, 'hora', actividad.hora, 'ventas', actividad.ventas) ORDER BY actividad.dia, actividad.hora), '[]'::json) AS "coalesce"
           FROM actividad) AS comportamiento_hora_dia
   FROM resumen r
  WITH NO DATA;


--
-- Name: nota_credito_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nota_credito_proveedor (
    id_nota bigint NOT NULL,
    request_id uuid NOT NULL,
    id_proveedor integer NOT NULL,
    uuid uuid,
    folio character varying(80) NOT NULL,
    fecha date NOT NULL,
    total numeric(18,2) NOT NULL,
    saldo_disponible numeric(18,2) NOT NULL,
    estado character varying(15) DEFAULT 'Disponible'::character varying NOT NULL,
    notas character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT nota_credito_proveedor_estado_check CHECK (((estado)::text = ANY ((ARRAY['Disponible'::character varying, 'Aplicada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT nota_credito_proveedor_saldo_disponible_check CHECK ((saldo_disponible >= (0)::numeric)),
    CONSTRAINT nota_credito_proveedor_total_check CHECK ((total > (0)::numeric))
);


--
-- Name: nota_credito_proveedor_id_nota_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nota_credito_proveedor_id_nota_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nota_credito_proveedor_id_nota_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nota_credito_proveedor_id_nota_seq OWNED BY public.nota_credito_proveedor.id_nota;


--
-- Name: objetoimpuesto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objetoimpuesto (
    "IdObjetoImpuesto" integer NOT NULL,
    "Clave" character varying(2) NOT NULL,
    "Descripcion" character varying(50) NOT NULL
);


--
-- Name: objetoimpuesto_IdObjetoImpuesto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.objetoimpuesto ALTER COLUMN "IdObjetoImpuesto" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."objetoimpuesto_IdObjetoImpuesto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: operation_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operation_idempotency (
    request_id uuid NOT NULL,
    operation_type character varying(30) NOT NULL,
    id_user integer,
    payload_hash character(64) NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE operation_idempotency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.operation_idempotency IS 'Resultados de operaciones críticas identificadas por UUID para responder reintentos sin duplicar efectos.';


--
-- Name: operational_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_job (
    name text NOT NULL,
    installed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    interval_seconds integer,
    grace_seconds integer DEFAULT 0 NOT NULL,
    CONSTRAINT operational_job_grace_seconds_check CHECK ((grace_seconds >= 0)),
    CONSTRAINT operational_job_interval_seconds_check CHECK ((interval_seconds > 0))
);


--
-- Name: operational_job_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_job_run (
    id uuid NOT NULL,
    job_name text NOT NULL,
    started_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finished_at timestamp with time zone,
    status text NOT NULL,
    CONSTRAINT operational_job_run_check CHECK ((((status = 'running'::text) AND (finished_at IS NULL)) OR ((status <> 'running'::text) AND (finished_at IS NOT NULL) AND (finished_at >= started_at)))),
    CONSTRAINT operational_job_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])))
);


--
-- Name: orden_compra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orden_compra (
    id_orden integer NOT NULL,
    folio bigint NOT NULL,
    request_id uuid NOT NULL,
    id_solicitud integer,
    id_proveedor integer NOT NULL,
    estado character varying(25) DEFAULT 'Emitida'::character varying NOT NULL,
    moneda character varying(3) DEFAULT 'MXN'::character varying NOT NULL,
    tipo_cambio numeric(18,6) DEFAULT 1 NOT NULL,
    fecha_promesa date,
    notas character varying(1000),
    subtotal numeric(18,2) NOT NULL,
    impuestos numeric(18,2) DEFAULT 0 NOT NULL,
    total numeric(18,2) NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origen character varying(30) DEFAULT 'Abastecimiento'::character varying NOT NULL,
    CONSTRAINT ck_orden_compra_origen CHECK (((origen)::text = ANY ((ARRAY['Abastecimiento'::character varying, 'Compra directa'::character varying])::text[]))),
    CONSTRAINT orden_compra_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Emitida'::character varying, 'Confirmada'::character varying, 'Parcialmente recibida'::character varying, 'Recibida'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT orden_compra_tipo_cambio_check CHECK ((tipo_cambio > (0)::numeric))
);


--
-- Name: orden_compra_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orden_compra_detalle (
    id_detalle integer NOT NULL,
    id_orden integer NOT NULL,
    id_producto integer NOT NULL,
    descripcion character varying(500) NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    cantidad_recibida numeric(18,6) DEFAULT 0 NOT NULL,
    costo_unitario numeric(18,6) NOT NULL,
    tasa_iva numeric(9,6) DEFAULT 0.16 NOT NULL,
    CONSTRAINT orden_compra_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT orden_compra_detalle_check CHECK (((cantidad_recibida >= (0)::numeric) AND (cantidad_recibida <= cantidad))),
    CONSTRAINT orden_compra_detalle_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric))
);


--
-- Name: orden_compra_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.orden_compra_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.orden_compra_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: orden_compra_folio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.orden_compra ALTER COLUMN folio ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.orden_compra_folio_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: orden_compra_id_orden_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.orden_compra ALTER COLUMN id_orden ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.orden_compra_id_orden_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pago; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pago (
    id_pago integer NOT NULL,
    id_factura integer NOT NULL,
    fecha_pago timestamp with time zone DEFAULT now(),
    monto numeric(18,2) NOT NULL,
    forma_pago character varying(50),
    referencia character varying(100),
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    id_cuenta_bancaria integer,
    id_rep integer,
    CONSTRAINT pago_monto_check CHECK ((monto > (0)::numeric))
);


--
-- Name: pago_id_pago_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pago ALTER COLUMN id_pago ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pago_id_pago_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pago_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pago_proveedor (
    id_pago_proveedor integer NOT NULL,
    id_compra integer NOT NULL,
    fecha_pago timestamp with time zone DEFAULT now(),
    monto numeric(18,2) NOT NULL,
    forma_pago character varying(50),
    referencia character varying(100),
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pago_proveedor_monto_check CHECK ((monto > (0)::numeric))
);


--
-- Name: pago_proveedor_id_pago_proveedor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pago_proveedor ALTER COLUMN id_pago_proveedor ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pago_proveedor_id_pago_proveedor_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pagodocumentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagodocumentos (
    "IdPagoDocumentos" integer NOT NULL,
    "IdComplementoPago" integer NOT NULL,
    "IdFactura" integer NOT NULL,
    "Parcialidad" integer DEFAULT 1 NOT NULL,
    "SaldoAnterior" numeric(10,6) NOT NULL,
    "ImportePagado" numeric(10,6) NOT NULL,
    "SaldoInsoluto" numeric(10,6) GENERATED ALWAYS AS (("SaldoAnterior" - "ImportePagado")) STORED,
    CONSTRAINT chk_pagodocumentos_montos CHECK ((("SaldoAnterior" > (0)::numeric) AND ("ImportePagado" > (0)::numeric))),
    CONSTRAINT chk_pagodocumentos_saldo CHECK ((("SaldoAnterior" - "ImportePagado") >= (0)::numeric))
);


--
-- Name: pagodocumentos_IdPagoDocumentos_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pagodocumentos ALTER COLUMN "IdPagoDocumentos" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."pagodocumentos_IdPagoDocumentos_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pagosdetalleproveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagosdetalleproveedor (
    "IdPagosDetalleProveedor" integer NOT NULL,
    "IdPagosProveedor" integer NOT NULL,
    "IdCompra" integer NOT NULL,
    "Parcialidad" integer DEFAULT 1,
    "SaldoAnterior" numeric(10,2) NOT NULL,
    "MontoPagado" numeric(10,2) NOT NULL,
    "SaldoRestante" numeric(10,2) GENERATED ALWAYS AS (("SaldoAnterior" - "MontoPagado")) STORED,
    CONSTRAINT chk_pagosdetalle_montos CHECK ((("SaldoAnterior" > (0)::numeric) AND ("MontoPagado" > (0)::numeric))),
    CONSTRAINT chk_pagosdetalle_saldo CHECK ((("SaldoAnterior" - "MontoPagado") >= (0)::numeric))
);


--
-- Name: pagosdetalleproveedor_IdPagosDetalleProveedor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pagosdetalleproveedor ALTER COLUMN "IdPagosDetalleProveedor" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."pagosdetalleproveedor_IdPagosDetalleProveedor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pagosproveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagosproveedor (
    "IdPagosProveedor" integer NOT NULL,
    "IdProveedor" integer NOT NULL,
    "IdFormaPago" integer NOT NULL,
    "FechaPago" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "TotalPago" numeric(10,2) NOT NULL,
    CONSTRAINT chk_pagosproveedor_total CHECK (("TotalPago" > (0)::numeric))
);


--
-- Name: pagosproveedor_IdPagosProveedor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pagosproveedor ALTER COLUMN "IdPagosProveedor" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."pagosproveedor_IdPagosProveedor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pedido_entrega_archivo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_entrega_archivo (
    id_entrega bigint NOT NULL,
    tipo character varying(5) NOT NULL,
    mime character varying(20) NOT NULL,
    sha256 character(64) NOT NULL,
    contenido bytea NOT NULL,
    CONSTRAINT pedido_entrega_archivo_contenido_check CHECK (((octet_length(contenido) >= 1) AND (octet_length(contenido) <= 5242880))),
    CONSTRAINT pedido_entrega_archivo_mime_check CHECK (((mime)::text = ANY ((ARRAY['image/png'::character varying, 'image/jpeg'::character varying, 'image/webp'::character varying])::text[]))),
    CONSTRAINT pedido_entrega_archivo_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['firma'::character varying, 'foto'::character varying])::text[])))
);


--
-- Name: pedido_entrega_evidencia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_entrega_evidencia (
    id_entrega bigint NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    autor_nombre text NOT NULL,
    snapshot jsonb NOT NULL,
    sha256 character(64) NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pedido_entrega_evidencia_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text))
);


--
-- Name: pedido_estado_historial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_estado_historial (
    id_historial bigint NOT NULL,
    id_pedido integer NOT NULL,
    estado_anterior character varying(30),
    estado_nuevo character varying(30) NOT NULL,
    detalle character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pedido_estado_historial_id_historial_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pedido_estado_historial ALTER COLUMN id_historial ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pedido_estado_historial_id_historial_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pedido_surtido_ubicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_surtido_ubicacion (
    id_surtido bigint NOT NULL,
    id_pedido integer NOT NULL,
    id_detalle integer NOT NULL,
    id_producto integer NOT NULL,
    id_ubicacion integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    cantidad_consumida numeric(18,6) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'Reservada'::character varying NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pedido_surtido_ubicacion_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT pedido_surtido_ubicacion_check CHECK (((cantidad_consumida >= (0)::numeric) AND (cantidad_consumida <= cantidad))),
    CONSTRAINT pedido_surtido_ubicacion_estado_check CHECK (((estado)::text = ANY ((ARRAY['Reservada'::character varying, 'Consumida'::character varying, 'Liberada'::character varying])::text[])))
);


--
-- Name: TABLE pedido_surtido_ubicacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pedido_surtido_ubicacion IS 'Lista de picking: ubicación física reservada durante el surtido y consumida al facturar.';


--
-- Name: pedido_surtido_ubicacion_id_surtido_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pedido_surtido_ubicacion ALTER COLUMN id_surtido ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pedido_surtido_ubicacion_id_surtido_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pedido_venta_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pedido_venta_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pedido_venta_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pedido_venta_id_pedido_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pedido_venta ALTER COLUMN id_pedido ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pedido_venta_id_pedido_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: periodicidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.periodicidad (
    "IdPeriodicidad" bigint NOT NULL,
    "Clave" character varying,
    "Descripcion" character varying
);


--
-- Name: periodicidad_IdPeriodicidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.periodicidad ALTER COLUMN "IdPeriodicidad" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."periodicidad_IdPeriodicidad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: periodo_contable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.periodo_contable (
    id_periodo integer NOT NULL,
    anio integer NOT NULL,
    mes integer NOT NULL,
    fecha_inicio date GENERATED ALWAYS AS (make_date(anio, mes, 1)) STORED,
    fecha_fin date GENERATED ALWAYS AS ((((make_date(anio, mes, 1) + '1 mon'::interval) - '1 day'::interval))::date) STORED,
    estado character varying(10) DEFAULT 'Abierto'::character varying NOT NULL,
    cerrado_por integer,
    cerrado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT periodo_contable_anio_check CHECK (((anio >= 2000) AND (anio <= 2200))),
    CONSTRAINT periodo_contable_check CHECK (((((estado)::text = 'Abierto'::text) AND (cerrado_at IS NULL)) OR (((estado)::text = 'Cerrado'::text) AND (cerrado_at IS NOT NULL) AND (cerrado_por IS NOT NULL)))),
    CONSTRAINT periodo_contable_estado_check CHECK (((estado)::text = ANY ((ARRAY['Abierto'::character varying, 'Cerrado'::character varying])::text[]))),
    CONSTRAINT periodo_contable_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);


--
-- Name: periodo_contable_id_periodo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.periodo_contable_id_periodo_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: periodo_contable_id_periodo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.periodo_contable_id_periodo_seq OWNED BY public.periodo_contable.id_periodo;


--
-- Name: poliza_contable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poliza_contable (
    id_poliza bigint NOT NULL,
    folio bigint NOT NULL,
    fecha date DEFAULT CURRENT_DATE NOT NULL,
    tipo character varying(10) NOT NULL,
    concepto character varying(300) NOT NULL,
    estado character varying(15) DEFAULT 'Borrador'::character varying NOT NULL,
    origen_tipo character varying(40),
    origen_id bigint,
    automatica boolean DEFAULT false NOT NULL,
    id_usuario integer,
    contabilizada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT poliza_contable_check CHECK ((((origen_tipo IS NULL) AND (origen_id IS NULL)) OR ((origen_tipo IS NOT NULL) AND (origen_id IS NOT NULL)))),
    CONSTRAINT poliza_contable_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Contabilizada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT poliza_contable_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Diario'::character varying, 'Ingreso'::character varying, 'Egreso'::character varying])::text[])))
);


--
-- Name: poliza_contable_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.poliza_contable_detalle (
    id_detalle bigint NOT NULL,
    id_poliza bigint NOT NULL,
    id_cuenta integer NOT NULL,
    concepto character varying(300),
    referencia character varying(120),
    debe numeric(18,2) DEFAULT 0 NOT NULL,
    haber numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    id_centro_costo integer DEFAULT public.fn_centro_general() NOT NULL,
    CONSTRAINT poliza_contable_detalle_check CHECK ((((debe > (0)::numeric) AND (haber = (0)::numeric)) OR ((haber > (0)::numeric) AND (debe = (0)::numeric)))),
    CONSTRAINT poliza_contable_detalle_debe_check CHECK ((debe >= (0)::numeric)),
    CONSTRAINT poliza_contable_detalle_haber_check CHECK ((haber >= (0)::numeric))
);


--
-- Name: poliza_contable_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.poliza_contable_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: poliza_contable_detalle_id_detalle_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.poliza_contable_detalle_id_detalle_seq OWNED BY public.poliza_contable_detalle.id_detalle;


--
-- Name: poliza_contable_folio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.poliza_contable ALTER COLUMN folio ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.poliza_contable_folio_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: poliza_contable_id_poliza_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.poliza_contable_id_poliza_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: poliza_contable_id_poliza_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.poliza_contable_id_poliza_seq OWNED BY public.poliza_contable.id_poliza;


--
-- Name: portal_acceso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_acceso (
    id_acceso integer NOT NULL,
    id_cliente integer NOT NULL,
    alias character varying(80) NOT NULL,
    nombre character varying(150) NOT NULL,
    estado character varying(12) DEFAULT 'Pendiente'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT portal_acceso_alias_check CHECK ((((alias)::text = lower((alias)::text)) AND ((alias)::text ~ '^[a-z0-9][a-z0-9._-]{2,79}$'::text))),
    CONSTRAINT portal_acceso_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Activo'::character varying, 'Suspendido'::character varying])::text[]))),
    CONSTRAINT portal_acceso_nombre_check CHECK ((length(btrim((nombre)::text)) > 0)),
    CONSTRAINT portal_acceso_version_check CHECK ((version > 0))
);


--
-- Name: portal_acceso_id_acceso_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.portal_acceso ALTER COLUMN id_acceso ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.portal_acceso_id_acceso_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: portal_credencial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_credencial (
    id_acceso integer NOT NULL,
    password_hash text,
    fallos integer DEFAULT 0 NOT NULL,
    bloqueado_hasta timestamp with time zone,
    CONSTRAINT portal_credencial_fallos_check CHECK ((fallos >= 0))
);


--
-- Name: portal_evento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_evento (
    id_evento bigint NOT NULL,
    id_acceso integer NOT NULL,
    tipo character varying(30) NOT NULL,
    motivo character varying(500) DEFAULT ''::character varying NOT NULL,
    request_id uuid,
    huella character(64),
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT portal_evento_check CHECK (((request_id IS NULL) = (huella IS NULL)))
);


--
-- Name: portal_evento_id_evento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.portal_evento ALTER COLUMN id_evento ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.portal_evento_id_evento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: portal_invitacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_invitacion (
    id_invitacion integer NOT NULL,
    id_acceso integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    token_hash character(64) NOT NULL,
    version integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    vence_en timestamp with time zone NOT NULL,
    usada_en timestamp with time zone,
    revocada boolean DEFAULT false NOT NULL,
    CONSTRAINT portal_invitacion_check CHECK ((vence_en > creada_en))
);


--
-- Name: portal_invitacion_id_invitacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.portal_invitacion ALTER COLUMN id_invitacion ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.portal_invitacion_id_invitacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: portal_publicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_publicacion (
    id_publicacion integer NOT NULL,
    id_cliente integer NOT NULL,
    tipo character varying(12) NOT NULL,
    origen integer NOT NULL,
    origen_sha256 character(64) NOT NULL,
    titulo character varying(200) NOT NULL,
    clase character varying(12) NOT NULL,
    mime character varying(40) NOT NULL,
    sha256 character(64) NOT NULL,
    bytes integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    motivo character varying(500) NOT NULL,
    id_user integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT portal_publicacion_bytes_check CHECK (((bytes >= 1) AND (bytes <= 2097152))),
    CONSTRAINT portal_publicacion_clase_check CHECK (((clase)::text = ANY ((ARRAY['mock'::character varying, 'sandbox'::character varying, 'production'::character varying, 'copia'::character varying])::text[]))),
    CONSTRAINT portal_publicacion_mime_check CHECK (((mime)::text = ANY ((ARRAY['application/xml'::character varying, 'application/pdf'::character varying])::text[]))),
    CONSTRAINT portal_publicacion_motivo_check CHECK ((length(btrim((motivo)::text)) > 0)),
    CONSTRAINT portal_publicacion_origen_check CHECK ((origen > 0)),
    CONSTRAINT portal_publicacion_origen_sha256_check CHECK ((origen_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT portal_publicacion_sha256_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT portal_publicacion_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['xml'::character varying, 'acuse'::character varying, 'cotizacion'::character varying, 'entrega'::character varying])::text[])))
);


--
-- Name: portal_publicacion_archivo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_publicacion_archivo (
    id_publicacion integer NOT NULL,
    contenido bytea NOT NULL,
    CONSTRAINT portal_publicacion_archivo_contenido_check CHECK (((octet_length(contenido) >= 1) AND (octet_length(contenido) <= 2097152)))
);


--
-- Name: portal_publicacion_id_publicacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.portal_publicacion ALTER COLUMN id_publicacion ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.portal_publicacion_id_publicacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: portal_publicacion_retiro; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_publicacion_retiro (
    id_publicacion integer NOT NULL,
    request_id uuid NOT NULL,
    huella character(64) NOT NULL,
    motivo character varying(500) NOT NULL,
    id_user integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT portal_publicacion_retiro_motivo_check CHECK ((length(btrim((motivo)::text)) > 0))
);


--
-- Name: portal_sesion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_sesion (
    token_hash character(64) NOT NULL,
    id_acceso integer NOT NULL,
    version integer NOT NULL,
    creada_en timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    vence_en timestamp with time zone NOT NULL,
    revocada_en timestamp with time zone,
    CONSTRAINT portal_sesion_check CHECK ((vence_en > creada_en))
);


--
-- Name: precio_especial_cliente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.precio_especial_cliente (
    id_precio integer NOT NULL,
    id_cliente integer NOT NULL,
    id_producto integer NOT NULL,
    precio numeric(18,6) NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT precio_especial_cliente_check CHECK (((valid_to IS NULL) OR (valid_from IS NULL) OR (valid_to >= valid_from))),
    CONSTRAINT precio_especial_cliente_precio_check CHECK ((precio >= (0)::numeric))
);


--
-- Name: precio_especial_cliente_id_precio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.precio_especial_cliente ALTER COLUMN id_precio ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.precio_especial_cliente_id_precio_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: presupuesto_contable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presupuesto_contable (
    id_presupuesto bigint NOT NULL,
    anio integer NOT NULL,
    mes integer NOT NULL,
    id_cuenta integer NOT NULL,
    id_centro_costo integer,
    monto numeric(18,2) NOT NULL,
    notas character varying(500),
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT presupuesto_contable_anio_check CHECK (((anio >= 2000) AND (anio <= 2200))),
    CONSTRAINT presupuesto_contable_mes_check CHECK (((mes >= 1) AND (mes <= 12))),
    CONSTRAINT presupuesto_contable_monto_check CHECK ((monto >= (0)::numeric))
);


--
-- Name: presupuesto_contable_id_presupuesto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.presupuesto_contable_id_presupuesto_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: presupuesto_contable_id_presupuesto_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.presupuesto_contable_id_presupuesto_seq OWNED BY public.presupuesto_contable.id_presupuesto;


--
-- Name: producto_IdProducto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.producto ALTER COLUMN "IdProducto" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."producto_IdProducto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: producto_aplicacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_aplicacion (
    id_aplicacion integer NOT NULL,
    id_producto integer NOT NULL,
    fabricante_equipo character varying(80),
    modelo character varying(100),
    motor character varying(100),
    anio_desde smallint,
    anio_hasta smallint,
    restricciones character varying(255),
    CONSTRAINT producto_aplicacion_anio_desde_check CHECK (((anio_desde >= 1900) AND (anio_desde <= 2200))),
    CONSTRAINT producto_aplicacion_anio_hasta_check CHECK (((anio_hasta >= 1900) AND (anio_hasta <= 2200))),
    CONSTRAINT producto_aplicacion_check CHECK (((anio_desde IS NULL) OR (anio_hasta IS NULL) OR (anio_desde <= anio_hasta)))
);


--
-- Name: producto_aplicacion_id_aplicacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.producto_aplicacion ALTER COLUMN id_aplicacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.producto_aplicacion_id_aplicacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: producto_cotizacion_prov; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_cotizacion_prov (
    id_cotizacion_prov integer NOT NULL,
    id_producto integer NOT NULL,
    id_proveedor integer NOT NULL,
    marca_ofrecida character varying(100),
    precio_cotizado numeric(10,2) NOT NULL,
    dias_entrega integer DEFAULT 0 NOT NULL,
    fecha_registro timestamp with time zone DEFAULT now(),
    CONSTRAINT producto_cotizacion_prov_dias_entrega_check CHECK ((dias_entrega >= 0)),
    CONSTRAINT producto_cotizacion_prov_precio_cotizado_check CHECK ((precio_cotizado >= (0)::numeric))
);


--
-- Name: producto_cotizacion_prov_id_cotizacion_prov_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.producto_cotizacion_prov ALTER COLUMN id_cotizacion_prov ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.producto_cotizacion_prov_id_cotizacion_prov_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: producto_cruce; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_cruce (
    id_producto_origen integer NOT NULL,
    id_producto_destino integer NOT NULL,
    fecha_registro timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_different_products CHECK ((id_producto_origen <> id_producto_destino))
);


--
-- Name: producto_equivalente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_equivalente (
    "IdProducto" integer NOT NULL,
    "IdProductoEquivalente" integer NOT NULL,
    "TipoEquivalencia" public.tipo_equivalencia_enum DEFAULT 'Marca'::public.tipo_equivalencia_enum
);


--
-- Name: producto_kit_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_kit_detalle (
    id_kit integer NOT NULL,
    id_componente integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    CONSTRAINT producto_kit_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT producto_kit_detalle_check CHECK ((id_kit <> id_componente))
);


--
-- Name: producto_kit_movimiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_kit_movimiento (
    id_movimiento bigint NOT NULL,
    request_id uuid NOT NULL,
    id_kit integer NOT NULL,
    tipo character varying(20) NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT producto_kit_movimiento_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT producto_kit_movimiento_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Armado'::character varying, 'Desarmado'::character varying])::text[])))
);


--
-- Name: producto_kit_movimiento_id_movimiento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.producto_kit_movimiento ALTER COLUMN id_movimiento ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.producto_kit_movimiento_id_movimiento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: producto_numero_parte; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.producto_numero_parte (
    id_numero integer NOT NULL,
    id_producto integer NOT NULL,
    tipo character varying(20) NOT NULL,
    fabricante character varying(80),
    numero character varying(80) NOT NULL,
    numero_normalizado character varying(80) GENERATED ALWAYS AS (lower(regexp_replace((numero)::text, '[^[:alnum:]]'::text, ''::text, 'g'::text))) STORED,
    CONSTRAINT producto_numero_parte_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['OEM'::character varying, 'Fabricante'::character varying, 'Alterno'::character varying])::text[])))
);


--
-- Name: producto_numero_parte_id_numero_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.producto_numero_parte ALTER COLUMN id_numero ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.producto_numero_parte_id_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: proveedor_IdProveedor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.proveedor ALTER COLUMN "IdProveedor" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."proveedor_IdProveedor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: recepcion_compra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recepcion_compra (
    id_recepcion integer NOT NULL,
    request_id uuid NOT NULL,
    id_orden integer NOT NULL,
    referencia character varying(100),
    notas character varying(1000),
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recepcion_compra_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recepcion_compra_detalle (
    id_detalle integer NOT NULL,
    id_recepcion integer NOT NULL,
    id_orden_detalle integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    costo_unitario numeric(18,6) NOT NULL,
    CONSTRAINT recepcion_compra_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT recepcion_compra_detalle_costo_unitario_check CHECK ((costo_unitario >= (0)::numeric))
);


--
-- Name: recepcion_compra_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.recepcion_compra_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.recepcion_compra_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: recepcion_compra_id_recepcion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.recepcion_compra ALTER COLUMN id_recepcion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.recepcion_compra_id_recepcion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: recepcion_costo_adicional; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recepcion_costo_adicional (
    id_costo bigint NOT NULL,
    request_id uuid NOT NULL,
    id_recepcion integer NOT NULL,
    tipo character varying(30) NOT NULL,
    monto numeric(18,2) NOT NULL,
    criterio character varying(15) DEFAULT 'Valor'::character varying NOT NULL,
    notas character varying(500),
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT recepcion_costo_adicional_criterio_check CHECK (((criterio)::text = ANY ((ARRAY['Valor'::character varying, 'Cantidad'::character varying])::text[]))),
    CONSTRAINT recepcion_costo_adicional_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT recepcion_costo_adicional_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Flete'::character varying, 'Seguro'::character varying, 'Importacion'::character varying, 'Maniobras'::character varying, 'Otro'::character varying])::text[])))
);


--
-- Name: recepcion_costo_adicional_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recepcion_costo_adicional_detalle (
    id_costo bigint NOT NULL,
    id_recepcion_detalle integer NOT NULL,
    monto numeric(18,2) NOT NULL,
    CONSTRAINT recepcion_costo_adicional_detalle_monto_check CHECK ((monto >= (0)::numeric))
);


--
-- Name: recepcion_costo_adicional_id_costo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.recepcion_costo_adicional ALTER COLUMN id_costo ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.recepcion_costo_adicional_id_costo_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: regimenfiscal_IdRegimenFiscal_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.regimenfiscal ALTER COLUMN "IdRegimenFiscal" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."regimenfiscal_IdRegimenFiscal_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: relacioncfdi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relacioncfdi (
    "IdRelacionCFDI" integer NOT NULL,
    "IdFacturaOrigen" integer NOT NULL,
    "IdFacturaRelacionada" integer NOT NULL,
    "IdTipoRelacion" integer NOT NULL
);


--
-- Name: relacioncfdi_IdRelacionCFDI_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.relacioncfdi ALTER COLUMN "IdRelacionCFDI" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."relacioncfdi_IdRelacionCFDI_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rep; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rep (
    id_rep integer NOT NULL,
    id_cliente integer NOT NULL,
    fecha_pago timestamp with time zone NOT NULL,
    forma_pago character varying(50) NOT NULL,
    moneda character varying(5) DEFAULT 'MXN'::character varying NOT NULL,
    monto_total numeric(12,2) NOT NULL,
    cuenta_beneficiario character varying(50),
    rfc_beneficiario character varying(20),
    uuid uuid,
    no_serie_certificado character varying(50),
    no_certificado_emisor character varying(50),
    lugar_emision character varying(10),
    fecha_emision timestamp with time zone,
    sello_sat text,
    sello_cfdi text,
    cadena_original text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    estado character varying(20) DEFAULT 'Activo'::character varying
);


--
-- Name: rep_factura; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rep_factura (
    id_rep_factura integer NOT NULL,
    id_rep integer NOT NULL,
    id_factura integer NOT NULL,
    num_parcialidad integer DEFAULT 1 NOT NULL,
    saldo_anterior numeric(12,2) NOT NULL,
    monto_pagado numeric(12,2) NOT NULL,
    saldo_insoluto numeric(12,2) NOT NULL,
    impuestos_retenidos numeric(12,2) DEFAULT 0,
    impuestos_trasladados numeric(12,2) DEFAULT 0
);


--
-- Name: rep_factura_id_rep_factura_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rep_factura_id_rep_factura_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rep_factura_id_rep_factura_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rep_factura_id_rep_factura_seq OWNED BY public.rep_factura.id_rep_factura;


--
-- Name: rep_id_rep_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rep_id_rep_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rep_id_rep_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rep_id_rep_seq OWNED BY public.rep.id_rep;


--
-- Name: reserva_inventario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reserva_inventario (
    id_reserva integer NOT NULL,
    id_pedido integer NOT NULL,
    id_detalle integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    cantidad_liberada numeric(18,6) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'Activa'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    CONSTRAINT reserva_inventario_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT reserva_inventario_check CHECK (((cantidad_liberada >= (0)::numeric) AND (cantidad_liberada <= cantidad))),
    CONSTRAINT reserva_inventario_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Surtida'::character varying, 'Consumida'::character varying, 'Liberada'::character varying])::text[])))
);


--
-- Name: TABLE reserva_inventario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reserva_inventario IS 'Apartados que reducen existencia disponible sin modificar la existencia física.';


--
-- Name: COLUMN reserva_inventario.expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reserva_inventario.expires_at IS 'Fecha límite del apartado. Solo las reservas Activa pueden liberarse por vencimiento.';


--
-- Name: reserva_inventario_id_reserva_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reserva_inventario ALTER COLUMN id_reserva ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.reserva_inventario_id_reserva_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: saldos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saldos (
    id_saldo integer NOT NULL,
    caja_chica numeric(18,2) DEFAULT 0.00,
    cuenta_banco numeric(18,2) DEFAULT 0.00,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: saldos_id_saldo_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.saldos_id_saldo_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: saldos_id_saldo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.saldos_id_saldo_seq OWNED BY public.saldos.id_saldo;


--
-- Name: schema_migration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migration (
    filename text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: solicitud_autorizacion_comercial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitud_autorizacion_comercial (
    id_autorizacion integer NOT NULL,
    tipo character varying(25) NOT NULL,
    estado character varying(15) DEFAULT 'Pendiente'::character varying NOT NULL,
    id_cliente integer NOT NULL,
    id_producto integer,
    valor_solicitado numeric(18,6) NOT NULL,
    valor_referencia numeric(18,6) NOT NULL,
    motivo character varying(1000) NOT NULL,
    id_solicitante integer,
    id_autorizador integer,
    resolucion character varying(1000),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    operacion_tipo character varying(30),
    operacion_id bigint,
    used_at timestamp with time zone,
    operacion_destino character varying(15),
    monto_operacion numeric(18,2),
    regla_version integer,
    politica_decision jsonb,
    CONSTRAINT autorizacion_alcance_completo CHECK ((((operacion_destino IS NULL) AND (monto_operacion IS NULL)) OR ((operacion_destino IS NOT NULL) AND (monto_operacion IS NOT NULL)))),
    CONSTRAINT chk_autorizacion_operacion CHECK (((((estado)::text = 'Utilizada'::text) AND (operacion_tipo IS NOT NULL) AND (operacion_id IS NOT NULL) AND (used_at IS NOT NULL)) OR ((estado)::text <> 'Utilizada'::text))),
    CONSTRAINT solicitud_autorizacion_comercial_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Aprobada'::character varying, 'Rechazada'::character varying, 'Utilizada'::character varying, 'Cancelada'::character varying])::text[]))),
    CONSTRAINT solicitud_autorizacion_comercial_monto_operacion_check CHECK ((monto_operacion >= (0)::numeric)),
    CONSTRAINT solicitud_autorizacion_comercial_operacion_destino_check CHECK (((operacion_destino)::text = ANY ((ARRAY['Venta'::character varying, 'Pedido'::character varying, 'Cotizacion'::character varying])::text[]))),
    CONSTRAINT solicitud_autorizacion_comercial_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Descuento'::character varying, 'Margen bajo'::character varying, 'Exceso credito'::character varying])::text[])))
);


--
-- Name: COLUMN solicitud_autorizacion_comercial.operacion_tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.solicitud_autorizacion_comercial.operacion_tipo IS 'Entidad que consumió la autorización: Venta, Pedido o Cotizacion.';


--
-- Name: COLUMN solicitud_autorizacion_comercial.monto_operacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.solicitud_autorizacion_comercial.monto_operacion IS 'Tope de total con impuestos declarado al solicitar y verificado contra total calculado al usar; no es el precio unitario de la excepción. NULL histórico.';


--
-- Name: solicitud_autorizacion_comercial_id_autorizacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.solicitud_autorizacion_comercial ALTER COLUMN id_autorizacion ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.solicitud_autorizacion_comercial_id_autorizacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: solicitud_compra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitud_compra (
    id_solicitud integer NOT NULL,
    folio bigint NOT NULL,
    request_id uuid NOT NULL,
    estado character varying(20) DEFAULT 'Borrador'::character varying NOT NULL,
    motivo character varying(1000),
    id_solicitante integer,
    id_autorizador integer,
    authorized_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT solicitud_compra_estado_check CHECK (((estado)::text = ANY ((ARRAY['Borrador'::character varying, 'Autorizada'::character varying, 'Rechazada'::character varying, 'Ordenada'::character varying, 'Cancelada'::character varying])::text[])))
);


--
-- Name: solicitud_compra_detalle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitud_compra_detalle (
    id_detalle integer NOT NULL,
    id_solicitud integer NOT NULL,
    id_producto integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    costo_estimado numeric(18,6) DEFAULT 0 NOT NULL,
    origen character varying(20) DEFAULT 'Manual'::character varying NOT NULL,
    CONSTRAINT solicitud_compra_detalle_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT solicitud_compra_detalle_costo_estimado_check CHECK ((costo_estimado >= (0)::numeric)),
    CONSTRAINT solicitud_compra_detalle_origen_check CHECK (((origen)::text = ANY ((ARRAY['Manual'::character varying, 'Backorder'::character varying, 'Minimo'::character varying, 'Pronostico'::character varying])::text[])))
);


--
-- Name: solicitud_compra_detalle_id_detalle_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.solicitud_compra_detalle ALTER COLUMN id_detalle ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.solicitud_compra_detalle_id_detalle_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: solicitud_compra_folio_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.solicitud_compra ALTER COLUMN folio ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.solicitud_compra_folio_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: solicitud_compra_id_solicitud_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.solicitud_compra ALTER COLUMN id_solicitud ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.solicitud_compra_id_solicitud_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tasaocuota; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasaocuota (
    "IdTasaOCuota" integer NOT NULL,
    "RangoOFijo" character varying(10),
    "ValorMinimo" numeric(18,6),
    "ValorMaximo" numeric(18,6),
    "Impuesto" text NOT NULL,
    "Factor" character varying(10) NOT NULL,
    "Traslado" boolean NOT NULL,
    "Retencion" boolean NOT NULL
);


--
-- Name: tasaocuota_IdTasaOCuota_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tasaocuota ALTER COLUMN "IdTasaOCuota" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."tasaocuota_IdTasaOCuota_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: telefono; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telefono (
    "IdTelefono" integer NOT NULL,
    "IdEntidad" integer NOT NULL,
    "IdTipoEntidad" integer NOT NULL,
    "Nombre" character varying(40) NOT NULL,
    "Numero" character varying(20) NOT NULL,
    "Tipo" public.tipo_telefono_enum DEFAULT 'Movil'::public.tipo_telefono_enum,
    "Principal" boolean DEFAULT false
);


--
-- Name: telefono_IdTelefono_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.telefono ALTER COLUMN "IdTelefono" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."telefono_IdTelefono_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tesoreria_cierre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_cierre (
    id_cierre bigint NOT NULL,
    id_cuenta integer NOT NULL,
    anio integer NOT NULL,
    mes integer NOT NULL,
    saldo_estado_cuenta numeric(18,2) NOT NULL,
    saldo_calculado numeric(18,2) NOT NULL,
    movimientos integer NOT NULL,
    conciliados integer NOT NULL,
    ignorados integer NOT NULL,
    id_usuario integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT tesoreria_cierre_anio_check CHECK (((anio >= 2000) AND (anio <= 2200))),
    CONSTRAINT tesoreria_cierre_check CHECK ((saldo_estado_cuenta = saldo_calculado)),
    CONSTRAINT tesoreria_cierre_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);


--
-- Name: tesoreria_cierre_id_cierre_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesoreria_cierre_id_cierre_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesoreria_cierre_id_cierre_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesoreria_cierre_id_cierre_seq OWNED BY public.tesoreria_cierre.id_cierre;


--
-- Name: tesoreria_conciliacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_conciliacion (
    id_conciliacion bigint NOT NULL,
    request_id uuid NOT NULL,
    id_cuenta integer,
    tipo character varying(15) NOT NULL,
    estado character varying(12) DEFAULT 'Activa'::character varying NOT NULL,
    total_banco numeric(18,2) NOT NULL,
    total_sistema numeric(18,2) NOT NULL,
    ajuste numeric(18,2) DEFAULT 0 NOT NULL,
    tipo_ajuste character varying(20),
    motivo character varying(500),
    id_usuario integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    revertida_por integer,
    revertida_at timestamp with time zone,
    motivo_reversion character varying(500),
    CONSTRAINT tesoreria_conciliacion_check CHECK ((total_banco = (total_sistema + ajuste))),
    CONSTRAINT tesoreria_conciliacion_check1 CHECK (((((estado)::text = 'Activa'::text) AND (revertida_at IS NULL)) OR (((estado)::text = 'Revertida'::text) AND (revertida_at IS NOT NULL)))),
    CONSTRAINT tesoreria_conciliacion_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Revertida'::character varying])::text[]))),
    CONSTRAINT tesoreria_conciliacion_tipo_ajuste_check CHECK (((tipo_ajuste IS NULL) OR ((tipo_ajuste)::text = ANY ((ARRAY['Comision'::character varying, 'Redondeo'::character varying, 'TipoCambio'::character varying, 'Otro'::character varying])::text[])))),
    CONSTRAINT tesoreria_conciliacion_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Exacta'::character varying, 'Ajuste'::character varying, 'Transferencia'::character varying])::text[])))
);


--
-- Name: tesoreria_conciliacion_id_conciliacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesoreria_conciliacion_id_conciliacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesoreria_conciliacion_id_conciliacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesoreria_conciliacion_id_conciliacion_seq OWNED BY public.tesoreria_conciliacion.id_conciliacion;


--
-- Name: tesoreria_conciliacion_sistema; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_conciliacion_sistema (
    id_conciliacion bigint NOT NULL,
    id_caja_movimiento bigint NOT NULL,
    monto numeric(18,2) NOT NULL,
    generado_ajuste boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL
);


--
-- Name: tesoreria_cuenta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_cuenta (
    id_cuenta integer NOT NULL,
    nombre character varying(100) NOT NULL,
    banco character varying(100) NOT NULL,
    moneda character(3) DEFAULT 'MXN'::bpchar NOT NULL,
    ultimos_cuatro character(4),
    saldo_inicial numeric(18,2) DEFAULT 0 NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT tesoreria_cuenta_ultimos_cuatro_check CHECK (((ultimos_cuatro IS NULL) OR (ultimos_cuatro ~ '^[0-9]{4}$'::text)))
);


--
-- Name: tesoreria_cuenta_id_cuenta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesoreria_cuenta_id_cuenta_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesoreria_cuenta_id_cuenta_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesoreria_cuenta_id_cuenta_seq OWNED BY public.tesoreria_cuenta.id_cuenta;


--
-- Name: tesoreria_importacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_importacion (
    id_importacion bigint NOT NULL,
    request_id uuid NOT NULL,
    id_cuenta integer NOT NULL,
    nombre_archivo character varying(255) NOT NULL,
    sha256 character(64) NOT NULL,
    total_renglones integer DEFAULT 0 NOT NULL,
    insertados integer DEFAULT 0 NOT NULL,
    duplicados integer DEFAULT 0 NOT NULL,
    conciliados_auto integer DEFAULT 0 NOT NULL,
    errores jsonb DEFAULT '[]'::jsonb NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: tesoreria_importacion_id_importacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesoreria_importacion_id_importacion_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesoreria_importacion_id_importacion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesoreria_importacion_id_importacion_seq OWNED BY public.tesoreria_importacion.id_importacion;


--
-- Name: tesoreria_movimiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_movimiento (
    id_movimiento bigint NOT NULL,
    id_cuenta integer NOT NULL,
    fecha date NOT NULL,
    descripcion character varying(300) NOT NULL,
    referencia character varying(120),
    monto numeric(18,2) NOT NULL,
    estado character varying(12) DEFAULT 'Pendiente'::character varying NOT NULL,
    id_caja_movimiento bigint,
    conciliado_por integer,
    conciliado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    id_importacion bigint,
    fingerprint character(64),
    metodo_conciliacion character varying(12),
    puntaje_conciliacion numeric(5,2),
    observaciones character varying(500),
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    id_conciliacion bigint,
    CONSTRAINT tesoreria_movimiento_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Conciliado'::character varying, 'Ignorado'::character varying])::text[]))),
    CONSTRAINT tesoreria_movimiento_metodo_check CHECK (((metodo_conciliacion IS NULL) OR ((metodo_conciliacion)::text = ANY ((ARRAY['Manual'::character varying, 'Automatica'::character varying])::text[])))),
    CONSTRAINT tesoreria_movimiento_monto_check CHECK ((monto <> (0)::numeric)),
    CONSTRAINT tesoreria_movimiento_vinculo_check CHECK (((((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Ignorado'::character varying])::text[])) AND (id_conciliacion IS NULL) AND (conciliado_at IS NULL)) OR (((estado)::text = 'Conciliado'::text) AND (id_conciliacion IS NOT NULL) AND (conciliado_at IS NOT NULL))))
);


--
-- Name: tesoreria_movimiento_id_movimiento_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesoreria_movimiento_id_movimiento_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesoreria_movimiento_id_movimiento_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesoreria_movimiento_id_movimiento_seq OWNED BY public.tesoreria_movimiento.id_movimiento;


--
-- Name: tesoreria_transferencia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_transferencia (
    id_transferencia bigint NOT NULL,
    request_id uuid NOT NULL,
    id_conciliacion bigint NOT NULL,
    id_movimiento_salida bigint NOT NULL,
    id_movimiento_entrada bigint NOT NULL,
    referencia character varying(120),
    id_usuario integer,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT tesoreria_transferencia_check CHECK ((id_movimiento_salida <> id_movimiento_entrada))
);


--
-- Name: tesoreria_transferencia_id_transferencia_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tesoreria_transferencia_id_transferencia_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tesoreria_transferencia_id_transferencia_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tesoreria_transferencia_id_transferencia_seq OWNED BY public.tesoreria_transferencia.id_transferencia;


--
-- Name: timbrefiscaldigital; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.timbrefiscaldigital (
    "IdTimbreFiscalDigital" integer NOT NULL,
    "IdFactura" integer NOT NULL,
    "UUID" uuid NOT NULL,
    "FechaTimbrado" timestamp without time zone NOT NULL,
    "CSDSAT" character varying(255) NOT NULL,
    "CadenaOriginaldelTimbre" text,
    "SelloDigitalEmisor" text,
    "SelloDigitalSAT" text,
    "Version" character varying(5) DEFAULT '1.1'::character varying NOT NULL,
    "RfcProvCertif" character varying(13) NOT NULL
);


--
-- Name: timbrefiscaldigital_IdTimbreFiscalDigital_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.timbrefiscaldigital ALTER COLUMN "IdTimbreFiscalDigital" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."timbrefiscaldigital_IdTimbreFiscalDigital_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tipocomprobante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipocomprobante (
    "IdTipoComprobante" integer NOT NULL,
    "Clave" character varying(1) NOT NULL,
    "Nombre" character varying(50) NOT NULL
);


--
-- Name: tipocomprobante_IdTipoComprobante_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tipocomprobante ALTER COLUMN "IdTipoComprobante" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."tipocomprobante_IdTipoComprobante_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tipoentidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipoentidad (
    "IdTipoEntidad" integer NOT NULL,
    "Nombre" character varying(40) NOT NULL
);


--
-- Name: tipoentidad_IdTipoEntidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tipoentidad ALTER COLUMN "IdTipoEntidad" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."tipoentidad_IdTipoEntidad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tipofactor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipofactor (
    "IdTipoFactor" bigint NOT NULL,
    "Clave" character varying
);


--
-- Name: tipofactor_IdTipoFactor_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tipofactor ALTER COLUMN "IdTipoFactor" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."tipofactor_IdTipoFactor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tipomotivocancelacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipomotivocancelacion (
    "IdTipoMotivoCancelacion" integer NOT NULL,
    "ClaveSAT" character varying(2) NOT NULL,
    "Descripcion" character varying(100) NOT NULL
);


--
-- Name: tipomotivocancelacion_IdTipoMotivoCancelacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tipomotivocancelacion ALTER COLUMN "IdTipoMotivoCancelacion" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."tipomotivocancelacion_IdTipoMotivoCancelacion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tiporelacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tiporelacion (
    "IdTipoRelacion" integer NOT NULL,
    "Clave" character varying(2) NOT NULL,
    "Descripcion" character varying(255) NOT NULL
);


--
-- Name: tiporelacion_IdTipoRelacion_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tiporelacion ALTER COLUMN "IdTipoRelacion" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."tiporelacion_IdTipoRelacion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: transferencia_almacen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transferencia_almacen (
    id_transferencia bigint NOT NULL,
    request_id uuid NOT NULL,
    id_producto integer NOT NULL,
    id_ubicacion_origen integer NOT NULL,
    id_ubicacion_destino integer NOT NULL,
    cantidad numeric(18,6) NOT NULL,
    motivo character varying(500) NOT NULL,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transferencia_almacen_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT transferencia_almacen_check CHECK ((id_ubicacion_origen <> id_ubicacion_destino))
);


--
-- Name: transferencia_almacen_id_transferencia_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.transferencia_almacen ALTER COLUMN id_transferencia ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.transferencia_almacen_id_transferencia_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: unidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unidad (
    "IdUnidad" integer NOT NULL,
    "Descripcion" character varying(50) NOT NULL
);


--
-- Name: unidad_IdUnidad_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.unidad ALTER COLUMN "IdUnidad" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."unidad_IdUnidad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: usocfdi_IdUsoCFDI_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usocfdi ALTER COLUMN "IdUsoCFDI" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."usocfdi_IdUsoCFDI_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: venta_perdida; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venta_perdida (
    id_venta_perdida integer NOT NULL,
    id_oportunidad integer,
    id_cliente integer,
    id_producto integer,
    descripcion_buscada character varying(255) NOT NULL,
    cantidad numeric(18,6) DEFAULT 1 NOT NULL,
    motivo character varying(40) NOT NULL,
    notas text,
    id_user integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT venta_perdida_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT venta_perdida_motivo_check CHECK (((motivo)::text = ANY ((ARRAY['Sin existencia'::character varying, 'Precio'::character varying, 'Entrega'::character varying, 'Compatibilidad'::character varying, 'Otro'::character varying])::text[])))
);


--
-- Name: venta_perdida_id_venta_perdida_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.venta_perdida ALTER COLUMN id_venta_perdida ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.venta_perdida_id_venta_perdida_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vw_prediccion_demanda; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.vw_prediccion_demanda AS
 WITH semanas AS (
         SELECT generate_series(0, 25) AS semana_ord
        ), ventas AS (
         SELECT cf.id_producto,
            (floor((((CURRENT_DATE - (f.fecha_emision)::date))::numeric / 7.0)))::integer AS antiguedad_semana,
            sum(cf.cantidad) AS unidades
           FROM (public.conceptofactura cf
             JOIN public.factura f ON ((f.id_factura = cf.id_factura)))
          WHERE (((f.estatus)::text <> 'Cancelada'::text) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar) AND (f.fecha_emision >= (CURRENT_DATE - '182 days'::interval)))
          GROUP BY cf.id_producto, ((floor((((CURRENT_DATE - (f.fecha_emision)::date))::numeric / 7.0)))::integer)
        ), serie AS (
         SELECT p."IdProducto" AS id_producto,
            (26 - s.semana_ord) AS semana_ord,
            COALESCE(v.unidades, (0)::numeric) AS unidades_semana
           FROM ((public.producto p
             CROSS JOIN semanas s)
             LEFT JOIN ventas v ON (((v.id_producto = p."IdProducto") AND (v.antiguedad_semana = s.semana_ord))))
        ), estadistica AS (
         SELECT serie.id_producto,
            regr_slope((serie.unidades_semana)::double precision, (serie.semana_ord)::double precision) AS pendiente,
            regr_intercept((serie.unidades_semana)::double precision, (serie.semana_ord)::double precision) AS intercepto,
            COALESCE(regr_r2((serie.unidades_semana)::double precision, (serie.semana_ord)::double precision), (0)::double precision) AS r_cuadrado
           FROM serie
          GROUP BY serie.id_producto
        ), resumen AS (
         SELECT p."IdProducto" AS id_producto,
            COALESCE(sum(cf.cantidad) FILTER (WHERE (f.fecha_emision >= (CURRENT_DATE - '30 days'::interval))), (0)::numeric) AS vendido_30d,
            COALESCE(sum(cf.cantidad) FILTER (WHERE (f.fecha_emision >= (CURRENT_DATE - '60 days'::interval))), (0)::numeric) AS vendido_60d,
            COALESCE(sum(cf.cantidad) FILTER (WHERE (f.fecha_emision >= (CURRENT_DATE - '90 days'::interval))), (0)::numeric) AS vendido_90d
           FROM ((public.producto p
             LEFT JOIN public.conceptofactura cf ON ((cf.id_producto = p."IdProducto")))
             LEFT JOIN public.factura f ON (((f.id_factura = cf.id_factura) AND ((f.estatus)::text <> 'Cancelada'::text) AND (COALESCE(f.tipo_comprobante, 'I'::bpchar) = 'I'::bpchar))))
          GROUP BY p."IdProducto"
        ), calculo AS (
         SELECT p."IdProducto",
            p."Codigo",
            p."IdUnidad",
            p."IdObjetoImpuesto",
            p."Descripcion",
            p."PrecioUnitario",
            p."IdCategoria",
            p."Ubicacion",
            p."IdClaveProdOServ",
            p."IdClaveUnidad",
            p."Marca",
            p."ObjetoImpuesto",
            p."TasaIVA",
            p."AplicaRetencionISR",
            p."AplicaRetencionIVA",
            p."Existencia",
            p.imagenes,
            p.imagen_url,
            r.vendido_30d,
            r.vendido_60d,
            r.vendido_90d,
            e.pendiente,
            e.intercepto,
            e.r_cuadrado,
            GREATEST(round((((0.50 * r.vendido_30d) + (0.30 * (r.vendido_60d / 2.0))) + (0.20 * (r.vendido_90d / 3.0)))), (0)::numeric) AS pronostico
           FROM ((public.producto p
             JOIN resumen r ON ((r.id_producto = p."IdProducto")))
             JOIN estadistica e ON ((e.id_producto = p."IdProducto")))
        )
 SELECT "IdProducto" AS id_producto,
    "Codigo" AS codigo,
    "Descripcion" AS descripcion,
    "Existencia" AS stock_actual,
    "PrecioUnitario" AS precio_unitario,
    vendido_30d,
    vendido_60d,
    vendido_90d,
    round((vendido_30d / 30.0), 2) AS prom_diario_30d,
    round((vendido_60d / 60.0), 2) AS prom_diario_60d,
    round((vendido_90d / 90.0), 2) AS prom_diario_90d,
    round((pendiente)::numeric, 4) AS pendiente_regresion,
    round((intercepto)::numeric, 2) AS intercepto_regresion,
    round((r_cuadrado)::numeric, 4) AS r_cuadrado,
    (26)::bigint AS num_semanas,
        CASE
            WHEN (pendiente > (0.5)::double precision) THEN 'ALTA'::text
            WHEN (pendiente < ('-0.5'::numeric)::double precision) THEN 'BAJA'::text
            ELSE 'ESTABLE'::text
        END AS tendencia,
    pronostico AS demanda_proyectada_30d,
    GREATEST((pronostico - "Existencia"), (0)::numeric) AS cantidad_sugerida_compra
   FROM calculo
  ORDER BY GREATEST((pronostico - "Existencia"), (0)::numeric) DESC, vendido_30d DESC
  WITH NO DATA;


--
-- Name: vw_smart_restock; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_smart_restock AS
 WITH ventas_30d AS (
         SELECT cf.id_producto,
            sum(cf.cantidad) AS unidades_vendidas_30d
           FROM (public.conceptofactura cf
             JOIN public.factura f ON ((cf.id_factura = f.id_factura)))
          WHERE ((f.estatus <> 'Cancelada'::public.estatus_factura_enum) AND (f.fecha_emision >= (now() - '30 days'::interval)))
          GROUP BY cf.id_producto
        )
 SELECT p."IdProducto" AS id_producto,
    p."Codigo" AS codigo,
    p."Descripcion" AS descripcion,
    COALESCE(v.unidades_vendidas_30d, (0)::numeric) AS unidades_vendidas_30d,
    p."Existencia" AS stock_actual,
    p."PrecioUnitario" AS precio_unitario,
    COALESCE(( SELECT u.margen_porcentaje
           FROM public.fn_get_utilidad_productos() u(id_producto, codigo, descripcion, cantidad_vendida, ingresos_totales, costo_total, utilidad_neta, margen_porcentaje)
          WHERE (u.id_producto = p."IdProducto")
         LIMIT 1), (0)::numeric) AS margen
   FROM (public.producto p
     LEFT JOIN ventas_30d v ON ((p."IdProducto" = v.id_producto)))
  ORDER BY COALESCE(v.unidades_vendidas_30d, (0)::numeric) DESC, COALESCE(( SELECT u.margen_porcentaje
           FROM public.fn_get_utilidad_productos() u(id_producto, codigo, descripcion, cantidad_vendida, ingresos_totales, costo_total, utilidad_neta, margen_porcentaje)
          WHERE (u.id_producto = p."IdProducto")
         LIMIT 1), (0)::numeric) DESC;


--
-- Name: web_producto_ficha; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.web_producto_ficha (
    id_producto integer NOT NULL,
    slug character varying(160) NOT NULL,
    titulo character varying(160) NOT NULL,
    descripcion text NOT NULL,
    estado text DEFAULT 'borrador'::text NOT NULL,
    datos_reales_confirmados boolean DEFAULT false NOT NULL,
    derechos_imagen_confirmados boolean DEFAULT false NOT NULL,
    compatibilidad_verificada boolean DEFAULT false NOT NULL,
    snapshot jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by integer NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT web_producto_ficha_check CHECK (((estado <> 'listo'::text) OR (datos_reales_confirmados AND derechos_imagen_confirmados AND compatibilidad_verificada))),
    CONSTRAINT web_producto_ficha_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'listo'::text, 'retirado'::text]))),
    CONSTRAINT web_producto_ficha_slug_check CHECK (((slug)::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT web_producto_ficha_version_check CHECK ((version > 0))
);


--
-- Name: anticipo_proveedor id_anticipo; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anticipo_proveedor ALTER COLUMN id_anticipo SET DEFAULT nextval('public.anticipo_proveedor_id_anticipo_seq'::regclass);


--
-- Name: aplicacion_proveedor id_aplicacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor ALTER COLUMN id_aplicacion SET DEFAULT nextval('public.aplicacion_proveedor_id_aplicacion_seq'::regclass);


--
-- Name: auditoria_jsonb id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_jsonb ALTER COLUMN id SET DEFAULT nextval('public.auditoria_jsonb_id_seq'::regclass);


--
-- Name: auth_user id_user; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user ALTER COLUMN id_user SET DEFAULT nextval('public.auth_user_id_user_seq'::regclass);


--
-- Name: caja_movimiento id_movimiento; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_movimiento ALTER COLUMN id_movimiento SET DEFAULT nextval('public.caja_movimiento_id_movimiento_seq'::regclass);


--
-- Name: caja_turno id_turno; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_turno ALTER COLUMN id_turno SET DEFAULT nextval('public.caja_turno_id_turno_seq'::regclass);


--
-- Name: centro_costo id_centro; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.centro_costo ALTER COLUMN id_centro SET DEFAULT nextval('public.centro_costo_id_centro_seq'::regclass);


--
-- Name: cfdi_relacionado id_relacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cfdi_relacionado ALTER COLUMN id_relacion SET DEFAULT nextval('public.cfdi_relacionado_id_relacion_seq'::regclass);


--
-- Name: cuenta_contable id_cuenta; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuenta_contable ALTER COLUMN id_cuenta SET DEFAULT nextval('public.cuenta_contable_id_cuenta_seq'::regclass);


--
-- Name: devolucion id_devolucion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion ALTER COLUMN id_devolucion SET DEFAULT nextval('public.devolucion_id_devolucion_seq'::regclass);


--
-- Name: factura_proveedor id_factura_proveedor; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor ALTER COLUMN id_factura_proveedor SET DEFAULT nextval('public.factura_proveedor_id_factura_proveedor_seq'::regclass);


--
-- Name: factura_proveedor_detalle id_detalle; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_detalle ALTER COLUMN id_detalle SET DEFAULT nextval('public.factura_proveedor_detalle_id_detalle_seq'::regclass);


--
-- Name: factura_proveedor_discrepancia id_discrepancia; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_discrepancia ALTER COLUMN id_discrepancia SET DEFAULT nextval('public.factura_proveedor_discrepancia_id_discrepancia_seq'::regclass);


--
-- Name: factura_proveedor_pago id_pago; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago ALTER COLUMN id_pago SET DEFAULT nextval('public.factura_proveedor_pago_id_pago_seq'::regclass);


--
-- Name: factura_proveedor_programacion id_programacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_programacion ALTER COLUMN id_programacion SET DEFAULT nextval('public.factura_proveedor_programacion_id_programacion_seq'::regclass);


--
-- Name: fiscal_documento id_documento; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_documento ALTER COLUMN id_documento SET DEFAULT nextval('public.fiscal_documento_id_documento_seq'::regclass);


--
-- Name: fiscal_evento id_evento; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_evento ALTER COLUMN id_evento SET DEFAULT nextval('public.fiscal_evento_id_evento_seq'::regclass);


--
-- Name: gasto id_gasto; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gasto ALTER COLUMN id_gasto SET DEFAULT nextval('public.gasto_id_gasto_seq'::regclass);


--
-- Name: nota_credito_proveedor id_nota; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_proveedor ALTER COLUMN id_nota SET DEFAULT nextval('public.nota_credito_proveedor_id_nota_seq'::regclass);


--
-- Name: periodo_contable id_periodo; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodo_contable ALTER COLUMN id_periodo SET DEFAULT nextval('public.periodo_contable_id_periodo_seq'::regclass);


--
-- Name: poliza_contable id_poliza; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable ALTER COLUMN id_poliza SET DEFAULT nextval('public.poliza_contable_id_poliza_seq'::regclass);


--
-- Name: poliza_contable_detalle id_detalle; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable_detalle ALTER COLUMN id_detalle SET DEFAULT nextval('public.poliza_contable_detalle_id_detalle_seq'::regclass);


--
-- Name: presupuesto_contable id_presupuesto; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presupuesto_contable ALTER COLUMN id_presupuesto SET DEFAULT nextval('public.presupuesto_contable_id_presupuesto_seq'::regclass);


--
-- Name: rep id_rep; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep ALTER COLUMN id_rep SET DEFAULT nextval('public.rep_id_rep_seq'::regclass);


--
-- Name: rep_factura id_rep_factura; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep_factura ALTER COLUMN id_rep_factura SET DEFAULT nextval('public.rep_factura_id_rep_factura_seq'::regclass);


--
-- Name: saldos id_saldo; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saldos ALTER COLUMN id_saldo SET DEFAULT nextval('public.saldos_id_saldo_seq'::regclass);


--
-- Name: tesoreria_cierre id_cierre; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cierre ALTER COLUMN id_cierre SET DEFAULT nextval('public.tesoreria_cierre_id_cierre_seq'::regclass);


--
-- Name: tesoreria_conciliacion id_conciliacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion ALTER COLUMN id_conciliacion SET DEFAULT nextval('public.tesoreria_conciliacion_id_conciliacion_seq'::regclass);


--
-- Name: tesoreria_cuenta id_cuenta; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cuenta ALTER COLUMN id_cuenta SET DEFAULT nextval('public.tesoreria_cuenta_id_cuenta_seq'::regclass);


--
-- Name: tesoreria_importacion id_importacion; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_importacion ALTER COLUMN id_importacion SET DEFAULT nextval('public.tesoreria_importacion_id_importacion_seq'::regclass);


--
-- Name: tesoreria_movimiento id_movimiento; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento ALTER COLUMN id_movimiento SET DEFAULT nextval('public.tesoreria_movimiento_id_movimiento_seq'::regclass);


--
-- Name: tesoreria_transferencia id_transferencia; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia ALTER COLUMN id_transferencia SET DEFAULT nextval('public.tesoreria_transferencia_id_transferencia_seq'::regclass);


--
-- Name: almacen almacen_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen
    ADD CONSTRAINT almacen_codigo_key UNIQUE (codigo);


--
-- Name: almacen_picking_verificacion almacen_picking_verificacion_id_anulada_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_picking_verificacion
    ADD CONSTRAINT almacen_picking_verificacion_id_anulada_key UNIQUE (id_anulada);


--
-- Name: almacen_picking_verificacion almacen_picking_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_picking_verificacion
    ADD CONSTRAINT almacen_picking_verificacion_pkey PRIMARY KEY (id);


--
-- Name: almacen almacen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen
    ADD CONSTRAINT almacen_pkey PRIMARY KEY (id_almacen);


--
-- Name: almacen_ubicacion almacen_ubicacion_id_almacen_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_ubicacion
    ADD CONSTRAINT almacen_ubicacion_id_almacen_codigo_key UNIQUE (id_almacen, codigo);


--
-- Name: almacen_ubicacion almacen_ubicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_ubicacion
    ADD CONSTRAINT almacen_ubicacion_pkey PRIMARY KEY (id_ubicacion);


--
-- Name: analytics_inventario_diario analytics_inventario_diario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_inventario_diario
    ADD CONSTRAINT analytics_inventario_diario_pkey PRIMARY KEY (fecha);


--
-- Name: anticipo_proveedor anticipo_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anticipo_proveedor
    ADD CONSTRAINT anticipo_proveedor_pkey PRIMARY KEY (id_anticipo);


--
-- Name: anticipo_proveedor anticipo_proveedor_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anticipo_proveedor
    ADD CONSTRAINT anticipo_proveedor_request_id_key UNIQUE (request_id);


--
-- Name: aplicacion_proveedor aplicacion_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor
    ADD CONSTRAINT aplicacion_proveedor_pkey PRIMARY KEY (id_aplicacion);


--
-- Name: app_access_profile_permission app_access_profile_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_access_profile_permission
    ADD CONSTRAINT app_access_profile_permission_pkey PRIMARY KEY (id_profile, permission_code);


--
-- Name: app_access_profile app_access_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_access_profile
    ADD CONSTRAINT app_access_profile_pkey PRIMARY KEY (id_profile);


--
-- Name: app_notification app_notification_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: app_notification app_notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_pkey PRIMARY KEY (id_notification);


--
-- Name: app_permission app_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_permission
    ADD CONSTRAINT app_permission_pkey PRIMARY KEY (code);


--
-- Name: app_role_permission app_role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role_permission
    ADD CONSTRAINT app_role_permission_pkey PRIMARY KEY (role, permission_code);


--
-- Name: app_user_access_profile app_user_access_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_access_profile
    ADD CONSTRAINT app_user_access_profile_pkey PRIMARY KEY (id_user);


--
-- Name: app_user_permission app_user_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_permission
    ADD CONSTRAINT app_user_permission_pkey PRIMARY KEY (id_user, permission_code);


--
-- Name: auditoria_jsonb auditoria_jsonb_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_jsonb
    ADD CONSTRAINT auditoria_jsonb_pkey PRIMARY KEY (id);


--
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY ("IdAuditoria");


--
-- Name: auth_mfa_challenge auth_mfa_challenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenge
    ADD CONSTRAINT auth_mfa_challenge_pkey PRIMARY KEY (token_hash);


--
-- Name: auth_mfa auth_mfa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa
    ADD CONSTRAINT auth_mfa_pkey PRIMARY KEY (id_user);


--
-- Name: auth_mfa_recovery auth_mfa_recovery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_recovery
    ADD CONSTRAINT auth_mfa_recovery_pkey PRIMARY KEY (id_user, code_hash);


--
-- Name: auth_password_recovery auth_password_recovery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_recovery
    ADD CONSTRAINT auth_password_recovery_pkey PRIMARY KEY (id_user);


--
-- Name: auth_session auth_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (id_session);


--
-- Name: auth_user auth_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user
    ADD CONSTRAINT auth_user_pkey PRIMARY KEY (id_user);


--
-- Name: auth_user auth_user_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_user
    ADD CONSTRAINT auth_user_username_key UNIQUE (username);


--
-- Name: backorder_cliente backorder_cliente_id_detalle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backorder_cliente
    ADD CONSTRAINT backorder_cliente_id_detalle_key UNIQUE (id_detalle);


--
-- Name: backorder_cliente backorder_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backorder_cliente
    ADD CONSTRAINT backorder_cliente_pkey PRIMARY KEY (id_backorder);


--
-- Name: bancos bancos_NombreBanco_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancos
    ADD CONSTRAINT "bancos_NombreBanco_key" UNIQUE ("NombreBanco");


--
-- Name: bancos bancos_NombreCorto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancos
    ADD CONSTRAINT "bancos_NombreCorto_key" UNIQUE ("NombreCorto");


--
-- Name: bancos bancos_RFCBanco_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancos
    ADD CONSTRAINT "bancos_RFCBanco_key" UNIQUE ("RFCBanco");


--
-- Name: bancos bancos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancos
    ADD CONSTRAINT bancos_pkey PRIMARY KEY ("IdBanco");


--
-- Name: caja_movimiento caja_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_movimiento
    ADD CONSTRAINT caja_movimiento_pkey PRIMARY KEY (id_movimiento);


--
-- Name: caja_turno caja_turno_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_turno
    ADD CONSTRAINT caja_turno_pkey PRIMARY KEY (id_turno);


--
-- Name: casco_recuperable casco_recuperable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casco_recuperable
    ADD CONSTRAINT casco_recuperable_pkey PRIMARY KEY (id_casco);


--
-- Name: categoria categoria_Descripcion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria
    ADD CONSTRAINT "categoria_Descripcion_key" UNIQUE ("Descripcion");


--
-- Name: categoria categoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria
    ADD CONSTRAINT categoria_pkey PRIMARY KEY ("IdCategoria");


--
-- Name: centro_costo centro_costo_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.centro_costo
    ADD CONSTRAINT centro_costo_codigo_key UNIQUE (codigo);


--
-- Name: centro_costo centro_costo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.centro_costo
    ADD CONSTRAINT centro_costo_pkey PRIMARY KEY (id_centro);


--
-- Name: cfdi_relacionado cfdi_relacionado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cfdi_relacionado
    ADD CONSTRAINT cfdi_relacionado_pkey PRIMARY KEY (id_relacion);


--
-- Name: claveproductooservicio claveproductooservicio_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claveproductooservicio
    ADD CONSTRAINT "claveproductooservicio_Clave_key" UNIQUE ("Clave");


--
-- Name: claveproductooservicio claveproductooservicio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claveproductooservicio
    ADD CONSTRAINT claveproductooservicio_pkey PRIMARY KEY ("IdClaveProdOServ");


--
-- Name: claveunidad claveunidad_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claveunidad
    ADD CONSTRAINT "claveunidad_Clave_key" UNIQUE ("Clave");


--
-- Name: claveunidad claveunidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claveunidad
    ADD CONSTRAINT claveunidad_pkey PRIMARY KEY ("IdClaveUnidad");


--
-- Name: cliente cliente_RFC_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT "cliente_RFC_key" UNIQUE ("RFC");


--
-- Name: cliente_comercial cliente_comercial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente_comercial
    ADD CONSTRAINT cliente_comercial_pkey PRIMARY KEY (id_cliente);


--
-- Name: cliente_contacto cliente_contacto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente_contacto
    ADD CONSTRAINT cliente_contacto_pkey PRIMARY KEY (id_contacto);


--
-- Name: cliente cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT cliente_pkey PRIMARY KEY ("IdCliente");


--
-- Name: colonia colonia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.colonia
    ADD CONSTRAINT colonia_pkey PRIMARY KEY ("IdColonia");


--
-- Name: comercial_limite_aprobador comercial_limite_aprobador_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comercial_limite_aprobador
    ADD CONSTRAINT comercial_limite_aprobador_pkey PRIMARY KEY (id_usuario, operacion);


--
-- Name: comercial_regla_aprobacion comercial_regla_aprobacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comercial_regla_aprobacion
    ADD CONSTRAINT comercial_regla_aprobacion_pkey PRIMARY KEY (operacion, tipo);


--
-- Name: complementodepago complementodepago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complementodepago
    ADD CONSTRAINT complementodepago_pkey PRIMARY KEY ("IdComplementoPago");


--
-- Name: compra compra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compra
    ADD CONSTRAINT compra_pkey PRIMARY KEY (id_compra);


--
-- Name: conceptocotizacion conceptocotizacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptocotizacion
    ADD CONSTRAINT conceptocotizacion_pkey PRIMARY KEY (id_concepto);


--
-- Name: conceptofactura conceptofactura_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptofactura
    ADD CONSTRAINT conceptofactura_pkey PRIMARY KEY (id_concepto);


--
-- Name: conteo_inventario_detalle conteo_inventario_detalle_id_conteo_id_producto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario_detalle
    ADD CONSTRAINT conteo_inventario_detalle_id_conteo_id_producto_key UNIQUE (id_conteo, id_producto);


--
-- Name: conteo_inventario_detalle conteo_inventario_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario_detalle
    ADD CONSTRAINT conteo_inventario_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: conteo_inventario conteo_inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario
    ADD CONSTRAINT conteo_inventario_pkey PRIMARY KEY (id_conteo);


--
-- Name: conteo_inventario conteo_inventario_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario
    ADD CONSTRAINT conteo_inventario_request_id_key UNIQUE (request_id);


--
-- Name: cotizacion_invitacion cotizacion_invitacion_id_revision_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_invitacion
    ADD CONSTRAINT cotizacion_invitacion_id_revision_request_id_key UNIQUE (id_revision, request_id);


--
-- Name: cotizacion_invitacion cotizacion_invitacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_invitacion
    ADD CONSTRAINT cotizacion_invitacion_pkey PRIMARY KEY (id_invitacion);


--
-- Name: cotizacion_invitacion cotizacion_invitacion_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_invitacion
    ADD CONSTRAINT cotizacion_invitacion_token_hash_key UNIQUE (token_hash);


--
-- Name: cotizacion cotizacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion
    ADD CONSTRAINT cotizacion_pkey PRIMARY KEY (id_cotizacion);


--
-- Name: cotizacion_respuesta cotizacion_respuesta_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_respuesta
    ADD CONSTRAINT cotizacion_respuesta_id_revision_key UNIQUE (id_revision);


--
-- Name: cotizacion_respuesta cotizacion_respuesta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_respuesta
    ADD CONSTRAINT cotizacion_respuesta_pkey PRIMARY KEY (id_respuesta);


--
-- Name: cotizacion_revision cotizacion_revision_id_cotizacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_revision
    ADD CONSTRAINT cotizacion_revision_id_cotizacion_key UNIQUE (id_cotizacion);


--
-- Name: cotizacion_revision cotizacion_revision_id_raiz_numero_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_revision
    ADD CONSTRAINT cotizacion_revision_id_raiz_numero_key UNIQUE (id_raiz, numero);


--
-- Name: cotizacion_revision cotizacion_revision_id_raiz_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_revision
    ADD CONSTRAINT cotizacion_revision_id_raiz_request_id_key UNIQUE (id_raiz, request_id);


--
-- Name: cotizacion_revision cotizacion_revision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_revision
    ADD CONSTRAINT cotizacion_revision_pkey PRIMARY KEY (id_revision);


--
-- Name: venta_perdida crm_busqueda_no_vacia; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.venta_perdida
    ADD CONSTRAINT crm_busqueda_no_vacia CHECK ((length(btrim((descripcion_buscada)::text)) > 0)) NOT VALID;


--
-- Name: crm_campana crm_campana_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana
    ADD CONSTRAINT crm_campana_pkey PRIMARY KEY (id_campana);


--
-- Name: crm_campana_preparacion crm_campana_preparacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana_preparacion
    ADD CONSTRAINT crm_campana_preparacion_pkey PRIMARY KEY (id_preparacion);


--
-- Name: crm_campana_preparacion crm_campana_preparacion_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana_preparacion
    ADD CONSTRAINT crm_campana_preparacion_request_id_key UNIQUE (request_id);


--
-- Name: crm_comunicacion crm_comunicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_comunicacion
    ADD CONSTRAINT crm_comunicacion_pkey PRIMARY KEY (id_comunicacion);


--
-- Name: crm_consentimiento_comercial crm_consentimiento_comercial_id_contacto_canal_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consentimiento_comercial
    ADD CONSTRAINT crm_consentimiento_comercial_id_contacto_canal_version_key UNIQUE (id_contacto, canal, version);


--
-- Name: crm_consentimiento_comercial crm_consentimiento_comercial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consentimiento_comercial
    ADD CONSTRAINT crm_consentimiento_comercial_pkey PRIMARY KEY (id_consentimiento);


--
-- Name: crm_consentimiento_comercial crm_consentimiento_comercial_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consentimiento_comercial
    ADD CONSTRAINT crm_consentimiento_comercial_request_id_key UNIQUE (request_id);


--
-- Name: crm_oportunidad crm_empresa_no_vacia; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.crm_oportunidad
    ADD CONSTRAINT crm_empresa_no_vacia CHECK ((length(btrim((empresa)::text)) > 0)) NOT VALID;


--
-- Name: crm_encuesta_satisfaccion crm_encuesta_satisfaccion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_encuesta_satisfaccion
    ADD CONSTRAINT crm_encuesta_satisfaccion_pkey PRIMARY KEY (id_encuesta);


--
-- Name: crm_etapa_evento crm_etapa_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_etapa_evento
    ADD CONSTRAINT crm_etapa_evento_pkey PRIMARY KEY (id_evento);


--
-- Name: crm_meta_vendedor crm_meta_vendedor_id_user_fecha_inicio_fecha_fin_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meta_vendedor
    ADD CONSTRAINT crm_meta_vendedor_id_user_fecha_inicio_fecha_fin_key UNIQUE (id_user, fecha_inicio, fecha_fin);


--
-- Name: crm_meta_vendedor crm_meta_vendedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meta_vendedor
    ADD CONSTRAINT crm_meta_vendedor_pkey PRIMARY KEY (id_meta);


--
-- Name: crm_oportunidad_consulta_web crm_oportunidad_consulta_web_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_consulta_web
    ADD CONSTRAINT crm_oportunidad_consulta_web_pkey PRIMARY KEY (id_oportunidad);


--
-- Name: crm_oportunidad_consulta_web crm_oportunidad_consulta_web_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_consulta_web
    ADD CONSTRAINT crm_oportunidad_consulta_web_request_id_key UNIQUE (request_id);


--
-- Name: crm_oportunidad_cotizacion crm_oportunidad_cotizacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_cotizacion
    ADD CONSTRAINT crm_oportunidad_cotizacion_pkey PRIMARY KEY (id_cotizacion);


--
-- Name: crm_oportunidad crm_oportunidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad
    ADD CONSTRAINT crm_oportunidad_pkey PRIMARY KEY (id_oportunidad);


--
-- Name: crm_oportunidad crm_perdida_con_motivo; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.crm_oportunidad
    ADD CONSTRAINT crm_perdida_con_motivo CHECK ((((etapa)::text <> 'Perdida'::text) OR ((length(btrim((motivo_perdida)::text)) > 0) AND (motivo_perdida IS NOT NULL)))) NOT VALID;


--
-- Name: crm_plantilla crm_plantilla_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_plantilla
    ADD CONSTRAINT crm_plantilla_pkey PRIMARY KEY (id_plantilla);


--
-- Name: crm_reporte_intento_evento crm_reporte_intento_evento_id_resultado_intento_fase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_intento_evento
    ADD CONSTRAINT crm_reporte_intento_evento_id_resultado_intento_fase_key UNIQUE (id_resultado, intento, fase);


--
-- Name: crm_reporte_intento_evento crm_reporte_intento_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_intento_evento
    ADD CONSTRAINT crm_reporte_intento_evento_pkey PRIMARY KEY (id);


--
-- Name: crm_reporte_programa crm_reporte_programa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_programa
    ADD CONSTRAINT crm_reporte_programa_pkey PRIMARY KEY (id_programa);


--
-- Name: crm_reporte_recuperacion crm_reporte_recuperacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_recuperacion
    ADD CONSTRAINT crm_reporte_recuperacion_pkey PRIMARY KEY (id_resultado);


--
-- Name: crm_reporte_reintento crm_reporte_reintento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_reintento
    ADD CONSTRAINT crm_reporte_reintento_pkey PRIMARY KEY (id_resultado);


--
-- Name: crm_reporte_resultado crm_reporte_resultado_id_programa_programada_en_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_resultado
    ADD CONSTRAINT crm_reporte_resultado_id_programa_programada_en_key UNIQUE (id_programa, programada_en);


--
-- Name: crm_reporte_resultado crm_reporte_resultado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_resultado
    ADD CONSTRAINT crm_reporte_resultado_pkey PRIMARY KEY (id_resultado);


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_evento_id_modelo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_evento_id_modelo_key UNIQUE (id_evento, id_modelo);


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_secuencia_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_secuencia_key UNIQUE (id_secuencia);


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_pkey PRIMARY KEY (request_id);


--
-- Name: crm_secuencia_control crm_secuencia_control_id_secuencia_version_resultante_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_id_secuencia_version_resultante_key UNIQUE (id_secuencia, version_resultante);


--
-- Name: crm_secuencia_control crm_secuencia_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_pkey PRIMARY KEY (request_id);


--
-- Name: crm_secuencia_evento crm_secuencia_evento_id_tarea_evento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_evento
    ADD CONSTRAINT crm_secuencia_evento_id_tarea_evento_key UNIQUE (id_tarea, evento);


--
-- Name: crm_secuencia_evento crm_secuencia_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_evento
    ADD CONSTRAINT crm_secuencia_evento_pkey PRIMARY KEY (id_evento);


--
-- Name: crm_secuencia_modelo crm_secuencia_modelo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_modelo
    ADD CONSTRAINT crm_secuencia_modelo_pkey PRIMARY KEY (id_modelo);


--
-- Name: crm_secuencia crm_secuencia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia
    ADD CONSTRAINT crm_secuencia_pkey PRIMARY KEY (id_secuencia);


--
-- Name: crm_secuencia_regla crm_secuencia_regla_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_regla
    ADD CONSTRAINT crm_secuencia_regla_pkey PRIMARY KEY (id_regla);


--
-- Name: crm_segmento crm_segmento_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_segmento
    ADD CONSTRAINT crm_segmento_nombre_key UNIQUE (nombre);


--
-- Name: crm_segmento crm_segmento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_segmento
    ADD CONSTRAINT crm_segmento_pkey PRIMARY KEY (id_segmento);


--
-- Name: crm_seguimiento crm_seguimiento_no_vacio; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.crm_seguimiento
    ADD CONSTRAINT crm_seguimiento_no_vacio CHECK ((length(btrim(detalle)) > 0)) NOT VALID;


--
-- Name: crm_seguimiento crm_seguimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_seguimiento
    ADD CONSTRAINT crm_seguimiento_pkey PRIMARY KEY (id_seguimiento);


--
-- Name: crm_solicitud_web crm_solicitud_web_id_oportunidad_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web
    ADD CONSTRAINT crm_solicitud_web_id_oportunidad_key UNIQUE (id_oportunidad);


--
-- Name: crm_solicitud_web crm_solicitud_web_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web
    ADD CONSTRAINT crm_solicitud_web_pkey PRIMARY KEY (request_id);


--
-- Name: crm_solicitud_web_resolucion crm_solicitud_web_resolucion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web_resolucion
    ADD CONSTRAINT crm_solicitud_web_resolucion_pkey PRIMARY KEY (operation_id);


--
-- Name: crm_solicitud_web_resolucion crm_solicitud_web_resolucion_request_id_version_resultante_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web_resolucion
    ADD CONSTRAINT crm_solicitud_web_resolucion_request_id_version_resultante_key UNIQUE (request_id, version_resultante);


--
-- Name: crm_tarea crm_tarea_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_pkey PRIMARY KEY (id_tarea);


--
-- Name: crm_tarea crm_tarea_secuencia_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_secuencia_unica UNIQUE (id_secuencia, paso_secuencia);


--
-- Name: crm_unidad_archivo_contenido crm_unidad_archivo_contenido_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_archivo_contenido
    ADD CONSTRAINT crm_unidad_archivo_contenido_pkey PRIMARY KEY (id_archivo);


--
-- Name: crm_unidad_archivo crm_unidad_archivo_id_unidad_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_archivo
    ADD CONSTRAINT crm_unidad_archivo_id_unidad_request_id_key UNIQUE (id_unidad, request_id);


--
-- Name: crm_unidad_archivo crm_unidad_archivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_archivo
    ADD CONSTRAINT crm_unidad_archivo_pkey PRIMARY KEY (id_archivo);


--
-- Name: crm_unidad_cliente crm_unidad_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_cliente
    ADD CONSTRAINT crm_unidad_cliente_pkey PRIMARY KEY (id_unidad);


--
-- Name: crm_unidad_lectura crm_unidad_lectura_id_unidad_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_lectura
    ADD CONSTRAINT crm_unidad_lectura_id_unidad_request_id_key UNIQUE (id_unidad, request_id);


--
-- Name: crm_unidad_lectura crm_unidad_lectura_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_lectura
    ADD CONSTRAINT crm_unidad_lectura_pkey PRIMARY KEY (id_lectura);


--
-- Name: crm_unidad_mantenimiento crm_unidad_mantenimiento_id_unidad_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_mantenimiento
    ADD CONSTRAINT crm_unidad_mantenimiento_id_unidad_request_id_key UNIQUE (id_unidad, request_id);


--
-- Name: crm_unidad_mantenimiento crm_unidad_mantenimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_mantenimiento
    ADD CONSTRAINT crm_unidad_mantenimiento_pkey PRIMARY KEY (id_mantenimiento);


--
-- Name: crm_unidad_pieza_garantia crm_unidad_pieza_garantia_id_pieza_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza_garantia
    ADD CONSTRAINT crm_unidad_pieza_garantia_id_pieza_request_id_key UNIQUE (id_pieza, request_id);


--
-- Name: crm_unidad_pieza_garantia crm_unidad_pieza_garantia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza_garantia
    ADD CONSTRAINT crm_unidad_pieza_garantia_pkey PRIMARY KEY (id_vinculo);


--
-- Name: crm_unidad_pieza crm_unidad_pieza_id_unidad_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza
    ADD CONSTRAINT crm_unidad_pieza_id_unidad_request_id_key UNIQUE (id_unidad, request_id);


--
-- Name: crm_unidad_pieza crm_unidad_pieza_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza
    ADD CONSTRAINT crm_unidad_pieza_pkey PRIMARY KEY (id_pieza);


--
-- Name: cuenta_contable cuenta_contable_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuenta_contable
    ADD CONSTRAINT cuenta_contable_codigo_key UNIQUE (codigo);


--
-- Name: cuenta_contable cuenta_contable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuenta_contable
    ADD CONSTRAINT cuenta_contable_pkey PRIMARY KEY (id_cuenta);


--
-- Name: cuentabancaria cuentabancaria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentabancaria
    ADD CONSTRAINT cuentabancaria_pkey PRIMARY KEY ("IdCuentaBancaria");


--
-- Name: detalle_compra detalle_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compra
    ADD CONSTRAINT detalle_compra_pkey PRIMARY KEY (id_detalle);


--
-- Name: devolucion_detalle devolucion_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_detalle
    ADD CONSTRAINT devolucion_detalle_pkey PRIMARY KEY (id_devolucion, id_producto);


--
-- Name: devolucion devolucion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion
    ADD CONSTRAINT devolucion_pkey PRIMARY KEY (id_devolucion);


--
-- Name: devolucion_proveedor_detalle devolucion_proveedor_detalle_id_devolucion_id_recepcion_det_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor_detalle
    ADD CONSTRAINT devolucion_proveedor_detalle_id_devolucion_id_recepcion_det_key UNIQUE (id_devolucion, id_recepcion_detalle);


--
-- Name: devolucion_proveedor_detalle devolucion_proveedor_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor_detalle
    ADD CONSTRAINT devolucion_proveedor_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: devolucion_proveedor devolucion_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor
    ADD CONSTRAINT devolucion_proveedor_pkey PRIMARY KEY (id_devolucion);


--
-- Name: devolucion_proveedor devolucion_proveedor_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor
    ADD CONSTRAINT devolucion_proveedor_request_id_key UNIQUE (request_id);


--
-- Name: documento_salida_archivo documento_salida_archivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida_archivo
    ADD CONSTRAINT documento_salida_archivo_pkey PRIMARY KEY (id);


--
-- Name: documento_salida_cierre documento_salida_cierre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida_cierre
    ADD CONSTRAINT documento_salida_cierre_pkey PRIMARY KEY (id);


--
-- Name: documento_salida_cierre documento_salida_cierre_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida_cierre
    ADD CONSTRAINT documento_salida_cierre_request_id_key UNIQUE (request_id);


--
-- Name: documento_salida documento_salida_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida
    ADD CONSTRAINT documento_salida_pkey PRIMARY KEY (id);


--
-- Name: email email_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email
    ADD CONSTRAINT email_pkey PRIMARY KEY ("IdEmail");


--
-- Name: emisor emisor_RFC_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emisor
    ADD CONSTRAINT "emisor_RFC_key" UNIQUE ("RFC");


--
-- Name: emisor emisor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emisor
    ADD CONSTRAINT emisor_pkey PRIMARY KEY ("IdEmisor");


--
-- Name: entrega_pedido entrega_pedido_id_pedido_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega_pedido
    ADD CONSTRAINT entrega_pedido_id_pedido_key UNIQUE (id_pedido);


--
-- Name: entrega_pedido entrega_pedido_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega_pedido
    ADD CONSTRAINT entrega_pedido_pkey PRIMARY KEY (id_entrega);


--
-- Name: estado estado_Nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado
    ADD CONSTRAINT "estado_Nombre_key" UNIQUE ("Nombre");


--
-- Name: estado estado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado
    ADD CONSTRAINT estado_pkey PRIMARY KEY ("IdEstado");


--
-- Name: evaluacion_proveedor evaluacion_proveedor_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluacion_proveedor
    ADD CONSTRAINT evaluacion_proveedor_id_orden_key UNIQUE (id_orden);


--
-- Name: evaluacion_proveedor evaluacion_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluacion_proveedor
    ADD CONSTRAINT evaluacion_proveedor_pkey PRIMARY KEY (id_evaluacion);


--
-- Name: factura factura_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_pkey PRIMARY KEY (id_factura);


--
-- Name: factura_proveedor_detalle factura_proveedor_detalle_id_factura_proveedor_id_orden_det_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_detalle
    ADD CONSTRAINT factura_proveedor_detalle_id_factura_proveedor_id_orden_det_key UNIQUE (id_factura_proveedor, id_orden_detalle);


--
-- Name: factura_proveedor_detalle factura_proveedor_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_detalle
    ADD CONSTRAINT factura_proveedor_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: factura_proveedor_discrepancia factura_proveedor_discrepancia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_discrepancia
    ADD CONSTRAINT factura_proveedor_discrepancia_pkey PRIMARY KEY (id_discrepancia);


--
-- Name: factura_proveedor_pago factura_proveedor_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago
    ADD CONSTRAINT factura_proveedor_pago_pkey PRIMARY KEY (id_pago);


--
-- Name: factura_proveedor_pago factura_proveedor_pago_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago
    ADD CONSTRAINT factura_proveedor_pago_request_id_key UNIQUE (request_id);


--
-- Name: factura_proveedor factura_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_pkey PRIMARY KEY (id_factura_proveedor);


--
-- Name: factura_proveedor_programacion factura_proveedor_programacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_programacion
    ADD CONSTRAINT factura_proveedor_programacion_pkey PRIMARY KEY (id_programacion);


--
-- Name: factura_proveedor_recepcion factura_proveedor_recepcion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_recepcion
    ADD CONSTRAINT factura_proveedor_recepcion_pkey PRIMARY KEY (id_factura_detalle, id_recepcion_detalle);


--
-- Name: factura_proveedor factura_proveedor_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_request_id_key UNIQUE (request_id);


--
-- Name: fiscal_documento fiscal_documento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_documento
    ADD CONSTRAINT fiscal_documento_pkey PRIMARY KEY (id_documento);


--
-- Name: fiscal_evento fiscal_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_evento
    ADD CONSTRAINT fiscal_evento_pkey PRIMARY KEY (id_evento);


--
-- Name: formadepago formadepago_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formadepago
    ADD CONSTRAINT "formadepago_Clave_key" UNIQUE ("Clave");


--
-- Name: formadepago formadepago_Nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formadepago
    ADD CONSTRAINT "formadepago_Nombre_key" UNIQUE ("Nombre");


--
-- Name: formadepago formadepago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formadepago
    ADD CONSTRAINT formadepago_pkey PRIMARY KEY ("IdFormaPago");


--
-- Name: garantia garantia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garantia
    ADD CONSTRAINT garantia_pkey PRIMARY KEY (id_garantia);


--
-- Name: gasto gasto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gasto
    ADD CONSTRAINT gasto_pkey PRIMARY KEY (id_gasto);


--
-- Name: historial_correos historial_correos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_correos
    ADD CONSTRAINT historial_correos_pkey PRIMARY KEY (id_historial);


--
-- Name: impuesto impuesto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impuesto
    ADD CONSTRAINT impuesto_pkey PRIMARY KEY ("IdImpuesto");


--
-- Name: impuestoproducto impuestoproducto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impuestoproducto
    ADD CONSTRAINT impuestoproducto_pkey PRIMARY KEY ("IdImpuestoProducto");


--
-- Name: inventario_lote inventario_lote_id_producto_id_ubicacion_lote_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_lote
    ADD CONSTRAINT inventario_lote_id_producto_id_ubicacion_lote_key UNIQUE (id_producto, id_ubicacion, lote);


--
-- Name: inventario_lote inventario_lote_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_lote
    ADD CONSTRAINT inventario_lote_pkey PRIMARY KEY (id_lote);


--
-- Name: inventario inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_pkey PRIMARY KEY ("IdProducto");


--
-- Name: inventario_serie inventario_serie_numero_serie_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_serie
    ADD CONSTRAINT inventario_serie_numero_serie_key UNIQUE (numero_serie);


--
-- Name: inventario_serie inventario_serie_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_serie
    ADD CONSTRAINT inventario_serie_pkey PRIMARY KEY (id_serie);


--
-- Name: inventario_ubicacion inventario_ubicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_ubicacion
    ADD CONSTRAINT inventario_ubicacion_pkey PRIMARY KEY (id_ubicacion, id_producto);


--
-- Name: kardex kardex_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kardex
    ADD CONSTRAINT kardex_pkey PRIMARY KEY (id_kardex);


--
-- Name: lista_precio_detalle lista_precio_detalle_id_lista_id_producto_cantidad_minima_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precio_detalle
    ADD CONSTRAINT lista_precio_detalle_id_lista_id_producto_cantidad_minima_key UNIQUE (id_lista, id_producto, cantidad_minima);


--
-- Name: lista_precio_detalle lista_precio_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precio_detalle
    ADD CONSTRAINT lista_precio_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: lista_precio lista_precio_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precio
    ADD CONSTRAINT lista_precio_nombre_key UNIQUE (nombre);


--
-- Name: lista_precio lista_precio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precio
    ADD CONSTRAINT lista_precio_pkey PRIMARY KEY (id_lista);


--
-- Name: localidad localidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.localidad
    ADD CONSTRAINT localidad_pkey PRIMARY KEY ("IdLocalidad");


--
-- Name: meses meses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meses
    ADD CONSTRAINT meses_pkey PRIMARY KEY ("IdMeses");


--
-- Name: metododepago metododepago_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metododepago
    ADD CONSTRAINT "metododepago_Clave_key" UNIQUE ("Clave");


--
-- Name: metododepago metododepago_Nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metododepago
    ADD CONSTRAINT "metododepago_Nombre_key" UNIQUE ("Nombre");


--
-- Name: metododepago metododepago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metododepago
    ADD CONSTRAINT metododepago_pkey PRIMARY KEY ("IdMetodoDePago");


--
-- Name: moneda moneda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moneda
    ADD CONSTRAINT moneda_pkey PRIMARY KEY ("IdMoneda");


--
-- Name: municipio municipio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT municipio_pkey PRIMARY KEY ("IdMunicipio");


--
-- Name: nota_credito_proveedor nota_credito_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_proveedor
    ADD CONSTRAINT nota_credito_proveedor_pkey PRIMARY KEY (id_nota);


--
-- Name: nota_credito_proveedor nota_credito_proveedor_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_proveedor
    ADD CONSTRAINT nota_credito_proveedor_request_id_key UNIQUE (request_id);


--
-- Name: objetoimpuesto objetoimpuesto_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objetoimpuesto
    ADD CONSTRAINT "objetoimpuesto_Clave_key" UNIQUE ("Clave");


--
-- Name: objetoimpuesto objetoimpuesto_Descripcion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objetoimpuesto
    ADD CONSTRAINT "objetoimpuesto_Descripcion_key" UNIQUE ("Descripcion");


--
-- Name: objetoimpuesto objetoimpuesto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objetoimpuesto
    ADD CONSTRAINT objetoimpuesto_pkey PRIMARY KEY ("IdObjetoImpuesto");


--
-- Name: operation_idempotency operation_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_idempotency
    ADD CONSTRAINT operation_idempotency_pkey PRIMARY KEY (request_id);


--
-- Name: operational_job operational_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_job
    ADD CONSTRAINT operational_job_pkey PRIMARY KEY (name);


--
-- Name: operational_job_run operational_job_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_job_run
    ADD CONSTRAINT operational_job_run_pkey PRIMARY KEY (id);


--
-- Name: orden_compra_detalle orden_compra_detalle_id_orden_id_producto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_id_orden_id_producto_key UNIQUE (id_orden, id_producto);


--
-- Name: orden_compra_detalle orden_compra_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: orden_compra orden_compra_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_folio_key UNIQUE (folio);


--
-- Name: orden_compra orden_compra_id_solicitud_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_id_solicitud_key UNIQUE (id_solicitud);


--
-- Name: orden_compra orden_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_pkey PRIMARY KEY (id_orden);


--
-- Name: orden_compra orden_compra_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_request_id_key UNIQUE (request_id);


--
-- Name: pago pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago
    ADD CONSTRAINT pago_pkey PRIMARY KEY (id_pago);


--
-- Name: pago_proveedor pago_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago_proveedor
    ADD CONSTRAINT pago_proveedor_pkey PRIMARY KEY (id_pago_proveedor);


--
-- Name: pagodocumentos pagodocumentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagodocumentos
    ADD CONSTRAINT pagodocumentos_pkey PRIMARY KEY ("IdPagoDocumentos");


--
-- Name: pagosdetalleproveedor pagosdetalleproveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagosdetalleproveedor
    ADD CONSTRAINT pagosdetalleproveedor_pkey PRIMARY KEY ("IdPagosDetalleProveedor");


--
-- Name: pagosproveedor pagosproveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagosproveedor
    ADD CONSTRAINT pagosproveedor_pkey PRIMARY KEY ("IdPagosProveedor");


--
-- Name: pedido_entrega_archivo pedido_entrega_archivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_entrega_archivo
    ADD CONSTRAINT pedido_entrega_archivo_pkey PRIMARY KEY (id_entrega, tipo);


--
-- Name: pedido_entrega_evidencia pedido_entrega_evidencia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_entrega_evidencia
    ADD CONSTRAINT pedido_entrega_evidencia_pkey PRIMARY KEY (id_entrega);


--
-- Name: pedido_entrega_evidencia pedido_entrega_evidencia_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_entrega_evidencia
    ADD CONSTRAINT pedido_entrega_evidencia_request_id_key UNIQUE (request_id);


--
-- Name: pedido_estado_historial pedido_estado_historial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_estado_historial
    ADD CONSTRAINT pedido_estado_historial_pkey PRIMARY KEY (id_historial);


--
-- Name: pedido_surtido_ubicacion pedido_surtido_ubicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_surtido_ubicacion
    ADD CONSTRAINT pedido_surtido_ubicacion_pkey PRIMARY KEY (id_surtido);


--
-- Name: pedido_venta_detalle pedido_venta_detalle_id_pedido_id_producto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta_detalle
    ADD CONSTRAINT pedido_venta_detalle_id_pedido_id_producto_key UNIQUE (id_pedido, id_producto);


--
-- Name: pedido_venta_detalle pedido_venta_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta_detalle
    ADD CONSTRAINT pedido_venta_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: pedido_venta pedido_venta_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_folio_key UNIQUE (folio);


--
-- Name: pedido_venta pedido_venta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_pkey PRIMARY KEY (id_pedido);


--
-- Name: pedido_venta pedido_venta_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_request_id_key UNIQUE (request_id);


--
-- Name: periodicidad periodicidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodicidad
    ADD CONSTRAINT periodicidad_pkey PRIMARY KEY ("IdPeriodicidad");


--
-- Name: periodo_contable periodo_contable_anio_mes_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodo_contable
    ADD CONSTRAINT periodo_contable_anio_mes_key UNIQUE (anio, mes);


--
-- Name: periodo_contable periodo_contable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodo_contable
    ADD CONSTRAINT periodo_contable_pkey PRIMARY KEY (id_periodo);


--
-- Name: producto_cruce pk_producto_cruce; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_cruce
    ADD CONSTRAINT pk_producto_cruce PRIMARY KEY (id_producto_origen, id_producto_destino);


--
-- Name: poliza_contable_detalle poliza_contable_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable_detalle
    ADD CONSTRAINT poliza_contable_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: poliza_contable poliza_contable_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable
    ADD CONSTRAINT poliza_contable_folio_key UNIQUE (folio);


--
-- Name: poliza_contable poliza_contable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable
    ADD CONSTRAINT poliza_contable_pkey PRIMARY KEY (id_poliza);


--
-- Name: portal_acceso portal_acceso_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_acceso
    ADD CONSTRAINT portal_acceso_alias_key UNIQUE (alias);


--
-- Name: portal_acceso portal_acceso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_acceso
    ADD CONSTRAINT portal_acceso_pkey PRIMARY KEY (id_acceso);


--
-- Name: portal_credencial portal_credencial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_credencial
    ADD CONSTRAINT portal_credencial_pkey PRIMARY KEY (id_acceso);


--
-- Name: portal_evento portal_evento_id_acceso_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_evento
    ADD CONSTRAINT portal_evento_id_acceso_request_id_key UNIQUE (id_acceso, request_id);


--
-- Name: portal_evento portal_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_evento
    ADD CONSTRAINT portal_evento_pkey PRIMARY KEY (id_evento);


--
-- Name: portal_invitacion portal_invitacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invitacion
    ADD CONSTRAINT portal_invitacion_pkey PRIMARY KEY (id_invitacion);


--
-- Name: portal_invitacion portal_invitacion_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invitacion
    ADD CONSTRAINT portal_invitacion_request_id_key UNIQUE (request_id);


--
-- Name: portal_invitacion portal_invitacion_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invitacion
    ADD CONSTRAINT portal_invitacion_token_hash_key UNIQUE (token_hash);


--
-- Name: portal_publicacion_archivo portal_publicacion_archivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion_archivo
    ADD CONSTRAINT portal_publicacion_archivo_pkey PRIMARY KEY (id_publicacion);


--
-- Name: portal_publicacion portal_publicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion
    ADD CONSTRAINT portal_publicacion_pkey PRIMARY KEY (id_publicacion);


--
-- Name: portal_publicacion portal_publicacion_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion
    ADD CONSTRAINT portal_publicacion_request_id_key UNIQUE (request_id);


--
-- Name: portal_publicacion_retiro portal_publicacion_retiro_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion_retiro
    ADD CONSTRAINT portal_publicacion_retiro_pkey PRIMARY KEY (id_publicacion);


--
-- Name: portal_publicacion_retiro portal_publicacion_retiro_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion_retiro
    ADD CONSTRAINT portal_publicacion_retiro_request_id_key UNIQUE (request_id);


--
-- Name: portal_sesion portal_sesion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sesion
    ADD CONSTRAINT portal_sesion_pkey PRIMARY KEY (token_hash);


--
-- Name: precio_especial_cliente precio_especial_cliente_id_cliente_id_producto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precio_especial_cliente
    ADD CONSTRAINT precio_especial_cliente_id_cliente_id_producto_key UNIQUE (id_cliente, id_producto);


--
-- Name: precio_especial_cliente precio_especial_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precio_especial_cliente
    ADD CONSTRAINT precio_especial_cliente_pkey PRIMARY KEY (id_precio);


--
-- Name: presupuesto_contable presupuesto_contable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presupuesto_contable
    ADD CONSTRAINT presupuesto_contable_pkey PRIMARY KEY (id_presupuesto);


--
-- Name: producto producto_Codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT "producto_Codigo_key" UNIQUE ("Codigo");


--
-- Name: producto_aplicacion producto_aplicacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_aplicacion
    ADD CONSTRAINT producto_aplicacion_pkey PRIMARY KEY (id_aplicacion);


--
-- Name: producto_cotizacion_prov producto_cotizacion_prov_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_cotizacion_prov
    ADD CONSTRAINT producto_cotizacion_prov_pkey PRIMARY KEY (id_cotizacion_prov);


--
-- Name: producto_equivalente producto_equivalente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_equivalente
    ADD CONSTRAINT producto_equivalente_pkey PRIMARY KEY ("IdProducto", "IdProductoEquivalente");


--
-- Name: producto_kit_detalle producto_kit_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_detalle
    ADD CONSTRAINT producto_kit_detalle_pkey PRIMARY KEY (id_kit, id_componente);


--
-- Name: producto_kit_movimiento producto_kit_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_movimiento
    ADD CONSTRAINT producto_kit_movimiento_pkey PRIMARY KEY (id_movimiento);


--
-- Name: producto_kit_movimiento producto_kit_movimiento_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_movimiento
    ADD CONSTRAINT producto_kit_movimiento_request_id_key UNIQUE (request_id);


--
-- Name: producto_numero_parte producto_numero_parte_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_numero_parte
    ADD CONSTRAINT producto_numero_parte_pkey PRIMARY KEY (id_numero);


--
-- Name: producto_numero_parte producto_numero_parte_tipo_fabricante_numero_normalizado_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_numero_parte
    ADD CONSTRAINT producto_numero_parte_tipo_fabricante_numero_normalizado_key UNIQUE (tipo, fabricante, numero_normalizado);


--
-- Name: producto producto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT producto_pkey PRIMARY KEY ("IdProducto");


--
-- Name: proveedor proveedor_RFC_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT "proveedor_RFC_key" UNIQUE ("RFC");


--
-- Name: proveedor proveedor_RazonSocial_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT "proveedor_RazonSocial_key" UNIQUE ("RazonSocial");


--
-- Name: proveedor proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT proveedor_pkey PRIMARY KEY ("IdProveedor");


--
-- Name: recepcion_compra_detalle recepcion_compra_detalle_id_recepcion_id_orden_detalle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra_detalle
    ADD CONSTRAINT recepcion_compra_detalle_id_recepcion_id_orden_detalle_key UNIQUE (id_recepcion, id_orden_detalle);


--
-- Name: recepcion_compra_detalle recepcion_compra_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra_detalle
    ADD CONSTRAINT recepcion_compra_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: recepcion_compra recepcion_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra
    ADD CONSTRAINT recepcion_compra_pkey PRIMARY KEY (id_recepcion);


--
-- Name: recepcion_compra recepcion_compra_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra
    ADD CONSTRAINT recepcion_compra_request_id_key UNIQUE (request_id);


--
-- Name: recepcion_costo_adicional_detalle recepcion_costo_adicional_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional_detalle
    ADD CONSTRAINT recepcion_costo_adicional_detalle_pkey PRIMARY KEY (id_costo, id_recepcion_detalle);


--
-- Name: recepcion_costo_adicional recepcion_costo_adicional_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional
    ADD CONSTRAINT recepcion_costo_adicional_pkey PRIMARY KEY (id_costo);


--
-- Name: recepcion_costo_adicional recepcion_costo_adicional_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional
    ADD CONSTRAINT recepcion_costo_adicional_request_id_key UNIQUE (request_id);


--
-- Name: regimenfiscal regimenfiscal_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regimenfiscal
    ADD CONSTRAINT "regimenfiscal_Clave_key" UNIQUE ("Clave");


--
-- Name: regimenfiscal regimenfiscal_Nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regimenfiscal
    ADD CONSTRAINT "regimenfiscal_Nombre_key" UNIQUE ("Nombre");


--
-- Name: regimenfiscal regimenfiscal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regimenfiscal
    ADD CONSTRAINT regimenfiscal_pkey PRIMARY KEY ("IdRegimenFiscal");


--
-- Name: relacioncfdi relacioncfdi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relacioncfdi
    ADD CONSTRAINT relacioncfdi_pkey PRIMARY KEY ("IdRelacionCFDI");


--
-- Name: rep_factura rep_factura_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep_factura
    ADD CONSTRAINT rep_factura_pkey PRIMARY KEY (id_rep_factura);


--
-- Name: rep rep_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep
    ADD CONSTRAINT rep_pkey PRIMARY KEY (id_rep);


--
-- Name: reserva_inventario reserva_inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_inventario
    ADD CONSTRAINT reserva_inventario_pkey PRIMARY KEY (id_reserva);


--
-- Name: saldos saldos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saldos
    ADD CONSTRAINT saldos_pkey PRIMARY KEY (id_saldo);


--
-- Name: schema_migration schema_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (filename);


--
-- Name: solicitud_autorizacion_comercial solicitud_autorizacion_comercial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_autorizacion_comercial
    ADD CONSTRAINT solicitud_autorizacion_comercial_pkey PRIMARY KEY (id_autorizacion);


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_id_solicitud_id_producto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_id_solicitud_id_producto_key UNIQUE (id_solicitud, id_producto);


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_pkey PRIMARY KEY (id_detalle);


--
-- Name: solicitud_compra solicitud_compra_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra
    ADD CONSTRAINT solicitud_compra_folio_key UNIQUE (folio);


--
-- Name: solicitud_compra solicitud_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra
    ADD CONSTRAINT solicitud_compra_pkey PRIMARY KEY (id_solicitud);


--
-- Name: solicitud_compra solicitud_compra_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra
    ADD CONSTRAINT solicitud_compra_request_id_key UNIQUE (request_id);


--
-- Name: tasaocuota tasaocuota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasaocuota
    ADD CONSTRAINT tasaocuota_pkey PRIMARY KEY ("IdTasaOCuota");


--
-- Name: telefono telefono_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telefono
    ADD CONSTRAINT telefono_pkey PRIMARY KEY ("IdTelefono");


--
-- Name: tesoreria_cierre tesoreria_cierre_id_cuenta_anio_mes_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cierre
    ADD CONSTRAINT tesoreria_cierre_id_cuenta_anio_mes_key UNIQUE (id_cuenta, anio, mes);


--
-- Name: tesoreria_cierre tesoreria_cierre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cierre
    ADD CONSTRAINT tesoreria_cierre_pkey PRIMARY KEY (id_cierre);


--
-- Name: tesoreria_conciliacion tesoreria_conciliacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion
    ADD CONSTRAINT tesoreria_conciliacion_pkey PRIMARY KEY (id_conciliacion);


--
-- Name: tesoreria_conciliacion tesoreria_conciliacion_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion
    ADD CONSTRAINT tesoreria_conciliacion_request_id_key UNIQUE (request_id);


--
-- Name: tesoreria_conciliacion_sistema tesoreria_conciliacion_sistema_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion_sistema
    ADD CONSTRAINT tesoreria_conciliacion_sistema_pkey PRIMARY KEY (id_conciliacion, id_caja_movimiento);


--
-- Name: tesoreria_cuenta tesoreria_cuenta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cuenta
    ADD CONSTRAINT tesoreria_cuenta_pkey PRIMARY KEY (id_cuenta);


--
-- Name: tesoreria_importacion tesoreria_importacion_id_cuenta_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_importacion
    ADD CONSTRAINT tesoreria_importacion_id_cuenta_sha256_key UNIQUE (id_cuenta, sha256);


--
-- Name: tesoreria_importacion tesoreria_importacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_importacion
    ADD CONSTRAINT tesoreria_importacion_pkey PRIMARY KEY (id_importacion);


--
-- Name: tesoreria_importacion tesoreria_importacion_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_importacion
    ADD CONSTRAINT tesoreria_importacion_request_id_key UNIQUE (request_id);


--
-- Name: tesoreria_movimiento tesoreria_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento
    ADD CONSTRAINT tesoreria_movimiento_pkey PRIMARY KEY (id_movimiento);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_id_conciliacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_id_conciliacion_key UNIQUE (id_conciliacion);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_pkey PRIMARY KEY (id_transferencia);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_request_id_key UNIQUE (request_id);


--
-- Name: timbrefiscaldigital timbrefiscaldigital_IdFactura_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timbrefiscaldigital
    ADD CONSTRAINT "timbrefiscaldigital_IdFactura_key" UNIQUE ("IdFactura");


--
-- Name: timbrefiscaldigital timbrefiscaldigital_UUID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timbrefiscaldigital
    ADD CONSTRAINT "timbrefiscaldigital_UUID_key" UNIQUE ("UUID");


--
-- Name: timbrefiscaldigital timbrefiscaldigital_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.timbrefiscaldigital
    ADD CONSTRAINT timbrefiscaldigital_pkey PRIMARY KEY ("IdTimbreFiscalDigital");


--
-- Name: tipocomprobante tipocomprobante_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipocomprobante
    ADD CONSTRAINT "tipocomprobante_Clave_key" UNIQUE ("Clave");


--
-- Name: tipocomprobante tipocomprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipocomprobante
    ADD CONSTRAINT tipocomprobante_pkey PRIMARY KEY ("IdTipoComprobante");


--
-- Name: tipoentidad tipoentidad_Nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipoentidad
    ADD CONSTRAINT "tipoentidad_Nombre_key" UNIQUE ("Nombre");


--
-- Name: tipoentidad tipoentidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipoentidad
    ADD CONSTRAINT tipoentidad_pkey PRIMARY KEY ("IdTipoEntidad");


--
-- Name: tipofactor tipofactor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipofactor
    ADD CONSTRAINT tipofactor_pkey PRIMARY KEY ("IdTipoFactor");


--
-- Name: tipomotivocancelacion tipomotivocancelacion_ClaveSAT_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipomotivocancelacion
    ADD CONSTRAINT "tipomotivocancelacion_ClaveSAT_key" UNIQUE ("ClaveSAT");


--
-- Name: tipomotivocancelacion tipomotivocancelacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipomotivocancelacion
    ADD CONSTRAINT tipomotivocancelacion_pkey PRIMARY KEY ("IdTipoMotivoCancelacion");


--
-- Name: tiporelacion tiporelacion_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiporelacion
    ADD CONSTRAINT "tiporelacion_Clave_key" UNIQUE ("Clave");


--
-- Name: tiporelacion tiporelacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiporelacion
    ADD CONSTRAINT tiporelacion_pkey PRIMARY KEY ("IdTipoRelacion");


--
-- Name: transferencia_almacen transferencia_almacen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencia_almacen
    ADD CONSTRAINT transferencia_almacen_pkey PRIMARY KEY (id_transferencia);


--
-- Name: transferencia_almacen transferencia_almacen_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencia_almacen
    ADD CONSTRAINT transferencia_almacen_request_id_key UNIQUE (request_id);


--
-- Name: unidad unidad_Descripcion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad
    ADD CONSTRAINT "unidad_Descripcion_key" UNIQUE ("Descripcion");


--
-- Name: unidad unidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad
    ADD CONSTRAINT unidad_pkey PRIMARY KEY ("IdUnidad");


--
-- Name: cotizacion uq_cotizacion_cliente; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion
    ADD CONSTRAINT uq_cotizacion_cliente UNIQUE (id_cotizacion, id_cliente);


--
-- Name: crm_oportunidad uq_crm_oportunidad_cliente; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad
    ADD CONSTRAINT uq_crm_oportunidad_cliente UNIQUE (id_oportunidad, id_cliente);


--
-- Name: cuentabancaria uq_cuentabancaria_entidad; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentabancaria
    ADD CONSTRAINT uq_cuentabancaria_entidad UNIQUE ("IdEntidad", "IdTipoEntidad", "NumeroCuenta");


--
-- Name: email uq_email_principal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email
    ADD CONSTRAINT uq_email_principal UNIQUE ("IdEntidad", "IdTipoEntidad", "Correo");


--
-- Name: pagosdetalleproveedor uq_pagosdetalle_compra_parcialidad; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagosdetalleproveedor
    ADD CONSTRAINT uq_pagosdetalle_compra_parcialidad UNIQUE ("IdCompra", "Parcialidad");


--
-- Name: relacioncfdi uq_relacioncfdi_facturas; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relacioncfdi
    ADD CONSTRAINT uq_relacioncfdi_facturas UNIQUE ("IdFacturaOrigen", "IdFacturaRelacionada");


--
-- Name: telefono uq_telefono_principal; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telefono
    ADD CONSTRAINT uq_telefono_principal UNIQUE ("IdEntidad", "IdTipoEntidad", "Numero");


--
-- Name: usocfdi usocfdi_Clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usocfdi
    ADD CONSTRAINT "usocfdi_Clave_key" UNIQUE ("Clave");


--
-- Name: usocfdi usocfdi_Nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usocfdi
    ADD CONSTRAINT "usocfdi_Nombre_key" UNIQUE ("Nombre");


--
-- Name: usocfdi usocfdi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usocfdi
    ADD CONSTRAINT usocfdi_pkey PRIMARY KEY ("IdUsoCFDI");


--
-- Name: venta_perdida venta_perdida_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_perdida
    ADD CONSTRAINT venta_perdida_pkey PRIMARY KEY (id_venta_perdida);


--
-- Name: web_producto_ficha web_producto_ficha_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_producto_ficha
    ADD CONSTRAINT web_producto_ficha_pkey PRIMARY KEY (id_producto);


--
-- Name: web_producto_ficha web_producto_ficha_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_producto_ficha
    ADD CONSTRAINT web_producto_ficha_slug_key UNIQUE (slug);


--
-- Name: almacen_verificacion_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX almacen_verificacion_pedido ON public.almacen_picking_verificacion USING btree (id_pedido, creada_en DESC, id);


--
-- Name: almacen_verificacion_surtido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX almacen_verificacion_surtido ON public.almacen_picking_verificacion USING btree (id_surtido);


--
-- Name: app_access_profile_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_access_profile_name_uq ON public.app_access_profile USING btree (lower(btrim((name)::text)));


--
-- Name: app_user_access_profile_profile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_user_access_profile_profile_idx ON public.app_user_access_profile USING btree (id_profile);


--
-- Name: auth_mfa_challenge_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_mfa_challenge_user_idx ON public.auth_mfa_challenge USING btree (id_user, expires_at);


--
-- Name: auth_session_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_expiry_idx ON public.auth_session USING btree (id_user, expires_at);


--
-- Name: auth_session_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_user_active_idx ON public.auth_session USING btree (id_user, created_at DESC, id_session) WHERE (revoked_at IS NULL);


--
-- Name: caja_un_turno_abierto; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX caja_un_turno_abierto ON public.caja_turno USING btree (estado) WHERE ((estado)::text = 'Abierta'::text);


--
-- Name: cotizacion_invitacion_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cotizacion_invitacion_revision ON public.cotizacion_invitacion USING btree (id_revision, id_invitacion DESC);


--
-- Name: crm_campana_preparacion_historia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_campana_preparacion_historia ON public.crm_campana_preparacion USING btree (id_campana, id_preparacion DESC);


--
-- Name: crm_consentimiento_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_consentimiento_cliente ON public.crm_consentimiento_comercial USING btree (id_cliente, id_contacto, canal, version DESC);


--
-- Name: crm_consentimiento_destino; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_consentimiento_destino ON public.crm_consentimiento_comercial USING btree (canal, destino_hash, id_contacto, version DESC);


--
-- Name: crm_etapa_evento_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_etapa_evento_origen ON public.crm_etapa_evento USING btree (id_oportunidad, id_evento DESC);


--
-- Name: crm_etapa_evento_regla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_etapa_evento_regla ON public.crm_etapa_evento USING btree (etapa, id_evento DESC);


--
-- Name: crm_pieza_garantia_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_pieza_garantia_activa ON public.crm_unidad_pieza_garantia USING btree (id_garantia) WHERE (NOT retirado);


--
-- Name: crm_pieza_garantia_historial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_pieza_garantia_historial ON public.crm_unidad_pieza_garantia USING btree (id_pieza, id_vinculo DESC);


--
-- Name: crm_reporte_intento_historia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_reporte_intento_historia ON public.crm_reporte_intento_evento USING btree (id_resultado, creada_en, id);


--
-- Name: crm_reporte_programa_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_reporte_programa_activo ON public.crm_reporte_programa USING btree (id_programa) WHERE activa;


--
-- Name: crm_reporte_programa_propietario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_reporte_programa_propietario ON public.crm_reporte_programa USING btree (id_propietario, creada_en DESC, id_programa);


--
-- Name: crm_reporte_reintento_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_reporte_reintento_lease ON public.crm_reporte_reintento USING btree (lease_hasta) WHERE ((estado)::text = 'EnCurso'::text);


--
-- Name: crm_reporte_reintento_pendiente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_reporte_reintento_pendiente ON public.crm_reporte_reintento USING btree (disponible_en, id_resultado) WHERE ((estado)::text = 'Pendiente'::text);


--
-- Name: crm_reporte_resultado_historia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_reporte_resultado_historia ON public.crm_reporte_resultado USING btree (id_programa, programada_en DESC, id_resultado);


--
-- Name: crm_secuencia_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_secuencia_activa ON public.crm_secuencia USING btree (id_modelo, id_cliente) WHERE ((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Pausada'::character varying])::text[]));


--
-- Name: crm_secuencia_aplicacion_historia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_secuencia_aplicacion_historia ON public.crm_secuencia_aplicacion USING btree (id_regla, creada_en DESC, request_id);


--
-- Name: crm_secuencia_control_historial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_secuencia_control_historial ON public.crm_secuencia_control USING btree (id_secuencia, version_resultante DESC);


--
-- Name: crm_secuencia_eventos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_secuencia_eventos ON public.crm_secuencia_evento USING btree (id_secuencia, id_evento);


--
-- Name: crm_secuencia_responsable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_secuencia_responsable ON public.crm_secuencia USING btree (id_responsable, creada_en DESC, id_secuencia);


--
-- Name: crm_solicitud_web_pendientes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_solicitud_web_pendientes ON public.crm_solicitud_web USING btree (estado, created_at DESC);


--
-- Name: crm_solicitud_web_resolucion_historial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_solicitud_web_resolucion_historial ON public.crm_solicitud_web_resolucion USING btree (request_id, version_resultante DESC);


--
-- Name: crm_solicitud_web_retencion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_solicitud_web_retencion ON public.crm_solicitud_web USING btree (expires_at) WHERE (payload IS NOT NULL);


--
-- Name: crm_unidad_archivo_unidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_unidad_archivo_unidad ON public.crm_unidad_archivo USING btree (id_unidad, id_archivo DESC);


--
-- Name: crm_unidad_lectura_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_unidad_lectura_fecha ON public.crm_unidad_lectura USING btree (id_unidad, fecha DESC, id_lectura DESC);


--
-- Name: crm_unidad_mantenimiento_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_unidad_mantenimiento_estado ON public.crm_unidad_mantenimiento USING btree (id_unidad, estado, creada_en DESC, id_mantenimiento DESC);


--
-- Name: crm_unidad_pieza_historial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_unidad_pieza_historial ON public.crm_unidad_pieza USING btree (id_unidad, fecha DESC, id_pieza DESC);


--
-- Name: crm_unidad_pieza_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_unidad_pieza_origen ON public.crm_unidad_pieza USING btree (id_concepto) WHERE (NOT anulada);


--
-- Name: documento_salida_factura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documento_salida_factura ON public.documento_salida USING btree (id_factura, creada_en DESC, id);


--
-- Name: idx_auth_user_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_user_is_active ON public.auth_user USING btree (is_active);


--
-- Name: idx_auth_user_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_user_username ON public.auth_user USING btree (username);


--
-- Name: idx_autorizacion_comercial_busqueda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autorizacion_comercial_busqueda ON public.solicitud_autorizacion_comercial USING btree (id_cliente, tipo, id_producto, estado, expires_at);


--
-- Name: idx_autorizacion_comercial_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autorizacion_comercial_estado ON public.solicitud_autorizacion_comercial USING btree (estado, created_at);


--
-- Name: idx_backorder_pendiente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backorder_pendiente ON public.backorder_cliente USING btree (prioridad, created_at) WHERE ((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Parcial'::character varying])::text[]));


--
-- Name: idx_caja_movimiento_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_caja_movimiento_fecha ON public.caja_movimiento USING btree (fecha DESC);


--
-- Name: idx_caja_turno_apertura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_caja_turno_apertura ON public.caja_turno USING btree (apertura DESC);


--
-- Name: idx_casco_estado_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_casco_estado_fecha ON public.casco_recuperable USING btree (estado, created_at DESC);


--
-- Name: idx_categoria_descripcion_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categoria_descripcion_trgm ON public.categoria USING gin (COALESCE("Descripcion", ''::character varying) public.gin_trgm_ops);


--
-- Name: idx_cliente_busqueda_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cliente_busqueda_trgm ON public.cliente USING gin (public.directory_search_document(ARRAY[("IdCliente")::text, ("RFC")::text, ("RazonSocial")::text, ("CodigoPostal")::text]) public.gin_trgm_ops);


--
-- Name: idx_cliente_contacto_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cliente_contacto_cliente ON public.cliente_contacto USING btree (id_cliente, es_principal DESC, nombre);


--
-- Name: idx_cliente_cp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cliente_cp ON public.cliente USING btree ("CodigoPostal");


--
-- Name: idx_cliente_razon_social; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cliente_razon_social ON public.cliente USING btree ("RazonSocial");


--
-- Name: idx_colonia_clave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_colonia_clave ON public.colonia USING btree ("Clave");


--
-- Name: idx_colonia_cp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_colonia_cp ON public.colonia USING btree ("CodigoPostal");


--
-- Name: idx_compra_busqueda_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compra_busqueda_trgm ON public.compra USING gin (public.directory_search_document(ARRAY[(id_compra)::text, (folio_factura_proveedor)::text]) public.gin_trgm_ops);


--
-- Name: idx_compra_proveedor_busqueda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compra_proveedor_busqueda ON public.compra USING btree (id_proveedor);


--
-- Name: idx_compra_proveedor_saldo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compra_proveedor_saldo ON public.compra USING btree (id_proveedor, fecha_compra) WHERE (saldo_pendiente > (0)::numeric);


--
-- Name: idx_conteo_estado_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conteo_estado_fecha ON public.conteo_inventario USING btree (estado, created_at DESC);


--
-- Name: idx_cotizacion_busqueda_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizacion_busqueda_trgm ON public.cotizacion USING gin (public.directory_search_document(ARRAY[(folio)::text, ('C-'::text || (folio)::text), (nombre_receptor)::text, (rfc_receptor)::text]) public.gin_trgm_ops);


--
-- Name: idx_cotizacion_unidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizacion_unidad ON public.cotizacion USING btree (id_unidad) WHERE (id_unidad IS NOT NULL);


--
-- Name: idx_cotizacion_vencimiento_pendiente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizacion_vencimiento_pendiente ON public.cotizacion USING btree (fecha_vencimiento) WHERE ((estatus)::text = 'Pendiente'::text);


--
-- Name: idx_crm_agenda_abierta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_agenda_abierta ON public.crm_oportunidad USING btree (fecha_siguiente_accion, id_oportunidad) WHERE ((etapa)::text <> ALL ((ARRAY['Ganada'::character varying, 'Perdida'::character varying])::text[]));


--
-- Name: idx_crm_campana_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_campana_estado ON public.crm_campana USING btree (estado, fecha_inicio);


--
-- Name: idx_crm_comunicacion_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_comunicacion_cliente ON public.crm_comunicacion USING btree (id_cliente, fecha DESC);


--
-- Name: idx_crm_comunicacion_oportunidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_comunicacion_oportunidad ON public.crm_comunicacion USING btree (id_oportunidad, fecha DESC);


--
-- Name: idx_crm_encuesta_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_encuesta_cliente ON public.crm_encuesta_satisfaccion USING btree (id_cliente, created_at DESC);


--
-- Name: idx_crm_oportunidad_cotizacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_oportunidad_cotizacion ON public.crm_oportunidad_cotizacion USING btree (id_oportunidad, id_cotizacion);


--
-- Name: idx_crm_oportunidad_etapa_accion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_oportunidad_etapa_accion ON public.crm_oportunidad USING btree (etapa, fecha_siguiente_accion);


--
-- Name: idx_crm_seguimiento_oportunidad_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_seguimiento_oportunidad_fecha ON public.crm_seguimiento USING btree (id_oportunidad, created_at DESC);


--
-- Name: idx_crm_tarea_responsable_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_tarea_responsable_estado ON public.crm_tarea USING btree (id_responsable, estado, fecha_vencimiento);


--
-- Name: idx_crm_tarea_vencida; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_tarea_vencida ON public.crm_tarea USING btree (fecha_vencimiento) WHERE ((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'En progreso'::character varying])::text[]));


--
-- Name: idx_crm_unidad_busqueda_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_unidad_busqueda_trgm ON public.crm_unidad_cliente USING gin (public.directory_search_document(ARRAY[(vin)::text, (esn)::text, (numero_economico)::text, (placas)::text]) public.gin_trgm_ops);


--
-- Name: idx_crm_unidad_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_unidad_cliente ON public.crm_unidad_cliente USING btree (id_cliente, updated_at DESC);


--
-- Name: idx_crm_unidad_oportunidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_unidad_oportunidad ON public.crm_unidad_cliente USING btree (id_oportunidad, updated_at DESC);


--
-- Name: idx_cuentabancaria_entidad_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuentabancaria_entidad_tipo ON public.cuentabancaria USING btree ("IdEntidad", "IdTipoEntidad");


--
-- Name: idx_detalle_factura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_factura ON public.conceptofactura USING btree (id_factura);


--
-- Name: idx_devolucion_factura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devolucion_factura ON public.devolucion USING btree (id_factura, fecha DESC);


--
-- Name: idx_email_entidad_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_entidad_tipo ON public.email USING btree ("IdEntidad", "IdTipoEntidad");


--
-- Name: idx_estado_clave_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_estado_clave_unique ON public.estado USING btree ("Clave");


--
-- Name: idx_evaluacion_proveedor_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluacion_proveedor_fecha ON public.evaluacion_proveedor USING btree (id_proveedor, created_at DESC);


--
-- Name: idx_factura_busqueda_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_busqueda_trgm ON public.factura USING gin (public.directory_search_document(ARRAY[(folio)::text, ((serie)::text || (folio)::text), (((serie)::text || '-'::text) || (folio)::text), (nombre_receptor)::text, (rfc_receptor)::text]) public.gin_trgm_ops);


--
-- Name: idx_factura_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_cliente ON public.factura USING btree (id_cliente);


--
-- Name: idx_factura_cliente_saldo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_cliente_saldo ON public.factura USING btree (id_cliente, fecha_emision) WHERE (saldo_pendiente > (0)::numeric);


--
-- Name: idx_factura_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_origen ON public.factura USING btree (id_factura_origen);


--
-- Name: idx_factura_proveedor_discrepancia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_proveedor_discrepancia ON public.factura_proveedor_discrepancia USING btree (id_factura_proveedor, estado);


--
-- Name: idx_factura_proveedor_programacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_proveedor_programacion ON public.factura_proveedor_programacion USING btree (fecha_programada, estado);


--
-- Name: idx_factura_proveedor_recepcion_detalle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_proveedor_recepcion_detalle ON public.factura_proveedor_recepcion USING btree (id_recepcion_detalle);


--
-- Name: idx_factura_proveedor_saldo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_proveedor_saldo ON public.factura_proveedor USING btree (fecha_vencimiento, id_proveedor) WHERE ((saldo_pendiente > (0)::numeric) AND ((estado)::text = ANY ((ARRAY['Aprobada'::character varying, 'Parcialmente pagada'::character varying])::text[])));


--
-- Name: idx_factura_unidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_factura_unidad ON public.factura USING btree (id_unidad) WHERE (id_unidad IS NOT NULL);


--
-- Name: idx_fiscal_documento_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiscal_documento_estado ON public.fiscal_documento USING btree (estado, updated_at DESC);


--
-- Name: idx_fiscal_evento_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fiscal_evento_documento ON public.fiscal_evento USING btree (id_documento, created_at DESC);


--
-- Name: idx_garantia_compromiso_abierta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_garantia_compromiso_abierta ON public.garantia USING btree (fecha_compromiso) WHERE ((estado)::text <> ALL ((ARRAY['Cerrada'::character varying, 'Rechazada'::character varying])::text[]));


--
-- Name: idx_garantia_estado_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_garantia_estado_fecha ON public.garantia USING btree (estado, created_at DESC);


--
-- Name: idx_impuestoproducto_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impuestoproducto_producto ON public.impuestoproducto USING btree ("IdProducto");


--
-- Name: idx_inventario_ubicacion_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventario_ubicacion_producto ON public.inventario_ubicacion USING btree (id_producto, id_ubicacion);


--
-- Name: idx_job_run_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_run_latest ON public.operational_job_run USING btree (job_name, started_at DESC);


--
-- Name: idx_job_run_success; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_run_success ON public.operational_job_run USING btree (job_name, finished_at DESC) WHERE (status = 'success'::text);


--
-- Name: idx_kardex_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kardex_fecha ON public.kardex USING btree (fecha);


--
-- Name: idx_kardex_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kardex_producto ON public.kardex USING btree (id_producto);


--
-- Name: idx_kardex_producto_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kardex_producto_fecha ON public.kardex USING btree (id_producto, fecha DESC);


--
-- Name: idx_lista_precio_vigente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lista_precio_vigente ON public.lista_precio USING btree (activa, valid_from, valid_to);


--
-- Name: idx_localidad_clave_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_localidad_clave_estado ON public.localidad USING btree ("Clave", "ClaveEstado");


--
-- Name: idx_lote_caducidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lote_caducidad ON public.inventario_lote USING btree (fecha_caducidad) WHERE ((fecha_caducidad IS NOT NULL) AND (cantidad > (0)::numeric));


--
-- Name: idx_municipio_clave_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_municipio_clave_estado ON public.municipio USING btree ("ClaveEstado");


--
-- Name: idx_mv_clientes_cobranza; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_clientes_cobranza ON public.mv_clientes_cobranza USING btree (id);


--
-- Name: idx_mv_inventario_almacen; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_inventario_almacen ON public.mv_inventario_almacen USING btree (id);


--
-- Name: idx_mv_operaciones_avanzadas; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_operaciones_avanzadas ON public.mv_operaciones_avanzadas USING btree (id);


--
-- Name: idx_mv_ventas_facturacion; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_ventas_facturacion ON public.mv_ventas_facturacion USING btree (id);


--
-- Name: idx_notification_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_user_unread ON public.app_notification USING btree (id_user, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_operation_idempotency_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operation_idempotency_created_at ON public.operation_idempotency USING btree (created_at);


--
-- Name: idx_orden_compra_compra_directa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orden_compra_compra_directa ON public.orden_compra USING btree (created_at DESC, id_orden DESC) WHERE ((origen)::text = 'Compra directa'::text);


--
-- Name: idx_orden_compra_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orden_compra_estado ON public.orden_compra USING btree (estado, created_at DESC);


--
-- Name: idx_pago_rep; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pago_rep ON public.pago USING btree (id_rep) WHERE (id_rep IS NOT NULL);


--
-- Name: idx_pagodocumentos_complemento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagodocumentos_complemento ON public.pagodocumentos USING btree ("IdComplementoPago");


--
-- Name: idx_pagodocumentos_factura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagodocumentos_factura ON public.pagodocumentos USING btree ("IdFactura");


--
-- Name: idx_pagosdetalle_pagoprov; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagosdetalle_pagoprov ON public.pagosdetalleproveedor USING btree ("IdPagosProveedor");


--
-- Name: idx_pagosproveedor_proveedor_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagosproveedor_proveedor_fecha ON public.pagosproveedor USING btree ("IdProveedor", "FechaPago");


--
-- Name: idx_pedido_cliente_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_cliente_fecha ON public.pedido_venta USING btree (id_cliente, created_at DESC);


--
-- Name: idx_pedido_estado_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_estado_fecha ON public.pedido_venta USING btree (estado, created_at DESC);


--
-- Name: idx_picking_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picking_pedido ON public.pedido_surtido_ubicacion USING btree (id_pedido, id_detalle, estado);


--
-- Name: idx_picking_ubicacion_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_picking_ubicacion_activo ON public.pedido_surtido_ubicacion USING btree (id_ubicacion, id_producto) WHERE ((estado)::text = 'Reservada'::text);


--
-- Name: idx_poliza_detalle_centro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_detalle_centro ON public.poliza_contable_detalle USING btree (id_centro_costo);


--
-- Name: idx_poliza_detalle_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_detalle_cuenta ON public.poliza_contable_detalle USING btree (id_cuenta);


--
-- Name: idx_poliza_detalle_poliza; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_detalle_poliza ON public.poliza_contable_detalle USING btree (id_poliza);


--
-- Name: idx_poliza_fecha_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poliza_fecha_estado ON public.poliza_contable USING btree (fecha DESC, estado);


--
-- Name: idx_prod_cotiz_producto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prod_cotiz_producto ON public.producto_cotizacion_prov USING btree (id_producto);


--
-- Name: idx_prodcruce_destino; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prodcruce_destino ON public.producto_cruce USING btree (id_producto_destino);


--
-- Name: idx_prodcruce_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prodcruce_origen ON public.producto_cruce USING btree (id_producto_origen);


--
-- Name: idx_producto_aplicacion_busqueda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_aplicacion_busqueda ON public.producto_aplicacion USING btree (lower((COALESCE(motor, ''::character varying))::text), lower((COALESCE(modelo, ''::character varying))::text));


--
-- Name: idx_producto_aplicacion_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_aplicacion_trgm ON public.producto_aplicacion USING gin (public.product_application_text(ARRAY[(fabricante_equipo)::text, (modelo)::text, (motor)::text, (restricciones)::text]) public.gin_trgm_ops);


--
-- Name: idx_producto_busqueda_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_busqueda_codigo ON public.producto USING btree (lower(regexp_replace((COALESCE("Codigo", ''::character varying))::text, '[^[:alnum:]]'::text, ''::text, 'g'::text)));


--
-- Name: idx_producto_busqueda_descripcion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_busqueda_descripcion ON public.producto USING btree (lower(("Descripcion")::text));


--
-- Name: idx_producto_categoria_busqueda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_categoria_busqueda ON public.producto USING btree ("IdCategoria");


--
-- Name: idx_producto_codigo_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_codigo_trgm ON public.producto USING gin (COALESCE("Codigo", ''::character varying) public.gin_trgm_ops);


--
-- Name: idx_producto_descripcion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_descripcion ON public.producto USING btree ("Descripcion");


--
-- Name: idx_producto_descripcion_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_descripcion_trgm ON public.producto USING gin (COALESCE("Descripcion", ''::character varying) public.gin_trgm_ops);


--
-- Name: idx_producto_marca; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_marca ON public.producto USING btree ("Marca");


--
-- Name: idx_producto_marca_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_marca_trgm ON public.producto USING gin (COALESCE("Marca", ''::character varying) public.gin_trgm_ops);


--
-- Name: idx_producto_numero_normalizado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_numero_normalizado ON public.producto_numero_parte USING btree (numero_normalizado);


--
-- Name: idx_producto_oem_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_producto_oem_trgm ON public.producto_numero_parte USING gin (numero_normalizado public.gin_trgm_ops);


--
-- Name: idx_proveedor_busqueda_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proveedor_busqueda_trgm ON public.proveedor USING gin (public.directory_search_document(ARRAY[("IdProveedor")::text, ("RFC")::text, ("RazonSocial")::text, ("CodigoPostal")::text]) public.gin_trgm_ops);


--
-- Name: idx_proveedor_razon_social; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proveedor_razon_social ON public.proveedor USING btree ("RazonSocial");


--
-- Name: idx_recepcion_compra_orden; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recepcion_compra_orden ON public.recepcion_compra USING btree (id_orden, created_at DESC);


--
-- Name: idx_reserva_producto_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reserva_producto_activa ON public.reserva_inventario USING btree (id_producto) WHERE ((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Surtida'::character varying])::text[]));


--
-- Name: idx_reserva_vencimiento_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reserva_vencimiento_activa ON public.reserva_inventario USING btree (expires_at, id_producto) WHERE ((estado)::text = 'Activa'::text);


--
-- Name: idx_solicitud_compra_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitud_compra_estado ON public.solicitud_compra USING btree (estado, created_at DESC);


--
-- Name: idx_telefono_entidad_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telefono_entidad_tipo ON public.telefono USING btree ("IdEntidad", "IdTipoEntidad");


--
-- Name: idx_tesoreria_importacion_cuenta_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesoreria_importacion_cuenta_fecha ON public.tesoreria_importacion USING btree (id_cuenta, created_at DESC);


--
-- Name: idx_tesoreria_movimiento_busqueda; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesoreria_movimiento_busqueda ON public.tesoreria_movimiento USING btree (id_cuenta, estado, fecha DESC);


--
-- Name: idx_tesoreria_movimiento_conciliacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tesoreria_movimiento_conciliacion ON public.tesoreria_movimiento USING btree (id_conciliacion) WHERE (id_conciliacion IS NOT NULL);


--
-- Name: idx_venta_perdida_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venta_perdida_fecha ON public.venta_perdida USING btree (created_at DESC, id_venta_perdida DESC);


--
-- Name: idx_venta_perdida_motivo_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venta_perdida_motivo_fecha ON public.venta_perdida USING btree (motivo, created_at DESC, id_venta_perdida DESC);


--
-- Name: idx_venta_perdida_producto_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venta_perdida_producto_fecha ON public.venta_perdida USING btree (id_producto, created_at DESC);


--
-- Name: idx_vw_prediccion_demanda_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vw_prediccion_demanda_pk ON public.vw_prediccion_demanda USING btree (id_producto);


--
-- Name: idx_web_producto_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_web_producto_estado ON public.web_producto_ficha USING btree (estado, id_producto);


--
-- Name: ix_factura_gasto_reembolso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_factura_gasto_reembolso ON public.factura USING btree (id_gasto_reembolso) WHERE (id_gasto_reembolso IS NOT NULL);


--
-- Name: portal_acceso_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_acceso_cliente ON public.portal_acceso USING btree (id_cliente, id_acceso DESC);


--
-- Name: portal_cotizacion_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_cotizacion_cliente ON public.cotizacion USING btree (id_cliente, id_cotizacion);


--
-- Name: portal_garantia_factura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_garantia_factura ON public.garantia USING btree (id_factura, id_garantia);


--
-- Name: portal_publicacion_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_publicacion_cliente ON public.portal_publicacion USING btree (id_cliente, id_publicacion DESC);


--
-- Name: portal_publicacion_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_publicacion_origen ON public.portal_publicacion USING btree (id_cliente, tipo, origen);


--
-- Name: portal_sesion_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX portal_sesion_cuenta ON public.portal_sesion USING btree (id_acceso, creada_en DESC) WHERE (revocada_en IS NULL);


--
-- Name: uq_factura_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_factura_pedido ON public.factura USING btree (id_pedido) WHERE (id_pedido IS NOT NULL);


--
-- Name: uq_factura_serie_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_factura_serie_folio ON public.factura USING btree (serie, folio) WHERE ((serie IS NOT NULL) AND (folio IS NOT NULL));


--
-- Name: uq_pedido_cotizacion; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pedido_cotizacion ON public.pedido_venta USING btree (id_cotizacion) WHERE (id_cotizacion IS NOT NULL);


--
-- Name: uq_poliza_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_poliza_origen ON public.poliza_contable USING btree (origen_tipo, origen_id) WHERE (origen_tipo IS NOT NULL);


--
-- Name: uq_presupuesto_centro; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_presupuesto_centro ON public.presupuesto_contable USING btree (anio, mes, id_cuenta, id_centro_costo) WHERE (id_centro_costo IS NOT NULL);


--
-- Name: uq_presupuesto_general; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_presupuesto_general ON public.presupuesto_contable USING btree (anio, mes, id_cuenta) WHERE (id_centro_costo IS NULL);


--
-- Name: uq_tesoreria_conciliacion_sistema_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tesoreria_conciliacion_sistema_activo ON public.tesoreria_conciliacion_sistema USING btree (id_caja_movimiento) WHERE activo;


--
-- Name: uq_tesoreria_movimiento_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tesoreria_movimiento_fingerprint ON public.tesoreria_movimiento USING btree (id_cuenta, fingerprint) WHERE (fingerprint IS NOT NULL);


--
-- Name: uq_tesoreria_movimiento_referencia; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tesoreria_movimiento_referencia ON public.tesoreria_movimiento USING btree (id_cuenta, referencia) WHERE ((referencia IS NOT NULL) AND ((referencia)::text <> ''::text));


--
-- Name: ux_almacen_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_almacen_principal ON public.almacen USING btree (es_principal) WHERE es_principal;


--
-- Name: ux_aplicacion_anticipo_proveedor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_aplicacion_anticipo_proveedor ON public.aplicacion_proveedor USING btree (id_factura_proveedor, id_anticipo) WHERE (id_anticipo IS NOT NULL);


--
-- Name: ux_aplicacion_nota_proveedor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_aplicacion_nota_proveedor ON public.aplicacion_proveedor USING btree (id_factura_proveedor, id_nota) WHERE (id_nota IS NOT NULL);


--
-- Name: ux_cliente_contacto_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_cliente_contacto_principal ON public.cliente_contacto USING btree (id_cliente) WHERE es_principal;


--
-- Name: ux_crm_unidad_esn; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_crm_unidad_esn ON public.crm_unidad_cliente USING btree (esn) WHERE (esn IS NOT NULL);


--
-- Name: ux_crm_unidad_vin; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_crm_unidad_vin ON public.crm_unidad_cliente USING btree (vin) WHERE (vin IS NOT NULL);


--
-- Name: ux_devolucion_gasto_reembolso; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_devolucion_gasto_reembolso ON public.devolucion USING btree (id_gasto_reembolso) WHERE (id_gasto_reembolso IS NOT NULL);


--
-- Name: ux_factura_proveedor_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_factura_proveedor_folio ON public.factura_proveedor USING btree (id_proveedor, lower((COALESCE(serie, ''::character varying))::text), lower((folio)::text)) WHERE ((estado)::text <> 'Cancelada'::text);


--
-- Name: ux_factura_proveedor_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_factura_proveedor_uuid ON public.factura_proveedor USING btree (uuid) WHERE (uuid IS NOT NULL);


--
-- Name: ux_fiscal_documento_factura; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_fiscal_documento_factura ON public.fiscal_documento USING btree (id_factura) WHERE (id_factura IS NOT NULL);


--
-- Name: ux_fiscal_documento_rep; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_fiscal_documento_rep ON public.fiscal_documento USING btree (id_rep) WHERE (id_rep IS NOT NULL);


--
-- Name: ux_fiscal_documento_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_fiscal_documento_uuid ON public.fiscal_documento USING btree (uuid) WHERE (uuid IS NOT NULL);


--
-- Name: ux_nota_credito_proveedor_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_nota_credito_proveedor_folio ON public.nota_credito_proveedor USING btree (id_proveedor, lower((folio)::text)) WHERE ((estado)::text <> 'Cancelada'::text);


--
-- Name: ux_nota_credito_proveedor_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_nota_credito_proveedor_uuid ON public.nota_credito_proveedor USING btree (uuid) WHERE (uuid IS NOT NULL);


--
-- Name: almacen_picking_verificacion almacen_verificacion_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER almacen_verificacion_auditoria AFTER INSERT ON public.almacen_picking_verificacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: almacen_picking_verificacion almacen_verificacion_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER almacen_verificacion_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.almacen_picking_verificacion FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.almacen_picking_verificacion ENABLE ALWAYS TRIGGER almacen_verificacion_conservar;


--
-- Name: almacen_picking_verificacion almacen_verificacion_vinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER almacen_verificacion_vinculo BEFORE INSERT ON public.almacen_picking_verificacion FOR EACH ROW EXECUTE FUNCTION public.fn_almacen_verificar_picking();

ALTER TABLE public.almacen_picking_verificacion ENABLE ALWAYS TRIGGER almacen_verificacion_vinculo;


--
-- Name: cotizacion_respuesta cotizacion_respuesta_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cotizacion_respuesta_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.cotizacion_respuesta FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cotizacion_evidencia_inmutable();

ALTER TABLE public.cotizacion_respuesta ENABLE ALWAYS TRIGGER cotizacion_respuesta_inmutable;


--
-- Name: cotizacion_revision cotizacion_revision_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cotizacion_revision_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.cotizacion_revision FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cotizacion_evidencia_inmutable();

ALTER TABLE public.cotizacion_revision ENABLE ALWAYS TRIGGER cotizacion_revision_inmutable;


--
-- Name: crm_secuencia_aplicacion crm_aplicacion_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_aplicacion_audit AFTER INSERT ON public.crm_secuencia_aplicacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_secuencia_aplicacion crm_aplicacion_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_aplicacion_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_secuencia_aplicacion FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_secuencia_aplicacion ENABLE ALWAYS TRIGGER crm_aplicacion_conservar;


--
-- Name: crm_consentimiento_comercial crm_consentimiento_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_consentimiento_auditoria AFTER INSERT ON public.crm_consentimiento_comercial FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_consentimiento_comercial crm_consentimiento_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_consentimiento_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_consentimiento_comercial FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_campana_conservar();

ALTER TABLE public.crm_consentimiento_comercial ENABLE ALWAYS TRIGGER crm_consentimiento_conservar;


--
-- Name: crm_etapa_evento crm_etapa_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_etapa_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_etapa_evento FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_etapa_evento ENABLE ALWAYS TRIGGER crm_etapa_conservar;


--
-- Name: crm_oportunidad crm_etapa_evento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_etapa_evento AFTER INSERT OR UPDATE OF etapa, id_cliente, id_responsable ON public.crm_oportunidad FOR EACH ROW EXECUTE FUNCTION public.fn_crm_etapa_evento();


--
-- Name: crm_campana_preparacion crm_preparacion_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_preparacion_auditoria AFTER INSERT ON public.crm_campana_preparacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_campana_preparacion crm_preparacion_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_preparacion_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_campana_preparacion FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_campana_conservar();

ALTER TABLE public.crm_campana_preparacion ENABLE ALWAYS TRIGGER crm_preparacion_conservar;


--
-- Name: crm_secuencia_regla crm_regla_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_regla_audit AFTER INSERT ON public.crm_secuencia_regla FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_secuencia_regla crm_regla_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_regla_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_secuencia_regla FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_secuencia_regla ENABLE ALWAYS TRIGGER crm_regla_conservar;


--
-- Name: crm_secuencia_aplicacion crm_regla_vinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_regla_vinculo BEFORE INSERT ON public.crm_secuencia_aplicacion FOR EACH ROW EXECUTE FUNCTION public.fn_crm_regla_vinculo();


--
-- Name: crm_reporte_reintento crm_reporte_cola_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_cola_audit AFTER INSERT OR UPDATE ON public.crm_reporte_reintento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_reporte_reintento crm_reporte_cola_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_cola_conservar BEFORE DELETE OR TRUNCATE ON public.crm_reporte_reintento FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_conservar;


--
-- Name: crm_reporte_reintento crm_reporte_cola_control; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_cola_control BEFORE INSERT OR UPDATE ON public.crm_reporte_reintento FOR EACH ROW EXECUTE FUNCTION public.fn_crm_reporte_cola_control();

ALTER TABLE public.crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_control;


--
-- Name: crm_reporte_reintento crm_reporte_cola_vinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_cola_vinculo BEFORE INSERT ON public.crm_reporte_reintento FOR EACH ROW EXECUTE FUNCTION public.fn_crm_reporte_cola_vinculo();

ALTER TABLE public.crm_reporte_reintento ENABLE ALWAYS TRIGGER crm_reporte_cola_vinculo;


--
-- Name: crm_reporte_intento_evento crm_reporte_intento_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_intento_audit AFTER INSERT ON public.crm_reporte_intento_evento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_reporte_intento_evento crm_reporte_intento_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_intento_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_reporte_intento_evento FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_reporte_intento_evento ENABLE ALWAYS TRIGGER crm_reporte_intento_conservar;


--
-- Name: crm_reporte_programa crm_reporte_programa_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_programa_audit AFTER INSERT OR UPDATE ON public.crm_reporte_programa FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_reporte_programa crm_reporte_programa_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_programa_conservar BEFORE DELETE OR TRUNCATE ON public.crm_reporte_programa FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_reporte_programa ENABLE ALWAYS TRIGGER crm_reporte_programa_conservar;


--
-- Name: crm_reporte_programa crm_reporte_programa_control; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_programa_control BEFORE INSERT OR UPDATE ON public.crm_reporte_programa FOR EACH ROW EXECUTE FUNCTION public.fn_crm_reporte_programa_control();

ALTER TABLE public.crm_reporte_programa ENABLE ALWAYS TRIGGER crm_reporte_programa_control;


--
-- Name: crm_reporte_recuperacion crm_reporte_recuperacion_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_recuperacion_audit AFTER INSERT ON public.crm_reporte_recuperacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_reporte_recuperacion crm_reporte_recuperacion_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_recuperacion_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_reporte_recuperacion FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_reporte_recuperacion ENABLE ALWAYS TRIGGER crm_reporte_recuperacion_conservar;


--
-- Name: crm_reporte_recuperacion crm_reporte_recuperacion_vinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_recuperacion_vinculo BEFORE INSERT ON public.crm_reporte_recuperacion FOR EACH ROW EXECUTE FUNCTION public.fn_crm_reporte_cola_vinculo();

ALTER TABLE public.crm_reporte_recuperacion ENABLE ALWAYS TRIGGER crm_reporte_recuperacion_vinculo;


--
-- Name: crm_reporte_resultado crm_reporte_resultado_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_resultado_audit AFTER INSERT ON public.crm_reporte_resultado FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_reporte_resultado crm_reporte_resultado_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_reporte_resultado_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_reporte_resultado FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_reporte_resultado ENABLE ALWAYS TRIGGER crm_reporte_resultado_conservar;


--
-- Name: crm_secuencia crm_secuencia_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_audit AFTER INSERT OR DELETE OR UPDATE ON public.crm_secuencia FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_secuencia_control crm_secuencia_control_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_control_audit AFTER INSERT ON public.crm_secuencia_control FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_secuencia_control crm_secuencia_control_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_control_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_secuencia_control FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_secuencia_control ENABLE ALWAYS TRIGGER crm_secuencia_control_conservar;


--
-- Name: crm_secuencia_evento crm_secuencia_evento_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_evento_audit AFTER INSERT ON public.crm_secuencia_evento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_secuencia_evento crm_secuencia_evento_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_evento_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_secuencia_evento FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_secuencia_evento ENABLE ALWAYS TRIGGER crm_secuencia_evento_conservar;


--
-- Name: crm_secuencia_modelo crm_secuencia_modelo_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_modelo_audit AFTER INSERT ON public.crm_secuencia_modelo FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_secuencia_modelo crm_secuencia_modelo_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_modelo_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.crm_secuencia_modelo FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.crm_secuencia_modelo ENABLE ALWAYS TRIGGER crm_secuencia_modelo_conservar;


--
-- Name: crm_tarea crm_secuencia_tarea; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_secuencia_tarea BEFORE DELETE OR UPDATE ON public.crm_tarea FOR EACH ROW EXECUTE FUNCTION public.fn_crm_secuencia_tarea();


--
-- Name: documento_salida_archivo documento_salida_archivo_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_archivo_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.documento_salida_archivo FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.documento_salida_archivo ENABLE ALWAYS TRIGGER documento_salida_archivo_conservar;


--
-- Name: auditoria_jsonb documento_salida_archivo_privado; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_archivo_privado BEFORE INSERT OR UPDATE ON public.auditoria_jsonb FOR EACH ROW WHEN (((new.table_name)::text = 'documento_salida_archivo'::text)) EXECUTE FUNCTION public.fn_documento_salida_archivo_privado();

ALTER TABLE public.auditoria_jsonb ENABLE ALWAYS TRIGGER documento_salida_archivo_privado;


--
-- Name: documento_salida_archivo documento_salida_archivo_vinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_archivo_vinculo BEFORE INSERT ON public.documento_salida_archivo FOR EACH ROW EXECUTE FUNCTION public.fn_documento_salida_vinculo();

ALTER TABLE public.documento_salida_archivo ENABLE ALWAYS TRIGGER documento_salida_archivo_vinculo;


--
-- Name: documento_salida documento_salida_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_auditoria AFTER INSERT ON public.documento_salida FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: documento_salida_cierre documento_salida_cierre_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_cierre_auditoria AFTER INSERT ON public.documento_salida_cierre FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: documento_salida_cierre documento_salida_cierre_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_cierre_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.documento_salida_cierre FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.documento_salida_cierre ENABLE ALWAYS TRIGGER documento_salida_cierre_conservar;


--
-- Name: documento_salida documento_salida_conservar; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_conservar BEFORE DELETE OR UPDATE OR TRUNCATE ON public.documento_salida FOR EACH STATEMENT EXECUTE FUNCTION public.fn_crm_secuencia_conservar();

ALTER TABLE public.documento_salida ENABLE ALWAYS TRIGGER documento_salida_conservar;


--
-- Name: documento_salida documento_salida_vinculo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documento_salida_vinculo BEFORE INSERT ON public.documento_salida FOR EACH ROW EXECUTE FUNCTION public.fn_documento_salida_vinculo();

ALTER TABLE public.documento_salida ENABLE ALWAYS TRIGGER documento_salida_vinculo;


--
-- Name: entrega_pedido entrega_evidenciada_protegida; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER entrega_evidenciada_protegida BEFORE DELETE OR UPDATE ON public.entrega_pedido FOR EACH ROW EXECUTE FUNCTION public.fn_proteger_entrega_evidenciada();

ALTER TABLE public.entrega_pedido ENABLE ALWAYS TRIGGER entrega_evidenciada_protegida;


--
-- Name: pedido_entrega_archivo pedido_entrega_archivo_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pedido_entrega_archivo_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.pedido_entrega_archivo FOR EACH STATEMENT EXECUTE FUNCTION public.fn_pedido_entrega_inmutable();

ALTER TABLE public.pedido_entrega_archivo ENABLE ALWAYS TRIGGER pedido_entrega_archivo_inmutable;


--
-- Name: pedido_entrega_evidencia pedido_entrega_evidencia_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pedido_entrega_evidencia_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.pedido_entrega_evidencia FOR EACH STATEMENT EXECUTE FUNCTION public.fn_pedido_entrega_inmutable();

ALTER TABLE public.pedido_entrega_evidencia ENABLE ALWAYS TRIGGER pedido_entrega_evidencia_inmutable;


--
-- Name: portal_acceso portal_acceso_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_acceso_auditoria AFTER INSERT OR DELETE OR UPDATE ON public.portal_acceso FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: portal_acceso portal_cliente_fijo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_cliente_fijo BEFORE UPDATE ON public.portal_acceso FOR EACH ROW EXECUTE FUNCTION public.fn_portal_cliente_fijo();


--
-- Name: portal_evento portal_evento_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_evento_auditoria AFTER INSERT ON public.portal_evento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: portal_evento portal_evento_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_evento_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.portal_evento FOR EACH STATEMENT EXECUTE FUNCTION public.fn_portal_evento_inmutable();

ALTER TABLE public.portal_evento ENABLE ALWAYS TRIGGER portal_evento_inmutable;


--
-- Name: auditoria_jsonb portal_proteger_secretos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_proteger_secretos BEFORE INSERT ON public.auditoria_jsonb FOR EACH ROW EXECUTE FUNCTION public.fn_portal_proteger_secretos();

ALTER TABLE public.auditoria_jsonb ENABLE ALWAYS TRIGGER portal_proteger_secretos;


--
-- Name: portal_publicacion_archivo portal_publicacion_archivo_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_publicacion_archivo_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.portal_publicacion_archivo FOR EACH STATEMENT EXECUTE FUNCTION public.fn_portal_publicacion_inmutable();

ALTER TABLE public.portal_publicacion_archivo ENABLE ALWAYS TRIGGER portal_publicacion_archivo_inmutable;


--
-- Name: portal_publicacion portal_publicacion_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_publicacion_auditoria AFTER INSERT ON public.portal_publicacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: portal_publicacion portal_publicacion_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_publicacion_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.portal_publicacion FOR EACH STATEMENT EXECUTE FUNCTION public.fn_portal_publicacion_inmutable();

ALTER TABLE public.portal_publicacion ENABLE ALWAYS TRIGGER portal_publicacion_inmutable;


--
-- Name: portal_publicacion_retiro portal_publicacion_retiro_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_publicacion_retiro_auditoria AFTER INSERT ON public.portal_publicacion_retiro FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: portal_publicacion_retiro portal_publicacion_retiro_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_publicacion_retiro_inmutable BEFORE DELETE OR UPDATE OR TRUNCATE ON public.portal_publicacion_retiro FOR EACH STATEMENT EXECUTE FUNCTION public.fn_portal_publicacion_inmutable();

ALTER TABLE public.portal_publicacion_retiro ENABLE ALWAYS TRIGGER portal_publicacion_retiro_inmutable;


--
-- Name: crm_solicitud_web_resolucion resolucion_web_solo_insercion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER resolucion_web_solo_insercion BEFORE DELETE OR UPDATE ON public.crm_solicitud_web_resolucion FOR EACH ROW EXECUTE FUNCTION public.fn_resolucion_web_solo_insercion();


--
-- Name: app_access_profile trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.app_access_profile FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: app_access_profile_permission trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.app_access_profile_permission FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: app_permission trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.app_permission FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: app_role_permission trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.app_role_permission FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: app_user_access_profile trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.app_user_access_profile FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: app_user_permission trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.app_user_permission FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: auth_user trg_access_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_access_audit AFTER INSERT OR DELETE OR UPDATE ON public.auth_user FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: conceptofactura trg_asignar_costo_venta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asignar_costo_venta BEFORE INSERT ON public.conceptofactura FOR EACH ROW EXECUTE FUNCTION public.fn_asignar_costo_venta();


--
-- Name: auditoria_jsonb trg_audit_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON public.auditoria_jsonb FOR EACH STATEMENT EXECUTE FUNCTION public.fn_audit_append_only();

ALTER TABLE public.auditoria_jsonb ENABLE ALWAYS TRIGGER trg_audit_append_only;


--
-- Name: auditoria_jsonb trg_audit_enrich; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_enrich BEFORE INSERT ON public.auditoria_jsonb FOR EACH ROW EXECUTE FUNCTION public.fn_audit_enrich();

ALTER TABLE public.auditoria_jsonb ENABLE ALWAYS TRIGGER trg_audit_enrich;


--
-- Name: pedido_entrega_evidencia trg_audit_entrega_evidencia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_entrega_evidencia AFTER INSERT ON public.pedido_entrega_evidencia FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_unidad_archivo trg_audit_expediente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_expediente AFTER INSERT OR DELETE OR UPDATE ON public.crm_unidad_archivo FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_unidad_lectura trg_audit_expediente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_expediente AFTER INSERT OR DELETE OR UPDATE ON public.crm_unidad_lectura FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_unidad_mantenimiento trg_audit_expediente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_expediente AFTER INSERT OR DELETE OR UPDATE ON public.crm_unidad_mantenimiento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: almacen trg_audit_jsonb_almacen; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_almacen AFTER INSERT OR DELETE OR UPDATE ON public.almacen FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: almacen_ubicacion trg_audit_jsonb_almacen_ubicacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_almacen_ubicacion AFTER INSERT OR DELETE OR UPDATE ON public.almacen_ubicacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: anticipo_proveedor trg_audit_jsonb_anticipo_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_anticipo_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.anticipo_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: aplicacion_proveedor trg_audit_jsonb_aplicacion_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_aplicacion_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.aplicacion_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: app_notification trg_audit_jsonb_app_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_app_notification AFTER INSERT OR DELETE OR UPDATE ON public.app_notification FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: backorder_cliente trg_audit_jsonb_backorder_cliente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_backorder_cliente AFTER INSERT OR DELETE OR UPDATE ON public.backorder_cliente FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: casco_recuperable trg_audit_jsonb_casco_recuperable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_casco_recuperable AFTER INSERT OR DELETE OR UPDATE ON public.casco_recuperable FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: centro_costo trg_audit_jsonb_centro_costo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_centro_costo AFTER INSERT OR DELETE OR UPDATE ON public.centro_costo FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cliente trg_audit_jsonb_cliente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_cliente AFTER INSERT OR DELETE OR UPDATE ON public.cliente FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cliente_comercial trg_audit_jsonb_cliente_comercial; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_cliente_comercial AFTER INSERT OR DELETE OR UPDATE ON public.cliente_comercial FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cliente_contacto trg_audit_jsonb_cliente_contacto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_cliente_contacto AFTER INSERT OR DELETE OR UPDATE ON public.cliente_contacto FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: compra trg_audit_jsonb_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_compra AFTER INSERT OR DELETE OR UPDATE ON public.compra FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: conteo_inventario trg_audit_jsonb_conteo_inventario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_conteo_inventario AFTER INSERT OR DELETE OR UPDATE ON public.conteo_inventario FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: conteo_inventario_detalle trg_audit_jsonb_conteo_inventario_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_conteo_inventario_detalle AFTER INSERT OR DELETE OR UPDATE ON public.conteo_inventario_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_campana trg_audit_jsonb_crm_campana; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_campana AFTER INSERT OR DELETE OR UPDATE ON public.crm_campana FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_comunicacion trg_audit_jsonb_crm_comunicacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_comunicacion AFTER INSERT OR DELETE OR UPDATE ON public.crm_comunicacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_encuesta_satisfaccion trg_audit_jsonb_crm_encuesta_satisfaccion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_encuesta_satisfaccion AFTER INSERT OR DELETE OR UPDATE ON public.crm_encuesta_satisfaccion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_meta_vendedor trg_audit_jsonb_crm_meta_vendedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_meta_vendedor AFTER INSERT OR DELETE OR UPDATE ON public.crm_meta_vendedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_oportunidad_cotizacion trg_audit_jsonb_crm_oportunidad_cotizacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_oportunidad_cotizacion AFTER INSERT OR DELETE OR UPDATE ON public.crm_oportunidad_cotizacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_plantilla trg_audit_jsonb_crm_plantilla; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_plantilla AFTER INSERT OR DELETE OR UPDATE ON public.crm_plantilla FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_segmento trg_audit_jsonb_crm_segmento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_segmento AFTER INSERT OR DELETE OR UPDATE ON public.crm_segmento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_tarea trg_audit_jsonb_crm_tarea; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_tarea AFTER INSERT OR DELETE OR UPDATE ON public.crm_tarea FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_unidad_pieza trg_audit_jsonb_crm_unidad_pieza; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_unidad_pieza AFTER INSERT OR DELETE OR UPDATE ON public.crm_unidad_pieza FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: crm_unidad_pieza_garantia trg_audit_jsonb_crm_unidad_pieza_garantia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_crm_unidad_pieza_garantia AFTER INSERT OR DELETE OR UPDATE ON public.crm_unidad_pieza_garantia FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cuenta_contable trg_audit_jsonb_cuenta_contable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_cuenta_contable AFTER INSERT OR DELETE OR UPDATE ON public.cuenta_contable FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: devolucion_proveedor trg_audit_jsonb_devolucion_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_devolucion_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.devolucion_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: devolucion_proveedor_detalle trg_audit_jsonb_devolucion_proveedor_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_devolucion_proveedor_detalle AFTER INSERT OR DELETE OR UPDATE ON public.devolucion_proveedor_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: entrega_pedido trg_audit_jsonb_entrega_pedido; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_entrega_pedido AFTER INSERT OR DELETE OR UPDATE ON public.entrega_pedido FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: evaluacion_proveedor trg_audit_jsonb_evaluacion_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_evaluacion_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.evaluacion_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura trg_audit_jsonb_factura; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura AFTER INSERT OR DELETE OR UPDATE ON public.factura FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura_proveedor trg_audit_jsonb_factura_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.factura_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura_proveedor_detalle trg_audit_jsonb_factura_proveedor_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura_proveedor_detalle AFTER INSERT OR DELETE OR UPDATE ON public.factura_proveedor_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura_proveedor_discrepancia trg_audit_jsonb_factura_proveedor_discrepancia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura_proveedor_discrepancia AFTER INSERT OR DELETE OR UPDATE ON public.factura_proveedor_discrepancia FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura_proveedor_pago trg_audit_jsonb_factura_proveedor_pago; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura_proveedor_pago AFTER INSERT OR DELETE OR UPDATE ON public.factura_proveedor_pago FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura_proveedor_programacion trg_audit_jsonb_factura_proveedor_programacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura_proveedor_programacion AFTER INSERT OR DELETE OR UPDATE ON public.factura_proveedor_programacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: factura_proveedor_recepcion trg_audit_jsonb_factura_proveedor_recepcion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_factura_proveedor_recepcion AFTER INSERT OR DELETE OR UPDATE ON public.factura_proveedor_recepcion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: garantia trg_audit_jsonb_garantia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_garantia AFTER INSERT OR DELETE OR UPDATE ON public.garantia FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: gasto trg_audit_jsonb_gasto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_gasto AFTER INSERT OR DELETE OR UPDATE ON public.gasto FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: inventario_lote trg_audit_jsonb_inventario_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_inventario_lote AFTER INSERT OR DELETE OR UPDATE ON public.inventario_lote FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: inventario_serie trg_audit_jsonb_inventario_serie; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_inventario_serie AFTER INSERT OR DELETE OR UPDATE ON public.inventario_serie FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: inventario_ubicacion trg_audit_jsonb_inventario_ubicacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_inventario_ubicacion AFTER INSERT OR DELETE OR UPDATE ON public.inventario_ubicacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: lista_precio trg_audit_jsonb_lista_precio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_lista_precio AFTER INSERT OR DELETE OR UPDATE ON public.lista_precio FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: lista_precio_detalle trg_audit_jsonb_lista_precio_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_lista_precio_detalle AFTER INSERT OR DELETE OR UPDATE ON public.lista_precio_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: nota_credito_proveedor trg_audit_jsonb_nota_credito_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_nota_credito_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.nota_credito_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: orden_compra trg_audit_jsonb_orden_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_orden_compra AFTER INSERT OR DELETE OR UPDATE ON public.orden_compra FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: orden_compra_detalle trg_audit_jsonb_orden_compra_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_orden_compra_detalle AFTER INSERT OR DELETE OR UPDATE ON public.orden_compra_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: pago trg_audit_jsonb_pago; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_pago AFTER INSERT OR DELETE OR UPDATE ON public.pago FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: pedido_surtido_ubicacion trg_audit_jsonb_pedido_surtido_ubicacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_pedido_surtido_ubicacion AFTER INSERT OR DELETE OR UPDATE ON public.pedido_surtido_ubicacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: pedido_venta trg_audit_jsonb_pedido_venta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_pedido_venta AFTER INSERT OR DELETE OR UPDATE ON public.pedido_venta FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: pedido_venta_detalle trg_audit_jsonb_pedido_venta_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_pedido_venta_detalle AFTER INSERT OR DELETE OR UPDATE ON public.pedido_venta_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: periodo_contable trg_audit_jsonb_periodo_contable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_periodo_contable AFTER INSERT OR DELETE OR UPDATE ON public.periodo_contable FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: poliza_contable trg_audit_jsonb_poliza_contable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_poliza_contable AFTER INSERT OR DELETE OR UPDATE ON public.poliza_contable FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: poliza_contable_detalle trg_audit_jsonb_poliza_contable_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_poliza_contable_detalle AFTER INSERT OR DELETE OR UPDATE ON public.poliza_contable_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: precio_especial_cliente trg_audit_jsonb_precio_especial_cliente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_precio_especial_cliente AFTER INSERT OR DELETE OR UPDATE ON public.precio_especial_cliente FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: presupuesto_contable trg_audit_jsonb_presupuesto_contable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_presupuesto_contable AFTER INSERT OR DELETE OR UPDATE ON public.presupuesto_contable FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: producto trg_audit_jsonb_producto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_producto AFTER INSERT OR DELETE OR UPDATE ON public.producto FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: producto_kit_detalle trg_audit_jsonb_producto_kit_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_producto_kit_detalle AFTER INSERT OR DELETE OR UPDATE ON public.producto_kit_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: producto_kit_movimiento trg_audit_jsonb_producto_kit_movimiento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_producto_kit_movimiento AFTER INSERT OR DELETE OR UPDATE ON public.producto_kit_movimiento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: recepcion_compra trg_audit_jsonb_recepcion_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_recepcion_compra AFTER INSERT OR DELETE OR UPDATE ON public.recepcion_compra FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: recepcion_compra_detalle trg_audit_jsonb_recepcion_compra_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_recepcion_compra_detalle AFTER INSERT OR DELETE OR UPDATE ON public.recepcion_compra_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: recepcion_costo_adicional trg_audit_jsonb_recepcion_costo_adicional; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_recepcion_costo_adicional AFTER INSERT OR DELETE OR UPDATE ON public.recepcion_costo_adicional FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: reserva_inventario trg_audit_jsonb_reserva_inventario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_reserva_inventario AFTER INSERT OR DELETE OR UPDATE ON public.reserva_inventario FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: solicitud_autorizacion_comercial trg_audit_jsonb_solicitud_autorizacion_comercial; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_solicitud_autorizacion_comercial AFTER INSERT OR DELETE OR UPDATE ON public.solicitud_autorizacion_comercial FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: solicitud_compra trg_audit_jsonb_solicitud_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_solicitud_compra AFTER INSERT OR DELETE OR UPDATE ON public.solicitud_compra FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: solicitud_compra_detalle trg_audit_jsonb_solicitud_compra_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_solicitud_compra_detalle AFTER INSERT OR DELETE OR UPDATE ON public.solicitud_compra_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_cierre trg_audit_jsonb_tesoreria_cierre; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_cierre AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_cierre FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_conciliacion trg_audit_jsonb_tesoreria_conciliacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_conciliacion AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_conciliacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_conciliacion_sistema trg_audit_jsonb_tesoreria_conciliacion_sistema; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_conciliacion_sistema AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_conciliacion_sistema FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_cuenta trg_audit_jsonb_tesoreria_cuenta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_cuenta AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_cuenta FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_importacion trg_audit_jsonb_tesoreria_importacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_importacion AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_importacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_movimiento trg_audit_jsonb_tesoreria_movimiento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_movimiento AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_movimiento FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tesoreria_transferencia trg_audit_jsonb_tesoreria_transferencia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_tesoreria_transferencia AFTER INSERT OR DELETE OR UPDATE ON public.tesoreria_transferencia FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: transferencia_almacen trg_audit_jsonb_transferencia_almacen; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_jsonb_transferencia_almacen AFTER INSERT OR DELETE OR UPDATE ON public.transferencia_almacen FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: comercial_limite_aprobador trg_audit_limite_aprobador; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_limite_aprobador AFTER INSERT OR DELETE OR UPDATE ON public.comercial_limite_aprobador FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: comercial_regla_aprobacion trg_audit_regla_aprobacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_regla_aprobacion AFTER INSERT OR DELETE OR UPDATE ON public.comercial_regla_aprobacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cotizacion_invitacion trg_audit_versiones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_versiones AFTER INSERT OR DELETE OR UPDATE ON public.cotizacion_invitacion FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cotizacion_respuesta trg_audit_versiones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_versiones AFTER INSERT OR DELETE OR UPDATE ON public.cotizacion_respuesta FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cotizacion_revision trg_audit_versiones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_versiones AFTER INSERT OR DELETE OR UPDATE ON public.cotizacion_revision FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: cliente trg_auditoria_cliente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_cliente AFTER INSERT OR DELETE OR UPDATE ON public.cliente FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdCliente');


--
-- Name: complementodepago trg_auditoria_complementodepago; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_complementodepago AFTER INSERT OR DELETE OR UPDATE ON public.complementodepago FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdComplementoPago');


--
-- Name: cuentabancaria trg_auditoria_cuentabancaria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_cuentabancaria AFTER INSERT OR DELETE OR UPDATE ON public.cuentabancaria FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdCuentaBancaria');


--
-- Name: email trg_auditoria_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_email AFTER INSERT OR DELETE OR UPDATE ON public.email FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdEmail');


--
-- Name: emisor trg_auditoria_emisor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_emisor AFTER INSERT OR DELETE OR UPDATE ON public.emisor FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdEmisor');


--
-- Name: impuestoproducto trg_auditoria_impuestoproducto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_impuestoproducto AFTER INSERT OR DELETE OR UPDATE ON public.impuestoproducto FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdImpuestoProducto');


--
-- Name: inventario trg_auditoria_inventario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_inventario AFTER UPDATE ON public.inventario FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdProducto');


--
-- Name: pagodocumentos trg_auditoria_pagodocumentos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_pagodocumentos AFTER INSERT OR DELETE OR UPDATE ON public.pagodocumentos FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdPagoDocumentos');


--
-- Name: pagosdetalleproveedor trg_auditoria_pagosdetalleproveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_pagosdetalleproveedor AFTER INSERT OR DELETE OR UPDATE ON public.pagosdetalleproveedor FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdPagosDetalleProveedor');


--
-- Name: pagosproveedor trg_auditoria_pagosproveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_pagosproveedor AFTER INSERT OR DELETE OR UPDATE ON public.pagosproveedor FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdPagosProveedor');


--
-- Name: producto trg_auditoria_producto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_producto AFTER INSERT OR DELETE OR UPDATE ON public.producto FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdProducto');


--
-- Name: proveedor trg_auditoria_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_proveedor AFTER INSERT OR DELETE OR UPDATE ON public.proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdProveedor');


--
-- Name: relacioncfdi trg_auditoria_relacioncfdi; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_relacioncfdi AFTER INSERT OR DELETE ON public.relacioncfdi FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdRelacionCFDI');


--
-- Name: telefono trg_auditoria_telefono; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_telefono AFTER INSERT OR DELETE OR UPDATE ON public.telefono FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdTelefono');


--
-- Name: timbrefiscaldigital trg_auditoria_timbrefiscaldigital; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_timbrefiscaldigital AFTER INSERT ON public.timbrefiscaldigital FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_generica('IdTimbreFiscalDigital');


--
-- Name: poliza_contable_detalle trg_bloquear_detalle_periodo_cerrado; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bloquear_detalle_periodo_cerrado BEFORE INSERT OR DELETE OR UPDATE ON public.poliza_contable_detalle FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_detalle_periodo_cerrado();


--
-- Name: cotizacion trg_bloquear_folio_cotizacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bloquear_folio_cotizacion BEFORE INSERT ON public.cotizacion FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_folio_cotizacion();


--
-- Name: poliza_contable trg_bloquear_periodo_cerrado; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bloquear_periodo_cerrado BEFORE INSERT OR DELETE OR UPDATE ON public.poliza_contable FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_periodo_cerrado();


--
-- Name: tesoreria_movimiento trg_bloquear_tesoreria_cerrada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bloquear_tesoreria_cerrada BEFORE INSERT OR DELETE OR UPDATE ON public.tesoreria_movimiento FOR EACH ROW EXECUTE FUNCTION public.fn_bloquear_tesoreria_cerrada();


--
-- Name: factura trg_comision_nota_credito; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_comision_nota_credito AFTER UPDATE OF id_factura_origen, estatus ON public.factura FOR EACH ROW EXECUTE FUNCTION public.fn_comision_nota_credito();


--
-- Name: gasto trg_gasto_saldos_y_landed_cost; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gasto_saldos_y_landed_cost AFTER INSERT ON public.gasto FOR EACH ROW EXECUTE FUNCTION public.fn_gasto_saldos_y_landed_cost();


--
-- Name: producto trg_kardex_cambios_producto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kardex_cambios_producto AFTER UPDATE ON public.producto FOR EACH ROW EXECUTE FUNCTION public.fn_kardex_cambios_producto();


--
-- Name: detalle_compra trg_kardex_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kardex_compra AFTER INSERT ON public.detalle_compra FOR EACH ROW EXECUTE FUNCTION public.fn_kardex_compra();


--
-- Name: conceptofactura trg_kardex_venta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_kardex_venta AFTER INSERT ON public.conceptofactura FOR EACH ROW EXECUTE FUNCTION public.fn_kardex_venta();


--
-- Name: anticipo_proveedor trg_poliza_anticipo_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_poliza_anticipo_proveedor AFTER INSERT OR UPDATE OF estado ON public.anticipo_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_poliza_anticipo_proveedor();


--
-- Name: aplicacion_proveedor trg_poliza_aplicacion_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_poliza_aplicacion_proveedor AFTER INSERT OR UPDATE OF estado ON public.aplicacion_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_poliza_aplicacion_proveedor();


--
-- Name: factura_proveedor trg_poliza_factura_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_poliza_factura_proveedor AFTER INSERT OR UPDATE OF estado, total ON public.factura_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_factura_proveedor();


--
-- Name: factura_proveedor_pago trg_poliza_factura_proveedor_pago; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_poliza_factura_proveedor_pago AFTER INSERT OR UPDATE OF estado ON public.factura_proveedor_pago FOR EACH ROW EXECUTE FUNCTION public.fn_poliza_factura_proveedor_pago();


--
-- Name: producto trg_producto_ubicacion_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_producto_ubicacion_insert AFTER INSERT ON public.producto FOR EACH ROW EXECUTE FUNCTION public.fn_sincronizar_existencia_ubicaciones();


--
-- Name: producto trg_producto_ubicacion_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_producto_ubicacion_update AFTER UPDATE OF "Existencia" ON public.producto FOR EACH ROW EXECUTE FUNCTION public.fn_sincronizar_existencia_ubicaciones();


--
-- Name: caja_movimiento trg_proteger_bitacora_caja; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_proteger_bitacora_caja BEFORE DELETE OR UPDATE ON public.caja_movimiento FOR EACH ROW EXECUTE FUNCTION public.fn_proteger_bitacora_caja();


--
-- Name: devolucion trg_recalcular_comision_devolucion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER trg_recalcular_comision_devolucion AFTER UPDATE ON public.devolucion DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_recalcular_comision_devolucion();


--
-- Name: saldos trg_registrar_movimiento_caja; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_registrar_movimiento_caja AFTER UPDATE ON public.saldos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_movimiento_caja();


--
-- Name: pago trg_sync_ingreso_saldos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_ingreso_saldos AFTER INSERT ON public.pago FOR EACH ROW EXECUTE FUNCTION public.fn_sync_ingreso_saldos();


--
-- Name: pago_proveedor trg_sync_pago_proveedor_saldos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_pago_proveedor_saldos AFTER INSERT ON public.pago_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_sync_pago_proveedor_saldos();


--
-- Name: compra trg_sync_poliza_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_compra AFTER INSERT OR UPDATE OF estatus, total ON public.compra FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_compra();


--
-- Name: conceptofactura trg_sync_poliza_concepto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_concepto AFTER INSERT OR DELETE OR UPDATE ON public.conceptofactura FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_concepto();


--
-- Name: detalle_compra trg_sync_poliza_detalle_compra; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_detalle_compra AFTER INSERT OR DELETE OR UPDATE ON public.detalle_compra FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_detalle_compra();


--
-- Name: factura trg_sync_poliza_factura; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_factura AFTER INSERT OR UPDATE OF estatus, subtotal, descuento, total_impuestos_trasladados, total_impuestos_retenidos, total ON public.factura FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_factura();


--
-- Name: gasto trg_sync_poliza_gasto; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_gasto AFTER INSERT OR UPDATE ON public.gasto FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_gasto();


--
-- Name: pago trg_sync_poliza_pago; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_pago AFTER INSERT OR UPDATE ON public.pago FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_pago();


--
-- Name: pago_proveedor trg_sync_poliza_pago_proveedor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_poliza_pago_proveedor AFTER INSERT OR UPDATE ON public.pago_proveedor FOR EACH ROW EXECUTE FUNCTION public.fn_sync_poliza_pago_proveedor();


--
-- Name: pago trg_sync_reverso_saldos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_reverso_saldos AFTER DELETE ON public.pago FOR EACH ROW EXECUTE FUNCTION public.fn_sync_reverso_saldos();


--
-- Name: factura trg_validar_cancelacion_financiera; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_cancelacion_financiera BEFORE UPDATE OF estatus ON public.factura FOR EACH ROW EXECUTE FUNCTION public.fn_validar_cancelacion_financiera();


--
-- Name: devolucion trg_validar_devolucion_pagada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_devolucion_pagada BEFORE INSERT ON public.devolucion FOR EACH ROW EXECUTE FUNCTION public.fn_validar_devolucion_pagada();


--
-- Name: auth_user trigger_auth_user_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auth_user_updated_at BEFORE UPDATE ON public.auth_user FOR EACH ROW EXECUTE FUNCTION public.update_auth_user_updated_at();


--
-- Name: almacen_picking_verificacion almacen_picking_verificacion_id_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_picking_verificacion
    ADD CONSTRAINT almacen_picking_verificacion_id_actor_fkey FOREIGN KEY (id_actor) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: almacen_picking_verificacion almacen_picking_verificacion_id_anulada_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_picking_verificacion
    ADD CONSTRAINT almacen_picking_verificacion_id_anulada_fkey FOREIGN KEY (id_anulada) REFERENCES public.almacen_picking_verificacion(id) ON DELETE RESTRICT;


--
-- Name: almacen_picking_verificacion almacen_picking_verificacion_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_picking_verificacion
    ADD CONSTRAINT almacen_picking_verificacion_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE RESTRICT;


--
-- Name: almacen_picking_verificacion almacen_picking_verificacion_id_surtido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_picking_verificacion
    ADD CONSTRAINT almacen_picking_verificacion_id_surtido_fkey FOREIGN KEY (id_surtido) REFERENCES public.pedido_surtido_ubicacion(id_surtido) ON DELETE RESTRICT;


--
-- Name: almacen_ubicacion almacen_ubicacion_id_almacen_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacen_ubicacion
    ADD CONSTRAINT almacen_ubicacion_id_almacen_fkey FOREIGN KEY (id_almacen) REFERENCES public.almacen(id_almacen) ON DELETE CASCADE;


--
-- Name: anticipo_proveedor anticipo_proveedor_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anticipo_proveedor
    ADD CONSTRAINT anticipo_proveedor_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor");


--
-- Name: anticipo_proveedor anticipo_proveedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anticipo_proveedor
    ADD CONSTRAINT anticipo_proveedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: aplicacion_proveedor aplicacion_proveedor_id_anticipo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor
    ADD CONSTRAINT aplicacion_proveedor_id_anticipo_fkey FOREIGN KEY (id_anticipo) REFERENCES public.anticipo_proveedor(id_anticipo);


--
-- Name: aplicacion_proveedor aplicacion_proveedor_id_factura_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor
    ADD CONSTRAINT aplicacion_proveedor_id_factura_proveedor_fkey FOREIGN KEY (id_factura_proveedor) REFERENCES public.factura_proveedor(id_factura_proveedor);


--
-- Name: aplicacion_proveedor aplicacion_proveedor_id_nota_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor
    ADD CONSTRAINT aplicacion_proveedor_id_nota_fkey FOREIGN KEY (id_nota) REFERENCES public.nota_credito_proveedor(id_nota);


--
-- Name: aplicacion_proveedor aplicacion_proveedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor
    ADD CONSTRAINT aplicacion_proveedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: aplicacion_proveedor aplicacion_proveedor_revertida_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aplicacion_proveedor
    ADD CONSTRAINT aplicacion_proveedor_revertida_por_fkey FOREIGN KEY (revertida_por) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: app_access_profile_permission app_access_profile_permission_id_profile_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_access_profile_permission
    ADD CONSTRAINT app_access_profile_permission_id_profile_fkey FOREIGN KEY (id_profile) REFERENCES public.app_access_profile(id_profile) ON DELETE CASCADE;


--
-- Name: app_access_profile_permission app_access_profile_permission_permission_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_access_profile_permission
    ADD CONSTRAINT app_access_profile_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES public.app_permission(code);


--
-- Name: app_notification app_notification_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_notification
    ADD CONSTRAINT app_notification_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: app_role_permission app_role_permission_permission_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role_permission
    ADD CONSTRAINT app_role_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES public.app_permission(code) ON DELETE CASCADE;


--
-- Name: app_user_access_profile app_user_access_profile_id_profile_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_access_profile
    ADD CONSTRAINT app_user_access_profile_id_profile_fkey FOREIGN KEY (id_profile) REFERENCES public.app_access_profile(id_profile);


--
-- Name: app_user_access_profile app_user_access_profile_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_access_profile
    ADD CONSTRAINT app_user_access_profile_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: app_user_permission app_user_permission_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_permission
    ADD CONSTRAINT app_user_permission_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: app_user_permission app_user_permission_permission_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_permission
    ADD CONSTRAINT app_user_permission_permission_code_fkey FOREIGN KEY (permission_code) REFERENCES public.app_permission(code) ON DELETE CASCADE;


--
-- Name: auth_mfa_challenge auth_mfa_challenge_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenge
    ADD CONSTRAINT auth_mfa_challenge_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: auth_mfa auth_mfa_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa
    ADD CONSTRAINT auth_mfa_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: auth_mfa_recovery auth_mfa_recovery_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_recovery
    ADD CONSTRAINT auth_mfa_recovery_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_mfa(id_user) ON DELETE CASCADE;


--
-- Name: auth_password_recovery auth_password_recovery_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_password_recovery
    ADD CONSTRAINT auth_password_recovery_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: auth_session auth_session_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: backorder_cliente backorder_cliente_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backorder_cliente
    ADD CONSTRAINT backorder_cliente_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: backorder_cliente backorder_cliente_id_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backorder_cliente
    ADD CONSTRAINT backorder_cliente_id_detalle_fkey FOREIGN KEY (id_detalle) REFERENCES public.pedido_venta_detalle(id_detalle) ON DELETE CASCADE;


--
-- Name: backorder_cliente backorder_cliente_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backorder_cliente
    ADD CONSTRAINT backorder_cliente_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE CASCADE;


--
-- Name: backorder_cliente backorder_cliente_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backorder_cliente
    ADD CONSTRAINT backorder_cliente_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: caja_movimiento caja_movimiento_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_movimiento
    ADD CONSTRAINT caja_movimiento_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.auth_user(id_user);


--
-- Name: caja_turno caja_turno_abierto_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_turno
    ADD CONSTRAINT caja_turno_abierto_por_fkey FOREIGN KEY (abierto_por) REFERENCES public.auth_user(id_user);


--
-- Name: caja_turno caja_turno_cerrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caja_turno
    ADD CONSTRAINT caja_turno_cerrado_por_fkey FOREIGN KEY (cerrado_por) REFERENCES public.auth_user(id_user);


--
-- Name: casco_recuperable casco_recuperable_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casco_recuperable
    ADD CONSTRAINT casco_recuperable_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: casco_recuperable casco_recuperable_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casco_recuperable
    ADD CONSTRAINT casco_recuperable_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: casco_recuperable casco_recuperable_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.casco_recuperable
    ADD CONSTRAINT casco_recuperable_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: cliente_comercial cliente_comercial_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente_comercial
    ADD CONSTRAINT cliente_comercial_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE CASCADE;


--
-- Name: cliente_comercial cliente_comercial_id_lista_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente_comercial
    ADD CONSTRAINT cliente_comercial_id_lista_fkey FOREIGN KEY (id_lista) REFERENCES public.lista_precio(id_lista) ON DELETE SET NULL;


--
-- Name: cliente_contacto cliente_contacto_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente_contacto
    ADD CONSTRAINT cliente_contacto_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE CASCADE;


--
-- Name: comercial_limite_aprobador comercial_limite_aprobador_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comercial_limite_aprobador
    ADD CONSTRAINT comercial_limite_aprobador_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: compra compra_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compra
    ADD CONSTRAINT compra_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor");


--
-- Name: conceptocotizacion conceptocotizacion_id_cotizacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptocotizacion
    ADD CONSTRAINT conceptocotizacion_id_cotizacion_fkey FOREIGN KEY (id_cotizacion) REFERENCES public.cotizacion(id_cotizacion) ON DELETE CASCADE;


--
-- Name: conceptocotizacion conceptocotizacion_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptocotizacion
    ADD CONSTRAINT conceptocotizacion_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: conceptofactura conceptofactura_id_clave_prod_serv_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptofactura
    ADD CONSTRAINT conceptofactura_id_clave_prod_serv_fkey FOREIGN KEY (id_clave_prod_serv) REFERENCES public.claveproductooservicio("IdClaveProdOServ");


--
-- Name: conceptofactura conceptofactura_id_clave_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptofactura
    ADD CONSTRAINT conceptofactura_id_clave_unidad_fkey FOREIGN KEY (id_clave_unidad) REFERENCES public.claveunidad("IdClaveUnidad");


--
-- Name: conceptofactura conceptofactura_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptofactura
    ADD CONSTRAINT conceptofactura_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura) ON DELETE CASCADE;


--
-- Name: conceptofactura conceptofactura_id_objeto_impuesto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptofactura
    ADD CONSTRAINT conceptofactura_id_objeto_impuesto_fkey FOREIGN KEY (id_objeto_impuesto) REFERENCES public.objetoimpuesto("IdObjetoImpuesto");


--
-- Name: conceptofactura conceptofactura_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conceptofactura
    ADD CONSTRAINT conceptofactura_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: conteo_inventario_detalle conteo_inventario_detalle_id_conteo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario_detalle
    ADD CONSTRAINT conteo_inventario_detalle_id_conteo_fkey FOREIGN KEY (id_conteo) REFERENCES public.conteo_inventario(id_conteo) ON DELETE CASCADE;


--
-- Name: conteo_inventario_detalle conteo_inventario_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario_detalle
    ADD CONSTRAINT conteo_inventario_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: conteo_inventario conteo_inventario_id_autorizador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario
    ADD CONSTRAINT conteo_inventario_id_autorizador_fkey FOREIGN KEY (id_autorizador) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: conteo_inventario conteo_inventario_id_ubicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario
    ADD CONSTRAINT conteo_inventario_id_ubicacion_fkey FOREIGN KEY (id_ubicacion) REFERENCES public.almacen_ubicacion(id_ubicacion);


--
-- Name: conteo_inventario conteo_inventario_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conteo_inventario
    ADD CONSTRAINT conteo_inventario_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: cotizacion cotizacion_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion
    ADD CONSTRAINT cotizacion_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: cotizacion cotizacion_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion
    ADD CONSTRAINT cotizacion_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE SET NULL;


--
-- Name: cotizacion_invitacion cotizacion_invitacion_id_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_invitacion
    ADD CONSTRAINT cotizacion_invitacion_id_revision_fkey FOREIGN KEY (id_revision) REFERENCES public.cotizacion_revision(id_revision) ON DELETE RESTRICT;


--
-- Name: cotizacion_respuesta cotizacion_respuesta_id_invitacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_respuesta
    ADD CONSTRAINT cotizacion_respuesta_id_invitacion_fkey FOREIGN KEY (id_invitacion) REFERENCES public.cotizacion_invitacion(id_invitacion) ON DELETE RESTRICT;


--
-- Name: cotizacion_respuesta cotizacion_respuesta_id_revision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_respuesta
    ADD CONSTRAINT cotizacion_respuesta_id_revision_fkey FOREIGN KEY (id_revision) REFERENCES public.cotizacion_revision(id_revision) ON DELETE RESTRICT;


--
-- Name: cotizacion_revision cotizacion_revision_id_cotizacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_revision
    ADD CONSTRAINT cotizacion_revision_id_cotizacion_fkey FOREIGN KEY (id_cotizacion) REFERENCES public.cotizacion(id_cotizacion) ON DELETE RESTRICT;


--
-- Name: cotizacion_revision cotizacion_revision_id_raiz_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizacion_revision
    ADD CONSTRAINT cotizacion_revision_id_raiz_fkey FOREIGN KEY (id_raiz) REFERENCES public.cotizacion(id_cotizacion) ON DELETE RESTRICT;


--
-- Name: crm_campana crm_campana_id_plantilla_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana
    ADD CONSTRAINT crm_campana_id_plantilla_fkey FOREIGN KEY (id_plantilla) REFERENCES public.crm_plantilla(id_plantilla);


--
-- Name: crm_campana crm_campana_id_segmento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana
    ADD CONSTRAINT crm_campana_id_segmento_fkey FOREIGN KEY (id_segmento) REFERENCES public.crm_segmento(id_segmento);


--
-- Name: crm_campana crm_campana_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana
    ADD CONSTRAINT crm_campana_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_campana_preparacion crm_campana_preparacion_id_campana_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana_preparacion
    ADD CONSTRAINT crm_campana_preparacion_id_campana_fkey FOREIGN KEY (id_campana) REFERENCES public.crm_campana(id_campana) ON DELETE RESTRICT;


--
-- Name: crm_campana_preparacion crm_campana_preparacion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_campana_preparacion
    ADD CONSTRAINT crm_campana_preparacion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_comunicacion crm_comunicacion_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_comunicacion
    ADD CONSTRAINT crm_comunicacion_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE CASCADE;


--
-- Name: crm_comunicacion crm_comunicacion_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_comunicacion
    ADD CONSTRAINT crm_comunicacion_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE CASCADE;


--
-- Name: crm_comunicacion crm_comunicacion_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_comunicacion
    ADD CONSTRAINT crm_comunicacion_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE SET NULL;


--
-- Name: crm_comunicacion crm_comunicacion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_comunicacion
    ADD CONSTRAINT crm_comunicacion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_consentimiento_comercial crm_consentimiento_comercial_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consentimiento_comercial
    ADD CONSTRAINT crm_consentimiento_comercial_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE RESTRICT;


--
-- Name: crm_consentimiento_comercial crm_consentimiento_comercial_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consentimiento_comercial
    ADD CONSTRAINT crm_consentimiento_comercial_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_encuesta_satisfaccion crm_encuesta_satisfaccion_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_encuesta_satisfaccion
    ADD CONSTRAINT crm_encuesta_satisfaccion_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE SET NULL;


--
-- Name: crm_encuesta_satisfaccion crm_encuesta_satisfaccion_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_encuesta_satisfaccion
    ADD CONSTRAINT crm_encuesta_satisfaccion_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE SET NULL;


--
-- Name: crm_encuesta_satisfaccion crm_encuesta_satisfaccion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_encuesta_satisfaccion
    ADD CONSTRAINT crm_encuesta_satisfaccion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_etapa_evento crm_etapa_evento_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_etapa_evento
    ADD CONSTRAINT crm_etapa_evento_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE RESTRICT;


--
-- Name: crm_etapa_evento crm_etapa_evento_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_etapa_evento
    ADD CONSTRAINT crm_etapa_evento_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE RESTRICT;


--
-- Name: crm_etapa_evento crm_etapa_evento_id_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_etapa_evento
    ADD CONSTRAINT crm_etapa_evento_id_responsable_fkey FOREIGN KEY (id_responsable) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_meta_vendedor crm_meta_vendedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_meta_vendedor
    ADD CONSTRAINT crm_meta_vendedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE CASCADE;


--
-- Name: crm_oportunidad_consulta_web crm_oportunidad_consulta_web_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_consulta_web
    ADD CONSTRAINT crm_oportunidad_consulta_web_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user);


--
-- Name: crm_oportunidad_consulta_web crm_oportunidad_consulta_web_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_consulta_web
    ADD CONSTRAINT crm_oportunidad_consulta_web_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad);


--
-- Name: crm_oportunidad_consulta_web crm_oportunidad_consulta_web_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_consulta_web
    ADD CONSTRAINT crm_oportunidad_consulta_web_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.crm_solicitud_web(request_id);


--
-- Name: crm_oportunidad_cotizacion crm_oportunidad_cotizacion_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_cotizacion
    ADD CONSTRAINT crm_oportunidad_cotizacion_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user);


--
-- Name: crm_oportunidad_cotizacion crm_oportunidad_cotizacion_id_cotizacion_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_cotizacion
    ADD CONSTRAINT crm_oportunidad_cotizacion_id_cotizacion_id_cliente_fkey FOREIGN KEY (id_cotizacion, id_cliente) REFERENCES public.cotizacion(id_cotizacion, id_cliente);


--
-- Name: crm_oportunidad_cotizacion crm_oportunidad_cotizacion_id_oportunidad_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad_cotizacion
    ADD CONSTRAINT crm_oportunidad_cotizacion_id_oportunidad_id_cliente_fkey FOREIGN KEY (id_oportunidad, id_cliente) REFERENCES public.crm_oportunidad(id_oportunidad, id_cliente);


--
-- Name: crm_oportunidad crm_oportunidad_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad
    ADD CONSTRAINT crm_oportunidad_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE SET NULL;


--
-- Name: crm_oportunidad crm_oportunidad_id_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_oportunidad
    ADD CONSTRAINT crm_oportunidad_id_responsable_fkey FOREIGN KEY (id_responsable) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_plantilla crm_plantilla_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_plantilla
    ADD CONSTRAINT crm_plantilla_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_reporte_intento_evento crm_reporte_intento_evento_id_resultado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_intento_evento
    ADD CONSTRAINT crm_reporte_intento_evento_id_resultado_fkey FOREIGN KEY (id_resultado) REFERENCES public.crm_reporte_reintento(id_resultado) ON DELETE RESTRICT;


--
-- Name: crm_reporte_programa crm_reporte_programa_id_propietario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_programa
    ADD CONSTRAINT crm_reporte_programa_id_propietario_fkey FOREIGN KEY (id_propietario) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_reporte_recuperacion crm_reporte_recuperacion_id_resultado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_recuperacion
    ADD CONSTRAINT crm_reporte_recuperacion_id_resultado_fkey FOREIGN KEY (id_resultado) REFERENCES public.crm_reporte_reintento(id_resultado) ON DELETE RESTRICT;


--
-- Name: crm_reporte_reintento crm_reporte_reintento_id_resultado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_reintento
    ADD CONSTRAINT crm_reporte_reintento_id_resultado_fkey FOREIGN KEY (id_resultado) REFERENCES public.crm_reporte_resultado(id_resultado) ON DELETE RESTRICT;


--
-- Name: crm_reporte_resultado crm_reporte_resultado_id_programa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_reporte_resultado
    ADD CONSTRAINT crm_reporte_resultado_id_programa_fkey FOREIGN KEY (id_programa) REFERENCES public.crm_reporte_programa(id_programa) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_actor_fkey FOREIGN KEY (id_actor) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_evento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_evento_fkey FOREIGN KEY (id_evento) REFERENCES public.crm_etapa_evento(id_evento) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_modelo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_modelo_fkey FOREIGN KEY (id_modelo) REFERENCES public.crm_secuencia_modelo(id_modelo) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_regla_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_regla_fkey FOREIGN KEY (id_regla) REFERENCES public.crm_secuencia_regla(id_regla) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_aplicacion crm_secuencia_aplicacion_id_secuencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_aplicacion
    ADD CONSTRAINT crm_secuencia_aplicacion_id_secuencia_fkey FOREIGN KEY (id_secuencia) REFERENCES public.crm_secuencia(id_secuencia) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_control crm_secuencia_control_id_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_id_actor_fkey FOREIGN KEY (id_actor) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_control crm_secuencia_control_id_anterior_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_id_anterior_fkey FOREIGN KEY (id_anterior) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_control crm_secuencia_control_id_nuevo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_id_nuevo_fkey FOREIGN KEY (id_nuevo) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_control crm_secuencia_control_id_secuencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_id_secuencia_fkey FOREIGN KEY (id_secuencia) REFERENCES public.crm_secuencia(id_secuencia) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_control crm_secuencia_control_id_tarea_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_control
    ADD CONSTRAINT crm_secuencia_control_id_tarea_fkey FOREIGN KEY (id_tarea) REFERENCES public.crm_tarea(id_tarea) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_evento crm_secuencia_evento_id_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_evento
    ADD CONSTRAINT crm_secuencia_evento_id_actor_fkey FOREIGN KEY (id_actor) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_evento crm_secuencia_evento_id_secuencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_evento
    ADD CONSTRAINT crm_secuencia_evento_id_secuencia_fkey FOREIGN KEY (id_secuencia) REFERENCES public.crm_secuencia(id_secuencia) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_evento crm_secuencia_evento_id_tarea_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_evento
    ADD CONSTRAINT crm_secuencia_evento_id_tarea_fkey FOREIGN KEY (id_tarea) REFERENCES public.crm_tarea(id_tarea) ON DELETE RESTRICT;


--
-- Name: crm_secuencia crm_secuencia_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia
    ADD CONSTRAINT crm_secuencia_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE RESTRICT;


--
-- Name: crm_secuencia crm_secuencia_id_creador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia
    ADD CONSTRAINT crm_secuencia_id_creador_fkey FOREIGN KEY (id_creador) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia crm_secuencia_id_modelo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia
    ADD CONSTRAINT crm_secuencia_id_modelo_fkey FOREIGN KEY (id_modelo) REFERENCES public.crm_secuencia_modelo(id_modelo) ON DELETE RESTRICT;


--
-- Name: crm_secuencia crm_secuencia_id_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia
    ADD CONSTRAINT crm_secuencia_id_responsable_fkey FOREIGN KEY (id_responsable) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_modelo crm_secuencia_modelo_id_creador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_modelo
    ADD CONSTRAINT crm_secuencia_modelo_id_creador_fkey FOREIGN KEY (id_creador) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_regla crm_secuencia_regla_id_creador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_regla
    ADD CONSTRAINT crm_secuencia_regla_id_creador_fkey FOREIGN KEY (id_creador) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_secuencia_regla crm_secuencia_regla_id_modelo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_secuencia_regla
    ADD CONSTRAINT crm_secuencia_regla_id_modelo_fkey FOREIGN KEY (id_modelo) REFERENCES public.crm_secuencia_modelo(id_modelo) ON DELETE RESTRICT;


--
-- Name: crm_segmento crm_segmento_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_segmento
    ADD CONSTRAINT crm_segmento_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_seguimiento crm_seguimiento_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_seguimiento
    ADD CONSTRAINT crm_seguimiento_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE CASCADE;


--
-- Name: crm_seguimiento crm_seguimiento_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_seguimiento
    ADD CONSTRAINT crm_seguimiento_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_solicitud_web crm_solicitud_web_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web
    ADD CONSTRAINT crm_solicitud_web_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad);


--
-- Name: crm_solicitud_web_resolucion crm_solicitud_web_resolucion_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web_resolucion
    ADD CONSTRAINT crm_solicitud_web_resolucion_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user);


--
-- Name: crm_solicitud_web_resolucion crm_solicitud_web_resolucion_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web_resolucion
    ADD CONSTRAINT crm_solicitud_web_resolucion_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad);


--
-- Name: crm_solicitud_web_resolucion crm_solicitud_web_resolucion_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web_resolucion
    ADD CONSTRAINT crm_solicitud_web_resolucion_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.crm_solicitud_web(request_id);


--
-- Name: crm_solicitud_web crm_solicitud_web_revisada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_solicitud_web
    ADD CONSTRAINT crm_solicitud_web_revisada_por_fkey FOREIGN KEY (revisada_por) REFERENCES public.auth_user(id_user);


--
-- Name: crm_tarea crm_tarea_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE CASCADE;


--
-- Name: crm_tarea crm_tarea_id_cotizacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_cotizacion_fkey FOREIGN KEY (id_cotizacion) REFERENCES public.cotizacion(id_cotizacion) ON DELETE SET NULL;


--
-- Name: crm_tarea crm_tarea_id_creador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_creador_fkey FOREIGN KEY (id_creador) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_tarea crm_tarea_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE CASCADE;


--
-- Name: crm_tarea crm_tarea_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE SET NULL;


--
-- Name: crm_tarea crm_tarea_id_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_responsable_fkey FOREIGN KEY (id_responsable) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: crm_tarea crm_tarea_id_secuencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_secuencia_fkey FOREIGN KEY (id_secuencia) REFERENCES public.crm_secuencia(id_secuencia) ON DELETE RESTRICT;


--
-- Name: crm_tarea crm_tarea_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tarea
    ADD CONSTRAINT crm_tarea_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE SET NULL;


--
-- Name: crm_unidad_archivo_contenido crm_unidad_archivo_contenido_id_archivo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_archivo_contenido
    ADD CONSTRAINT crm_unidad_archivo_contenido_id_archivo_fkey FOREIGN KEY (id_archivo) REFERENCES public.crm_unidad_archivo(id_archivo) ON DELETE RESTRICT;


--
-- Name: crm_unidad_archivo crm_unidad_archivo_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_archivo
    ADD CONSTRAINT crm_unidad_archivo_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_unidad_archivo crm_unidad_archivo_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_archivo
    ADD CONSTRAINT crm_unidad_archivo_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE RESTRICT;


--
-- Name: crm_unidad_cliente crm_unidad_cliente_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_cliente
    ADD CONSTRAINT crm_unidad_cliente_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE CASCADE;


--
-- Name: crm_unidad_cliente crm_unidad_cliente_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_cliente
    ADD CONSTRAINT crm_unidad_cliente_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE CASCADE;


--
-- Name: crm_unidad_lectura crm_unidad_lectura_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_lectura
    ADD CONSTRAINT crm_unidad_lectura_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_unidad_lectura crm_unidad_lectura_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_lectura
    ADD CONSTRAINT crm_unidad_lectura_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE RESTRICT;


--
-- Name: crm_unidad_mantenimiento crm_unidad_mantenimiento_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_mantenimiento
    ADD CONSTRAINT crm_unidad_mantenimiento_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_unidad_mantenimiento crm_unidad_mantenimiento_id_cierre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_mantenimiento
    ADD CONSTRAINT crm_unidad_mantenimiento_id_cierre_fkey FOREIGN KEY (id_cierre) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_unidad_mantenimiento crm_unidad_mantenimiento_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_mantenimiento
    ADD CONSTRAINT crm_unidad_mantenimiento_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE RESTRICT;


--
-- Name: crm_unidad_pieza_garantia crm_unidad_pieza_garantia_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza_garantia
    ADD CONSTRAINT crm_unidad_pieza_garantia_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_unidad_pieza_garantia crm_unidad_pieza_garantia_id_garantia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza_garantia
    ADD CONSTRAINT crm_unidad_pieza_garantia_id_garantia_fkey FOREIGN KEY (id_garantia) REFERENCES public.garantia(id_garantia) ON DELETE RESTRICT;


--
-- Name: crm_unidad_pieza_garantia crm_unidad_pieza_garantia_id_pieza_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza_garantia
    ADD CONSTRAINT crm_unidad_pieza_garantia_id_pieza_fkey FOREIGN KEY (id_pieza) REFERENCES public.crm_unidad_pieza(id_pieza) ON DELETE RESTRICT;


--
-- Name: crm_unidad_pieza crm_unidad_pieza_id_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza
    ADD CONSTRAINT crm_unidad_pieza_id_autor_fkey FOREIGN KEY (id_autor) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: crm_unidad_pieza crm_unidad_pieza_id_concepto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza
    ADD CONSTRAINT crm_unidad_pieza_id_concepto_fkey FOREIGN KEY (id_concepto) REFERENCES public.conceptofactura(id_concepto) ON DELETE RESTRICT;


--
-- Name: crm_unidad_pieza crm_unidad_pieza_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_unidad_pieza
    ADD CONSTRAINT crm_unidad_pieza_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE RESTRICT;


--
-- Name: cuenta_contable cuenta_contable_id_padre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuenta_contable
    ADD CONSTRAINT cuenta_contable_id_padre_fkey FOREIGN KEY (id_padre) REFERENCES public.cuenta_contable(id_cuenta);


--
-- Name: detalle_compra detalle_compra_id_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compra
    ADD CONSTRAINT detalle_compra_id_compra_fkey FOREIGN KEY (id_compra) REFERENCES public.compra(id_compra) ON DELETE CASCADE;


--
-- Name: detalle_compra detalle_compra_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compra
    ADD CONSTRAINT detalle_compra_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: devolucion_detalle devolucion_detalle_id_devolucion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_detalle
    ADD CONSTRAINT devolucion_detalle_id_devolucion_fkey FOREIGN KEY (id_devolucion) REFERENCES public.devolucion(id_devolucion) ON DELETE CASCADE;


--
-- Name: devolucion_detalle devolucion_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_detalle
    ADD CONSTRAINT devolucion_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: devolucion devolucion_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion
    ADD CONSTRAINT devolucion_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura) ON DELETE CASCADE;


--
-- Name: devolucion devolucion_id_gasto_reembolso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion
    ADD CONSTRAINT devolucion_id_gasto_reembolso_fkey FOREIGN KEY (id_gasto_reembolso) REFERENCES public.gasto(id_gasto);


--
-- Name: devolucion_proveedor_detalle devolucion_proveedor_detalle_id_devolucion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor_detalle
    ADD CONSTRAINT devolucion_proveedor_detalle_id_devolucion_fkey FOREIGN KEY (id_devolucion) REFERENCES public.devolucion_proveedor(id_devolucion) ON DELETE CASCADE;


--
-- Name: devolucion_proveedor_detalle devolucion_proveedor_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor_detalle
    ADD CONSTRAINT devolucion_proveedor_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: devolucion_proveedor_detalle devolucion_proveedor_detalle_id_recepcion_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor_detalle
    ADD CONSTRAINT devolucion_proveedor_detalle_id_recepcion_detalle_fkey FOREIGN KEY (id_recepcion_detalle) REFERENCES public.recepcion_compra_detalle(id_detalle);


--
-- Name: devolucion_proveedor devolucion_proveedor_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor
    ADD CONSTRAINT devolucion_proveedor_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor");


--
-- Name: devolucion_proveedor devolucion_proveedor_id_recepcion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor
    ADD CONSTRAINT devolucion_proveedor_id_recepcion_fkey FOREIGN KEY (id_recepcion) REFERENCES public.recepcion_compra(id_recepcion);


--
-- Name: devolucion_proveedor devolucion_proveedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devolucion_proveedor
    ADD CONSTRAINT devolucion_proveedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: documento_salida_archivo documento_salida_archivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida_archivo
    ADD CONSTRAINT documento_salida_archivo_id_fkey FOREIGN KEY (id) REFERENCES public.documento_salida(id) ON DELETE RESTRICT;


--
-- Name: documento_salida_cierre documento_salida_cierre_id_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida_cierre
    ADD CONSTRAINT documento_salida_cierre_id_actor_fkey FOREIGN KEY (id_actor) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: documento_salida_cierre documento_salida_cierre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida_cierre
    ADD CONSTRAINT documento_salida_cierre_id_fkey FOREIGN KEY (id) REFERENCES public.documento_salida(id) ON DELETE RESTRICT;


--
-- Name: documento_salida documento_salida_id_actor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida
    ADD CONSTRAINT documento_salida_id_actor_fkey FOREIGN KEY (id_actor) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: documento_salida documento_salida_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida
    ADD CONSTRAINT documento_salida_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE RESTRICT;


--
-- Name: documento_salida documento_salida_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_salida
    ADD CONSTRAINT documento_salida_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura) ON DELETE RESTRICT;


--
-- Name: entrega_pedido entrega_pedido_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega_pedido
    ADD CONSTRAINT entrega_pedido_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE CASCADE;


--
-- Name: entrega_pedido entrega_pedido_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega_pedido
    ADD CONSTRAINT entrega_pedido_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: evaluacion_proveedor evaluacion_proveedor_id_orden_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluacion_proveedor
    ADD CONSTRAINT evaluacion_proveedor_id_orden_fkey FOREIGN KEY (id_orden) REFERENCES public.orden_compra(id_orden) ON DELETE SET NULL;


--
-- Name: evaluacion_proveedor evaluacion_proveedor_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluacion_proveedor
    ADD CONSTRAINT evaluacion_proveedor_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor") ON DELETE CASCADE;


--
-- Name: evaluacion_proveedor evaluacion_proveedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluacion_proveedor
    ADD CONSTRAINT evaluacion_proveedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura factura_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: factura factura_id_factura_global_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_factura_global_fkey FOREIGN KEY (id_factura_global) REFERENCES public.factura(id_factura);


--
-- Name: factura factura_id_factura_origen_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_factura_origen_fkey FOREIGN KEY (id_factura_origen) REFERENCES public.factura(id_factura);


--
-- Name: factura factura_id_forma_pago_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_forma_pago_fkey FOREIGN KEY (id_forma_pago) REFERENCES public.formadepago("IdFormaPago");


--
-- Name: factura factura_id_gasto_reembolso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_gasto_reembolso_fkey FOREIGN KEY (id_gasto_reembolso) REFERENCES public.gasto(id_gasto);


--
-- Name: factura factura_id_metodo_pago_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_metodo_pago_fkey FOREIGN KEY (id_metodo_pago) REFERENCES public.metododepago("IdMetodoDePago");


--
-- Name: factura factura_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE SET NULL;


--
-- Name: factura factura_id_uso_cfdi_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_uso_cfdi_fkey FOREIGN KEY (id_uso_cfdi) REFERENCES public.usocfdi("IdUsoCFDI");


--
-- Name: factura factura_id_vendedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT factura_id_vendedor_fkey FOREIGN KEY (id_vendedor) REFERENCES public.auth_user(id_user);


--
-- Name: factura_proveedor factura_proveedor_aprobada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_aprobada_por_fkey FOREIGN KEY (aprobada_por) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor factura_proveedor_cancelada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_cancelada_por_fkey FOREIGN KEY (cancelada_por) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor_detalle factura_proveedor_detalle_id_factura_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_detalle
    ADD CONSTRAINT factura_proveedor_detalle_id_factura_proveedor_fkey FOREIGN KEY (id_factura_proveedor) REFERENCES public.factura_proveedor(id_factura_proveedor) ON DELETE CASCADE;


--
-- Name: factura_proveedor_detalle factura_proveedor_detalle_id_orden_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_detalle
    ADD CONSTRAINT factura_proveedor_detalle_id_orden_detalle_fkey FOREIGN KEY (id_orden_detalle) REFERENCES public.orden_compra_detalle(id_detalle);


--
-- Name: factura_proveedor_detalle factura_proveedor_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_detalle
    ADD CONSTRAINT factura_proveedor_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: factura_proveedor_discrepancia factura_proveedor_discrepancia_id_factura_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_discrepancia
    ADD CONSTRAINT factura_proveedor_discrepancia_id_factura_detalle_fkey FOREIGN KEY (id_factura_detalle) REFERENCES public.factura_proveedor_detalle(id_detalle) ON DELETE CASCADE;


--
-- Name: factura_proveedor_discrepancia factura_proveedor_discrepancia_id_factura_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_discrepancia
    ADD CONSTRAINT factura_proveedor_discrepancia_id_factura_proveedor_fkey FOREIGN KEY (id_factura_proveedor) REFERENCES public.factura_proveedor(id_factura_proveedor) ON DELETE CASCADE;


--
-- Name: factura_proveedor_discrepancia factura_proveedor_discrepancia_resuelta_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_discrepancia
    ADD CONSTRAINT factura_proveedor_discrepancia_resuelta_por_fkey FOREIGN KEY (resuelta_por) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor factura_proveedor_id_orden_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_id_orden_fkey FOREIGN KEY (id_orden) REFERENCES public.orden_compra(id_orden);


--
-- Name: factura_proveedor factura_proveedor_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor");


--
-- Name: factura_proveedor factura_proveedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor
    ADD CONSTRAINT factura_proveedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor_pago factura_proveedor_pago_id_factura_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago
    ADD CONSTRAINT factura_proveedor_pago_id_factura_proveedor_fkey FOREIGN KEY (id_factura_proveedor) REFERENCES public.factura_proveedor(id_factura_proveedor);


--
-- Name: factura_proveedor_pago factura_proveedor_pago_id_programacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago
    ADD CONSTRAINT factura_proveedor_pago_id_programacion_fkey FOREIGN KEY (id_programacion) REFERENCES public.factura_proveedor_programacion(id_programacion);


--
-- Name: factura_proveedor_pago factura_proveedor_pago_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago
    ADD CONSTRAINT factura_proveedor_pago_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor_pago factura_proveedor_pago_revertido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_pago
    ADD CONSTRAINT factura_proveedor_pago_revertido_por_fkey FOREIGN KEY (revertido_por) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor_programacion factura_proveedor_programacion_id_factura_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_programacion
    ADD CONSTRAINT factura_proveedor_programacion_id_factura_proveedor_fkey FOREIGN KEY (id_factura_proveedor) REFERENCES public.factura_proveedor(id_factura_proveedor) ON DELETE CASCADE;


--
-- Name: factura_proveedor_programacion factura_proveedor_programacion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_programacion
    ADD CONSTRAINT factura_proveedor_programacion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: factura_proveedor_recepcion factura_proveedor_recepcion_id_factura_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_recepcion
    ADD CONSTRAINT factura_proveedor_recepcion_id_factura_detalle_fkey FOREIGN KEY (id_factura_detalle) REFERENCES public.factura_proveedor_detalle(id_detalle) ON DELETE CASCADE;


--
-- Name: factura_proveedor_recepcion factura_proveedor_recepcion_id_recepcion_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura_proveedor_recepcion
    ADD CONSTRAINT factura_proveedor_recepcion_id_recepcion_detalle_fkey FOREIGN KEY (id_recepcion_detalle) REFERENCES public.recepcion_compra_detalle(id_detalle);


--
-- Name: fiscal_documento fiscal_documento_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_documento
    ADD CONSTRAINT fiscal_documento_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura) ON DELETE RESTRICT;


--
-- Name: fiscal_documento fiscal_documento_id_rep_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_documento
    ADD CONSTRAINT fiscal_documento_id_rep_fkey FOREIGN KEY (id_rep) REFERENCES public.rep(id_rep) ON DELETE RESTRICT;


--
-- Name: fiscal_documento fiscal_documento_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_documento
    ADD CONSTRAINT fiscal_documento_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: fiscal_evento fiscal_evento_id_documento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_evento
    ADD CONSTRAINT fiscal_evento_id_documento_fkey FOREIGN KEY (id_documento) REFERENCES public.fiscal_documento(id_documento) ON DELETE CASCADE;


--
-- Name: fiscal_evento fiscal_evento_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_evento
    ADD CONSTRAINT fiscal_evento_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: cfdi_relacionado fk_cfdi_relacionado_factura; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cfdi_relacionado
    ADD CONSTRAINT fk_cfdi_relacionado_factura FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura) ON DELETE CASCADE;


--
-- Name: cliente fk_cliente_estado_clave; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT fk_cliente_estado_clave FOREIGN KEY ("ClaveEstado") REFERENCES public.estado("Clave");


--
-- Name: cliente fk_cliente_formapago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT fk_cliente_formapago FOREIGN KEY ("IdFormaPago") REFERENCES public.formadepago("IdFormaPago");


--
-- Name: cliente fk_cliente_metodopago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT fk_cliente_metodopago FOREIGN KEY ("IdMetodoDePago") REFERENCES public.metododepago("IdMetodoDePago");


--
-- Name: cliente fk_cliente_regimenfiscal; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT fk_cliente_regimenfiscal FOREIGN KEY ("IdRegimenFiscal") REFERENCES public.regimenfiscal("IdRegimenFiscal");


--
-- Name: cliente fk_cliente_usocfdi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT fk_cliente_usocfdi FOREIGN KEY ("IdUsoCFDI") REFERENCES public.usocfdi("IdUsoCFDI");


--
-- Name: complementodepago fk_complementodepago_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complementodepago
    ADD CONSTRAINT fk_complementodepago_cliente FOREIGN KEY ("IdCliente") REFERENCES public.cliente("IdCliente");


--
-- Name: complementodepago fk_complementodepago_formapago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complementodepago
    ADD CONSTRAINT fk_complementodepago_formapago FOREIGN KEY ("IdFormaPago") REFERENCES public.formadepago("IdFormaPago");


--
-- Name: cuentabancaria fk_cuentabancaria_banco; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentabancaria
    ADD CONSTRAINT fk_cuentabancaria_banco FOREIGN KEY ("IdBanco") REFERENCES public.bancos("IdBanco");


--
-- Name: cuentabancaria fk_cuentabancaria_tipoentidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentabancaria
    ADD CONSTRAINT fk_cuentabancaria_tipoentidad FOREIGN KEY ("IdTipoEntidad") REFERENCES public.tipoentidad("IdTipoEntidad");


--
-- Name: email fk_email_tipoentidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email
    ADD CONSTRAINT fk_email_tipoentidad FOREIGN KEY ("IdTipoEntidad") REFERENCES public.tipoentidad("IdTipoEntidad");


--
-- Name: emisor fk_emisor_estado_clave; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emisor
    ADD CONSTRAINT fk_emisor_estado_clave FOREIGN KEY ("ClaveEstado") REFERENCES public.estado("Clave");


--
-- Name: emisor fk_emisor_regimenfiscal; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emisor
    ADD CONSTRAINT fk_emisor_regimenfiscal FOREIGN KEY ("IdRegimenFiscal") REFERENCES public.regimenfiscal("IdRegimenFiscal");


--
-- Name: factura fk_factura_cotizacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT fk_factura_cotizacion FOREIGN KEY (id_cotizacion) REFERENCES public.cotizacion(id_cotizacion) ON DELETE SET NULL;


--
-- Name: factura fk_factura_pedido; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.factura
    ADD CONSTRAINT fk_factura_pedido FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE SET NULL;


--
-- Name: impuestoproducto fk_impuestoproducto_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impuestoproducto
    ADD CONSTRAINT fk_impuestoproducto_producto FOREIGN KEY ("IdProducto") REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: inventario fk_inventario_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT fk_inventario_producto FOREIGN KEY ("IdProducto") REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: kardex fk_kardex_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kardex
    ADD CONSTRAINT fk_kardex_producto FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: localidad fk_localidad_estado_clave; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.localidad
    ADD CONSTRAINT fk_localidad_estado_clave FOREIGN KEY ("ClaveEstado") REFERENCES public.estado("Clave");


--
-- Name: municipio fk_municipio_estado_clave; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT fk_municipio_estado_clave FOREIGN KEY ("ClaveEstado") REFERENCES public.estado("Clave");


--
-- Name: pagodocumentos fk_pagodocumentos_complemento; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagodocumentos
    ADD CONSTRAINT fk_pagodocumentos_complemento FOREIGN KEY ("IdComplementoPago") REFERENCES public.complementodepago("IdComplementoPago") ON DELETE CASCADE;


--
-- Name: pagosdetalleproveedor fk_pagosdetalle_pagoprov; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagosdetalleproveedor
    ADD CONSTRAINT fk_pagosdetalle_pagoprov FOREIGN KEY ("IdPagosProveedor") REFERENCES public.pagosproveedor("IdPagosProveedor") ON DELETE CASCADE;


--
-- Name: pagosproveedor fk_pagosproveedor_formapago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagosproveedor
    ADD CONSTRAINT fk_pagosproveedor_formapago FOREIGN KEY ("IdFormaPago") REFERENCES public.formadepago("IdFormaPago");


--
-- Name: pagosproveedor fk_pagosproveedor_proveedor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagosproveedor
    ADD CONSTRAINT fk_pagosproveedor_proveedor FOREIGN KEY ("IdProveedor") REFERENCES public.proveedor("IdProveedor");


--
-- Name: producto_cotizacion_prov fk_prod_cotiz_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_cotizacion_prov
    ADD CONSTRAINT fk_prod_cotiz_producto FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto_cotizacion_prov fk_prod_cotiz_proveedor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_cotizacion_prov
    ADD CONSTRAINT fk_prod_cotiz_proveedor FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor") ON DELETE CASCADE;


--
-- Name: producto_cruce fk_prodcruce_destino; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_cruce
    ADD CONSTRAINT fk_prodcruce_destino FOREIGN KEY (id_producto_destino) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto_cruce fk_prodcruce_origen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_cruce
    ADD CONSTRAINT fk_prodcruce_origen FOREIGN KEY (id_producto_origen) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto fk_producto_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT fk_producto_categoria FOREIGN KEY ("IdCategoria") REFERENCES public.categoria("IdCategoria");


--
-- Name: producto fk_producto_claveprodoserv; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT fk_producto_claveprodoserv FOREIGN KEY ("IdClaveProdOServ") REFERENCES public.claveproductooservicio("IdClaveProdOServ");


--
-- Name: producto fk_producto_claveunidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT fk_producto_claveunidad FOREIGN KEY ("IdClaveUnidad") REFERENCES public.claveunidad("IdClaveUnidad");


--
-- Name: producto_equivalente fk_producto_equivalente_1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_equivalente
    ADD CONSTRAINT fk_producto_equivalente_1 FOREIGN KEY ("IdProducto") REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto_equivalente fk_producto_equivalente_2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_equivalente
    ADD CONSTRAINT fk_producto_equivalente_2 FOREIGN KEY ("IdProductoEquivalente") REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto fk_producto_objetoimpuesto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT fk_producto_objetoimpuesto FOREIGN KEY ("IdObjetoImpuesto") REFERENCES public.objetoimpuesto("IdObjetoImpuesto");


--
-- Name: producto fk_producto_unidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT fk_producto_unidad FOREIGN KEY ("IdUnidad") REFERENCES public.unidad("IdUnidad");


--
-- Name: proveedor fk_proveedor_estado_clave; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT fk_proveedor_estado_clave FOREIGN KEY ("ClaveEstado") REFERENCES public.estado("Clave");


--
-- Name: proveedor fk_proveedor_formapago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT fk_proveedor_formapago FOREIGN KEY ("IdFormaPago") REFERENCES public.formadepago("IdFormaPago");


--
-- Name: proveedor fk_proveedor_metodopago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT fk_proveedor_metodopago FOREIGN KEY ("IdMetodoDePago") REFERENCES public.metododepago("IdMetodoDePago");


--
-- Name: proveedor fk_proveedor_regimenfiscal; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT fk_proveedor_regimenfiscal FOREIGN KEY ("IdRegimenFiscal") REFERENCES public.regimenfiscal("IdRegimenFiscal");


--
-- Name: proveedor fk_proveedor_usocfdi; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor
    ADD CONSTRAINT fk_proveedor_usocfdi FOREIGN KEY ("IdUsoCFDI") REFERENCES public.usocfdi("IdUsoCFDI");


--
-- Name: relacioncfdi fk_relacioncfdi_tiporelacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relacioncfdi
    ADD CONSTRAINT fk_relacioncfdi_tiporelacion FOREIGN KEY ("IdTipoRelacion") REFERENCES public.tiporelacion("IdTipoRelacion");


--
-- Name: telefono fk_telefono_tipoentidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telefono
    ADD CONSTRAINT fk_telefono_tipoentidad FOREIGN KEY ("IdTipoEntidad") REFERENCES public.tipoentidad("IdTipoEntidad");


--
-- Name: garantia garantia_id_concepto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garantia
    ADD CONSTRAINT garantia_id_concepto_fkey FOREIGN KEY (id_concepto) REFERENCES public.conceptofactura(id_concepto);


--
-- Name: garantia garantia_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garantia
    ADD CONSTRAINT garantia_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura);


--
-- Name: garantia garantia_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garantia
    ADD CONSTRAINT garantia_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor") ON DELETE SET NULL;


--
-- Name: garantia garantia_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.garantia
    ADD CONSTRAINT garantia_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: historial_correos historial_correos_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_correos
    ADD CONSTRAINT historial_correos_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura);


--
-- Name: inventario_lote inventario_lote_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_lote
    ADD CONSTRAINT inventario_lote_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: inventario_lote inventario_lote_id_ubicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_lote
    ADD CONSTRAINT inventario_lote_id_ubicacion_fkey FOREIGN KEY (id_ubicacion) REFERENCES public.almacen_ubicacion(id_ubicacion);


--
-- Name: inventario_serie inventario_serie_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_serie
    ADD CONSTRAINT inventario_serie_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: inventario_serie inventario_serie_id_ubicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_serie
    ADD CONSTRAINT inventario_serie_id_ubicacion_fkey FOREIGN KEY (id_ubicacion) REFERENCES public.almacen_ubicacion(id_ubicacion);


--
-- Name: inventario_ubicacion inventario_ubicacion_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_ubicacion
    ADD CONSTRAINT inventario_ubicacion_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: inventario_ubicacion inventario_ubicacion_id_ubicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_ubicacion
    ADD CONSTRAINT inventario_ubicacion_id_ubicacion_fkey FOREIGN KEY (id_ubicacion) REFERENCES public.almacen_ubicacion(id_ubicacion) ON DELETE CASCADE;


--
-- Name: lista_precio_detalle lista_precio_detalle_id_lista_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precio_detalle
    ADD CONSTRAINT lista_precio_detalle_id_lista_fkey FOREIGN KEY (id_lista) REFERENCES public.lista_precio(id_lista) ON DELETE CASCADE;


--
-- Name: lista_precio_detalle lista_precio_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lista_precio_detalle
    ADD CONSTRAINT lista_precio_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: nota_credito_proveedor nota_credito_proveedor_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_proveedor
    ADD CONSTRAINT nota_credito_proveedor_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor");


--
-- Name: nota_credito_proveedor nota_credito_proveedor_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_credito_proveedor
    ADD CONSTRAINT nota_credito_proveedor_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: operation_idempotency operation_idempotency_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_idempotency
    ADD CONSTRAINT operation_idempotency_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: operational_job_run operational_job_run_job_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_job_run
    ADD CONSTRAINT operational_job_run_job_name_fkey FOREIGN KEY (job_name) REFERENCES public.operational_job(name);


--
-- Name: orden_compra_detalle orden_compra_detalle_id_orden_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_id_orden_fkey FOREIGN KEY (id_orden) REFERENCES public.orden_compra(id_orden) ON DELETE CASCADE;


--
-- Name: orden_compra_detalle orden_compra_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: orden_compra orden_compra_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedor("IdProveedor");


--
-- Name: orden_compra orden_compra_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitud_compra(id_solicitud) ON DELETE SET NULL;


--
-- Name: orden_compra orden_compra_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orden_compra
    ADD CONSTRAINT orden_compra_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: pago pago_id_cuenta_bancaria_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago
    ADD CONSTRAINT pago_id_cuenta_bancaria_fkey FOREIGN KEY (id_cuenta_bancaria) REFERENCES public.cuentabancaria("IdCuentaBancaria");


--
-- Name: pago pago_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago
    ADD CONSTRAINT pago_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura) ON DELETE CASCADE;


--
-- Name: pago pago_id_rep_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago
    ADD CONSTRAINT pago_id_rep_fkey FOREIGN KEY (id_rep) REFERENCES public.rep(id_rep);


--
-- Name: pago_proveedor pago_proveedor_id_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pago_proveedor
    ADD CONSTRAINT pago_proveedor_id_compra_fkey FOREIGN KEY (id_compra) REFERENCES public.compra(id_compra) ON DELETE CASCADE;


--
-- Name: pedido_entrega_archivo pedido_entrega_archivo_id_entrega_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_entrega_archivo
    ADD CONSTRAINT pedido_entrega_archivo_id_entrega_fkey FOREIGN KEY (id_entrega) REFERENCES public.pedido_entrega_evidencia(id_entrega) ON DELETE RESTRICT;


--
-- Name: pedido_entrega_evidencia pedido_entrega_evidencia_id_entrega_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_entrega_evidencia
    ADD CONSTRAINT pedido_entrega_evidencia_id_entrega_fkey FOREIGN KEY (id_entrega) REFERENCES public.entrega_pedido(id_entrega) ON DELETE RESTRICT;


--
-- Name: pedido_estado_historial pedido_estado_historial_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_estado_historial
    ADD CONSTRAINT pedido_estado_historial_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE CASCADE;


--
-- Name: pedido_estado_historial pedido_estado_historial_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_estado_historial
    ADD CONSTRAINT pedido_estado_historial_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: pedido_surtido_ubicacion pedido_surtido_ubicacion_id_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_surtido_ubicacion
    ADD CONSTRAINT pedido_surtido_ubicacion_id_detalle_fkey FOREIGN KEY (id_detalle) REFERENCES public.pedido_venta_detalle(id_detalle) ON DELETE CASCADE;


--
-- Name: pedido_surtido_ubicacion pedido_surtido_ubicacion_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_surtido_ubicacion
    ADD CONSTRAINT pedido_surtido_ubicacion_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE CASCADE;


--
-- Name: pedido_surtido_ubicacion pedido_surtido_ubicacion_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_surtido_ubicacion
    ADD CONSTRAINT pedido_surtido_ubicacion_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: pedido_surtido_ubicacion pedido_surtido_ubicacion_id_ubicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_surtido_ubicacion
    ADD CONSTRAINT pedido_surtido_ubicacion_id_ubicacion_fkey FOREIGN KEY (id_ubicacion) REFERENCES public.almacen_ubicacion(id_ubicacion);


--
-- Name: pedido_surtido_ubicacion pedido_surtido_ubicacion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_surtido_ubicacion
    ADD CONSTRAINT pedido_surtido_ubicacion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: pedido_venta_detalle pedido_venta_detalle_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta_detalle
    ADD CONSTRAINT pedido_venta_detalle_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE CASCADE;


--
-- Name: pedido_venta_detalle pedido_venta_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta_detalle
    ADD CONSTRAINT pedido_venta_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: pedido_venta pedido_venta_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: pedido_venta pedido_venta_id_cotizacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_id_cotizacion_fkey FOREIGN KEY (id_cotizacion) REFERENCES public.cotizacion(id_cotizacion) ON DELETE SET NULL;


--
-- Name: pedido_venta pedido_venta_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.crm_unidad_cliente(id_unidad) ON DELETE SET NULL;


--
-- Name: pedido_venta pedido_venta_id_vendedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_venta
    ADD CONSTRAINT pedido_venta_id_vendedor_fkey FOREIGN KEY (id_vendedor) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: periodo_contable periodo_contable_cerrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.periodo_contable
    ADD CONSTRAINT periodo_contable_cerrado_por_fkey FOREIGN KEY (cerrado_por) REFERENCES public.auth_user(id_user);


--
-- Name: poliza_contable_detalle poliza_contable_detalle_id_centro_costo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable_detalle
    ADD CONSTRAINT poliza_contable_detalle_id_centro_costo_fkey FOREIGN KEY (id_centro_costo) REFERENCES public.centro_costo(id_centro);


--
-- Name: poliza_contable_detalle poliza_contable_detalle_id_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable_detalle
    ADD CONSTRAINT poliza_contable_detalle_id_cuenta_fkey FOREIGN KEY (id_cuenta) REFERENCES public.cuenta_contable(id_cuenta);


--
-- Name: poliza_contable_detalle poliza_contable_detalle_id_poliza_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable_detalle
    ADD CONSTRAINT poliza_contable_detalle_id_poliza_fkey FOREIGN KEY (id_poliza) REFERENCES public.poliza_contable(id_poliza) ON DELETE CASCADE;


--
-- Name: poliza_contable poliza_contable_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.poliza_contable
    ADD CONSTRAINT poliza_contable_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.auth_user(id_user);


--
-- Name: portal_acceso portal_acceso_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_acceso
    ADD CONSTRAINT portal_acceso_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE RESTRICT;


--
-- Name: portal_credencial portal_credencial_id_acceso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_credencial
    ADD CONSTRAINT portal_credencial_id_acceso_fkey FOREIGN KEY (id_acceso) REFERENCES public.portal_acceso(id_acceso) ON DELETE RESTRICT;


--
-- Name: portal_evento portal_evento_id_acceso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_evento
    ADD CONSTRAINT portal_evento_id_acceso_fkey FOREIGN KEY (id_acceso) REFERENCES public.portal_acceso(id_acceso) ON DELETE RESTRICT;


--
-- Name: portal_invitacion portal_invitacion_id_acceso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_invitacion
    ADD CONSTRAINT portal_invitacion_id_acceso_fkey FOREIGN KEY (id_acceso) REFERENCES public.portal_acceso(id_acceso) ON DELETE RESTRICT;


--
-- Name: portal_publicacion_archivo portal_publicacion_archivo_id_publicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion_archivo
    ADD CONSTRAINT portal_publicacion_archivo_id_publicacion_fkey FOREIGN KEY (id_publicacion) REFERENCES public.portal_publicacion(id_publicacion) ON DELETE RESTRICT;


--
-- Name: portal_publicacion portal_publicacion_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion
    ADD CONSTRAINT portal_publicacion_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE RESTRICT;


--
-- Name: portal_publicacion portal_publicacion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion
    ADD CONSTRAINT portal_publicacion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: portal_publicacion_retiro portal_publicacion_retiro_id_publicacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion_retiro
    ADD CONSTRAINT portal_publicacion_retiro_id_publicacion_fkey FOREIGN KEY (id_publicacion) REFERENCES public.portal_publicacion(id_publicacion) ON DELETE RESTRICT;


--
-- Name: portal_publicacion_retiro portal_publicacion_retiro_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_publicacion_retiro
    ADD CONSTRAINT portal_publicacion_retiro_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE RESTRICT;


--
-- Name: portal_sesion portal_sesion_id_acceso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sesion
    ADD CONSTRAINT portal_sesion_id_acceso_fkey FOREIGN KEY (id_acceso) REFERENCES public.portal_acceso(id_acceso) ON DELETE RESTRICT;


--
-- Name: precio_especial_cliente precio_especial_cliente_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precio_especial_cliente
    ADD CONSTRAINT precio_especial_cliente_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE CASCADE;


--
-- Name: precio_especial_cliente precio_especial_cliente_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precio_especial_cliente
    ADD CONSTRAINT precio_especial_cliente_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: presupuesto_contable presupuesto_contable_id_centro_costo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presupuesto_contable
    ADD CONSTRAINT presupuesto_contable_id_centro_costo_fkey FOREIGN KEY (id_centro_costo) REFERENCES public.centro_costo(id_centro);


--
-- Name: presupuesto_contable presupuesto_contable_id_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presupuesto_contable
    ADD CONSTRAINT presupuesto_contable_id_cuenta_fkey FOREIGN KEY (id_cuenta) REFERENCES public.cuenta_contable(id_cuenta);


--
-- Name: producto_aplicacion producto_aplicacion_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_aplicacion
    ADD CONSTRAINT producto_aplicacion_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto_kit_detalle producto_kit_detalle_id_componente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_detalle
    ADD CONSTRAINT producto_kit_detalle_id_componente_fkey FOREIGN KEY (id_componente) REFERENCES public.producto("IdProducto");


--
-- Name: producto_kit_detalle producto_kit_detalle_id_kit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_detalle
    ADD CONSTRAINT producto_kit_detalle_id_kit_fkey FOREIGN KEY (id_kit) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: producto_kit_movimiento producto_kit_movimiento_id_kit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_movimiento
    ADD CONSTRAINT producto_kit_movimiento_id_kit_fkey FOREIGN KEY (id_kit) REFERENCES public.producto("IdProducto");


--
-- Name: producto_kit_movimiento producto_kit_movimiento_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_kit_movimiento
    ADD CONSTRAINT producto_kit_movimiento_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: producto_numero_parte producto_numero_parte_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.producto_numero_parte
    ADD CONSTRAINT producto_numero_parte_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: recepcion_compra_detalle recepcion_compra_detalle_id_orden_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra_detalle
    ADD CONSTRAINT recepcion_compra_detalle_id_orden_detalle_fkey FOREIGN KEY (id_orden_detalle) REFERENCES public.orden_compra_detalle(id_detalle);


--
-- Name: recepcion_compra_detalle recepcion_compra_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra_detalle
    ADD CONSTRAINT recepcion_compra_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: recepcion_compra_detalle recepcion_compra_detalle_id_recepcion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra_detalle
    ADD CONSTRAINT recepcion_compra_detalle_id_recepcion_fkey FOREIGN KEY (id_recepcion) REFERENCES public.recepcion_compra(id_recepcion) ON DELETE CASCADE;


--
-- Name: recepcion_compra recepcion_compra_id_orden_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra
    ADD CONSTRAINT recepcion_compra_id_orden_fkey FOREIGN KEY (id_orden) REFERENCES public.orden_compra(id_orden);


--
-- Name: recepcion_compra recepcion_compra_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_compra
    ADD CONSTRAINT recepcion_compra_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: recepcion_costo_adicional_detalle recepcion_costo_adicional_detalle_id_costo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional_detalle
    ADD CONSTRAINT recepcion_costo_adicional_detalle_id_costo_fkey FOREIGN KEY (id_costo) REFERENCES public.recepcion_costo_adicional(id_costo) ON DELETE CASCADE;


--
-- Name: recepcion_costo_adicional_detalle recepcion_costo_adicional_detalle_id_recepcion_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional_detalle
    ADD CONSTRAINT recepcion_costo_adicional_detalle_id_recepcion_detalle_fkey FOREIGN KEY (id_recepcion_detalle) REFERENCES public.recepcion_compra_detalle(id_detalle);


--
-- Name: recepcion_costo_adicional recepcion_costo_adicional_id_recepcion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional
    ADD CONSTRAINT recepcion_costo_adicional_id_recepcion_fkey FOREIGN KEY (id_recepcion) REFERENCES public.recepcion_compra(id_recepcion);


--
-- Name: recepcion_costo_adicional recepcion_costo_adicional_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_costo_adicional
    ADD CONSTRAINT recepcion_costo_adicional_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: rep_factura rep_factura_id_factura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep_factura
    ADD CONSTRAINT rep_factura_id_factura_fkey FOREIGN KEY (id_factura) REFERENCES public.factura(id_factura);


--
-- Name: rep_factura rep_factura_id_rep_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep_factura
    ADD CONSTRAINT rep_factura_id_rep_fkey FOREIGN KEY (id_rep) REFERENCES public.rep(id_rep) ON DELETE CASCADE;


--
-- Name: rep rep_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep
    ADD CONSTRAINT rep_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: reserva_inventario reserva_inventario_id_detalle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_inventario
    ADD CONSTRAINT reserva_inventario_id_detalle_fkey FOREIGN KEY (id_detalle) REFERENCES public.pedido_venta_detalle(id_detalle) ON DELETE CASCADE;


--
-- Name: reserva_inventario reserva_inventario_id_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_inventario
    ADD CONSTRAINT reserva_inventario_id_pedido_fkey FOREIGN KEY (id_pedido) REFERENCES public.pedido_venta(id_pedido) ON DELETE CASCADE;


--
-- Name: reserva_inventario reserva_inventario_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_inventario
    ADD CONSTRAINT reserva_inventario_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: solicitud_autorizacion_comercial solicitud_autorizacion_comercial_id_autorizador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_autorizacion_comercial
    ADD CONSTRAINT solicitud_autorizacion_comercial_id_autorizador_fkey FOREIGN KEY (id_autorizador) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: solicitud_autorizacion_comercial solicitud_autorizacion_comercial_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_autorizacion_comercial
    ADD CONSTRAINT solicitud_autorizacion_comercial_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente");


--
-- Name: solicitud_autorizacion_comercial solicitud_autorizacion_comercial_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_autorizacion_comercial
    ADD CONSTRAINT solicitud_autorizacion_comercial_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: solicitud_autorizacion_comercial solicitud_autorizacion_comercial_id_solicitante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_autorizacion_comercial
    ADD CONSTRAINT solicitud_autorizacion_comercial_id_solicitante_fkey FOREIGN KEY (id_solicitante) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitud_compra(id_solicitud) ON DELETE CASCADE;


--
-- Name: solicitud_compra solicitud_compra_id_autorizador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra
    ADD CONSTRAINT solicitud_compra_id_autorizador_fkey FOREIGN KEY (id_autorizador) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: solicitud_compra solicitud_compra_id_solicitante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_compra
    ADD CONSTRAINT solicitud_compra_id_solicitante_fkey FOREIGN KEY (id_solicitante) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: tesoreria_cierre tesoreria_cierre_id_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cierre
    ADD CONSTRAINT tesoreria_cierre_id_cuenta_fkey FOREIGN KEY (id_cuenta) REFERENCES public.tesoreria_cuenta(id_cuenta);


--
-- Name: tesoreria_cierre tesoreria_cierre_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_cierre
    ADD CONSTRAINT tesoreria_cierre_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.auth_user(id_user);


--
-- Name: tesoreria_conciliacion tesoreria_conciliacion_id_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion
    ADD CONSTRAINT tesoreria_conciliacion_id_cuenta_fkey FOREIGN KEY (id_cuenta) REFERENCES public.tesoreria_cuenta(id_cuenta);


--
-- Name: tesoreria_conciliacion tesoreria_conciliacion_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion
    ADD CONSTRAINT tesoreria_conciliacion_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: tesoreria_conciliacion tesoreria_conciliacion_revertida_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion
    ADD CONSTRAINT tesoreria_conciliacion_revertida_por_fkey FOREIGN KEY (revertida_por) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: tesoreria_conciliacion_sistema tesoreria_conciliacion_sistema_id_caja_movimiento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion_sistema
    ADD CONSTRAINT tesoreria_conciliacion_sistema_id_caja_movimiento_fkey FOREIGN KEY (id_caja_movimiento) REFERENCES public.caja_movimiento(id_movimiento);


--
-- Name: tesoreria_conciliacion_sistema tesoreria_conciliacion_sistema_id_conciliacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_conciliacion_sistema
    ADD CONSTRAINT tesoreria_conciliacion_sistema_id_conciliacion_fkey FOREIGN KEY (id_conciliacion) REFERENCES public.tesoreria_conciliacion(id_conciliacion) ON DELETE CASCADE;


--
-- Name: tesoreria_importacion tesoreria_importacion_id_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_importacion
    ADD CONSTRAINT tesoreria_importacion_id_cuenta_fkey FOREIGN KEY (id_cuenta) REFERENCES public.tesoreria_cuenta(id_cuenta);


--
-- Name: tesoreria_importacion tesoreria_importacion_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_importacion
    ADD CONSTRAINT tesoreria_importacion_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: tesoreria_movimiento tesoreria_movimiento_conciliado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento
    ADD CONSTRAINT tesoreria_movimiento_conciliado_por_fkey FOREIGN KEY (conciliado_por) REFERENCES public.auth_user(id_user);


--
-- Name: tesoreria_movimiento tesoreria_movimiento_id_caja_movimiento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento
    ADD CONSTRAINT tesoreria_movimiento_id_caja_movimiento_fkey FOREIGN KEY (id_caja_movimiento) REFERENCES public.caja_movimiento(id_movimiento);


--
-- Name: tesoreria_movimiento tesoreria_movimiento_id_conciliacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento
    ADD CONSTRAINT tesoreria_movimiento_id_conciliacion_fkey FOREIGN KEY (id_conciliacion) REFERENCES public.tesoreria_conciliacion(id_conciliacion);


--
-- Name: tesoreria_movimiento tesoreria_movimiento_id_cuenta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento
    ADD CONSTRAINT tesoreria_movimiento_id_cuenta_fkey FOREIGN KEY (id_cuenta) REFERENCES public.tesoreria_cuenta(id_cuenta);


--
-- Name: tesoreria_movimiento tesoreria_movimiento_id_importacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_movimiento
    ADD CONSTRAINT tesoreria_movimiento_id_importacion_fkey FOREIGN KEY (id_importacion) REFERENCES public.tesoreria_importacion(id_importacion);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_id_conciliacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_id_conciliacion_fkey FOREIGN KEY (id_conciliacion) REFERENCES public.tesoreria_conciliacion(id_conciliacion);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_id_movimiento_entrada_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_id_movimiento_entrada_fkey FOREIGN KEY (id_movimiento_entrada) REFERENCES public.tesoreria_movimiento(id_movimiento);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_id_movimiento_salida_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_id_movimiento_salida_fkey FOREIGN KEY (id_movimiento_salida) REFERENCES public.tesoreria_movimiento(id_movimiento);


--
-- Name: tesoreria_transferencia tesoreria_transferencia_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_transferencia
    ADD CONSTRAINT tesoreria_transferencia_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: transferencia_almacen transferencia_almacen_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencia_almacen
    ADD CONSTRAINT transferencia_almacen_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto");


--
-- Name: transferencia_almacen transferencia_almacen_id_ubicacion_destino_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencia_almacen
    ADD CONSTRAINT transferencia_almacen_id_ubicacion_destino_fkey FOREIGN KEY (id_ubicacion_destino) REFERENCES public.almacen_ubicacion(id_ubicacion);


--
-- Name: transferencia_almacen transferencia_almacen_id_ubicacion_origen_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencia_almacen
    ADD CONSTRAINT transferencia_almacen_id_ubicacion_origen_fkey FOREIGN KEY (id_ubicacion_origen) REFERENCES public.almacen_ubicacion(id_ubicacion);


--
-- Name: transferencia_almacen transferencia_almacen_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencia_almacen
    ADD CONSTRAINT transferencia_almacen_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: venta_perdida venta_perdida_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_perdida
    ADD CONSTRAINT venta_perdida_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.cliente("IdCliente") ON DELETE SET NULL;


--
-- Name: venta_perdida venta_perdida_id_oportunidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_perdida
    ADD CONSTRAINT venta_perdida_id_oportunidad_fkey FOREIGN KEY (id_oportunidad) REFERENCES public.crm_oportunidad(id_oportunidad) ON DELETE SET NULL;


--
-- Name: venta_perdida venta_perdida_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_perdida
    ADD CONSTRAINT venta_perdida_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE SET NULL;


--
-- Name: venta_perdida venta_perdida_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venta_perdida
    ADD CONSTRAINT venta_perdida_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.auth_user(id_user) ON DELETE SET NULL;


--
-- Name: web_producto_ficha web_producto_ficha_id_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_producto_ficha
    ADD CONSTRAINT web_producto_ficha_id_producto_fkey FOREIGN KEY (id_producto) REFERENCES public.producto("IdProducto") ON DELETE CASCADE;


--
-- Name: web_producto_ficha web_producto_ficha_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_producto_ficha
    ADD CONSTRAINT web_producto_ficha_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.auth_user(id_user);


--
-- Name: impuesto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.impuesto ENABLE ROW LEVEL SECURITY;

--
-- Name: meses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meses ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


