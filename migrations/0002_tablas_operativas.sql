-- Migración: Tablas operativas, catálogos y auditoría mínima
-- Contexto: Proyecto Sistema de Gestión ROV (Supabase)
-- EDI: Greenfield (continuación). Se valida idempotencia y bloqueos globales.

BEGIN;

-- Adquiere candado para evitar condiciones de carrera durante la migración
SELECT pg_advisory_xact_lock(hashtext('migrations:0002_tablas_operativas'));

-- ============================================================
-- 0. Extensiones y helpers reutilizables
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Actualiza role_enum con rol de desarrollo si aún no existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'role_enum'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            WHERE e.enumtypid = 'public.role_enum'::regtype
              AND e.enumlabel = 'dev'
        ) THEN
            ALTER TYPE public.role_enum ADD VALUE 'dev' BEFORE 'admin';
        END IF;
    ELSE
        CREATE TYPE public.role_enum AS ENUM ('dev', 'admin', 'oficina', 'centro');
    END IF;
END;
$$;

-- Función utilitaria para mantener updated_at coherente en tablas con historial
DROP FUNCTION IF EXISTS public.trg_set_updated_at();
CREATE FUNCTION public.trg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- ============================================================
-- 1. Organización: empresas → zonas → centros
-- ============================================================
CREATE TABLE IF NOT EXISTS public.empresas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre text NOT NULL UNIQUE,
    slug text NOT NULL UNIQUE,
    estado text NOT NULL DEFAULT 'activa',
    is_demo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_empresas_updated_at ON public.empresas;
CREATE TRIGGER trg_empresas_updated_at
BEFORE UPDATE ON public.empresas
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.zonas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nombre text NOT NULL,
    slug text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT zonas_nombre_unq UNIQUE (empresa_id, nombre),
    CONSTRAINT zonas_slug_unq UNIQUE (empresa_id, slug)
);

DROP TRIGGER IF EXISTS trg_zonas_updated_at ON public.zonas;
CREATE TRIGGER trg_zonas_updated_at
BEFORE UPDATE ON public.zonas
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.centros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    zona_id uuid NOT NULL REFERENCES public.zonas(id) ON DELETE RESTRICT,
    nombre text NOT NULL UNIQUE,
    slug text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT centros_empresa_zona_chk CHECK (
        EXISTS (
            SELECT 1
            FROM public.zonas z
            WHERE z.id = zona_id
              AND z.empresa_id = empresa_id
        )
    )
);

DROP TRIGGER IF EXISTS trg_centros_updated_at ON public.centros;
CREATE TRIGGER trg_centros_updated_at
BEFORE UPDATE ON public.centros
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

-- Vincula profiles.centro_id hacia centros.id ahora que la tabla existe
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_centro_id_fkey;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_centro_id_fkey
    FOREIGN KEY (centro_id)
    REFERENCES public.centros(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- 2. Catálogos y enums operativos
-- ============================================================
DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'component_tipo_enum'
    ) THEN
        CREATE TYPE public.component_tipo_enum AS ENUM (
            'rov', 'controlador', 'umbilical', 'sensor', 'grabber', 'herramienta', 'accesorio'
        );
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['rov','controlador','umbilical','sensor','grabber','herramienta','accesorio']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.component_tipo_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'component_tipo_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'operatividad_enum'
    ) THEN
        CREATE TYPE public.operatividad_enum AS ENUM ('operativo', 'limitado', 'no_operativo', 'en_mantenimiento');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['operativo','limitado','no_operativo','en_mantenimiento']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.operatividad_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'operatividad_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'condicion_enum'
    ) THEN
        CREATE TYPE public.condicion_enum AS ENUM ('nuevo', 'bueno', 'regular', 'defectuoso');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['nuevo','bueno','regular','defectuoso']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.condicion_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'condicion_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'ubicacion_enum'
    ) THEN
        CREATE TYPE public.ubicacion_enum AS ENUM ('centro', 'bodega', 'transito', 'reparacion_externa', 'proveedor', 'cliente');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['centro','bodega','transito','reparacion_externa','proveedor','cliente']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.ubicacion_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'ubicacion_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'equipo_estado_enum'
    ) THEN
        CREATE TYPE public.equipo_estado_enum AS ENUM ('vigente', 'no_vigente');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['vigente','no_vigente']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.equipo_estado_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'equipo_estado_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'equipo_rol_enum'
    ) THEN
        CREATE TYPE public.equipo_rol_enum AS ENUM ('principal', 'backup');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['principal','backup']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.equipo_rol_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'equipo_rol_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'prestamo_estado_enum'
    ) THEN
        CREATE TYPE public.prestamo_estado_enum AS ENUM ('borrador', 'activo', 'cerrado', 'cancelado');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['borrador','activo','cerrado','cancelado']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.prestamo_estado_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'prestamo_estado_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'movimiento_tipo_enum'
    ) THEN
        CREATE TYPE public.movimiento_tipo_enum AS ENUM ('traslado', 'devolucion', 'reparacion_externa', 'prestamo');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['traslado','devolucion','reparacion_externa','prestamo']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.movimiento_tipo_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'movimiento_tipo_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'movimiento_estado_enum'
    ) THEN
        CREATE TYPE public.movimiento_estado_enum AS ENUM ('pendiente', 'en_transito', 'recibido', 'cancelado');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['pendiente','en_transito','recibido','cancelado']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.movimiento_estado_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'movimiento_estado_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'movimiento_localizacion_enum'
    ) THEN
        CREATE TYPE public.movimiento_localizacion_enum AS ENUM ('centro', 'bodega', 'proveedor', 'cliente', 'reparacion_externa', 'base');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['centro','bodega','proveedor','cliente','reparacion_externa','base']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.movimiento_localizacion_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'movimiento_localizacion_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'bitacora_jornada_enum'
    ) THEN
        CREATE TYPE public.bitacora_jornada_enum AS ENUM ('diurna', 'nocturna', 'especial');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['diurna','nocturna','especial']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.bitacora_jornada_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'bitacora_jornada_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'bitacora_estado_puerto_enum'
    ) THEN
        CREATE TYPE public.bitacora_estado_puerto_enum AS ENUM ('abierto', 'cerrado');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['abierto','cerrado']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.bitacora_estado_puerto_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'bitacora_estado_puerto_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'bitacora_actividad_enum'
    ) THEN
        CREATE TYPE public.bitacora_actividad_enum AS ENUM ('operacion', 'mantenimiento', 'capacitacion', 'condicion_puerto_cerrado', 'standby');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['operacion','mantenimiento','capacitacion','condicion_puerto_cerrado','standby']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.bitacora_actividad_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'bitacora_actividad_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

DO $$
DECLARE
    v_missing text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'pilot_situacion_enum'
    ) THEN
        CREATE TYPE public.pilot_situacion_enum AS ENUM ('en_turno', 'descanso', 'licencia', 'vacaciones', 'sin_centro', 'en_spot');
    ELSE
        SELECT val INTO v_missing
        FROM unnest(ARRAY['en_turno','descanso','licencia','vacaciones','sin_centro','en_spot']) AS required(val)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e
            WHERE e.enumtypid = 'public.pilot_situacion_enum'::regtype
              AND e.enumlabel = required.val
        )
        LIMIT 1;
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'pilot_situacion_enum carece de valor requerido: %', v_missing;
        END IF;
    END IF;
END;
$$;

-- ============================================================
-- 3. Datos sensibles de perfiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profile_private (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    nombres text,
    apellidos text,
    documento_identidad text,
    telefono text,
    direccion text,
    informacion_medica jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profile_private_updated_at ON public.profile_private;
CREATE TRIGGER trg_profile_private_updated_at
BEFORE UPDATE ON public.profile_private
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Solo admin/dev/oficina podrán consultar profile_private.

-- ============================================================
-- 4. Inventario: componentes → equipos → equipo_componente
-- ============================================================
CREATE TABLE IF NOT EXISTS public.componentes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    zona_id uuid REFERENCES public.zonas(id) ON DELETE SET NULL,
    centro_id uuid REFERENCES public.centros(id) ON DELETE SET NULL,
    tipo public.component_tipo_enum NOT NULL,
    nombre text NOT NULL,
    codigo text NOT NULL UNIQUE,
    serie text UNIQUE,
    descripcion text,
    operatividad public.operatividad_enum NOT NULL DEFAULT 'operativo',
    condicion public.condicion_enum NOT NULL DEFAULT 'bueno',
    ubicacion public.ubicacion_enum NOT NULL,
    ubicacion_detalle text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT componentes_zona_empresa_chk CHECK (
        zona_id IS NULL OR EXISTS (
            SELECT 1 FROM public.zonas z WHERE z.id = zona_id AND z.empresa_id = empresa_id
        )
    ),
    CONSTRAINT componentes_centro_empresa_chk CHECK (
        centro_id IS NULL OR EXISTS (
            SELECT 1 FROM public.centros c WHERE c.id = centro_id AND c.empresa_id = empresa_id
        )
    )
);

DROP TRIGGER IF EXISTS trg_componentes_updated_at ON public.componentes;
CREATE TRIGGER trg_componentes_updated_at
BEFORE UPDATE ON public.componentes
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE INDEX IF NOT EXISTS componentes_empresa_id_idx ON public.componentes(empresa_id);
CREATE INDEX IF NOT EXISTS componentes_centro_id_idx ON public.componentes(centro_id);
CREATE INDEX IF NOT EXISTS componentes_codigo_idx ON public.componentes(codigo);
CREATE INDEX IF NOT EXISTS componentes_serie_idx ON public.componentes(serie);

ALTER TABLE public.componentes ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centros solo sobre registros de su empresa/centro.

CREATE TABLE IF NOT EXISTS public.equipos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    zona_id uuid REFERENCES public.zonas(id) ON DELETE SET NULL,
    centro_id uuid REFERENCES public.centros(id) ON DELETE SET NULL,
    codigo text NOT NULL UNIQUE,
    nombre text NOT NULL,
    estado public.equipo_estado_enum NOT NULL DEFAULT 'vigente',
    operatividad public.operatividad_enum NOT NULL DEFAULT 'operativo',
    condicion public.condicion_enum NOT NULL DEFAULT 'bueno',
    rol public.equipo_rol_enum,
    ubicacion public.ubicacion_enum NOT NULL,
    ubicacion_detalle text,
    notas text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT equipos_zona_empresa_chk CHECK (
        zona_id IS NULL OR EXISTS (
            SELECT 1 FROM public.zonas z WHERE z.id = zona_id AND z.empresa_id = empresa_id
        )
    ),
    CONSTRAINT equipos_centro_empresa_chk CHECK (
        centro_id IS NULL OR EXISTS (
            SELECT 1 FROM public.centros c WHERE c.id = centro_id AND c.empresa_id = empresa_id
        )
    )
);

DROP TRIGGER IF EXISTS trg_equipos_updated_at ON public.equipos;
CREATE TRIGGER trg_equipos_updated_at
BEFORE UPDATE ON public.equipos
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE INDEX IF NOT EXISTS equipos_empresa_id_idx ON public.equipos(empresa_id);
CREATE INDEX IF NOT EXISTS equipos_centro_id_idx ON public.equipos(centro_id);
CREATE INDEX IF NOT EXISTS equipos_codigo_idx ON public.equipos(codigo);

ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centros solo sobre registros alineados con v_sesion().

CREATE TABLE IF NOT EXISTS public.equipo_componente (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipo_id uuid NOT NULL REFERENCES public.equipos(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    componente_id uuid NOT NULL REFERENCES public.componentes(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    rol_componente public.component_tipo_enum NOT NULL,
    fecha_asignacion timestamptz NOT NULL DEFAULT now(),
    fecha_desasignacion timestamptz,
    notas text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT equipo_componente_fechas_chk CHECK (fecha_desasignacion IS NULL OR fecha_desasignacion > fecha_asignacion)
);

DROP TRIGGER IF EXISTS trg_equipo_componente_updated_at ON public.equipo_componente;
CREATE TRIGGER trg_equipo_componente_updated_at
BEFORE UPDATE ON public.equipo_componente
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS equipo_componente_componente_activo_unq
    ON public.equipo_componente(componente_id)
    WHERE fecha_desasignacion IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS equipo_componente_rol_unico_activo
    ON public.equipo_componente(equipo_id, rol_componente)
    WHERE fecha_desasignacion IS NULL
      AND rol_componente IN ('rov','controlador','umbilical');

CREATE INDEX IF NOT EXISTS equipo_componente_lookup_idx
    ON public.equipo_componente(equipo_id, rol_componente, fecha_desasignacion);

ALTER TABLE public.equipo_componente ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centros sólo componentes ligados a su equipo vigente.

-- ============================================================
-- 5. Operativa: préstamos intra y movimientos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.prestamos_intra (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
    equipo_origen_id uuid NOT NULL REFERENCES public.equipos(id) ON DELETE RESTRICT,
    equipo_destino_id uuid REFERENCES public.equipos(id) ON DELETE RESTRICT,
    componente_id uuid NOT NULL REFERENCES public.componentes(id) ON DELETE RESTRICT,
    estado public.prestamo_estado_enum NOT NULL DEFAULT 'activo',
    motivo text,
    responsable_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE RESTRICT,
    fecha_inicio timestamptz NOT NULL DEFAULT now(),
    fecha_compromiso timestamptz,
    fecha_cierre timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT prestamos_intra_equipo_destino_chk CHECK (
        equipo_destino_id IS NULL OR EXISTS (
            SELECT 1 FROM public.equipos eq
            WHERE eq.id = equipo_destino_id AND eq.centro_id = centro_id
        )
    ),
    CONSTRAINT prestamos_intra_equipo_origen_chk CHECK (
        EXISTS (
            SELECT 1 FROM public.equipos eq
            WHERE eq.id = equipo_origen_id AND eq.centro_id = centro_id
        )
    ),
    CONSTRAINT prestamos_intra_equipo_empresa_chk CHECK (
        EXISTS (
            SELECT 1 FROM public.equipos eq
            WHERE eq.id = equipo_origen_id AND eq.empresa_id = empresa_id
        )
    ),
    CONSTRAINT prestamos_intra_equipo_destino_empresa_chk CHECK (
        equipo_destino_id IS NULL OR EXISTS (
            SELECT 1 FROM public.equipos eq
            WHERE eq.id = equipo_destino_id AND eq.empresa_id = empresa_id
        )
    ),
    CONSTRAINT prestamos_intra_componente_empresa_chk CHECK (
        EXISTS (
            SELECT 1 FROM public.componentes c
            WHERE c.id = componente_id AND c.empresa_id = empresa_id
        )
    ),
    CONSTRAINT prestamos_intra_fecha_cierre_chk CHECK (
        fecha_cierre IS NULL OR fecha_cierre >= fecha_inicio
    )
);

DROP TRIGGER IF EXISTS trg_prestamos_intra_updated_at ON public.prestamos_intra;
CREATE TRIGGER trg_prestamos_intra_updated_at
BEFORE UPDATE ON public.prestamos_intra
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE INDEX IF NOT EXISTS prestamos_intra_equipo_origen_idx ON public.prestamos_intra(equipo_origen_id);
CREATE INDEX IF NOT EXISTS prestamos_intra_componente_idx ON public.prestamos_intra(componente_id);
CREATE INDEX IF NOT EXISTS prestamos_intra_estado_idx ON public.prestamos_intra(estado);

CREATE UNIQUE INDEX IF NOT EXISTS prestamos_intra_componente_activo_unq
    ON public.prestamos_intra(componente_id)
    WHERE estado = 'activo';

ALTER TABLE public.prestamos_intra ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centro asignado sólo vía RPC autorizadas.

CREATE TABLE IF NOT EXISTS public.movimientos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    centro_origen_id uuid REFERENCES public.centros(id) ON DELETE SET NULL,
    centro_destino_id uuid REFERENCES public.centros(id) ON DELETE SET NULL,
    origen_tipo public.movimiento_localizacion_enum,
    destino_tipo public.movimiento_localizacion_enum,
    tipo public.movimiento_tipo_enum NOT NULL,
    estado public.movimiento_estado_enum NOT NULL DEFAULT 'pendiente',
    equipo_id uuid REFERENCES public.equipos(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    componente_id uuid REFERENCES public.componentes(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    responsable_origen_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    responsable_destino_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    fecha_envio timestamptz,
    fecha_recepcion timestamptz,
    motivo text,
    notas text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT movimientos_objeto_xor_chk CHECK (
        (equipo_id IS NOT NULL AND componente_id IS NULL)
        OR (equipo_id IS NULL AND componente_id IS NOT NULL)
    ),
    CONSTRAINT movimientos_equipo_empresa_chk CHECK (
        equipo_id IS NULL OR EXISTS (
            SELECT 1 FROM public.equipos eq
            WHERE eq.id = equipo_id AND eq.empresa_id = empresa_id
        )
    ),
    CONSTRAINT movimientos_componente_empresa_chk CHECK (
        componente_id IS NULL OR EXISTS (
            SELECT 1 FROM public.componentes c
            WHERE c.id = componente_id AND c.empresa_id = empresa_id
        )
    ),
    CONSTRAINT movimientos_fechas_chk CHECK (
        fecha_recepcion IS NULL OR (fecha_envio IS NULL OR fecha_recepcion >= fecha_envio)
    )
);

DROP TRIGGER IF EXISTS trg_movimientos_updated_at ON public.movimientos;
CREATE TRIGGER trg_movimientos_updated_at
BEFORE UPDATE ON public.movimientos
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE INDEX IF NOT EXISTS movimientos_estado_idx ON public.movimientos(estado);
CREATE INDEX IF NOT EXISTS movimientos_equipo_idx ON public.movimientos(equipo_id);
CREATE INDEX IF NOT EXISTS movimientos_componente_idx ON public.movimientos(componente_id);

ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centro asignado restringido a registros de su ámbito.

-- ============================================================
-- 6. Bitácora operativa
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bitacora (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    zona_id uuid REFERENCES public.zonas(id) ON DELETE SET NULL,
    centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
    autor_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE RESTRICT,
    fecha date NOT NULL,
    jornada public.bitacora_jornada_enum NOT NULL,
    estado_puerto public.bitacora_estado_puerto_enum NOT NULL,
    equipo_usado uuid REFERENCES public.equipos(id) ON DELETE SET NULL,
    comentarios text,
    motivo_atraso text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_zona_empresa_chk CHECK (
        zona_id IS NULL OR EXISTS (
            SELECT 1 FROM public.zonas z WHERE z.id = zona_id AND z.empresa_id = empresa_id
        )
    ),
    CONSTRAINT bitacora_centro_empresa_chk CHECK (
        EXISTS (
            SELECT 1 FROM public.centros c WHERE c.id = centro_id AND c.empresa_id = empresa_id
        )
    )
);

DROP TRIGGER IF EXISTS trg_bitacora_updated_at ON public.bitacora;
CREATE TRIGGER trg_bitacora_updated_at
BEFORE UPDATE ON public.bitacora
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE INDEX IF NOT EXISTS bitacora_centro_fecha_idx ON public.bitacora(centro_id, fecha);

ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centro asignado sólo filas con centro_id = v_sesion().centro_id.

CREATE TABLE IF NOT EXISTS public.bitacora_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bitacora_id uuid NOT NULL REFERENCES public.bitacora(id) ON DELETE CASCADE,
    actividad public.bitacora_actividad_enum NOT NULL,
    descripcion text,
    duracion_minutos integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bitacora_items_duracion_chk CHECK (duracion_minutos IS NULL OR duracion_minutos >= 0)
);

ALTER TABLE public.bitacora_items
    DROP CONSTRAINT IF EXISTS bitacora_items_condicion_puerto_chk;
ALTER TABLE public.bitacora_items
    ADD CONSTRAINT bitacora_items_condicion_puerto_chk CHECK (
        actividad <> 'condicion_puerto_cerrado'::public.bitacora_actividad_enum
        OR EXISTS (
            SELECT 1 FROM public.bitacora b
            WHERE b.id = bitacora_id
              AND b.estado_puerto = 'cerrado'::public.bitacora_estado_puerto_enum
        )
    );

DROP TRIGGER IF EXISTS trg_bitacora_items_updated_at ON public.bitacora_items;
CREATE TRIGGER trg_bitacora_items_updated_at
BEFORE UPDATE ON public.bitacora_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE INDEX IF NOT EXISTS bitacora_items_bitacora_id_idx ON public.bitacora_items(bitacora_id);

ALTER TABLE public.bitacora_items ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Items deben heredar reglas de cabecera (JOIN contra bitacora en policies futuras).

-- ============================================================
-- 7. Vida de piloto (historial)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pilot_situaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    situacion public.pilot_situacion_enum NOT NULL,
    fecha_inicio timestamptz NOT NULL DEFAULT now(),
    fecha_fin timestamptz,
    motivo text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pilot_situaciones_fechas_chk CHECK (
        fecha_fin IS NULL OR fecha_fin >= fecha_inicio
    )
);

DROP TRIGGER IF EXISTS trg_pilot_situaciones_updated_at ON public.pilot_situaciones;
CREATE TRIGGER trg_pilot_situaciones_updated_at
BEFORE UPDATE ON public.pilot_situaciones
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS pilot_situaciones_activa_unq
    ON public.pilot_situaciones(user_id)
    WHERE fecha_fin IS NULL;

ALTER TABLE public.pilot_situaciones ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Admin/oficina global; centro asignado sólo registros de su user_id o centro asociado vía RPC.

-- ============================================================
-- 8. Auditoría mínima
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "when" timestamptz NOT NULL DEFAULT now(),
    who_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    role public.role_enum,
    centro_id uuid REFERENCES public.centros(id) ON DELETE SET NULL,
    objeto_tipo text NOT NULL,
    objeto_id uuid,
    accion text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_event_when_idx ON public.audit_event("when");
CREATE INDEX IF NOT EXISTS audit_event_accion_idx ON public.audit_event(accion);
CREATE INDEX IF NOT EXISTS audit_event_objeto_idx ON public.audit_event(objeto_tipo, objeto_id);

ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY;
-- EDI: Policies pendientes. Sólo admin/dev/oficina deberían leer; escrituras mediante triggers/RPC.

-- ============================================================
-- 9. Semilla opcional con guardas
-- ============================================================
DO $$
DECLARE
    v_empresa uuid;
    v_zona uuid;
    v_centro_a uuid;
    v_centro_b uuid;
    v_equipo uuid;
    v_equipo_destino uuid;
    v_componente_rov uuid;
    v_componente_ctrl uuid;
    v_componente_umb uuid;
    v_componente_sensor uuid;
    v_componente_extra uuid;
    v_prestamo uuid;
    v_movimiento uuid;
    v_bitacora uuid;
    v_autor uuid;
    v_piloto_asignado uuid;
    v_piloto_no_asignado uuid;
BEGIN
    -- Empresa demo
    INSERT INTO public.empresas (nombre, slug, estado, is_demo)
    SELECT 'Empresa Demo', 'empresa-demo', 'activa', true
    WHERE NOT EXISTS (SELECT 1 FROM public.empresas WHERE slug = 'empresa-demo');

    SELECT id INTO v_empresa FROM public.empresas WHERE slug = 'empresa-demo';
    IF v_empresa IS NULL THEN
        RETURN;
    END IF;

    -- Zona demo
    INSERT INTO public.zonas (empresa_id, nombre, slug)
    SELECT v_empresa, 'Zona Norte', 'zona-norte'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.zonas WHERE empresa_id = v_empresa AND slug = 'zona-norte'
    );

    SELECT id INTO v_zona FROM public.zonas WHERE empresa_id = v_empresa AND slug = 'zona-norte';

    -- Centros demo
    INSERT INTO public.centros (empresa_id, zona_id, nombre, slug)
    SELECT v_empresa, v_zona, 'Centro Principal', 'centro-principal'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.centros WHERE slug = 'centro-principal'
    );

    INSERT INTO public.centros (empresa_id, zona_id, nombre, slug)
    SELECT v_empresa, v_zona, 'Centro Secundario', 'centro-secundario'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.centros WHERE slug = 'centro-secundario'
    );

    SELECT id INTO v_centro_a FROM public.centros WHERE slug = 'centro-principal';
    SELECT id INTO v_centro_b FROM public.centros WHERE slug = 'centro-secundario';

    -- Componentes base
    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion, ubicacion)
    SELECT v_empresa, v_zona, v_centro_a, 'rov', 'ROV Demo', 'ROV-DEMO-001', 'ROV-SERIAL-001', 'ROV operativo demo', 'centro'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.componentes WHERE codigo = 'ROV-DEMO-001'
    );

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion, ubicacion)
    SELECT v_empresa, v_zona, v_centro_a, 'controlador', 'Controlador Demo', 'CTRL-DEMO-001', 'CTRL-SERIAL-001', 'Controlador principal', 'centro'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.componentes WHERE codigo = 'CTRL-DEMO-001'
    );

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion, ubicacion)
    SELECT v_empresa, v_zona, v_centro_a, 'umbilical', 'Umbilical Demo', 'UMB-DEMO-001', 'UMB-SERIAL-001', 'Umbilical principal', 'centro'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.componentes WHERE codigo = 'UMB-DEMO-001'
    );

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, descripcion, ubicacion)
    SELECT v_empresa, v_zona, v_centro_a, 'sensor', 'Sensor Multihaz', 'SEN-DEMO-001', 'Sensor para pruebas', 'centro'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.componentes WHERE codigo = 'SEN-DEMO-001'
    );

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, descripcion, ubicacion)
    SELECT v_empresa, v_zona, v_centro_a, 'grabber', 'Pinza Respaldo', 'GRB-DEMO-001', 'Pinza disponible para préstamo', 'bodega'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.componentes WHERE codigo = 'GRB-DEMO-001'
    );

    SELECT id INTO v_componente_rov FROM public.componentes WHERE codigo = 'ROV-DEMO-001';
    SELECT id INTO v_componente_ctrl FROM public.componentes WHERE codigo = 'CTRL-DEMO-001';
    SELECT id INTO v_componente_umb FROM public.componentes WHERE codigo = 'UMB-DEMO-001';
    SELECT id INTO v_componente_sensor FROM public.componentes WHERE codigo = 'SEN-DEMO-001';
    SELECT id INTO v_componente_extra FROM public.componentes WHERE codigo = 'GRB-DEMO-001';

    -- Equipos demo
    INSERT INTO public.equipos (empresa_id, zona_id, centro_id, codigo, nombre, ubicacion, rol)
    SELECT v_empresa, v_zona, v_centro_a, 'EQ-DEMO-001', 'Equipo Demo Principal', 'centro', 'principal'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.equipos WHERE codigo = 'EQ-DEMO-001'
    );

    INSERT INTO public.equipos (empresa_id, zona_id, centro_id, codigo, nombre, ubicacion, rol)
    SELECT v_empresa, v_zona, v_centro_a, 'EQ-DEMO-002', 'Equipo Demo Respaldo', 'centro', 'backup'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.equipos WHERE codigo = 'EQ-DEMO-002'
    );

    SELECT id INTO v_equipo FROM public.equipos WHERE codigo = 'EQ-DEMO-001';
    SELECT id INTO v_equipo_destino FROM public.equipos WHERE codigo = 'EQ-DEMO-002';

    -- Relaciones equipo - componente
    IF v_equipo IS NOT NULL AND v_componente_rov IS NOT NULL THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente)
        SELECT v_equipo, v_componente_rov, 'rov'
        WHERE NOT EXISTS (
            SELECT 1 FROM public.equipo_componente
            WHERE equipo_id = v_equipo AND componente_id = v_componente_rov AND fecha_desasignacion IS NULL
        );
    END IF;

    IF v_equipo IS NOT NULL AND v_componente_ctrl IS NOT NULL THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente)
        SELECT v_equipo, v_componente_ctrl, 'controlador'
        WHERE NOT EXISTS (
            SELECT 1 FROM public.equipo_componente
            WHERE equipo_id = v_equipo AND componente_id = v_componente_ctrl AND fecha_desasignacion IS NULL
        );
    END IF;

    IF v_equipo IS NOT NULL AND v_componente_umb IS NOT NULL THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente)
        SELECT v_equipo, v_componente_umb, 'umbilical'
        WHERE NOT EXISTS (
            SELECT 1 FROM public.equipo_componente
            WHERE equipo_id = v_equipo AND componente_id = v_componente_umb AND fecha_desasignacion IS NULL
        );
    END IF;

    IF v_equipo IS NOT NULL AND v_componente_sensor IS NOT NULL THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente)
        SELECT v_equipo, v_componente_sensor, 'sensor'
        WHERE NOT EXISTS (
            SELECT 1 FROM public.equipo_componente
            WHERE equipo_id = v_equipo AND componente_id = v_componente_sensor AND fecha_desasignacion IS NULL
        );
    END IF;

    -- Préstamo activo para probar autocierre
    IF v_equipo IS NOT NULL AND v_equipo_destino IS NOT NULL AND v_componente_sensor IS NOT NULL THEN
        INSERT INTO public.prestamos_intra (empresa_id, centro_id, equipo_origen_id, equipo_destino_id, componente_id, estado, motivo, responsable_id)
        SELECT v_empresa, v_centro_a, v_equipo, v_equipo_destino, v_componente_sensor, 'activo', 'Préstamo demo de sensor', p.user_id
        FROM public.profiles p
        WHERE p.centro_id = v_centro_a AND p.role = 'centro'::public.role_enum
        LIMIT 1
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT id INTO v_prestamo FROM public.prestamos_intra
    WHERE componente_id = v_componente_sensor AND estado = 'activo'
    ORDER BY created_at ASC
    LIMIT 1;

    -- Movimiento pendiente
    IF v_equipo IS NOT NULL THEN
        INSERT INTO public.movimientos (empresa_id, centro_origen_id, centro_destino_id, origen_tipo, destino_tipo, tipo, estado, equipo_id, responsable_origen_id, motivo)
        SELECT v_empresa, v_centro_a, v_centro_b, 'centro', 'centro', 'traslado', 'pendiente', v_equipo, p.user_id, 'Traslado demo'
        FROM public.profiles p
        WHERE p.centro_id = v_centro_a AND p.role = 'centro'::public.role_enum
        LIMIT 1
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT id INTO v_movimiento FROM public.movimientos
    WHERE equipo_id = v_equipo
    ORDER BY created_at DESC
    LIMIT 1;

    -- Bitácora demo
    SELECT user_id INTO v_autor
    FROM public.profiles
    WHERE centro_id = v_centro_a
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_autor IS NOT NULL THEN
        INSERT INTO public.bitacora (empresa_id, zona_id, centro_id, autor_user_id, fecha, jornada, estado_puerto, equipo_usado, comentarios)
        SELECT v_empresa, v_zona, v_centro_a, v_autor, current_date, 'diurna', 'abierto', v_equipo, 'Bitácora demo'
        WHERE NOT EXISTS (
            SELECT 1 FROM public.bitacora WHERE centro_id = v_centro_a AND fecha = current_date
        );
    END IF;

    SELECT id INTO v_bitacora FROM public.bitacora
    WHERE centro_id = v_centro_a AND fecha = current_date;

    IF v_bitacora IS NOT NULL THEN
        INSERT INTO public.bitacora_items (bitacora_id, actividad, descripcion, duracion_minutos)
        SELECT v_bitacora, 'operacion', 'Operación matutina demo', 120
        WHERE NOT EXISTS (
            SELECT 1 FROM public.bitacora_items WHERE bitacora_id = v_bitacora AND actividad = 'operacion'
        );

        INSERT INTO public.bitacora_items (bitacora_id, actividad, descripcion, duracion_minutos)
        SELECT v_bitacora, 'mantenimiento', 'Chequeo básico', 45
        WHERE NOT EXISTS (
            SELECT 1 FROM public.bitacora_items WHERE bitacora_id = v_bitacora AND actividad = 'mantenimiento'
        );
    END IF;

    -- Pilotos demo (roles centro asignado/no asignado)
    SELECT id INTO v_piloto_asignado FROM auth.users WHERE email = 'piloto.asignado@demo.local';
    IF v_piloto_asignado IS NOT NULL THEN
        INSERT INTO public.profiles (user_id, role, centro_id)
        SELECT v_piloto_asignado, 'centro'::public.role_enum, v_centro_a
        WHERE NOT EXISTS (
            SELECT 1 FROM public.profiles WHERE user_id = v_piloto_asignado
        );
    END IF;

    SELECT id INTO v_piloto_no_asignado FROM auth.users WHERE email = 'piloto.noasignado@demo.local';
    IF v_piloto_no_asignado IS NOT NULL THEN
        INSERT INTO public.profiles (user_id, role, centro_id)
        SELECT v_piloto_no_asignado, 'centro'::public.role_enum, NULL
        WHERE NOT EXISTS (
            SELECT 1 FROM public.profiles WHERE user_id = v_piloto_no_asignado
        );
    END IF;
END;
$$;

-- ============================================================
-- 10. TODOs y notas
-- ============================================================
-- EDI: Implementar RLS detallado en tablas operativas según matriz de permisos.
-- EDI: Añadir triggers/RPCs para reglas de negocio (autocierre de préstamos, herencia de ubicación, control de recepción, etc.).
-- EDI: Registrar eventos en audit_event desde RPCs y triggers operativos.

COMMIT;
