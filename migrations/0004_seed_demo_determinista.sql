-- Seed determinista de datos demo + suite QA (Prompt 4)
-- Contexto: Dataset base para validar RLS, RPCs y flujos operativos.

BEGIN;

-- Candado para evitar colisiones durante la semilla
SELECT pg_advisory_xact_lock(hashtext('seed:demo_dataset_v1'));

DO $$
DECLARE
    v_now timestamptz := timezone('UTC', now());
    v_empresa uuid;
    v_zona uuid;
    v_centro_c1 uuid;
    v_centro_c2 uuid;
    v_eq1 uuid;
    v_eq2 uuid;
    v_comp_rov uuid;
    v_comp_ctrl uuid;
    v_comp_umb uuid;
    v_comp_sensor uuid;
    v_comp_sensor_c2 uuid;
    v_comp_sensor_bodega uuid;
    v_prestamo uuid;
    v_movimiento uuid;
    v_bitacora_hoy uuid;
    v_bitacora_atrasada uuid;
    v_user_admin constant uuid := '11111111-1111-1111-1111-111111111111';
    v_user_oficina constant uuid := '22222222-2222-2222-2222-222222222222';
    v_user_centro_asignado constant uuid := '33333333-3333-3333-3333-333333333333';
    v_user_centro_no_asignado constant uuid := '44444444-4444-4444-4444-444444444444';
    v_instance constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- ============================================================
    -- 1. Organización: empresa → zona → centros
    -- ============================================================
    INSERT INTO public.empresas (nombre, slug, estado, is_demo)
    VALUES ('Empresa Demo E1', 'empresa-demo-e1', 'activa', true)
    ON CONFLICT (slug) DO UPDATE
        SET nombre = EXCLUDED.nombre,
            estado = EXCLUDED.estado,
            is_demo = EXCLUDED.is_demo
    RETURNING id INTO v_empresa;

    INSERT INTO public.zonas (empresa_id, nombre, slug)
    VALUES (v_empresa, 'Zona Operativa Z1', 'zona-operativa-z1')
    ON CONFLICT (empresa_id, slug) DO UPDATE
        SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_zona;

    INSERT INTO public.centros (empresa_id, zona_id, nombre, slug)
    VALUES
        (v_empresa, v_zona, 'Centro Principal C1', 'centro-principal-c1')
    ON CONFLICT (slug) DO UPDATE
        SET empresa_id = EXCLUDED.empresa_id,
            zona_id = EXCLUDED.zona_id,
            nombre = EXCLUDED.nombre
    RETURNING id INTO v_centro_c1;

    INSERT INTO public.centros (empresa_id, zona_id, nombre, slug)
    VALUES
        (v_empresa, v_zona, 'Centro Secundario C2', 'centro-secundario-c2')
    ON CONFLICT (slug) DO UPDATE
        SET empresa_id = EXCLUDED.empresa_id,
            zona_id = EXCLUDED.zona_id,
            nombre = EXCLUDED.nombre
    RETURNING id INTO v_centro_c2;

    -- ============================================================
    -- 2. Usuarios base en auth.users + profiles + profile_private
    -- ============================================================
    INSERT INTO auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data, aud, role,
                            email_confirmed_at, invited_at, confirmation_sent_at, confirmed_at,
                            last_sign_in_at, created_at, updated_at)
    VALUES
        (v_user_admin, v_instance, 'u_admin@demo.seed', '{"provider":"email","roles":["admin"]}'::jsonb,
            '{"username":"u_admin"}'::jsonb, 'authenticated', 'authenticated',
            v_now, v_now, v_now, v_now, v_now, v_now, v_now)
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            raw_app_meta_data = EXCLUDED.raw_app_meta_data,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            updated_at = EXCLUDED.updated_at;

    INSERT INTO auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data, aud, role,
                            email_confirmed_at, invited_at, confirmation_sent_at, confirmed_at,
                            last_sign_in_at, created_at, updated_at)
    VALUES
        (v_user_oficina, v_instance, 'u_oficina@demo.seed', '{"provider":"email","roles":["oficina"]}'::jsonb,
            '{"username":"u_oficina"}'::jsonb, 'authenticated', 'authenticated',
            v_now, v_now, v_now, v_now, v_now, v_now, v_now)
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            raw_app_meta_data = EXCLUDED.raw_app_meta_data,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            updated_at = EXCLUDED.updated_at;

    INSERT INTO auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data, aud, role,
                            email_confirmed_at, invited_at, confirmation_sent_at, confirmed_at,
                            last_sign_in_at, created_at, updated_at)
    VALUES
        (v_user_centro_asignado, v_instance, 'u_centro_asignado@demo.seed', '{"provider":"email","roles":["centro"]}'::jsonb,
            '{"username":"u_centro_asignado"}'::jsonb, 'authenticated', 'authenticated',
            v_now, v_now, v_now, v_now, v_now, v_now, v_now)
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            raw_app_meta_data = EXCLUDED.raw_app_meta_data,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            updated_at = EXCLUDED.updated_at;

    INSERT INTO auth.users (id, instance_id, email, raw_app_meta_data, raw_user_meta_data, aud, role,
                            email_confirmed_at, invited_at, confirmation_sent_at, confirmed_at,
                            last_sign_in_at, created_at, updated_at)
    VALUES
        (v_user_centro_no_asignado, v_instance, 'u_centro_no_asignado@demo.seed', '{"provider":"email","roles":["centro"]}'::jsonb,
            '{"username":"u_centro_no_asignado"}'::jsonb, 'authenticated', 'authenticated',
            v_now, v_now, v_now, v_now, v_now, v_now, v_now)
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            raw_app_meta_data = EXCLUDED.raw_app_meta_data,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            updated_at = EXCLUDED.updated_at;

    INSERT INTO public.profiles (user_id, role, centro_id)
    VALUES
        (v_user_admin, 'admin', NULL),
        (v_user_oficina, 'oficina', NULL),
        (v_user_centro_asignado, 'centro', v_centro_c1),
        (v_user_centro_no_asignado, 'centro', NULL)
    ON CONFLICT (user_id) DO UPDATE
        SET role = EXCLUDED.role,
            centro_id = EXCLUDED.centro_id;

    INSERT INTO public.profile_private (user_id, nombres, apellidos, documento_identidad, telefono, direccion, informacion_medica)
    VALUES
        (v_user_admin, 'Ana', 'Admin', 'ADMIN-001', '+56 900 000 001', 'Sede central', '{"alergias":[]}'::jsonb),
        (v_user_oficina, 'Oscar', 'Oficina', 'OFI-001', '+56 900 000 002', 'Oficina logística', '{"alergias":[]}'::jsonb),
        (v_user_centro_asignado, 'Carla', 'Centro', 'CEN-001', '+56 900 000 003', 'Centro C1', '{"alergias":["polen"]}'::jsonb),
        (v_user_centro_no_asignado, 'Nico', 'NoAsignado', 'CEN-002', '+56 900 000 004', 'En tránsito', '{"observaciones":"Sin centro"}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE
        SET nombres = EXCLUDED.nombres,
            apellidos = EXCLUDED.apellidos,
            documento_identidad = EXCLUDED.documento_identidad,
            telefono = EXCLUDED.telefono,
            direccion = EXCLUDED.direccion,
            informacion_medica = EXCLUDED.informacion_medica;

    -- ============================================================
    -- 3. Inventario: componentes
    -- ============================================================
    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion,
                                    operatividad, condicion, ubicacion, ubicacion_detalle)
    VALUES (v_empresa, v_zona, v_centro_c1, 'rov', 'ROV Explorador Demo', 'ROV-0001',
            'ROV-0001-SERIAL-ALPHA-20240101', 'ROV principal del equipo demo',
            'operativo', 'bueno', 'asignado_a_equipo', 'Asignado a EQ-0001')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            serie = EXCLUDED.serie,
            descripcion = EXCLUDED.descripcion,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle
    RETURNING id INTO v_comp_rov;

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion,
                                    operatividad, condicion, ubicacion, ubicacion_detalle)
    VALUES (v_empresa, v_zona, v_centro_c1, 'controlador', 'Controlador Maestro', 'CTR-0001',
            'CTR-0001-SERIAL-BETA-20240101', 'Controlador primario del ROV',
            'operativo', 'bueno', 'asignado_a_equipo', 'Asignado a EQ-0001')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            serie = EXCLUDED.serie,
            descripcion = EXCLUDED.descripcion,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle
    RETURNING id INTO v_comp_ctrl;

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion,
                                    operatividad, condicion, ubicacion, ubicacion_detalle)
    VALUES (v_empresa, v_zona, v_centro_c1, 'umbilical', 'Umbilical Titan', 'UMB-0001',
            'UMB-0001-SERIAL-GAMMA-20240101', 'Umbilical operativo de 300m',
            'operativo', 'bueno', 'asignado_a_equipo', 'Asignado a EQ-0001')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            serie = EXCLUDED.serie,
            descripcion = EXCLUDED.descripcion,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle
    RETURNING id INTO v_comp_umb;

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion,
                                    operatividad, condicion, ubicacion, ubicacion_detalle)
    VALUES (v_empresa, v_zona, v_centro_c1, 'sensor', 'Sensor Multihaz', 'SEN-0001',
            'SEN-0001-SERIAL-DELTA-20240101', 'Sensor asignado a EQ-0001',
            'operativo', 'bueno', 'asignado_a_equipo', 'Asignado a EQ-0001')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            serie = EXCLUDED.serie,
            descripcion = EXCLUDED.descripcion,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle
    RETURNING id INTO v_comp_sensor;

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion,
                                    operatividad, condicion, ubicacion, ubicacion_detalle)
    VALUES (v_empresa, v_zona, v_centro_c2, 'sensor', 'Sensor Respaldo C2', 'SEN-0002',
            'SEN-0002-SERIAL-EPSILON-20240101', 'Sensor disponible en C2',
            'operativo', 'bueno', 'centro', 'Centro C2 - Bodega técnica')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            serie = EXCLUDED.serie,
            descripcion = EXCLUDED.descripcion,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle
    RETURNING id INTO v_comp_sensor_c2;

    INSERT INTO public.componentes (empresa_id, zona_id, centro_id, tipo, nombre, codigo, serie, descripcion,
                                    operatividad, condicion, ubicacion, ubicacion_detalle)
    VALUES (v_empresa, v_zona, NULL, 'sensor', 'Sensor Bodega', 'SEN-0003',
            'SEN-0003-SERIAL-ZETA-20240101', 'Sensor almacenado en bodega central',
            'operativo', 'bueno', 'bodega', 'Bodega general empresa E1')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            serie = EXCLUDED.serie,
            descripcion = EXCLUDED.descripcion,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle
    RETURNING id INTO v_comp_sensor_bodega;

    -- ============================================================
    -- 4. Equipos y asignación de componentes
    -- ============================================================
    INSERT INTO public.equipos (empresa_id, zona_id, centro_id, codigo, nombre, estado, operatividad, condicion, rol, ubicacion, ubicacion_detalle, notas)
    VALUES (v_empresa, v_zona, v_centro_c1, 'EQ-0001', 'Equipo Operativo C1', 'vigente', 'operativo', 'bueno', 'principal', 'centro', 'Centro C1 - Hangar', 'Equipo principal con ROV asignado')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            estado = EXCLUDED.estado,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            rol = EXCLUDED.rol,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle,
            notas = EXCLUDED.notas
    RETURNING id INTO v_eq1;

    INSERT INTO public.equipos (empresa_id, zona_id, centro_id, codigo, nombre, estado, operatividad, condicion, rol, ubicacion, ubicacion_detalle, notas)
    VALUES (v_empresa, v_zona, v_centro_c1, 'EQ-0002', 'Equipo Secundario C1', 'vigente', 'operativo', 'bueno', 'backup', 'centro', 'Centro C1 - Plataforma', 'Equipo destino para préstamos intra-centro')
    ON CONFLICT (codigo) DO UPDATE
        SET zona_id = EXCLUDED.zona_id,
            centro_id = EXCLUDED.centro_id,
            estado = EXCLUDED.estado,
            operatividad = EXCLUDED.operatividad,
            condicion = EXCLUDED.condicion,
            rol = EXCLUDED.rol,
            ubicacion = EXCLUDED.ubicacion,
            ubicacion_detalle = EXCLUDED.ubicacion_detalle,
            notas = EXCLUDED.notas
    RETURNING id INTO v_eq2;

    -- Garantiza que no haya componentes activos distintos al esperado para cada rol clave
    UPDATE public.equipo_componente
    SET fecha_desasignacion = v_now
    WHERE equipo_id = v_eq1
      AND rol_componente IN ('rov', 'controlador', 'umbilical', 'sensor')
      AND componente_id <> ANY (ARRAY[v_comp_rov, v_comp_ctrl, v_comp_umb, v_comp_sensor])
      AND fecha_desasignacion IS NULL;

    -- ROV
    PERFORM 1 FROM public.equipo_componente
    WHERE equipo_id = v_eq1 AND componente_id = v_comp_rov;
    IF NOT FOUND THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente, fecha_asignacion, notas)
        VALUES (v_eq1, v_comp_rov, 'rov', v_now - interval '30 days', 'Asignación inicial seed determinista');
    ELSE
        UPDATE public.equipo_componente
        SET rol_componente = 'rov',
            fecha_desasignacion = NULL,
            notas = 'Asignación inicial seed determinista'
        WHERE equipo_id = v_eq1 AND componente_id = v_comp_rov;
    END IF;

    -- Controlador
    PERFORM 1 FROM public.equipo_componente
    WHERE equipo_id = v_eq1 AND componente_id = v_comp_ctrl;
    IF NOT FOUND THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente, fecha_asignacion, notas)
        VALUES (v_eq1, v_comp_ctrl, 'controlador', v_now - interval '30 days', 'Asignación inicial seed determinista');
    ELSE
        UPDATE public.equipo_componente
        SET rol_componente = 'controlador',
            fecha_desasignacion = NULL,
            notas = 'Asignación inicial seed determinista'
        WHERE equipo_id = v_eq1 AND componente_id = v_comp_ctrl;
    END IF;

    -- Umbilical
    PERFORM 1 FROM public.equipo_componente
    WHERE equipo_id = v_eq1 AND componente_id = v_comp_umb;
    IF NOT FOUND THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente, fecha_asignacion, notas)
        VALUES (v_eq1, v_comp_umb, 'umbilical', v_now - interval '30 days', 'Asignación inicial seed determinista');
    ELSE
        UPDATE public.equipo_componente
        SET rol_componente = 'umbilical',
            fecha_desasignacion = NULL,
            notas = 'Asignación inicial seed determinista'
        WHERE equipo_id = v_eq1 AND componente_id = v_comp_umb;
    END IF;

    -- Sensor
    PERFORM 1 FROM public.equipo_componente
    WHERE equipo_id = v_eq1 AND componente_id = v_comp_sensor;
    IF NOT FOUND THEN
        INSERT INTO public.equipo_componente (equipo_id, componente_id, rol_componente, fecha_asignacion, notas)
        VALUES (v_eq1, v_comp_sensor, 'sensor', v_now - interval '5 days', 'Sensor asociado al equipo antes del préstamo');
    ELSE
        UPDATE public.equipo_componente
        SET rol_componente = 'sensor',
            fecha_desasignacion = NULL,
            notas = 'Sensor asociado al equipo antes del préstamo'
        WHERE equipo_id = v_eq1 AND componente_id = v_comp_sensor;
    END IF;

    -- ============================================================
    -- 5. Préstamo intra-centro activo del sensor SEN-0001
    -- ============================================================
    SELECT id
    INTO v_prestamo
    FROM public.prestamos_intra
    WHERE componente_id = v_comp_sensor
      AND estado = 'activo'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_prestamo IS NULL THEN
        INSERT INTO public.prestamos_intra (empresa_id, centro_id, equipo_origen_id, equipo_destino_id,
                                            componente_id, estado, motivo, responsable_id,
                                            fecha_inicio, fecha_compromiso)
        VALUES (v_empresa, v_centro_c1, v_eq1, v_eq2, v_comp_sensor, 'activo',
                'Préstamo demo sensor EQ-0001 → EQ-0002', v_user_centro_asignado,
                v_now - interval '2 hours', v_now + interval '5 days')
        RETURNING id INTO v_prestamo;
    ELSE
        UPDATE public.prestamos_intra
        SET empresa_id = v_empresa,
            centro_id = v_centro_c1,
            equipo_origen_id = v_eq1,
            equipo_destino_id = v_eq2,
            motivo = 'Préstamo demo sensor EQ-0001 → EQ-0002',
            responsable_id = v_user_centro_asignado,
            fecha_inicio = LEAST(coalesce(fecha_inicio, v_now), v_now),
            fecha_compromiso = v_now + interval '5 days',
            estado = 'activo',
            fecha_cierre = NULL,
            fecha_devuelto = NULL,
            fecha_definitivo = NULL
        WHERE id = v_prestamo;
    END IF;

    -- ============================================================
    -- 6. Movimiento pendiente EQ-0001 (C1 → C2)
    -- ============================================================
    SELECT id
    INTO v_movimiento
    FROM public.movimientos
    WHERE equipo_id = v_eq1
      AND tipo = 'traslado'
      AND estado IN ('pendiente', 'en_transito')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_movimiento IS NULL THEN
        INSERT INTO public.movimientos (empresa_id, centro_origen_id, centro_destino_id, origen_tipo, destino_tipo,
                                        tipo, estado, equipo_id, responsable_origen_id, motivo, notas)
        VALUES (v_empresa, v_centro_c1, v_centro_c2, 'centro', 'centro', 'traslado', 'pendiente',
                v_eq1, v_user_centro_asignado, 'Traslado programado EQ-0001 C1→C2',
                'Semilla determinista para validar flujo pendiente → en_transito → recibido')
        RETURNING id INTO v_movimiento;
    ELSE
        UPDATE public.movimientos
        SET empresa_id = v_empresa,
            centro_origen_id = v_centro_c1,
            centro_destino_id = v_centro_c2,
            origen_tipo = 'centro',
            destino_tipo = 'centro',
            tipo = 'traslado',
            estado = 'pendiente',
            responsable_origen_id = v_user_centro_asignado,
            responsable_destino_id = NULL,
            fecha_envio = NULL,
            fecha_recepcion = NULL,
            motivo = 'Traslado programado EQ-0001 C1→C2',
            notas = 'Semilla determinista para validar flujo pendiente → en_transito → recibido'
        WHERE id = v_movimiento;
    END IF;

    -- ============================================================
    -- 7. Bitácora (dentro y fuera de ventana)
    -- ============================================================
    SELECT id
    INTO v_bitacora_hoy
    FROM public.bitacora
    WHERE centro_id = v_centro_c1
      AND fecha = current_date
      AND jornada = 'diurna'
    LIMIT 1;

    IF v_bitacora_hoy IS NULL THEN
        INSERT INTO public.bitacora (empresa_id, zona_id, centro_id, autor_user_id, fecha, jornada, estado_puerto,
                                     equipo_usado, comentarios, motivo_atraso)
        VALUES (v_empresa, v_zona, v_centro_c1, v_user_centro_asignado, current_date, 'diurna', 'abierto',
                v_eq1, 'Operación rutinaria matutina', NULL)
        RETURNING id INTO v_bitacora_hoy;
    ELSE
        UPDATE public.bitacora
        SET empresa_id = v_empresa,
            zona_id = v_zona,
            autor_user_id = v_user_centro_asignado,
            estado_puerto = 'abierto',
            equipo_usado = v_eq1,
            comentarios = 'Operación rutinaria matutina',
            motivo_atraso = NULL
        WHERE id = v_bitacora_hoy;
    END IF;

    DELETE FROM public.bitacora_items WHERE bitacora_id = v_bitacora_hoy;

    INSERT INTO public.bitacora_items (bitacora_id, actividad, descripcion, duracion_minutos)
    VALUES (v_bitacora_hoy, 'operacion', 'Inspección submarina programada (turno AM)', 180);

    INSERT INTO public.bitacora_items (bitacora_id, actividad, descripcion, duracion_minutos)
    VALUES (v_bitacora_hoy, 'standby', 'Otro: calibración específica de sensor con detalle extendido', 45);

    SELECT id
    INTO v_bitacora_atrasada
    FROM public.bitacora
    WHERE centro_id = v_centro_c1
      AND fecha = current_date - interval '1 day'
      AND jornada = 'diurna'
    LIMIT 1;

    IF v_bitacora_atrasada IS NULL THEN
        INSERT INTO public.bitacora (empresa_id, zona_id, centro_id, autor_user_id, fecha, jornada, estado_puerto,
                                     equipo_usado, comentarios, motivo_atraso)
        VALUES (v_empresa, v_zona, v_centro_c1, v_user_centro_asignado, current_date - interval '1 day',
                'diurna', 'abierto', v_eq1, 'Registro fuera de ventana para QA',
                'Simulación: reporte ingresado al día siguiente por mantenimiento prolongado')
        RETURNING id INTO v_bitacora_atrasada;
    ELSE
        UPDATE public.bitacora
        SET empresa_id = v_empresa,
            zona_id = v_zona,
            autor_user_id = v_user_centro_asignado,
            estado_puerto = 'abierto',
            equipo_usado = v_eq1,
            comentarios = 'Registro fuera de ventana para QA',
            motivo_atraso = 'Simulación: reporte ingresado al día siguiente por mantenimiento prolongado'
        WHERE id = v_bitacora_atrasada;
    END IF;

    DELETE FROM public.bitacora_items WHERE bitacora_id = v_bitacora_atrasada;

    INSERT INTO public.bitacora_items (bitacora_id, actividad, descripcion, duracion_minutos)
    VALUES (v_bitacora_atrasada, 'mantenimiento', 'Ingreso atrasado validando requisito de motivo', 90);

END;
$$;

-- ============================================================
-- Suite de smoke tests (ejecutar manualmente tras la semilla)
-- ============================================================
-- Impersonación (set_config) según rol antes de cada bloque.
--
-- Visibilidad por rol
--   -- Rol oficina:
--   --   SELECT COUNT(*) FROM public.equipos;
--   -- Rol centro asignado (C1) antes del traslado:
--   --   SELECT DISTINCT centro_id FROM public.equipos;
--   -- Rol centro sin asignación:
--   --   SELECT * FROM public.equipos;
--
-- Préstamos
--   -- SELECT public.rpc_prestamo_crear('<eq_origen>', '<eq_destino>', '<sensor>', 'Motivo QA'); -- debe crear activo
--   -- SELECT public.rpc_prestamo_crear('<eq_origen>', '<eq_destino>', '<sensor>', 'Motivo QA'); -- segunda vez => “Préstamo activo: no se puede prestar nuevamente este componente.”
--   -- Tras ejecutar rpc_movimiento_recibir sobre el traslado demo, validar que el préstamo pasa a devuelto con fecha_devuelto.
--
-- Movimientos
--   -- SELECT public.rpc_movimiento_crear('equipo', '<eq-0001-id>', NULL, 'traslado', 'centro', '<c1>', 'centro', '<c2>', 'Traslado QA');
--   -- SELECT public.rpc_movimiento_enviar('<mov_id>');
--   -- SELECT public.rpc_movimiento_recibir('<mov_id>'); -- espera autocierre préstamo + herencia de ubicación.
--
-- Bitácora
--   -- SELECT public.rpc_bitacora_crear('{"centro_id":"<c1>","fecha":"'||current_date||'","jornada":"diurna","estado_puerto":"abierto"}'::jsonb,
--   --     ARRAY[jsonb_build_object('actividad','operacion','descripcion','QA'), jsonb_build_object('actividad','standby','descripcion','Otro QA','duracion_minutos',15)]);
--   -- SELECT public.rpc_bitacora_crear('{"centro_id":"<c1>","fecha":"'||(current_date - interval '1 day')||'","jornada":"diurna","estado_puerto":"abierto"}'::jsonb,
--   --     ARRAY[]::jsonb[]); -- sin motivo => “Registro fuera de ventana: se requiere 'motivo_atraso'.”
--
-- profile_private
--   -- (rol centro) SELECT * FROM public.profile_private; -- sin filas / error RLS
--   -- (rol oficina) SELECT COUNT(*) FROM public.profile_private; -- 4 registros esperados
--
-- Guardas inventario
--   -- SELECT public.rpc_equipo_agregar_componente('<eq-0001-id>', '<otro-rov-id>', 'rov'); -- espera “Cambio de ROV no permitido: debe crear un nuevo equipo.”

COMMIT;
