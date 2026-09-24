# Upload Pipeline Release Checklist

- [ ] Back up PostgreSQL and verify restore target.
- [ ] Set `STORAGE_DRIVER=minio` for local/self-hosted or `qiniu` for production.
- [ ] Review storage credentials, bucket policy, CORS, and CDN domain.
- [ ] Run `npx prisma migrate deploy`.
- [ ] Deploy API and thumbnail worker together.
- [ ] Verify Redis, PostgreSQL, MinIO/Qiniu, API, worker, and frontend health.
- [ ] Smoke-test 1 KB direct upload, 20 MB multipart upload, retry, instant upload, cancellation, and thumbnail status.
- [ ] Watch API error rate, upload failure rate, BullMQ failed jobs, quota totals, and storage latency.

## Rollback

```bash
docker compose -f docker-compose.prod.yml down
git checkout <previous-release-tag>
docker compose -f docker-compose.prod.yml up --build -d
```

Restore the database backup only if the upload schema migration corrupted data. Otherwise keep the additive migration and roll back application images.
