'use client';

import React, { useEffect, useState } from 'react';
import {
  listTenants,
  getTenantDetail,
  provisionTenant,
  getPlanCatalog,
} from './saas-admin-api';

/**
 * SaaS tenant management screen: tenant status, plan, billing, usage,
 * entitlements, branding, domain, white-label, admin actions.
 * All from backend APIs, no hardcoded pricing.
 */
export default function SaasTenantManagementPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showProvision, setShowProvision] = useState(false);
  const [provisionForm, setProvisionForm] = useState({ slug: '', name: '', contactEmail: '', planId: '' });
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchTenants = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantsRes, plansRes] = await Promise.all([listTenants({ search: search || undefined, limit: 50 }), getPlanCatalog().catch(() => ({ items: [] }))]);
      setTenants(tenantsRes.items || []);
      setTotal(tenantsRes.total || 0);
      setPlans(plansRes.items || plansRes.plans || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTenants();
  };

  const handleSelectTenant = async (tenantId: string) => {
    try {
      const detail = await getTenantDetail(tenantId);
      setSelectedTenant(detail);
    } catch (e: any) {
      setMessage(`Failed to load tenant detail: ${e.message}`);
    }
  };

  const handleProvision = async () => {
    setProvisionLoading(true);
    setMessage(null);
    try {
      const result = await provisionTenant({
        slug: provisionForm.slug,
        name: provisionForm.name,
        contactEmail: provisionForm.contactEmail || undefined,
        planId: provisionForm.planId || undefined,
        idempotencyKey: `provision_${provisionForm.slug}_${Date.now()}`,
      });
      setMessage(`Tenant provisioned: ${result.tenantSlug} (${result.tenantId}) ${result.idempotent ? '[idempotent]' : ''}`);
      setShowProvision(false);
      setProvisionForm({ slug: '', name: '', contactEmail: '', planId: '' });
      await fetchTenants();
    } catch (e: any) {
      setMessage(`Provision failed: ${e.message}`);
    } finally {
      setProvisionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">SaaS Tenant Management</h1>
        <button onClick={() => setShowProvision(true)} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Provision Tenant</button>
      </div>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>}

      <form onSubmit={handleSearch} className="flex gap-2">
        <input type="text" placeholder="Search tenants..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm" />
        <button type="submit" className="px-4 py-2 bg-gray-800 text-white rounded text-sm">Search</button>
        <button type="button" onClick={fetchTenants} className="px-3 py-2 border rounded text-sm">Refresh</button>
      </form>

      <div className="bg-white border rounded-lg p-4">
        <p className="text-sm text-gray-500 mb-3">Total tenants: {total}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Slug</th>
                <th className="py-2">Name</th>
                <th className="py-2">Status</th>
                <th className="py-2">Plan</th>
                <th className="py-2">Lifecycle</th>
                <th className="py-2">Provisioning</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t: any) => (
                <tr key={t.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 font-mono text-xs">{t.slug}</td>
                  <td className="py-2">{t.name}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${t.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{t.status}</span></td>
                  <td className="py-2">{t.subscriptionSummary?.planCode || 'No plan'}</td>
                  <td className="py-2 text-xs">{t.lifecycleState}</td>
                  <td className="py-2 text-xs">{t.provisioningState}</td>
                  <td className="py-2"><button onClick={() => handleSelectTenant(t.id)} className="text-blue-600 hover:underline text-xs">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTenant && (
        <div className="bg-white border rounded-lg p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Tenant Detail: {selectedTenant.name} ({selectedTenant.slug})</h2>
            <button onClick={() => setSelectedTenant(null)} className="text-sm text-gray-500">Close</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-gray-500">ID</p><p className="font-mono text-xs">{selectedTenant.id}</p></div>
            <div><p className="text-gray-500">Status</p><p className="font-medium">{selectedTenant.status}</p></div>
            <div><p className="text-gray-500">Plan</p><p className="font-medium">{selectedTenant.subscriptionSummary?.planName || 'None'} ({selectedTenant.subscriptionSummary?.planCode || '-'})</p></div>
            <div><p className="text-gray-500">Interval</p><p className="font-medium">{selectedTenant.subscriptionSummary?.interval || 'N/A'}</p></div>
            <div><p className="text-gray-500">Subscription Status</p><p className="font-medium">{selectedTenant.subscriptionSummary?.status || 'None'}</p></div>
            <div><p className="text-gray-500">Renewal</p><p className="font-medium">{selectedTenant.subscriptionSummary?.renewalDate ? new Date(selectedTenant.subscriptionSummary.renewalDate).toLocaleDateString() : 'N/A'}</p></div>
            <div><p className="text-gray-500">Lifecycle</p><p className="font-medium">{selectedTenant.lifecycleState}</p></div>
            <div><p className="text-gray-500">Provisioning</p><p className="font-medium">{selectedTenant.provisioningState}</p></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium mb-2">Effective Features (canonical entitlement)</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {(selectedTenant.entitlements || []).map((e: any) => (
                  <div key={e.featureKey} className="flex justify-between text-xs border-b py-1">
                    <span>{e.featureKey}</span>
                    <span className={e.enabled ? 'text-green-600' : 'text-gray-400'}>{e.enabled ? '✓ Enabled' : '✗ Disabled'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-2">Limits (canonical plan limits)</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {(selectedTenant.limits || []).map((l: any) => (
                  <div key={l.limitKey} className="flex justify-between text-xs border-b py-1">
                    <span>{l.limitKey}</span>
                    <span>{l.unlimited ? 'Unlimited' : `${l.currentUsage}/${l.configuredLimit} (${l.remaining} remain)`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded p-3">
              <h4 className="font-medium text-sm mb-2">Branding</h4>
              {selectedTenant.brandingState ? (
                <div className="text-xs space-y-1">
                  <p>App: {selectedTenant.brandingState.appName}</p>
                  <p>Primary: {selectedTenant.brandingState.primaryColor}</p>
                  <p>Logo: {selectedTenant.brandingState.logoUrl ? 'Set' : 'Not set'}</p>
                  <p>Custom CSS: {selectedTenant.brandingState.hasCustomCss ? 'Yes' : 'No'}</p>
                </div>
              ) : <p className="text-xs text-gray-500">No branding</p>}
            </div>
            <div className="border rounded p-3">
              <h4 className="font-medium text-sm mb-2">Custom Domain</h4>
              {selectedTenant.customDomainState ? (
                <div className="text-xs space-y-1">
                  <p>Domain: {selectedTenant.customDomainState.domain || 'None'}</p>
                  <p>Status: {selectedTenant.customDomainState.status || 'N/A'}</p>
                  <p>Entitlement: {selectedTenant.customDomainState.entitlementAllowed ? 'Allowed' : `Blocked: ${selectedTenant.customDomainState.entitlementReason}`}</p>
                  <p>Verification: {selectedTenant.customDomainState.verificationRequired ? 'Required' : 'Done'}</p>
                </div>
              ) : <p className="text-xs text-gray-500">No domain state</p>}
            </div>
            <div className="border rounded p-3">
              <h4 className="font-medium text-sm mb-2">White-Label</h4>
              {selectedTenant.whiteLabelState ? (
                <div className="text-xs space-y-1">
                  <p>Eligible: {selectedTenant.whiteLabelState.eligible ? 'Yes' : 'No'}</p>
                  <p>State: {selectedTenant.whiteLabelState.provisioningState}</p>
                  <p>Entitlement: {selectedTenant.whiteLabelState.entitlementAllowed ? 'Allowed' : `Blocked: ${selectedTenant.whiteLabelState.entitlementReason}`}</p>
                  <p>Requested: {selectedTenant.whiteLabelState.requestedAt ? new Date(selectedTenant.whiteLabelState.requestedAt).toLocaleDateString() : 'Never'}</p>
                </div>
              ) : <p className="text-xs text-gray-500">No white-label state</p>}
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-2">Domains</h3>
            <div className="text-xs space-y-1">
              {(selectedTenant.domains || []).map((d: any) => (
                <div key={d.id} className="flex justify-between border-b py-1">
                  <span>{d.domain} {d.isPrimary ? '(primary)' : ''}</span>
                  <span className={d.status === 'ACTIVE' ? 'text-green-600' : 'text-yellow-600'}>{d.status}</span>
                </div>
              ))}
              {(!selectedTenant.domains || selectedTenant.domains.length === 0) && <p className="text-gray-500">No domains</p>}
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-2">Available Admin Actions</h3>
            <div className="flex flex-wrap gap-2">
              {(selectedTenant.availableActions || []).map((a: string) => (
                <span key={a} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs border border-blue-200">{a.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {showProvision && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="font-semibold mb-4">Provision Tenant - Idempotent</h3>
            <div className="space-y-3">
              <input type="text" placeholder="Slug (e.g., acme-capital)" value={provisionForm.slug} onChange={(e) => setProvisionForm({ ...provisionForm, slug: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              <input type="text" placeholder="Name (e.g., Acme Capital)" value={provisionForm.name} onChange={(e) => setProvisionForm({ ...provisionForm, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              <input type="email" placeholder="Contact Email" value={provisionForm.contactEmail} onChange={(e) => setProvisionForm({ ...provisionForm, contactEmail: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              <select value={provisionForm.planId} onChange={(e) => setProvisionForm({ ...provisionForm, planId: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">No plan (assign later)</option>
                {plans.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} - {p.code} - {p.price} {p.currency} / {p.interval}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500">Plan pricing from canonical catalog, never hardcoded. Provisioning is idempotent - duplicate slug returns existing.</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleProvision} disabled={provisionLoading || !provisionForm.slug || !provisionForm.name} className="flex-1 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                {provisionLoading ? 'Provisioning...' : 'Provision'}
              </button>
              <button onClick={() => setShowProvision(false)} className="flex-1 py-2 border rounded text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
