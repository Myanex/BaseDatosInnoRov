[![DB — Migrations & Smoke](https://github.com/${{ github.repository }}/actions/workflows/db-ci.yml/badge.svg)](../../actions/workflows/db-ci.yml)
[![Deploy DB (Guarded)](https://github.com/${{ github.repository }}/actions/workflows/deploy-db-guarded.yml/badge.svg)](../../actions/workflows/deploy-db-guarded.yml)

# Base de datos InnoRov

Repositorio de migraciones SQL, pruebas de humo y documentación asociada al proyecto de base de datos de InnoRov.

## Documentación rápida
- [CI de Base de Datos — Migrations & Smoke](docs/ci-db.md)
- [Despliegue de Migraciones a Supabase](docs/deploy-db.md)
- [Despliegue solo desde GitHub (sin terminal local)](docs/deploy-from-github.md)
- [Diagnóstico de la base de datos](docs/diagnostico-db.md)

## Despliegue desde la web
1. Confirma que el workflow **DB — Migrations & Smoke** esté en verde para la rama que deseas desplegar.
2. En GitHub → Actions → **Deploy DB (Supabase CLI)** → **Run workflow**.
3. Elige el `target` (`dev` o `prod`) y ejecuta el despliegue.
4. Revisa el log del job para verificar el resultado y consulta [la guía detallada](docs/deploy-from-github.md) ante cualquier error.

Las migraciones viven en [`supabase/migrations/`](supabase/migrations/) y los tests de humo en [`tests/sql/smoke.sql`](tests/sql/smoke.sql).
