#!/bin/bash
set -euo pipefail

# Database backup script for Knowledge Platform
# Usage: ./scripts/backup-db.sh [output_dir]
#
# Requires: pg_dump, gzip
# Environment: DATABASE_URL or individual PG* variables

OUTPUT_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${OUTPUT_DIR}/kp_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$OUTPUT_DIR"

if [ -n "${DATABASE_URL:-}" ]; then
  echo "Backing up database from DATABASE_URL..."
  pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_FILE"
else
  PGHOST="${PGHOST:-localhost}"
  PGPORT="${PGPORT:-5432}"
  PGUSER="${PGUSER:-postgres}"
  PGDATABASE="${PGDATABASE:-knowledge_platform}"
  echo "Backing up ${PGDATABASE}@${PGHOST}:${PGPORT}..."
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-acl | gzip > "$BACKUP_FILE"
fi

echo "Backup saved: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Retain only the last 30 backups
ls -t "${OUTPUT_DIR}"/kp_backup_*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "Cleanup complete — retaining last 30 backups."
