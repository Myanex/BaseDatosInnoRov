-- Migración: Estructura base para organización, identidad e inventario
-- Contexto: Proyecto Sistema de Gestión ROV (Supabase)
-- EDI: Implementa tablas núcleo con controles de integridad y RLS habilitado.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('supabase:migrations:20240711090000__estructura_base'));

-- ============================================================
-- 0. Extensiones y tipos base
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'role_enum' AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.role_enum AS ENUM ('dev', 'admin', 'oficina', 'centro');
    ELSE
        FOR v_missing IN
            SELECT val
            FROM unnest(ARRAY['dev', 'admin', 'oficina', 'centro']) AS required(val)
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_enum e
                WHERE e.enumtypid = 'public.role_enum'::regtype
                  AND e.enumlabel = required.val
            )
        LOOP
            EXECUTE format('ALTER TYPE public.role_enum ADD VALUE IF NOT EXISTS %L', v_missing);
        END LOOP;
    END IF;
END;
$$;

-- Tipos auxiliares para inventario y flujos operativos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'equipo_estado' AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.equipo_estado AS ENUM ('vigente', 'no_vigente');
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'prestamo_estado' AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.prestamo_estado AS ENUM ('pendiente', 'definitivo', 'devuelto', 'cancelado');
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'movimiento_estado' AND typnamespace = 'public'::regnamespace
    ) THEN
        CREATE TYPE public.movimiento_estado AS ENUM ('pendiente', 'en_transito', 'recibido', 'cancelado');
    END IF;
END;
$$;

-- ============================================================
-- 1. Organización (empresas → zonas → centros)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.empresas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL,
    nombre text NOT NULL,
    estado text NOT NULL DEFAULT 'activa',
    is_demo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS empresas_slug_idx ON public.empresas (lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS empresas_nombre_idx ON public.empresas (lower(nombre));

CREATE TABLE IF NOT EXISTS public.zonas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    codigo text NOT NULL,
    nombre text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    UNIQUE (empresa_id, codigo),
    UNIQUE (empresa_id, nombre)
);

CREATE UNIQUE INDEX IF NOT EXISTS zonas_empresa_idx ON public.zonas (id, empresa_id);

CREATE TABLE IF NOT EXISTS public.centros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    zona_id uuid REFERENCES public.zonas(id) DEFERRABLE INITIALLY IMMEDIATE,
    codigo text NOT NULL,
    nombre text NOT NULL,
    direccion text,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    UNIQUE (empresa_id, codigo),
    UNIQUE (empresa_id, nombre),
    CONSTRAINT centros_zona_empresa_fk FOREIGN KEY (zona_id, empresa_id)
        REFERENCES public.zonas (id, empresa_id)
        DEFERRABLE INITIALLY IMMEDIATE
);

-- ============================================================
-- 2. Identidad y perfiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id uuid PRIMARY KEY,
    role public.role_enum NOT NULL,
    centro_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    display_name text,
    email text,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    CONSTRAINT profiles_role_centro_chk CHECK (
        role <> 'centro' OR centro_id IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS public.profile_private (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    telefono text,
    datos_personales jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

CREATE TABLE IF NOT EXISTS public.pilot_situaciones (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    situacion text NOT NULL,
    vigente boolean NOT NULL DEFAULT true,
    observaciones text,
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

CREATE OR REPLACE VIEW public.v_pilotos_asignados AS
SELECT p.user_id,
       p.display_name,
    p.centro_id
FROM public.profiles p
WHERE p.role = 'centro' AND p.centro_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_pilotos_no_asignados AS
SELECT p.user_id,
       p.display_name,
       p.centro_id
FROM public.profiles p
WHERE p.role = 'centro' AND p.centro_id IS NULL;

-- ============================================================
-- 3. Inventario (componentes y equipos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.componentes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo text NOT NULL,
    nombre text NOT NULL,
    tipo text NOT NULL CHECK (tipo IN ('rov', 'controlador', 'umbilical', 'sensor', 'grabber', 'periferico')),
    centro_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    vigente boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS componentes_codigo_idx ON public.componentes (lower(codigo));
CREATE INDEX IF NOT EXISTS componentes_tipo_idx ON public.componentes (tipo);

CREATE TABLE IF NOT EXISTS public.equipos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo text NOT NULL,
    nombre text NOT NULL,
    estado public.equipo_estado NOT NULL DEFAULT 'vigente',
    centro_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    descripcion text,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    CONSTRAINT equipos_codigo_largo_chk CHECK (char_length(codigo) <= 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS equipos_codigo_idx ON public.equipos (lower(codigo));
CREATE INDEX IF NOT EXISTS equipos_centro_idx ON public.equipos (centro_id);

CREATE TABLE IF NOT EXISTS public.equipo_componente (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id uuid NOT NULL REFERENCES public.equipos(id) DEFERRABLE INITIALLY IMMEDIATE,
    componente_id uuid NOT NULL REFERENCES public.componentes(id) DEFERRABLE INITIALLY IMMEDIATE,
    asignado_desde timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    asignado_hasta timestamptz,
    vigente boolean GENERATED ALWAYS AS (asignado_hasta IS NULL) STORED,
    CONSTRAINT equipo_componente_interval_chk CHECK (
        asignado_hasta IS NULL OR asignado_hasta >= asignado_desde
    )
);

CREATE INDEX IF NOT EXISTS equipo_componente_equipo_idx ON public.equipo_componente (equipo_id);
CREATE INDEX IF NOT EXISTS equipo_componente_componente_idx ON public.equipo_componente (componente_id);
CREATE UNIQUE INDEX IF NOT EXISTS equipo_componente_componente_vigente_uidx
    ON public.equipo_componente (componente_id)
    WHERE vigente;

CREATE OR REPLACE FUNCTION public.componente_tipo(p_componente_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT c.tipo FROM public.componentes c WHERE c.id = p_componente_id;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS equipo_componente_unicidad_tipo_vigente_uidx
    ON public.equipo_componente (equipo_id, (public.componente_tipo(componente_id)))
    WHERE vigente AND public.componente_tipo(componente_id) IN ('rov', 'controlador', 'umbilical');

-- ============================================================
-- 4. Operativa (préstamos y movimientos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prestamos_intra (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id uuid NOT NULL REFERENCES public.equipos(id) DEFERRABLE INITIALLY IMMEDIATE,
    solicitante_id uuid REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE,
    centro_origen_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    centro_destino_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    estado public.prestamo_estado NOT NULL DEFAULT 'pendiente',
    notas text,
    creado_en timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    definitivo_en timestamptz,
    devuelto_en timestamptz,
    cancelado_en timestamptz
);

CREATE INDEX IF NOT EXISTS prestamos_equipo_idx ON public.prestamos_intra (equipo_id);
CREATE INDEX IF NOT EXISTS prestamos_estado_idx ON public.prestamos_intra (estado);

CREATE TABLE IF NOT EXISTS public.movimientos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prestamo_id uuid REFERENCES public.prestamos_intra(id) DEFERRABLE INITIALLY IMMEDIATE,
    equipo_id uuid NOT NULL REFERENCES public.equipos(id) DEFERRABLE INITIALLY IMMEDIATE,
    centro_origen_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    centro_destino_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    estado public.movimiento_estado NOT NULL DEFAULT 'pendiente',
    reparacion_externa boolean NOT NULL DEFAULT false,
    notas text,
    creado_por uuid REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE,
    creado_en timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    enviado_por uuid REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE,
    enviado_en timestamptz,
    recibido_por uuid REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE,
    recibido_en timestamptz,
    cancelado_por uuid REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE,
    cancelado_en timestamptz
);

CREATE INDEX IF NOT EXISTS movimientos_equipo_idx ON public.movimientos (equipo_id);
CREATE INDEX IF NOT EXISTS movimientos_estado_idx ON public.movimientos (estado);
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_equipo_activo_uidx
    ON public.movimientos (equipo_id)
    WHERE estado IN ('pendiente', 'en_transito');

-- ============================================================
-- 5. Bitácora y auditoría
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bitacora (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id uuid REFERENCES public.equipos(id) DEFERRABLE INITIALLY IMMEDIATE,
    centro_id uuid REFERENCES public.centros(id) DEFERRABLE INITIALLY IMMEDIATE,
    titulo text NOT NULL,
    descripcion text,
    autor_user_id uuid NOT NULL REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE,
    creado_en timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

CREATE INDEX IF NOT EXISTS bitacora_equipo_idx ON public.bitacora (equipo_id);
CREATE INDEX IF NOT EXISTS bitacora_centro_idx ON public.bitacora (centro_id);

CREATE TABLE IF NOT EXISTS public.bitacora_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bitacora_id uuid NOT NULL REFERENCES public.bitacora(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    detalle text NOT NULL,
    tipo text,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
    creado_por uuid REFERENCES public.profiles(user_id) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS bitacora_items_bitacora_idx ON public.bitacora_items (bitacora_id);

CREATE TABLE IF NOT EXISTS public.audit_event (
    id bigserial PRIMARY KEY,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT timezone('UTC', now())
);

CREATE INDEX IF NOT EXISTS audit_event_event_type_idx ON public.audit_event (event_type);
CREATE INDEX IF NOT EXISTS audit_event_actor_idx ON public.audit_event (actor_user_id);

-- ============================================================
-- 6. Habilitar RLS (policies definidas en migración posterior)
-- ============================================================
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.centros ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.pilot_situaciones ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.componentes ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.equipo_componente ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.prestamos_intra ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.bitacora_items ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.
ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY; -- EDI: policies en RLS.

COMMIT;
