# WLCT Kubernetes chart

This chart deploys API, worker, customer web, administrator web, trading engine, execution engine, market-data, and notification workloads. PostgreSQL and Redis are external services; no database or cache is installed by this chart. Secret objects must be provisioned before install; values only carry Kubernetes Secret names, never secret values.

## Required secrets

- The `external.postgres.secretRef` Secret contains `url` and `directUrl` keys.
- The `external.redis.secretRef` Secret contains the `url` key.
- `services.api.secretRef` carries API JWT, encryption, service-token, and metrics credentials.
- `services.worker.secretRef`, `services.web.secretRef`, `services.adminWeb.secretRef`, `services.tradingEngine.secretRef`, `services.executionEngine.secretRef`, `services.marketData.secretRef`, and `services.notificationService.secretRef` carry only each workload's runtime credentials.
- `ingress.tlsSecretName` is a pre-created TLS Secret for the API/app/admin hostnames.

Set `networkPolicy.postgresCidrs` and `networkPolicy.redisCidrs` to the actual egress CIDRs for the external services. The network policy denies all unspecified ingress/egress; it permits DNS, those database/cache CIDRs, and outbound TCP 443 for venue/provider HTTPS.

## Install, upgrade and rollback

```sh
helm lint infra/production/helm/wlct
helm upgrade --install wlct infra/production/helm/wlct --namespace wlct --create-namespace -f values.production.yaml
helm upgrade wlct infra/production/helm/wlct --namespace wlct -f values.production.yaml
helm history wlct --namespace wlct
helm rollback wlct <REVISION> --namespace wlct
```

Use an immutable release tag in every image value. The pre-install/pre-upgrade migration hook runs `prisma migrate deploy` once, with a bounded retry policy. Take a verified database backup before chart upgrades that change schema compatibility; a Helm rollback does not reverse database migrations.
