# Diagnóstico CI DB — K3 autofix

## Problema detectado
- El job `postgres` del workflow `DB — Migrations & Smoke` intentaba descargar la imagen `supabase/postgres:15.1.0` que fue retirada del registry, por lo que el servicio de base de datos nunca iniciaba.

## Acciones correctivas
- Parametricé la imagen de base de datos mediante `DB_IMAGE`, usando `postgres:15` como valor por defecto.
- Añadí un paso explícito para mostrar el valor efectivo de la imagen y dejé el listado del directorio de migraciones antes de aplicarlas (requerido para el diagnóstico).
- Confirmé que las migraciones y el smoke test existentes cumplen los requisitos de RLS, guardas y bloque de seed comentado.

## Resultado esperado
- El workflow ahora puede levantar Postgres usando una imagen disponible (`postgres:15`), aplicar migraciones en orden y ejecutar el smoke test sin dependencias de seed manual.
- En caso de necesitar otra imagen compatible (ej. `supabase/postgres:15`), basta con definir el `env`/`var` `DB_IMAGE` en el workflow o en GitHub.
