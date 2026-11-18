# Backup y restore de la base

## Backup

```powershell
cd C:\Users\cristofer\Desktop\SASS\shalom-service
./scripts/backup-db.ps1
```

Genera `backups/shalom-YYYYMMDD-HHmm.sql` desde el contenedor `postgres` y borra los backups de
más de `-KeepDays` días (7 por defecto).

Programar con el Programador de tareas de Windows (diario 02:00):

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\...\scripts\backup-db.ps1
```

## Restore

```powershell
# 1. detener api y worker para que nadie escriba
docker compose stop api worker

# 2. restaurar (recrea el esquema)
Get-Content backups\shalom-20261118-0200.sql | docker compose exec -T postgres psql -U nuvex_shalom -d nuvex_shalom

# 3. levantar de nuevo
docker compose start api worker
```

## Verificacion

```powershell
docker compose exec -T postgres psql -U nuvex_shalom -d nuvex_shalom -c "select count(*) from shalom_order;"
```

Probar el restore **al menos una vez** en un entorno limpio antes de confiar en él.
