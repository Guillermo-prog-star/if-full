# Integrity Family — Backup y Restauración

**Última actualización:** 2026-07-13

---

## Backup automático

- **Tarea:** `IntegrityFamily-DailyBackup` (Windows Programador de Tareas)
- **Horario:** 2:00 AM diario
- **Retención:** 30 backups (~30 días)
- **Ubicación:** `C:\Proyectos\if-full\backups\`
- **Formato:** `.sql.gz` (comprimido)
- **Log:** `C:\Proyectos\if-full\backups\backup.log`

### Verificar que la tarea existe
```powershell
Get-ScheduledTask -TaskName "IntegrityFamily-DailyBackup"
```

### Ejecutar backup manual
```bash
# Desde C:\Proyectos\if-full
./scripts/backup-mysql.sh --compress --keep 30
```

### Verificar restore (sin tocar datos de producción)
```bash
# Usa el backup más reciente automáticamente
./scripts/verify-restore.sh

# O especifica un backup concreto
./scripts/verify-restore.sh backups/if_backup_YYYYMMDD_HHmmss.sql.gz
```

---

## Restauración

### Requisito previo
```bash
docker compose up -d db
```

### Restaurar desde backup
```bash
./scripts/restore-mysql.sh backups/if_backup_YYYYMMDD_HHmmss.sql.gz
```

### Verificación post-restore (ejecutar en MySQL)
```sql
SELECT 'families'       AS tabla, COUNT(*) AS registros FROM families
UNION ALL
SELECT 'family_members',          COUNT(*) FROM family_members
UNION ALL
SELECT 'evaluations',             COUNT(*) FROM evaluations
UNION ALL
SELECT 'improvement_plans',       COUNT(*) FROM improvement_plans
UNION ALL
SELECT 'plan_tasks',              COUNT(*) FROM plan_tasks
UNION ALL
SELECT 'task_evidences',          COUNT(*) FROM task_evidences
UNION ALL
SELECT 'family_documentaries',    COUNT(*) FROM family_documentaries
UNION ALL
SELECT 'family_chapter_progress', COUNT(*) FROM family_chapter_progress;
```

---

## Historial de verificaciones

| Fecha | Backup | Resultado | Notas |
|-------|--------|-----------|-------|
| 2026-06-16 | if_backup_20260616_140811.sql.gz (9.6 MB) | OK | 8 tablas verificadas, 100% coincidencia |
| 2026-06-20 | if_backup_20260620_202317.sql.gz (9.7 MB) | OK | Primer backup automático + verify-restore.sh 8/8 tablas |
| 2026-07-13 | if_backup_20260712_030621.sql.gz (480 KB) | OK (diferencia explicada) | 7/8 tablas coinciden exacto. `plan_tasks`: 68 prod vs 62 restore — diferencia de 6 registros creados después del backup (backup 2026-07-12 03:06:21, últimos plan_tasks hasta 2026-07-13 16:03:59), confirmado por `created_at`; no es corrupción. `improvement_plans` sigue como N/A en ambos lados (mismo comportamiento que verificaciones previas). Nota: backup usado tenía ~32h de antigüedad (por encima del RPO de 24h) — no había backup del propio 13 de julio al momento de verificar; revisar que la tarea de backup diario esté corriendo. Verificación disparada una semana antes de lo esperado (tarea programada apuntaba al 20 de julio). |

**Próxima verificación recomendada:** 2026-08-13

---

## Objetivo de recuperación

- **RPO (pérdida máxima de datos):** 24 horas
- **RTO (tiempo máximo de restauración):** 2 horas
- **Meta:** Restaurar todo el sistema desde cero en menos de 2 horas
