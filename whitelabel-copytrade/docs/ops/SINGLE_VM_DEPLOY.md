# Single-VM production deployment

## Prerequisites

Use a Linux VM with Docker Engine and the Compose v2 plugin, at least 4 vCPU/8 GiB RAM, encrypted block storage, and an image registry reachable by the VM. Publish `A`/`AAAA` records for `api`, `app`, and `admin` subdomains before first boot; open inbound TCP 80/443 and UDP 443 only. Create `.env` from `.env.production.example`; supply secrets from a secret manager and use a distinct `WEB_SESSION_COOKIE_SECRET` and `ADMIN_SESSION_COOKIE_SECRET`. Never commit `.env`.

## Deploy

```sh
export REGISTRY=registry.example.com/wlct
export IMAGE_TAG=release-2026.10.25.1
export PREVIOUS_IMAGE_TAG=release-2026.10.18.1
export DOMAIN=example.com
export ACME_EMAIL=ops@example.com
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans
bash ./scripts/deploy-single-vm.sh
```

`deploy-single-vm.sh` pulls the pinned images, runs the migration job before replacement, waits for API/customer/admin health checks, and restores the previous image tag if deployment fails. Keep database backups even when using the rollback script: a migration may be additive but the old binary can still be incompatible with a newer schema.

## Backup and restore

Stop write traffic or take a consistent PostgreSQL snapshot with `pg_dump --format=custom --no-owner --no-acl` from the `postgres` service. Encrypt the dump with the organization's KMS key and copy it off-host; record the release tag, migration version, and checksum alongside it. Back up `postgres-data` only after stopping Postgres cleanly or with a filesystem snapshot mechanism that guarantees consistency. Back up `caddy-data` to preserve ACME state; do not expose it publicly. Verify restoration quarterly into an isolated host. To restore, stop the stack, restore the encrypted dump to a clean Postgres instance, verify ownership and schema, then start the pinned release.

## Rollback

Set `IMAGE_TAG` to the prior immutable release and `PREVIOUS_IMAGE_TAG` to the current release, then run `bash ./scripts/deploy-single-vm.sh`. If the migration is not backward-compatible, restore the pre-deploy database snapshot before starting the old release. Do not roll back by moving a registry tag or by setting `latest`; publish an immutable corrected tag instead.
