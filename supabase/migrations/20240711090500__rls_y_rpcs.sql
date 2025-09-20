-- Migración: RLS y RPCs operativas
-- Contexto: Proyecto Sistema de Gestión ROV (Supabase)
-- EDI: Implementa funciones de sesión, guards, policies y RPCs transaccionales.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('supabase:migrations:20240711090500__rls_y_rpcs'));

-- ============================================================
-- 0. Helpers de sesión y guards
-- ============================================================
DROP FUNCTION IF EXISTS public.session_centro_id();
DROP FUNCTION IF EXISTS public.session_role();
DROP FUNCTION IF EXISTS public.session_user_id();
DROP FUNCTION IF EXISTS public.assert_actor_asignado();
DROP FUNCTION IF EXISTS public.assert_oficina();
DROP FUNCTION IF EXISTS public.assert_admin_dev();
DROP FUNCTION IF EXISTS public.v_sesion();

CREATE OR REPLACE FUNCTION public.v_sesion()
RETURNS TABLE (
    user_id uuid,
    role public.role_enum,
    centro_id uuid,
    is_authenticated boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_claims jsonb;
    v_role_text text;
BEGIN
    user_id := NULL;
    role := NULL;
    centro_id := NULL;
    is_authenticated := FALSE;

    BEGIN
        v_claims := auth.jwt();
    EXCEPTION WHEN undefined_function THEN
        v_claims := NULL;
    END;

    IF v_claims IS NOT NULL THEN
        IF v_claims ? 'user_id' THEN
            BEGIN
                user_id := NULLIF(v_claims ->> 'user_id', '')::uuid;
            EXCEPTION WHEN others THEN
                user_id := NULL;
            END;
        ELSIF v_claims ? 'sub' THEN
            BEGIN
                user_id := NULLIF(v_claims ->> 'sub', '')::uuid;
            EXCEPTION WHEN others THEN
                user_id := NULL;
            END;
        END IF;

        v_role_text := lower(v_claims ->> 'role');
        IF v_role_text IS NOT NULL THEN
            BEGIN
                role := v_role_text::public.role_enum;
            EXCEPTION WHEN others THEN
                role := NULL;
            END;
        END IF;

        IF v_claims ? 'centro_id' THEN
            BEGIN
                centro_id := NULLIF(v_claims ->> 'centro_id', '')::uuid;
            EXCEPTION WHEN others THEN
                centro_id := NULL;
            END;
        END IF;
    END IF;

    IF user_id IS NULL THEN
        BEGIN
            user_id := auth.uid();
        EXCEPTION WHEN undefined_function THEN
            user_id := NULL;
        WHEN others THEN
            user_id := NULL;
        END;
    END IF;

    IF user_id IS NOT NULL THEN
        is_authenticated := TRUE;
        IF role IS NULL OR (role = 'centro' AND centro_id IS NULL) THEN
            SELECT p.role, p.centro_id
            INTO role, centro_id
            FROM public.profiles p
            WHERE p.user_id = user_id;
        END IF;
    END IF;

    RETURN QUERY
    SELECT user_id, role, centro_id, is_authenticated;
END;
$$;

CREATE OR REPLACE FUNCTION public.session_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT user_id FROM public.v_sesion() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.session_role()
RETURNS public.role_enum
LANGUAGE sql
STABLE
AS $$
    SELECT role FROM public.v_sesion() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.session_centro_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT centro_id FROM public.v_sesion() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_dev()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role public.role_enum;
BEGIN
    SELECT public.session_role() INTO v_role;
    IF v_role IS DISTINCT FROM 'admin' AND v_role IS DISTINCT FROM 'dev' THEN
        RAISE EXCEPTION 'Acceso restringido a administradores o desarrolladores.'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_oficina()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role public.role_enum;
BEGIN
    SELECT public.session_role() INTO v_role;
    IF v_role NOT IN ('admin', 'dev', 'oficina') THEN
        RAISE EXCEPTION 'Acceso restringido a oficina/administración.'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_actor_asignado()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role public.role_enum;
    v_centro uuid;
BEGIN
    SELECT public.session_role(), public.session_centro_id()
    INTO v_role, v_centro;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada.' USING ERRCODE = '42501';
    END IF;

    IF v_role = 'centro' AND v_centro IS NULL THEN
        RAISE EXCEPTION 'Centro sin asignación activa.' USING ERRCODE = '42501';
    END IF;
END;
$$;

-- ============================================================
-- 1. Policies RLS
-- ============================================================
-- Empresas
DROP POLICY IF EXISTS empresas_select_admin_dev ON public.empresas;
DROP POLICY IF EXISTS empresas_select_centro ON public.empresas;
DROP POLICY IF EXISTS empresas_modify_admin_dev ON public.empresas;

CREATE POLICY empresas_select_admin_dev
    ON public.empresas
    FOR SELECT
    USING (public.session_role() IN ('admin', 'dev', 'oficina'));

CREATE POLICY empresas_select_centro
    ON public.empresas
    FOR SELECT
    USING (
        public.session_role() = 'centro'
        AND EXISTS (
            SELECT 1
            FROM public.centros c
            WHERE c.empresa_id = public.empresas.id
              AND c.id = public.session_centro_id()
        )
    );

CREATE POLICY empresas_modify_admin_dev
    ON public.empresas
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev'))
    WITH CHECK (public.session_role() IN ('admin', 'dev'));

-- Zonas
DROP POLICY IF EXISTS zonas_select_admin_dev ON public.zonas;
DROP POLICY IF EXISTS zonas_select_centro ON public.zonas;
DROP POLICY IF EXISTS zonas_modify_admin_dev ON public.zonas;

CREATE POLICY zonas_select_admin_dev
    ON public.zonas
    FOR SELECT
    USING (public.session_role() IN ('admin', 'dev', 'oficina'));

CREATE POLICY zonas_select_centro
    ON public.zonas
    FOR SELECT
    USING (
        public.session_role() = 'centro'
        AND public.session_centro_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.centros c
            WHERE c.zona_id = public.zonas.id
              AND c.id = public.session_centro_id()
        )
    );

CREATE POLICY zonas_modify_admin_dev
    ON public.zonas
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev'))
    WITH CHECK (public.session_role() IN ('admin', 'dev'));

-- Centros
DROP POLICY IF EXISTS centros_select_roles ON public.centros;
DROP POLICY IF EXISTS centros_modify_admin_dev ON public.centros;

CREATE POLICY centros_select_roles
    ON public.centros
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (public.session_role() = 'centro' AND public.session_centro_id() = public.centros.id)
    );

CREATE POLICY centros_modify_admin_dev
    ON public.centros
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev'))
    WITH CHECK (public.session_role() IN ('admin', 'dev'));

-- Profiles
DROP POLICY IF EXISTS profiles_select_roles ON public.profiles;
DROP POLICY IF EXISTS profiles_modify_admin_dev ON public.profiles;

CREATE POLICY profiles_select_roles
    ON public.profiles
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR public.session_user_id() = public.profiles.user_id
    );

CREATE POLICY profiles_modify_admin_dev
    ON public.profiles
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev'))
    WITH CHECK (public.session_role() IN ('admin', 'dev'));

-- Profile_private
DROP POLICY IF EXISTS profile_private_select_roles ON public.profile_private;
DROP POLICY IF EXISTS profile_private_modify_admin_dev ON public.profile_private;

CREATE POLICY profile_private_select_roles
    ON public.profile_private
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR public.session_user_id() = public.profile_private.user_id
    );

CREATE POLICY profile_private_modify_admin_dev
    ON public.profile_private
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev'))
    WITH CHECK (public.session_role() IN ('admin', 'dev'));

-- Pilot situaciones
DROP POLICY IF EXISTS pilot_situaciones_select_roles ON public.pilot_situaciones;
DROP POLICY IF EXISTS pilot_situaciones_modify_roles ON public.pilot_situaciones;

CREATE POLICY pilot_situaciones_select_roles
    ON public.pilot_situaciones
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR public.session_user_id() = public.pilot_situaciones.user_id
    );

CREATE POLICY pilot_situaciones_modify_roles
    ON public.pilot_situaciones
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Componentes
DROP POLICY IF EXISTS componentes_select_roles ON public.componentes;
DROP POLICY IF EXISTS componentes_modify_admin_dev ON public.componentes;

CREATE POLICY componentes_select_roles
    ON public.componentes
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND (
                public.componentes.centro_id = public.session_centro_id()
                OR EXISTS (
                    SELECT 1
                    FROM public.equipo_componente ec
                    JOIN public.equipos e ON e.id = ec.equipo_id
                    WHERE ec.componente_id = public.componentes.id
                      AND ec.vigente
                      AND e.centro_id = public.session_centro_id()
                )
            )
        )
    );

CREATE POLICY componentes_modify_admin_dev
    ON public.componentes
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Equipos
DROP POLICY IF EXISTS equipos_select_roles ON public.equipos;
DROP POLICY IF EXISTS equipos_modify_roles ON public.equipos;

CREATE POLICY equipos_select_roles
    ON public.equipos
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND public.session_centro_id() = public.equipos.centro_id
        )
    );

CREATE POLICY equipos_modify_roles
    ON public.equipos
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Equipo componente
DROP POLICY IF EXISTS equipo_componente_select_roles ON public.equipo_componente;
DROP POLICY IF EXISTS equipo_componente_modify_roles ON public.equipo_componente;

CREATE POLICY equipo_componente_select_roles
    ON public.equipo_componente
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND EXISTS (
                SELECT 1
                FROM public.equipos e
                WHERE e.id = public.equipo_componente.equipo_id
                  AND e.centro_id = public.session_centro_id()
            )
        )
    );

CREATE POLICY equipo_componente_modify_roles
    ON public.equipo_componente
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Préstamos
DROP POLICY IF EXISTS prestamos_select_roles ON public.prestamos_intra;
DROP POLICY IF EXISTS prestamos_modify_roles ON public.prestamos_intra;

CREATE POLICY prestamos_select_roles
    ON public.prestamos_intra
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND (
                public.prestamos_intra.centro_origen_id = public.session_centro_id()
                OR public.prestamos_intra.centro_destino_id = public.session_centro_id()
                OR EXISTS (
                    SELECT 1
                    FROM public.equipos e
                    WHERE e.id = public.prestamos_intra.equipo_id
                      AND e.centro_id = public.session_centro_id()
                )
            )
        )
    );

CREATE POLICY prestamos_modify_roles
    ON public.prestamos_intra
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Movimientos
DROP POLICY IF EXISTS movimientos_select_roles ON public.movimientos;
DROP POLICY IF EXISTS movimientos_modify_roles ON public.movimientos;

CREATE POLICY movimientos_select_roles
    ON public.movimientos
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND (
                public.movimientos.centro_origen_id = public.session_centro_id()
                OR public.movimientos.centro_destino_id = public.session_centro_id()
                OR EXISTS (
                    SELECT 1
                    FROM public.equipos e
                    WHERE e.id = public.movimientos.equipo_id
                      AND e.centro_id = public.session_centro_id()
                )
            )
        )
    );

CREATE POLICY movimientos_modify_roles
    ON public.movimientos
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Bitácora
DROP POLICY IF EXISTS bitacora_select_roles ON public.bitacora;
DROP POLICY IF EXISTS bitacora_modify_roles ON public.bitacora;

CREATE POLICY bitacora_select_roles
    ON public.bitacora
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND (
                public.bitacora.centro_id = public.session_centro_id()
                OR EXISTS (
                    SELECT 1
                    FROM public.equipos e
                    WHERE e.id = public.bitacora.equipo_id
                      AND e.centro_id = public.session_centro_id()
                )
            )
        )
    );

CREATE POLICY bitacora_modify_roles
    ON public.bitacora
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Bitácora items
DROP POLICY IF EXISTS bitacora_items_select_roles ON public.bitacora_items;
DROP POLICY IF EXISTS bitacora_items_modify_roles ON public.bitacora_items;

CREATE POLICY bitacora_items_select_roles
    ON public.bitacora_items
    FOR SELECT
    USING (
        public.session_role() IN ('admin', 'dev', 'oficina')
        OR (
            public.session_role() = 'centro'
            AND EXISTS (
                SELECT 1
                FROM public.bitacora b
                WHERE b.id = public.bitacora_items.bitacora_id
                  AND (
                    b.centro_id = public.session_centro_id()
                    OR EXISTS (
                        SELECT 1
                        FROM public.equipos e
                        WHERE e.id = b.equipo_id
                          AND e.centro_id = public.session_centro_id()
                    )
                )
            )
        )
    );

CREATE POLICY bitacora_items_modify_roles
    ON public.bitacora_items
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev', 'oficina'))
    WITH CHECK (public.session_role() IN ('admin', 'dev', 'oficina'));

-- Audit event
DROP POLICY IF EXISTS audit_event_select_admin_dev ON public.audit_event;
DROP POLICY IF EXISTS audit_event_modify_admin_dev ON public.audit_event;

CREATE POLICY audit_event_select_admin_dev
    ON public.audit_event
    FOR SELECT
    USING (public.session_role() IN ('admin', 'dev'));

CREATE POLICY audit_event_modify_admin_dev
    ON public.audit_event
    FOR ALL
    USING (public.session_role() IN ('admin', 'dev'))
    WITH CHECK (public.session_role() IN ('admin', 'dev'));

-- ============================================================
-- 2. RPCs
-- ============================================================
DROP FUNCTION IF EXISTS public.rpc_equipo_crear(text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_equipo_crear(
    p_codigo text,
    p_nombre text,
    p_centro_id uuid,
    p_descripcion text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_id uuid;
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    INSERT INTO public.equipos (codigo, nombre, centro_id, descripcion)
    VALUES (p_codigo, p_nombre, p_centro_id, p_descripcion)
    RETURNING id INTO v_id;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'equipo.crear',
        jsonb_build_object('equipo_id', v_id, 'codigo', p_codigo, 'centro_id', p_centro_id),
        v_actor
    );

    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_equipo_agregar_componente(uuid, uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.rpc_equipo_agregar_componente(
    p_equipo_id uuid,
    p_componente_id uuid,
    p_asignado_desde timestamptz DEFAULT timezone('UTC', now())
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_id uuid;
    v_actor uuid := public.session_user_id();
    v_equipo_centro uuid;
BEGIN
    PERFORM public.assert_oficina();

    SELECT centro_id INTO v_equipo_centro FROM public.equipos WHERE id = p_equipo_id;

    INSERT INTO public.equipo_componente (equipo_id, componente_id, asignado_desde)
    VALUES (p_equipo_id, p_componente_id, p_asignado_desde)
    RETURNING id INTO v_id;

    IF v_equipo_centro IS NOT NULL THEN
        UPDATE public.componentes
        SET centro_id = v_equipo_centro,
            updated_at = timezone('UTC', now())
        WHERE id = p_componente_id;
    END IF;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'equipo.agregar_componente',
        jsonb_build_object('equipo_id', p_equipo_id, 'componente_id', p_componente_id, 'equipo_componente_id', v_id),
        v_actor
    );

    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_equipo_quitar_componente(uuid, uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.rpc_equipo_quitar_componente(
    p_equipo_id uuid,
    p_componente_id uuid,
    p_asignado_hasta timestamptz DEFAULT timezone('UTC', now())
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    UPDATE public.equipo_componente
    SET asignado_hasta = p_asignado_hasta
    WHERE equipo_id = p_equipo_id
      AND componente_id = p_componente_id
      AND vigente
    RETURNING id;

    UPDATE public.componentes
    SET centro_id = NULL,
        updated_at = timezone('UTC', now())
    WHERE id = p_componente_id;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'equipo.quitar_componente',
        jsonb_build_object('equipo_id', p_equipo_id, 'componente_id', p_componente_id, 'asignado_hasta', p_asignado_hasta),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_componente_baja_logica(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_componente_baja_logica(
    p_componente_id uuid,
    p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    UPDATE public.componentes
    SET vigente = FALSE,
        updated_at = timezone('UTC', now()),
        metadata = metadata || jsonb_build_object('baja_motivo', p_motivo, 'baja_en', timezone('UTC', now()))
    WHERE id = p_componente_id;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'componente.baja_logica',
        jsonb_build_object('componente_id', p_componente_id, 'motivo', p_motivo),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_prestamo_crear(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_prestamo_crear(
    p_equipo_id uuid,
    p_centro_destino uuid,
    p_notas text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_id uuid;
    v_origen uuid;
    v_actor uuid := public.session_user_id();
    v_role public.role_enum := public.session_role();
BEGIN
    IF v_role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
    ELSE
        PERFORM public.assert_oficina();
    END IF;

    SELECT centro_id INTO v_origen FROM public.equipos WHERE id = p_equipo_id;

    IF v_role = 'centro' AND v_origen IS DISTINCT FROM public.session_centro_id() THEN
        RAISE EXCEPTION 'El centro actual no puede crear préstamos para este equipo.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.prestamos_intra (equipo_id, solicitante_id, centro_origen_id, centro_destino_id, notas)
    VALUES (p_equipo_id, v_actor, v_origen, p_centro_destino, p_notas)
    RETURNING id INTO v_id;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'prestamo.crear',
        jsonb_build_object('prestamo_id', v_id, 'equipo_id', p_equipo_id, 'centro_destino_id', p_centro_destino),
        v_actor
    );

    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_prestamo_definitivo(uuid);
CREATE OR REPLACE FUNCTION public.rpc_prestamo_definitivo(
    p_prestamo_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    UPDATE public.prestamos_intra
    SET estado = 'definitivo',
        definitivo_en = timezone('UTC', now())
    WHERE id = p_prestamo_id
      AND estado = 'pendiente';

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'prestamo.definitivo',
        jsonb_build_object('prestamo_id', p_prestamo_id),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_prestamo_devolver(uuid);
CREATE OR REPLACE FUNCTION public.rpc_prestamo_devolver(
    p_prestamo_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    UPDATE public.prestamos_intra
    SET estado = 'devuelto',
        devuelto_en = timezone('UTC', now())
    WHERE id = p_prestamo_id;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'prestamo.devolver',
        jsonb_build_object('prestamo_id', p_prestamo_id),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_crear(uuid, uuid, uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.rpc_movimiento_crear(
    p_prestamo_id uuid,
    p_equipo_id uuid,
    p_centro_destino uuid,
    p_reparacion_externa boolean DEFAULT false,
    p_notas text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_id uuid;
    v_origen uuid;
    v_actor uuid := public.session_user_id();
    v_role public.role_enum := public.session_role();
BEGIN
    IF p_reparacion_externa AND v_role NOT IN ('admin', 'dev', 'oficina') THEN
        RAISE EXCEPTION 'Solo oficina puede marcar reparación externa.' USING ERRCODE = '42501';
    END IF;

    IF v_role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
    ELSE
        PERFORM public.assert_oficina();
    END IF;

    SELECT centro_id INTO v_origen FROM public.equipos WHERE id = p_equipo_id;

    IF v_role = 'centro' AND v_origen IS DISTINCT FROM public.session_centro_id() THEN
        RAISE EXCEPTION 'No puedes generar movimientos para equipos de otro centro.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.movimientos (prestamo_id, equipo_id, centro_origen_id, centro_destino_id, reparacion_externa, notas, creado_por)
    VALUES (p_prestamo_id, p_equipo_id, v_origen, p_centro_destino, p_reparacion_externa, p_notas, v_actor)
    RETURNING id INTO v_id;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'movimiento.crear',
        jsonb_build_object('movimiento_id', v_id, 'equipo_id', p_equipo_id, 'centro_destino_id', p_centro_destino, 'prestamo_id', p_prestamo_id),
        v_actor
    );

    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_enviar(uuid);
CREATE OR REPLACE FUNCTION public.rpc_movimiento_enviar(
    p_movimiento_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    UPDATE public.movimientos
    SET estado = 'en_transito',
        enviado_por = v_actor,
        enviado_en = timezone('UTC', now()),
        centro_origen_id = COALESCE(centro_origen_id, (SELECT centro_id FROM public.equipos WHERE id = public.movimientos.equipo_id))
    WHERE id = p_movimiento_id
      AND estado = 'pendiente';

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'movimiento.enviar',
        jsonb_build_object('movimiento_id', p_movimiento_id),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_recibir(uuid);
CREATE OR REPLACE FUNCTION public.rpc_movimiento_recibir(
    p_movimiento_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
    v_destino uuid;
    v_equipo uuid;
    v_prestamo uuid;
BEGIN
    PERFORM public.assert_oficina();

    SELECT centro_destino_id, equipo_id, prestamo_id
    INTO v_destino, v_equipo, v_prestamo
    FROM public.movimientos
    WHERE id = p_movimiento_id;

    UPDATE public.movimientos
    SET estado = 'recibido',
        recibido_por = v_actor,
        recibido_en = timezone('UTC', now()),
        centro_destino_id = COALESCE(centro_destino_id, v_destino)
    WHERE id = p_movimiento_id
      AND estado IN ('pendiente', 'en_transito');

    IF v_destino IS NOT NULL THEN
        UPDATE public.equipos
        SET centro_id = v_destino,
            updated_at = timezone('UTC', now())
        WHERE id = v_equipo;

        UPDATE public.componentes c
        SET centro_id = v_destino,
            updated_at = timezone('UTC', now())
        WHERE c.id IN (
            SELECT ec.componente_id
            FROM public.equipo_componente ec
            WHERE ec.equipo_id = v_equipo
              AND ec.vigente
        );
    END IF;

    IF v_prestamo IS NOT NULL THEN
        UPDATE public.prestamos_intra
        SET estado = 'devuelto',
            devuelto_en = timezone('UTC', now())
        WHERE id = v_prestamo;
    END IF;

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'movimiento.recibir',
        jsonb_build_object('movimiento_id', p_movimiento_id, 'equipo_id', v_equipo, 'centro_destino_id', v_destino, 'prestamo_id', v_prestamo),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_movimiento_cancelar(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_movimiento_cancelar(
    p_movimiento_id uuid,
    p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
BEGIN
    PERFORM public.assert_oficina();

    UPDATE public.movimientos
    SET estado = 'cancelado',
        cancelado_por = v_actor,
        cancelado_en = timezone('UTC', now()),
        notas = COALESCE(notas, '') || CASE WHEN p_motivo IS NOT NULL THEN '\nMotivo cancelación: ' || p_motivo ELSE '' END
    WHERE id = p_movimiento_id
      AND estado IN ('pendiente', 'en_transito');

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'movimiento.cancelar',
        jsonb_build_object('movimiento_id', p_movimiento_id, 'motivo', p_motivo),
        v_actor
    );
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_bitacora_crear(uuid, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_bitacora_crear(
    p_equipo_id uuid,
    p_titulo text,
    p_detalle text,
    p_centro_id uuid DEFAULT NULL,
    p_tipo text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor uuid := public.session_user_id();
    v_role public.role_enum := public.session_role();
    v_centro uuid := p_centro_id;
    v_bitacora uuid;
BEGIN
    IF v_role = 'centro' THEN
        PERFORM public.assert_actor_asignado();
        v_centro := public.session_centro_id();
    ELSE
        PERFORM public.assert_oficina();
        IF v_centro IS NULL THEN
            SELECT centro_id INTO v_centro FROM public.equipos WHERE id = p_equipo_id;
        END IF;
    END IF;

    INSERT INTO public.bitacora (equipo_id, centro_id, titulo, descripcion, autor_user_id)
    VALUES (p_equipo_id, v_centro, p_titulo, p_detalle, v_actor)
    RETURNING id INTO v_bitacora;

    INSERT INTO public.bitacora_items (bitacora_id, detalle, tipo, creado_por)
    VALUES (v_bitacora, p_detalle, p_tipo, v_actor);

    INSERT INTO public.audit_event (event_type, payload, actor_user_id)
    VALUES (
        'bitacora.crear',
        jsonb_build_object('bitacora_id', v_bitacora, 'equipo_id', p_equipo_id, 'centro_id', v_centro),
        v_actor
    );

    RETURN v_bitacora;
END;
$$;

COMMIT;
