# PostgreSQL 备份与恢复

## 备份

```bash
export DATABASE_URL="postgresql://user:password@host:5432/community_selection?schema=public"
export BACKUP_DIR=/data/backups/community-selection
scripts/pg-backup.sh
```

## 恢复

```bash
export DATABASE_URL="postgresql://user:password@host:5432/community_selection?schema=public"
export BACKUP_FILE=/data/backups/community-selection/community_selection_YYYYMMDDHHMMSS.dump
scripts/pg-restore.sh
```

## 频率建议

- 灰度期：每日全量备份，关键上线操作前手动备份。
- 稳定期：每日全量备份，保留至少 14 天。
- 每月至少做一次恢复演练。
