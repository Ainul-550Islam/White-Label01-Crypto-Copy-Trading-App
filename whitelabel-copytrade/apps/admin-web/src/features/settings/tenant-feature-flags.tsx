'use client';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { businessAdminApi, type SetTenantFlag, type TenantFeatureFlagRow } from '@/api/business-admin-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { DeveloperI18n, useDeveloperI18n, type DeveloperLocale } from '@/features/developer/i18n';
import { StepUpDialog } from '@/features/developer/step-up-dialog';

const copy: Record<DeveloperLocale, {
  title: string; intro: string; reason: string; reasonHint: string; reasonError: string;
  confirm: string; failed: string; uncertain: string; empty: string; saved: string;
  enabled: string; disabled: string; rollout: string; loading: string;
}> = {
  en: { title: 'Tenant feature flags', intro: 'Overrides apply only to the current tenant. Every change requires verification.', reason: 'Change reason', reasonHint: 'Explain why this override is needed', reasonError: 'Enter a change reason of at least five characters.', confirm: 'Change this tenant feature flag?', failed: 'Unable to load feature flags. Check your access and try again.', uncertain: 'The change could not be confirmed. Refresh the list before retrying.', empty: 'No tenant overrides found.', saved: 'The feature flag was updated.', enabled: 'Enabled — turn off', disabled: 'Disabled — turn on', rollout: 'rollout', loading: 'Loading feature flags…' },
  bn: { title: 'টেন্যান্ট ফিচার ফ্ল্যাগ', intro: 'পরিবর্তন শুধু বর্তমান টেন্যান্টে প্রযোজ্য। প্রতিটি পরিবর্তনে যাচাই প্রয়োজন।', reason: 'পরিবর্তনের কারণ', reasonHint: 'এই পরিবর্তন কেন প্রয়োজন লিখুন', reasonError: 'অন্তত পাঁচ অক্ষরের কারণ লিখুন।', confirm: 'এই টেন্যান্ট ফিচার ফ্ল্যাগ পরিবর্তন করবেন?', failed: 'ফিচার ফ্ল্যাগ লোড করা যায়নি। অনুমতি যাচাই করে আবার চেষ্টা করুন।', uncertain: 'পরিবর্তন নিশ্চিত করা যায়নি। আবার চেষ্টার আগে তালিকা রিফ্রেশ করুন।', empty: 'কোনো টেন্যান্ট পরিবর্তন পাওয়া যায়নি।', saved: 'ফিচার ফ্ল্যাগ হালনাগাদ হয়েছে।', enabled: 'চালু — বন্ধ করুন', disabled: 'বন্ধ — চালু করুন', rollout: 'রোলআউট', loading: 'ফিচার ফ্ল্যাগ লোড হচ্ছে…' },
  ar: { title: 'ميزات المستأجر', intro: 'تنطبق التغييرات على المستأجر الحالي فقط. يتطلب كل تغيير التحقق.', reason: 'سبب التغيير', reasonHint: 'اشرح سبب الحاجة إلى هذا التغيير', reasonError: 'أدخل سبباً من خمسة أحرف على الأقل.', confirm: 'هل تريد تغيير ميزة هذا المستأجر؟', failed: 'تعذر تحميل الميزات. تحقق من صلاحيتك وحاول مجدداً.', uncertain: 'تعذر تأكيد التغيير. حدّث القائمة قبل إعادة المحاولة.', empty: 'لم يتم العثور على إعدادات للمستأجر.', saved: 'تم تحديث الميزة.', enabled: 'مفعّلة — إيقاف', disabled: 'متوقفة — تفعيل', rollout: 'نسبة الإطلاق', loading: 'جارٍ تحميل الميزات…' },
  es: { title: 'Funciones del inquilino', intro: 'Los cambios se aplican solo al inquilino actual. Cada cambio requiere verificación.', reason: 'Motivo del cambio', reasonHint: 'Explica por qué se necesita este cambio', reasonError: 'Introduce un motivo de al menos cinco caracteres.', confirm: '¿Cambiar esta función del inquilino?', failed: 'No se pudieron cargar las funciones. Comprueba tu acceso e inténtalo de nuevo.', uncertain: 'No se pudo confirmar el cambio. Actualiza la lista antes de reintentar.', empty: 'No hay ajustes del inquilino.', saved: 'Se actualizó la función.', enabled: 'Activada — desactivar', disabled: 'Desactivada — activar', rollout: 'despliegue', loading: 'Cargando funciones…' },
  tr: { title: 'Kiracı özellik bayrakları', intro: 'Değişiklikler yalnızca mevcut kiracıya uygulanır. Her değişiklik doğrulama gerektirir.', reason: 'Değişiklik nedeni', reasonHint: 'Bu değişikliğin neden gerekli olduğunu açıklayın', reasonError: 'En az beş karakterlik bir neden girin.', confirm: 'Bu kiracı özellik bayrağı değiştirilsin mi?', failed: 'Özellikler yüklenemedi. Yetkinizi kontrol edip yeniden deneyin.', uncertain: 'Değişiklik doğrulanamadı. Yeniden denemeden önce listeyi yenileyin.', empty: 'Kiracı için ayar bulunamadı.', saved: 'Özellik bayrağı güncellendi.', enabled: 'Etkin — kapat', disabled: 'Kapalı — etkinleştir', rollout: 'yayılım', loading: 'Özellikler yükleniyor…' },
};

type Intent = { payload: SetTenantFlag; identity: string; key: string };
function FlagConsole(): JSX.Element {
  const { locale, setLocale, t } = useDeveloperI18n();
  const text = copy[locale];
  const [rows, setRows] = useState<TenantFeatureFlagRow[]>([]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [pending, setPending] = useState<Intent | null>(null);
  const keys = useRef(new Map<string, string>());
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRows(await businessAdminApi.getTenantFeatureFlags()); setError(''); }
    catch { setError(text.failed); }
    finally { setLoading(false); }
  }, [text.failed]);
  useEffect(() => { void refresh(); }, [refresh]);
  function prepare(flag: TenantFeatureFlagRow): void {
    if (busy) return;
    if (reason.trim().length < 5) { setError(text.reasonError); return; }
    const payload: SetTenantFlag = { key: flag.key, enabled: !flag.enabled, metadata: { ...flag.metadata, reason: reason.trim() } };
    const identity = JSON.stringify(payload);
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    setError(''); setNotice(''); setVerificationError(''); setPending({ payload, identity, key });
  }
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError('');
    try {
      await businessAdminApi.verifyStepUp({ method, action: 'FEATURE_FLAG_LIVE_TOGGLE', ...(method === 'TOTP' ? { code: value } : method === 'PASSWORD' ? { password: value } : { recoveryCode: value }) }, crypto.randomUUID());
    } catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const intent = pending; setPending(null);
    try {
      await businessAdminApi.setTenantFeatureFlag(intent.payload, intent.key);
      keys.current.delete(intent.identity); setReason(''); setNotice(text.saved);
      await refresh();
    } catch { setError(text.uncertain); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="tenant-feature-flags-title" className="space-y-4">
    <header><h1 id="tenant-feature-flags-title" className="text-2xl font-semibold">{text.title}</h1><p className="text-sm text-muted-foreground">{text.intro}</p></header>
    <label>{t.language}{' '}<select value={locale} onChange={(event) => setLocale(event.target.value as DeveloperLocale)}>
      <option value="en">English</option><option value="bn">বাংলা</option><option value="ar">العربية</option><option value="es">Español</option><option value="tr">Türkçe</option>
    </select></label>
    <label className="grid max-w-xl gap-1 text-sm">{text.reason}<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} className="rounded border px-3 py-2" placeholder={text.reasonHint} /></label>
    {pending && <StepUpDialog description={text.confirm} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    {error && <p role="alert">{error} <button className="rounded border px-2 py-1" type="button" onClick={() => void refresh()}>{t.retry}</button></p>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {loading ? <p role="status">{text.loading}</p> : rows.length === 0 && !error ? <p>{text.empty}</p> : <ul className="divide-y">{rows.map((flag) => <li key={flag.key} className="flex items-center justify-between gap-4 py-3">
      <div><p className="font-medium">{flag.key}</p><p className="text-xs text-muted-foreground">{flag.rolloutPercentage ?? 100}% {text.rollout}</p></div>
      <button type="button" aria-pressed={flag.enabled} disabled={busy} onClick={() => prepare(flag)} className="rounded border px-3 py-2 disabled:opacity-50">{busy && pending?.payload.key === flag.key ? t.saving : flag.enabled ? text.enabled : text.disabled}</button>
    </li>)}</ul>}
  </section>;
}
export function TenantFeatureFlags(): JSX.Element { return <DeveloperI18n><FlagConsole /></DeveloperI18n>; }
