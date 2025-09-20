# Diagnóstico de base de datos

## Resumen
- Las migraciones viven en `supabase/migrations/` (2 archivos SQL).
- No hay archivos sueltos en `migrations/` (directorio eliminado).
- El smoke (`tests/sql/smoke.sql`) mantiene los checks núcleo y los bloques de RLS/guards.

## Listado de migraciones
| Archivo | Contenido destacado |
| --- | --- |
| `20240711090000__estructura_base.sql` | Estructura base (empresas→zonas→centros, identidad, inventario, operativa, bitácora, auditoría) + RLS habilitado. |
| `20240711090500__rls_y_rpcs.sql` | Helpers de sesión, guards, policies RLS y RPCs transaccionales con auditoría. |

## Notas
- Los enums principales (`role_enum`, `equipo_estado`, `prestamo_estado`, `movimiento_estado`) se autoajustan si faltan valores.
- Las RPCs registran eventos en `audit_event` y usan los guards (`assert_*`).
- El smoke incluye los marcadores `-- CI_SEED_CHECK_START/END` y deja el seed comentado para pasar en entornos sin datos.
