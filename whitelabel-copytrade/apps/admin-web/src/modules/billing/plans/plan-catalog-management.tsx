'use client';

import React, { useEffect, useState } from 'react';

import { ApiError } from '@/lib/api-error';

import { activatePlan, archivePlan, createPlan, deactivatePlan, getPlans, updatePlan } from './plan-api';
import { formatAudience, formatBps, formatInterval, formatPrice, formatStatus, LIMIT_LABELS } from './plan-formatters';
import {
  BILLING_INTERVALS,
  PLAN_AUDIENCES,
  PLAN_CURRENCIES,
  type BillingInterval,
  type CreatePlanRequest,
  type Plan,
  type PlanAudience,
  type PlanCurrency,
  type PlanLimits,
  type PlanPage,
  planStatus,
  PlanStatus,
} from './plan-types';

/**
 * Plan catalogue (round 7): lists the plans the caller can see and, with
 * `plan:manage`, creates, edits, activates/deactivates and archives them.
 * Every action is a /v1/billing/plans route; the API re-authorises each call
 * (platform operators manage the platform catalogue, a tenant only its own
 * plans) and refuses archiving a plan that still has live subscribers.
 * Prices are entered and shown as decimal strings; nothing is computed here.
 */

const PAGE_SIZE = 25;

const NUMERIC_LIMITS: Array<keyof PlanLimits> = [
  'maxUsers',
  'maxTraders',
  'maxFollowersPerTrader',
  'maxExchangeAccountsPerUser',
  'maxCopySubscriptionsPerFollower',
  'maxApiRequestsPerMinute',
  'websocketConnections',
];
const BOOLEAN_LIMITS: Array<keyof PlanLimits> = ['customDomain', 'whiteLabelMobileApp', 'prioritySupport'];

interface PlanForm {
  code: string;
  name: string;
  description: string;
  audience: PlanAudience;
  price: string;
  currency: PlanCurrency;
  interval: BillingInterval;
  trialDays: string;
  platformFeeBps: string;
  performanceFeeBps: string;
  sortOrder: string;
  features: string;
  isActive: boolean;
  limits: Record<string, string | boolean>;
}

function emptyForm(): PlanForm {
  const limits: Record<string, string | boolean> = {};
  NUMERIC_LIMITS.forEach((key) => (limits[key] = ''));
  BOOLEAN_LIMITS.forEach((key) => (limits[key] = false));
  return {
    code: '',
    name: '',
    description: '',
    audience: 'TENANT',
    price: '',
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: '0',
    platformFeeBps: '0',
    performanceFeeBps: '0',
    sortOrder: '0',
    features: '',
    isActive: true,
    limits,
  };
}

function formFromPlan(plan: Plan): PlanForm {
  const limits: Record<string, string | boolean> = {};
  NUMERIC_LIMITS.forEach((key) => {
    const value = plan.limits?.[key];
    limits[key] = value === null || value === undefined ? '' : String(value);
  });
  BOOLEAN_LIMITS.forEach((key) => (limits[key] = Boolean(plan.limits?.[key])));
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? '',
    audience: plan.audience as PlanAudience,
    price: String(plan.price),
    currency: plan.currency as PlanCurrency,
    interval: plan.interval as BillingInterval,
    trialDays: String(plan.trialDays ?? 0),
    platformFeeBps: String(plan.platformFeeBps ?? 0),
    performanceFeeBps: String(plan.performanceFeeBps ?? 0),
    sortOrder: String(plan.sortOrder ?? 0),
    features: (plan.features ?? []).join(', '),
    isActive: plan.isActive,
    limits,
  };
}

/** Blank numeric limit = unlimited (null). */
function limitsFromForm(form: PlanForm): Partial<PlanLimits> {
  const limits: Record<string, number | boolean | null> = {};
  NUMERIC_LIMITS.forEach((key) => {
    const raw = String(form.limits[key] ?? '').trim();
    limits[key] = raw === '' ? null : Number.parseInt(raw, 10);
  });
  BOOLEAN_LIMITS.forEach((key) => (limits[key] = Boolean(form.limits[key])));
  return limits as Partial<PlanLimits>;
}

function featuresFromForm(form: PlanForm): string[] {
  return [...new Set(form.features.split(',').map((f) => f.trim()).filter(Boolean))];
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.entries(error.fieldErrors);
    return fields.length > 0 ? `${error.message} (${fields.map(([f, m]) => `${f}: ${m}`).join('; ')})` : error.message;
  }
  return error instanceof Error ? error.message : 'The request failed';
}

export default function PlanCatalogManagement({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState<PlanPage | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [search, setSearch] = useState('');
  // Managers need inactive plans listed, otherwise a deactivated plan vanishes
  // and can never be re-activated from here. Readers default to what is on sale.
  const [includeInactive, setIncludeInactive] = useState(canManage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm());

  const load = async (requestedPage = pageNumber) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPlans({ page: requestedPage, limit: PAGE_SIZE, search, sortBy: 'sortOrder', sortOrder: 'asc', includeInactive });
      setPage(result);
      setPageNumber(requestedPage);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  /** Runs one API action; true when it succeeded (the list is then reloaded). */
  const runAction = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setEditing('new');
    setMessage(null);
  };

  const openEdit = (plan: Plan) => {
    setForm(formFromPlan(plan));
    setEditing(plan);
    setMessage(null);
  };

  const save = async () => {
    if (editing === null) return;
    const common = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price: form.price.trim(),
      interval: form.interval,
      trialDays: toInt(form.trialDays),
      platformFeeBps: toInt(form.platformFeeBps),
      performanceFeeBps: toInt(form.performanceFeeBps),
      sortOrder: toInt(form.sortOrder),
      features: featuresFromForm(form),
      limits: limitsFromForm(form),
      isActive: form.isActive,
    };
    if (editing === 'new') {
      const request: CreatePlanRequest = {
        ...common,
        code: form.code.trim().toLowerCase(),
        audience: form.audience,
        currency: form.currency,
      };
      if (await runAction('save', () => createPlan(request), `Plan ${request.code} created`)) setEditing(null);
    } else if (await runAction('save', () => updatePlan(editing.id, common), `Plan ${editing.code} updated`)) {
      setEditing(null);
    }
  };

  const plans = page?.items ?? [];
  const totalPages = page?.pagination.totalPages ?? 1;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Plan catalogue</h1>
          <p className="text-sm text-gray-500 mt-1">
            Plans, prices, limits and features come from the billing API. Changing a plan never edits an existing subscription.
          </p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">
            New plan
          </button>
        )}
      </div>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(1);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          placeholder="Search plans by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" className="px-4 py-2 bg-gray-800 text-white rounded text-sm">
          Search
        </button>
        <button type="button" onClick={() => load()} className="px-3 py-2 border rounded text-sm">
          Refresh
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
      </form>

      <div className="bg-white border rounded-lg p-4">
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-gray-200 rounded" />
            <div className="h-8 bg-gray-200 rounded" />
            <div className="h-8 bg-gray-200 rounded" />
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-12">No plans found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Code</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">Audience</th>
                  <th className="py-2">Price</th>
                  <th className="py-2">Fees</th>
                  <th className="py-2">Scope</th>
                  <th className="py-2">Status</th>
                  {canManage && <th className="py-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const status = planStatus(plan);
                  return (
                    <tr key={plan.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 font-mono text-xs">{plan.code}</td>
                      <td className="py-2">
                        {plan.name}
                        <p className="text-xs text-gray-500">{formatInterval(plan.interval)}{plan.trialDays > 0 ? ` - ${plan.trialDays}-day trial` : ''}</p>
                      </td>
                      <td className="py-2 text-xs">{formatAudience(plan.audience)}</td>
                      <td className="py-2">{formatPrice(plan)}</td>
                      <td className="py-2 text-xs">
                        Platform {formatBps(plan.platformFeeBps)}
                        <br />
                        Performance {formatBps(plan.performanceFeeBps)}
                      </td>
                      <td className="py-2 text-xs">{plan.tenantId ? 'Organisation plan' : 'Platform plan'}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${status === PlanStatus.ACTIVE ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {formatStatus(status)}
                        </span>
                      </td>
                      {canManage && (
                        <td className="py-2">
                          <div className="flex gap-2 flex-wrap">
                            <button onClick={() => openEdit(plan)} disabled={!!busy} className="text-blue-600 hover:underline text-xs disabled:opacity-50">
                              Edit
                            </button>
                            {plan.isActive ? (
                              <button
                                onClick={() => runAction(`deactivate:${plan.id}`, () => deactivatePlan(plan.id), `Plan ${plan.code} is no longer offered`)}
                                disabled={!!busy}
                                className="text-yellow-700 hover:underline text-xs disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                onClick={() => runAction(`activate:${plan.id}`, () => activatePlan(plan.id), `Plan ${plan.code} is offered again`)}
                                disabled={!!busy}
                                className="text-green-600 hover:underline text-xs disabled:opacity-50"
                              >
                                Activate
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (window.confirm(`Archive plan ${plan.code}? The API refuses while it still has trialing, active or past-due subscribers.`)) {
                                  runAction(`archive:${plan.id}`, () => archivePlan(plan.id), `Plan ${plan.code} archived`);
                                }
                              }}
                              disabled={!!busy}
                              className="text-red-600 hover:underline text-xs disabled:opacity-50"
                            >
                              Archive
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-between items-center pt-3 text-xs text-gray-500">
          <span>
            {page?.pagination.totalItems ?? 0} plans - page {pageNumber} of {Math.max(1, totalPages)}
          </span>
          <div className="flex gap-2">
            <button onClick={() => load(pageNumber - 1)} disabled={loading || pageNumber <= 1} className="px-3 py-1 border rounded disabled:opacity-50">
              Previous
            </button>
            <button onClick={() => load(pageNumber + 1)} disabled={loading || pageNumber >= totalPages} className="px-3 py-1 border rounded disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      </div>

      {editing !== null && canManage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full overflow-y-auto" style={{ maxWidth: 720, maxHeight: '90vh' }}>
            <h3 className="font-semibold mb-4">{editing === 'new' ? 'New plan' : `Edit plan ${editing.code}`}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Code (lowercase slug, cannot change later)</span>
                <input
                  type="text"
                  value={form.code}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Name</span>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Description</span>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Audience (cannot change later)</span>
                <select
                  value={form.audience}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, audience: e.target.value as PlanAudience })}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {PLAN_AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {formatAudience(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Price (decimal, e.g. 49.00)</span>
                <input type="text" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Currency (cannot change later)</span>
                <select
                  value={form.currency}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, currency: e.target.value as PlanCurrency })}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {PLAN_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Billing interval</span>
                <select value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value as BillingInterval })} className="w-full border rounded px-3 py-2 text-sm">
                  {BILLING_INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {formatInterval(i)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Trial days</span>
                <input type="number" min={0} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Platform fee (basis points)</span>
                <input type="number" min={0} value={form.platformFeeBps} onChange={(e) => setForm({ ...form, platformFeeBps: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Performance fee (basis points)</span>
                <input type="number" min={0} value={form.performanceFeeBps} onChange={(e) => setForm({ ...form, performanceFeeBps: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Sort order</span>
                <input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-gray-500">Features (comma-separated keys)</span>
                <input type="text" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
              </label>
            </div>

            <h4 className="font-medium text-sm mt-4 mb-2">Limits (blank = unlimited)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {NUMERIC_LIMITS.map((key) => (
                <label key={key} className="space-y-1">
                  <span className="block text-xs text-gray-500">{LIMIT_LABELS[key]}</span>
                  <input
                    type="number"
                    min={0}
                    value={String(form.limits[key] ?? '')}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: e.target.value } })}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </label>
              ))}
              {BOOLEAN_LIMITS.map((key) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form.limits[key])}
                    onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: e.target.checked } })}
                  />
                  <span className="text-sm">{LIMIT_LABELS[key]}</span>
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span className="text-sm">Offered for purchase (active)</span>
              </label>
            </div>

            {message && message.startsWith('Error:') && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800 mt-4">{message}</div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={save}
                disabled={busy === 'save' || !form.name.trim() || !form.price.trim() || (editing === 'new' && !form.code.trim())}
                className="flex-1 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
              >
                {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(null)} className="flex-1 py-2 border rounded text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
