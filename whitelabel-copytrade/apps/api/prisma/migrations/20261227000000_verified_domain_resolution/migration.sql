-- Public host resolution must work before a tenant RLS context exists. Expose
-- only the public identity of an active, verified custom domain; never expose
-- the domain verification token or another tenant's private records.
--
-- With FORCE ROW LEVEL SECURITY the function owner must have BYPASSRLS (or be a
-- superuser). row_security=off makes an incorrectly owned function fail closed
-- instead of silently returning an incomplete result. The migration operator
-- must provision and retain that privilege for the owning deployment role.
CREATE OR REPLACE FUNCTION public.wlct_resolve_verified_tenant_domain(input_domain text)
RETURNS TABLE (tenant_id uuid, tenant_slug text, tenant_status text, tenant_locale text, tenant_currency text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $$
  SELECT t.id, t.slug::text, t.status::text, t.default_locale::text, t.default_currency::text
  FROM public.tenant_domains AS d
  JOIN public.tenants AS t ON t.id = d.tenant_id
  WHERE d.domain = lower(input_domain)
    AND d.status = 'ACTIVE'
    AND d.verified_at IS NOT NULL
    AND d.certificate_expiry > statement_timestamp()
    AND t.status = 'ACTIVE'
    AND t.deleted_at IS NULL
  LIMIT 1
$$;

-- Domain -> public tenant branding identity is intentionally callable before
-- authentication. No list operation or verification-token projection exists.
GRANT EXECUTE ON FUNCTION public.wlct_resolve_verified_tenant_domain(text) TO PUBLIC;
