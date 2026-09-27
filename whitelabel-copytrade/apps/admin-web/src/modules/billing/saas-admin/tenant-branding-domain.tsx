'use client';

import React, { useEffect, useState } from 'react';
import {
  getTenantDetail,
  getBranding,
  updateBranding,
  listDomains,
  registerDomain,
  generateVerificationChallenge,
  verifyDomain,
  removeDomain,
  getWhiteLabelState,
  requestWhiteLabel,
  enableWhiteLabel,
  disableWhiteLabel,
  getFeatureAccess,
} from './saas-admin-api';

/**
 * Tenant branding + custom-domain control UI.
 * Entitlement-aware controls and domain verification status.
 * Disables or explains unavailable features based on backend entitlement.
 */
export default function TenantBrandingDomainPage({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<any>(null);
  const [branding, setBranding] = useState<any>(null);
  const [domains, setDomains] = useState<any[]>([]);
  const [domainState, setDomainState] = useState<any>(null);
  const [whiteLabel, setWhiteLabel] = useState<any>(null);
  const [featureAccess, setFeatureAccess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [brandingForm, setBrandingForm] = useState<any>({});
  const [domainInput, setDomainInput] = useState('');
  const [verificationChallenge, setVerificationChallenge] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantRes, brandingRes, domainsRes, wlRes, faRes] = await Promise.all([
        getTenantDetail(tenantId),
        getBranding(tenantId).catch(() => null),
        listDomains(tenantId).catch(() => ({ domains: [], currentState: null })),
        getWhiteLabelState(tenantId).catch(() => null),
        getFeatureAccess(tenantId).catch(() => null),
      ]);
      setTenant(tenantRes);
      setBranding(brandingRes);
      setDomains(domainsRes.domains || []);
      setDomainState(domainsRes.currentState || null);
      setWhiteLabel(wlRes);
      setFeatureAccess(faRes);
      if (brandingRes) {
        setBrandingForm({
          appName: brandingRes.appName || '',
          logoUrl: brandingRes.logoUrl || '',
          primaryColor: brandingRes.primaryColor || '#1B2A4A',
          secondaryColor: brandingRes.secondaryColor || '#0F172A',
          accentColor: brandingRes.accentColor || '#22C55E',
          supportEmail: brandingRes.supportEmail || '',
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenantId]);

  const handleBrandingUpdate = async () => {
    setActionLoading('branding');
    setMessage(null);
    try {
      const payload: any = {};
      if (brandingForm.appName) payload.appName = brandingForm.appName;
      if (brandingForm.logoUrl) payload.logoUrl = brandingForm.logoUrl;
      if (brandingForm.primaryColor) payload.primaryColor = brandingForm.primaryColor;
      if (brandingForm.secondaryColor) payload.secondaryColor = brandingForm.secondaryColor;
      if (brandingForm.accentColor) payload.accentColor = brandingForm.accentColor;
      if (brandingForm.supportEmail) payload.supportEmail = brandingForm.supportEmail;

      const result = await updateBranding(tenantId, payload);
      setMessage(`Branding updated: ${result.message || 'success'}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Branding update failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRegisterDomain = async () => {
    if (!domainInput) return;
    setActionLoading('register_domain');
    setMessage(null);
    try {
      const result = await registerDomain(tenantId, domainInput, true);
      setMessage(`Domain registered: ${result.domain} - ${result.message}`);
      setDomainInput('');
      await fetchData();
    } catch (e: any) {
      setMessage(`Domain registration failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateChallenge = async (domain: string) => {
    setActionLoading(`challenge_${domain}`);
    setMessage(null);
    try {
      const challenge = await generateVerificationChallenge(tenantId, domain);
      setVerificationChallenge(challenge);
      setMessage(`Challenge generated: ${challenge.message || ''} Record: ${challenge.verificationRecord || ''}`);
    } catch (e: any) {
      setMessage(`Challenge generation failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifyDomain = async (domain: string) => {
    setActionLoading(`verify_${domain}`);
    setMessage(null);
    try {
      const result = await verifyDomain(tenantId, domain);
      setMessage(`Verification: ${result.status} - verified: ${result.verified} ${result.failureReason || ''}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Verification failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveDomain = async (domain: string) => {
    if (!confirm(`Remove domain ${domain}?`)) return;
    setActionLoading(`remove_${domain}`);
    setMessage(null);
    try {
      await removeDomain(tenantId, domain);
      setMessage(`Domain ${domain} removed`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Remove failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRequestWhiteLabel = async () => {
    setActionLoading('wl_request');
    setMessage(null);
    try {
      const result = await requestWhiteLabel(tenantId, { requestedAt: new Date().toISOString() });
      setMessage(`White-label requested: ${result.provisioningState}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`White-label request failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnableWhiteLabel = async () => {
    setActionLoading('wl_enable');
    setMessage(null);
    try {
      const result = await enableWhiteLabel(tenantId);
      setMessage(`White-label enabled: ${result.provisioningState}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`White-label enable failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisableWhiteLabel = async () => {
    setActionLoading('wl_disable');
    setMessage(null);
    try {
      const result = await disableWhiteLabel(tenantId, 'Admin disabled');
      setMessage(`White-label disabled: ${result.provisioningState}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`White-label disable failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const customDomainAllowed = featureAccess?.features?.find((f: any) => f.featureKey === 'customDomain')?.enabled ?? domainState?.entitlementAllowed ?? false;
  const customDomainReason = featureAccess?.features?.find((f: any) => f.featureKey === 'customDomain')?.reason || domainState?.entitlementReason;
  const whiteLabelAllowed = featureAccess?.features?.find((f: any) => f.featureKey === 'whiteLabelMobileApp')?.enabled ?? whiteLabel?.entitlementAllowed ?? false;
  const whiteLabelReason = featureAccess?.features?.find((f: any) => f.featureKey === 'whiteLabelMobileApp')?.reason || whiteLabel?.entitlementReason;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Branding & Domains - {tenant?.name || tenantId}</h1>
      <p className="text-sm text-gray-500">Branding uses existing sanitization. Custom domain requires customDomain entitlement. White-label requires whiteLabelMobileApp entitlement.</p>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}

      {/* Branding */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Tenant Branding</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">App Name</label>
            <input type="text" value={brandingForm.appName || ''} onChange={(e) => setBrandingForm({ ...brandingForm, appName: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" maxLength={64} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Logo URL</label>
            <input type="url" value={brandingForm.logoUrl || ''} onChange={(e) => setBrandingForm({ ...brandingForm, logoUrl: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Primary Color</label>
            <input type="text" value={brandingForm.primaryColor || ''} onChange={(e) => setBrandingForm({ ...brandingForm, primaryColor: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="#1B2A4A" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Secondary Color</label>
            <input type="text" value={brandingForm.secondaryColor || ''} onChange={(e) => setBrandingForm({ ...brandingForm, secondaryColor: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="#0F172A" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Accent Color</label>
            <input type="text" value={brandingForm.accentColor || ''} onChange={(e) => setBrandingForm({ ...brandingForm, accentColor: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="#22C55E" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Support Email</label>
            <input type="email" value={brandingForm.supportEmail || ''} onChange={(e) => setBrandingForm({ ...brandingForm, supportEmail: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">Custom CSS sanitized server-side: @import, url(), script vectors removed. No arbitrary unsafe HTML.</p>
        <button onClick={handleBrandingUpdate} disabled={actionLoading === 'branding'} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {actionLoading === 'branding' ? 'Updating...' : 'Update Branding'}
        </button>

        {branding && (
          <div className="mt-4 border-t pt-3 text-xs space-y-1">
            <p><span className="text-gray-500">Current:</span> {branding.appName} - {branding.primaryColor}</p>
            <p><span className="text-gray-500">Updated:</span> {branding.updatedAt ? new Date(branding.updatedAt).toLocaleString() : 'Never'}</p>
          </div>
        )}
      </div>

      {/* Custom Domain */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Custom Domain</h2>
        {!customDomainAllowed ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
            <p className="text-yellow-800 font-medium">Custom domain not allowed</p>
            <p className="text-yellow-700 text-xs mt-1">{customDomainReason || 'Feature not included in current plan - requires customDomain entitlement'}</p>
            <p className="text-xs text-gray-500 mt-2">Entitlement check: Tenant → Subscription → Plan → Entitlement Resolver → Feature Guard → Reject</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <input type="text" placeholder="app.example.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm" />
              <button onClick={handleRegisterDomain} disabled={!domainInput || actionLoading === 'register_domain'} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                {actionLoading === 'register_domain' ? 'Registering...' : 'Register Domain'}
              </button>
            </div>

            <div className="space-y-2">
              {domains.map((d: any) => (
                <div key={d.id} className="border rounded p-3 flex justify-between items-center">
                  <div className="text-sm">
                    <p className="font-medium">{d.domain} {d.isPrimary ? '(primary)' : ''}</p>
                    <p className="text-xs text-gray-500">Status: <span className={d.status === 'ACTIVE' ? 'text-green-600' : 'text-yellow-600'}>{d.status}</span> {d.verifiedAt ? `Verified: ${new Date(d.verifiedAt).toLocaleDateString()}` : 'Not verified'}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleGenerateChallenge(d.domain)} disabled={!!actionLoading} className="px-2 py-1 border rounded text-xs">Challenge</button>
                    <button onClick={() => handleVerifyDomain(d.domain)} disabled={!!actionLoading} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Verify</button>
                    <button onClick={() => handleRemoveDomain(d.domain)} disabled={!!actionLoading} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                  </div>
                </div>
              ))}
              {domains.length === 0 && <p className="text-sm text-gray-500">No custom domains registered</p>}
            </div>

            {verificationChallenge && (
              <div className="mt-4 bg-gray-50 border rounded p-3 text-xs">
                <p className="font-medium">Verification Challenge for {verificationChallenge.domain}</p>
                <p className="mt-1">Type: {verificationChallenge.verificationType}</p>
                <p>Record: {verificationChallenge.verificationRecord}</p>
                <p>Token: {verificationChallenge.token}</p>
                <p>Expires: {verificationChallenge.expiresAt ? new Date(verificationChallenge.expiresAt).toLocaleString() : ''}</p>
                <p className="mt-2 text-gray-600">{verificationChallenge.message}</p>
                <p className="mt-1">Add TXT record: _wlct-challenge.{verificationChallenge.domain} → {verificationChallenge.verificationRecord}</p>
              </div>
            )}

            {domainState && (
              <div className="mt-4 text-xs border-t pt-3">
                <p>Current State: {domainState.domain || 'None'} - {domainState.status || 'N/A'}</p>
                <p>Verification Required: {domainState.verificationRequired ? 'Yes' : 'No'}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* White-Label */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">White-Label Mobile App</h2>
        {!whiteLabelAllowed ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
            <p className="text-yellow-800 font-medium">White-label not allowed</p>
            <p className="text-yellow-700 text-xs mt-1">{whiteLabelReason || 'Requires whiteLabelMobileApp entitlement'}</p>
            <p className="text-xs text-gray-500 mt-2">White-label remains commercial entitlement. Not enabled merely by admin click.</p>
          </div>
        ) : (
          <>
            <div className="text-sm space-y-1 mb-4">
              <p><span className="text-gray-500">Eligible:</span> {whiteLabel?.eligible ? 'Yes' : 'No'}</p>
              <p><span className="text-gray-500">State:</span> {whiteLabel?.provisioningState || 'NOT_REQUESTED'}</p>
              <p><span className="text-gray-500">Requested:</span> {whiteLabel?.requestedAt ? new Date(whiteLabel.requestedAt).toLocaleString() : 'Never'}</p>
              <p><span className="text-gray-500">Enabled:</span> {whiteLabel?.enabledAt ? new Date(whiteLabel.enabledAt).toLocaleString() : 'Not yet'}</p>
            </div>
            <div className="flex gap-2">
              {(whiteLabel?.provisioningState === 'NOT_REQUESTED' || !whiteLabel?.provisioningState) && (
                <button onClick={handleRequestWhiteLabel} disabled={actionLoading === 'wl_request'} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === 'wl_request' ? 'Requesting...' : 'Request White-Label'}
                </button>
              )}
              {whiteLabel?.provisioningState === 'REQUESTED' && (
                <button onClick={handleEnableWhiteLabel} disabled={actionLoading === 'wl_enable'} className="px-4 py-2 bg-green-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === 'wl_enable' ? 'Enabling...' : 'Enable White-Label (Entitlement Check)'}
                </button>
              )}
              {whiteLabel?.provisioningState === 'ACTIVE' && (
                <button onClick={handleDisableWhiteLabel} disabled={actionLoading === 'wl_disable'} className="px-4 py-2 bg-red-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === 'wl_disable' ? 'Disabling...' : 'Disable White-Label'}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-3">Flow: Request → Entitlement Check → Provisioning → Active. Never direct DB flag.</p>
          </>
        )}
      </div>

      {/* Feature Access */}
      {featureAccess && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-medium mb-3">Effective Feature Access (Same Enforcement as Runtime)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-medium mb-2">Features</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(featureAccess.features || []).map((f: any) => (
                  <div key={f.featureKey} className="flex justify-between text-xs border-b py-1">
                    <span>{f.featureKey}</span>
                    <span className={f.enabled ? 'text-green-600' : 'text-red-600'}>{f.enabled ? '✓' : '✗'} {f.source} {f.reason ? `(${f.reason})` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Limits</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(featureAccess.limits || []).map((l: any) => (
                  <div key={l.limitKey} className="flex justify-between text-xs border-b py-1">
                    <span>{l.limitKey}</span>
                    <span>{l.unlimited ? 'Unlimited' : `${l.currentUsage}/${l.configuredLimit}`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
