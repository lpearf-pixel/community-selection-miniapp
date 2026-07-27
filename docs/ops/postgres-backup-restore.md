# PostgreSQL 加密备份与恢复

## 安全边界

- 备份只保存为 GPG AES-256 对称加密的 `.dump.gpg` 文件。
- 明文 `pg_dump` 通过管道直接进入 GPG，不落盘。
- 加密失败会删除 `.partial`；成功前会做一次解密可读性检查。
- 口令只从权限为 `0600` 的 `secrets/backup_passphrase` 读取。
- 恢复必须显式设置 `RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION`。
- `pg_restore --clean` 会覆盖目标库对象，必须先核对目标和停止业务写入。

## 生产 Compose

```bash
ENV_FILE=.env.production pnpm prod:backup
```

查看加密备份：

```bash
docker volume inspect community-selection-production_production-backups
```

恢复：

```bash
export BACKUP_FILE=/var/backups/community-selection/community_selection_YYYYMMDDTHHMMSSZ.dump.gpg
export RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION
ENV_FILE=.env.production pnpm prod:restore
```

## 非 Compose 数据库

```bash
export DATABASE_URL='postgresql://user:password@host:5432/community_selection'
export BACKUP_DIR=/data/backups/community-selection
export BACKUP_RETENTION_DAYS=14
export BACKUP_ENCRYPTION_PASSPHRASE_FILE=/secure/backup_passphrase
bash scripts/pg-backup.sh
```

恢复时：

```bash
export BACKUP_FILE=/data/backups/community-selection/community_selection_YYYYMMDDTHHMMSSZ.dump.gpg
export RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION
bash scripts/pg-restore.sh
```

## 频率与演练

- 每日全量加密备份，保留至少 14 天。
- 每次生产迁移前额外备份；部署脚本检测到已有数据库卷时自动执行。
- 每月至少在独立演练库恢复一次，记录备份名、开始/结束时间、迁移版本、表数量抽查和验收人。
- 不允许把恢复演练直接指向生产库。
