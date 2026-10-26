# Automatic TLS edge

Point public DNS `A`/`AAAA` records for `api.<DOMAIN>`, `app.<DOMAIN>`, and `admin.<DOMAIN>` to the VM. Allow inbound TCP 80/443 and UDP 443. Set `DOMAIN` to the root domain and `ACME_EMAIL` to an operator mailbox; Caddy obtains and renews certificates automatically after DNS resolves.

First boot: copy `.env.production.example` to `.env`, supply the private registry, immutable `IMAGE_TAG`, database/Redis credentials, and distinct web/admin session secrets; run the production compose command in `docs/ops/SINGLE_VM_DEPLOY.md`. The Caddy volume at `caddy-data` holds ACME state and must be included in encrypted backups. Certificate renewal is automatic; rotate only by preserving `/data` and updating `ACME_EMAIL` or DNS as required. WebSocket upgrades are proxied by Caddy's standard reverse proxy transport. Caddy's JSON access log does not emit request headers, so Authorization and Cookie values are not logged.
