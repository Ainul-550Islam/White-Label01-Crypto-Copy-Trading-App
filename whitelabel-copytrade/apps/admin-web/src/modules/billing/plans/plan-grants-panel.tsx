'use client';
import { useRef, useState, type FormEvent, type JSX } from 'react';
import type { Plan } from './plan-types';
import { updatePlanGrants, verifyPlanAction } from './plan-api';
import type { StepUpMethod } from '@/api/developer-platform-api';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import { useDeveloperI18n, type DeveloperLocale } from '@/features/developer/i18n';

const copy = {
  en: { title: 'Developer and feature grants', help: 'These limits apply to tenants subscribed to this platform plan. Zero blocks the corresponding quota. Saving changes existing entitlements.', quotas: 'Developer quotas', features: 'Capabilities and tenant flags', language: 'Language', save: 'Review and save', cancel: 'Close', confirm: 'Confirm this plan grant change.', invalid: 'Enter a whole number from 0 to 100000.', failed: 'The change could not be confirmed. Refresh the plan before retrying.', verify: 'Verification failed. Try again.' },
  bn: { title: 'ডেভেলপার ও বৈশিষ্ট্যের অনুমতি', help: 'এই সীমা প্ল্যাটফর্ম পরিকল্পনায় সাবস্ক্রাইব করা টেন্যান্টদের জন্য প্রযোজ্য। শূন্য মানে সংশ্লিষ্ট কোটা বন্ধ। সংরক্ষণে বিদ্যমান অনুমতি বদলাবে।', quotas: 'ডেভেলপার কোটা', features: 'ক্ষমতা ও টেন্যান্ট ফ্ল্যাগ', language: 'ভাষা', save: 'পর্যালোচনা করে সংরক্ষণ', cancel: 'বন্ধ করুন', confirm: 'এই পরিকল্পনার অনুমতি পরিবর্তন নিশ্চিত করুন।', invalid: '০ থেকে ১০০০০০ এর মধ্যে পূর্ণসংখ্যা দিন।', failed: 'পরিবর্তন নিশ্চিত করা যায়নি। আবার চেষ্টা করার আগে পরিকল্পনা রিফ্রেশ করুন।', verify: 'যাচাই ব্যর্থ হয়েছে। আবার চেষ্টা করুন।' },
  ar: { title: 'أذونات المطور والميزات', help: 'تنطبق هذه الحدود على المستأجرين المشتركين في خطة المنصة. الصفر يعطل الحصة المعنية. يؤدي الحفظ إلى تغيير الأذونات الحالية.', quotas: 'حصص المطور', features: 'القدرات وأعلام المستأجر', language: 'اللغة', save: 'مراجعة وحفظ', cancel: 'إغلاق', confirm: 'أكد تغيير أذونات الخطة.', invalid: 'أدخل عدداً صحيحاً بين ٠ و١٠٠٠٠٠.', failed: 'تعذر تأكيد التغيير. حدّث الخطة قبل إعادة المحاولة.', verify: 'فشل التحقق. حاول مجدداً.' },
  es: { title: 'Permisos de desarrollador y funciones', help: 'Estos límites se aplican a los clientes suscritos al plan de plataforma. Cero bloquea la cuota correspondiente. Guardar cambia los permisos existentes.', quotas: 'Cuotas de desarrollador', features: 'Capacidades y funciones del cliente', language: 'Idioma', save: 'Revisar y guardar', cancel: 'Cerrar', confirm: 'Confirma el cambio de permisos del plan.', invalid: 'Introduce un número entero entre 0 y 100000.', failed: 'No se pudo confirmar el cambio. Actualiza el plan antes de reintentar.', verify: 'Falló la verificación. Inténtalo de nuevo.' },
  tr: { title: 'Geliştirici ve özellik izinleri', help: 'Bu sınırlar platform planına abone olan kiracılar için geçerlidir. Sıfır ilgili kotayı engeller. Kaydetmek mevcut izinleri değiştirir.', quotas: 'Geliştirici kotaları', features: 'Yetenekler ve kiracı bayrakları', language: 'Dil', save: 'Gözden geçir ve kaydet', cancel: 'Kapat', confirm: 'Plan izni değişikliğini doğrulayın.', invalid: '0 ile 100000 arasında bir tam sayı girin.', failed: 'Değişiklik doğrulanamadı. Yeniden denemeden önce planı yenileyin.', verify: 'Doğrulama başarısız. Tekrar deneyin.' },
} as const;
type Labels = Record<DeveloperLocale, string>;
const quota: Array<[string, Labels]> = [
 ['developer_applications',{en:'Applications',bn:'অ্যাপ্লিকেশন',ar:'التطبيقات',es:'Aplicaciones',tr:'Uygulamalar'}],
 ['developer_credentials_per_app',{en:'Credentials per application',bn:'প্রতি অ্যাপ্লিকেশনে শংসাপত্র',ar:'بيانات الاعتماد لكل تطبيق',es:'Credenciales por aplicación',tr:'Uygulama başına kimlik bilgisi'}],
 ['developer_redirect_uris',{en:'Redirect URIs',bn:'রিডাইরেক্ট URI',ar:'عناوين إعادة التوجيه',es:'URI de redirección',tr:'Yönlendirme URI sayısı'}],
 ['developer_webhook_subscriptions',{en:'Webhook subscriptions',bn:'ওয়েবহুক সাবস্ক্রিপশন',ar:'اشتراكات الويب هوك',es:'Suscripciones webhook',tr:'Webhook abonelikleri'}],
 ['developer_webhook_endpoints_per_app',{en:'Webhook endpoints per application',bn:'প্রতি অ্যাপ্লিকেশনে ওয়েবহুক এন্ডপয়েন্ট',ar:'نقاط ويب هوك لكل تطبيق',es:'Endpoints webhook por aplicación',tr:'Uygulama başına webhook uç noktası'}],
 ['developer_rate_burst_per_minute',{en:'Burst requests per minute',bn:'প্রতি মিনিটে সর্বোচ্চ অনুরোধ',ar:'ذروة الطلبات في الدقيقة',es:'Pico de solicitudes por minuto',tr:'Dakikalık ani istek sınırı'}],
 ['developer_rate_sustained_per_minute',{en:'Sustained requests per minute',bn:'প্রতি মিনিটে স্থায়ী অনুরোধ',ar:'الطلبات المستمرة في الدقيقة',es:'Solicitudes sostenidas por minuto',tr:'Dakikalık sürekli istek sınırı'}],
 ['developer_reactivation_review',{en:'Reactivation review (0 or 1)',bn:'পুনঃসক্রিয়করণ পর্যালোচনা (০ বা ১)',ar:'مراجعة إعادة التنشيط (٠ أو ١)',es:'Revisión de reactivación (0 o 1)',tr:'Yeniden etkinleştirme incelemesi (0 veya 1)'}],
];
const grants: Array<[string, Labels]> = [
 ['developer_feature_portfolio_read',{en:'Portfolio read',bn:'পোর্টফোলিও দেখা',ar:'قراءة المحفظة',es:'Lectura de cartera',tr:'Portföy okuma'}],
 ['developer_feature_webhooks',{en:'Webhook management',bn:'ওয়েবহুক ব্যবস্থাপনা',ar:'إدارة الويب هوك',es:'Gestión de webhooks',tr:'Webhook yönetimi'}],
 ['developer_feature_reporting',{en:'Reports',bn:'রিপোর্ট',ar:'التقارير',es:'Informes',tr:'Raporlar'}],
 ['developer_feature_billing',{en:'Billing read',bn:'বিলিং দেখা',ar:'قراءة الفوترة',es:'Lectura de facturación',tr:'Faturalama okuma'}],
 ['developer_feature_trading',{en:'Trading',bn:'ট্রেডিং',ar:'التداول',es:'Operaciones',tr:'İşlem'}],
 ['developer_feature_copy_trading',{en:'Copy trading API',bn:'কপি ট্রেডিং API',ar:'واجهة نسخ التداول',es:'API de copy trading',tr:'Kopya işlem API’si'}],
 ['developer_feature_billing_manage',{en:'Billing management',bn:'বিলিং ব্যবস্থাপনা',ar:'إدارة الفوترة',es:'Gestión de facturación',tr:'Faturalama yönetimi'}],
 ['developer_feature_funding',{en:'Funding',bn:'তহবিল',ar:'التمويل',es:'Fondos',tr:'Fonlama'}],
 ['developer_feature_management',{en:'Developer management',bn:'ডেভেলপার ব্যবস্থাপনা',ar:'إدارة المطور',es:'Gestión de desarrollador',tr:'Geliştirici yönetimi'}],
 ['tenant_flag_grant_copy_trading',{en:'Copy trading flag',bn:'কপি ট্রেডিং ফ্ল্যাগ',ar:'علامة نسخ التداول',es:'Función de copy trading',tr:'Kopya işlem bayrağı'}],
 ['tenant_flag_grant_spot_trading',{en:'Spot trading flag',bn:'স্পট ট্রেডিং ফ্ল্যাগ',ar:'علامة التداول الفوري',es:'Función de operaciones al contado',tr:'Spot işlem bayrağı'}],
 ['tenant_flag_grant_paper_trading',{en:'Paper trading flag',bn:'পেপার ট্রেডিং ফ্ল্যাগ',ar:'علامة التداول التجريبي',es:'Función de operaciones simuladas',tr:'Sanal işlem bayrağı'}],
 ['tenant_flag_grant_referral_program',{en:'Referral program flag',bn:'রেফারেল ফ্ল্যাগ',ar:'علامة برنامج الإحالة',es:'Función de referidos',tr:'Yönlendirme programı bayrağı'}],
 ['tenant_flag_grant_kyc_required',{en:'KYC required flag',bn:'KYC আবশ্যক ফ্ল্যাগ',ar:'علامة اشتراط التحقق',es:'Función de KYC obligatorio',tr:'KYC gerekli bayrağı'}],
 ['tenant_flag_grant_two_factor_mandatory',{en:'Mandatory two-factor flag',bn:'আবশ্যিক দুই-ধাপ ফ্ল্যাগ',ar:'علامة المصادقة الثنائية الإلزامية',es:'Función de doble factor obligatorio',tr:'Zorunlu iki faktör bayrağı'}],
 ['tenant_flag_grant_public_registration',{en:'Public registration flag',bn:'উন্মুক্ত নিবন্ধন ফ্ল্যাগ',ar:'علامة التسجيل العام',es:'Función de registro público',tr:'Herkese açık kayıt bayrağı'}],
 ['tenant_flag_grant_mobile_app',{en:'Mobile app flag',bn:'মোবাইল অ্যাপ ফ্ল্যাগ',ar:'علامة تطبيق الهاتف',es:'Función de aplicación móvil',tr:'Mobil uygulama bayrağı'}],
 ['tenant_flag_grant_withdrawal_notifications',{en:'Withdrawal notifications flag',bn:'উত্তোলন বিজ্ঞপ্তি ফ্ল্যাগ',ar:'علامة إشعارات السحب',es:'Función de avisos de retiro',tr:'Çekim bildirimleri bayrağı'}],
 ['tenant_flag_grant_custom_domain',{en:'Custom domain flag',bn:'কাস্টম ডোমেইন ফ্ল্যাগ',ar:'علامة النطاق المخصص',es:'Función de dominio personalizado',tr:'Özel alan adı bayrağı'}],
 ['tenant_flag_grant_advanced_analytics',{en:'Advanced analytics flag',bn:'উন্নত বিশ্লেষণ ফ্ল্যাগ',ar:'علامة التحليلات المتقدمة',es:'Función de analítica avanzada',tr:'Gelişmiş analiz bayrağı'}],
];

export function PlanGrantsPanel({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }): JSX.Element {
  const { locale, setLocale } = useDeveloperI18n(); const t = copy[locale];
  const raw = plan.limits as unknown as Record<string, unknown>;
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries([
    ...quota.map(([key]) => [key, typeof raw?.[key] === 'number' ? String(raw[key]) : '0']),
    ...grants.map(([key]) => [key, raw?.[key] === true]),
  ]));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [verificationError, setVerificationError] = useState('');
  const [pending, setPending] = useState<{ payload: Record<string, number | boolean>; identity: string; key: string } | null>(null);
  const keys = useRef(new Map<string, string>());
  function prepare(event: FormEvent): void {
    event.preventDefault(); setError(''); const payload: Record<string, number | boolean> = {};
    for (const [key] of quota) { const value = String(values[key]); if (!/^\d+$/.test(value) || Number(value) > (key === 'developer_reactivation_review' ? 1 : 100000)) { setError(t.invalid); return; } payload[key] = Number(value); }
    for (const [key] of grants) payload[key] = values[key] === true;
    const identity = JSON.stringify(payload), key = keys.current.get(identity) ?? crypto.randomUUID(); keys.current.set(identity, key);
    setPending({ payload, identity, key }); setVerificationError('');
  }
  async function confirm(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return; setBusy(true);
    try { await verifyPlanAction('PLAN_GRANTS_UPDATE', method, value, crypto.randomUUID()); }
    catch { setVerificationError(t.verify); setBusy(false); return; }
    const intent = pending; setPending(null);
    try {
      const result = await updatePlanGrants(plan.id, intent.payload, intent.key);
      const updated = result?.limits as unknown as Record<string, unknown>;
      if (result?.id !== plan.id || !updated || Object.entries(intent.payload).some(([key, expected]) => updated[key] !== expected)) throw new Error('Invalid response');
      keys.current.delete(intent.identity); onSaved();
    } catch { setError(t.failed); }
    finally { setBusy(false); }
  }
  return <section className="rounded border bg-card p-4" aria-labelledby="plan-grants-heading">
    <label>{t.language} <select value={locale} onChange={(e) => setLocale(e.target.value as DeveloperLocale)}><option value="en">English</option><option value="bn">বাংলা</option><option value="ar">العربية</option><option value="es">Español</option><option value="tr">Türkçe</option></select></label>
    <h2 id="plan-grants-heading" className="text-lg font-semibold">{t.title}: {plan.name}</h2><p>{t.help}</p>
    <form onSubmit={prepare} className="space-y-4">
      <fieldset><legend className="font-semibold">{t.quotas}</legend><div className="grid gap-2 md:grid-cols-2">{quota.map(([key, label]) => <label key={key}>{label[locale]}<input className="block w-full rounded border p-2" type="number" min="0" max={key === 'developer_reactivation_review' ? 1 : 100000} step="1" required value={String(values[key])} onChange={(e) => setValues({ ...values, [key]: e.target.value })} /></label>)}</div></fieldset>
      <fieldset><legend className="font-semibold">{t.features}</legend><div className="grid gap-2 md:grid-cols-2">{grants.map(([key, label]) => <label key={key} className="flex gap-2"><input type="checkbox" checked={values[key] === true} onChange={(e) => setValues({ ...values, [key]: e.target.checked })} />{label[locale]}</label>)}</div></fieldset>
      {error && <p role="alert">{error}</p>}<div className="flex gap-2"><button type="submit" disabled={busy} className="rounded bg-primary px-3 py-2 text-white">{t.save}</button><button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2">{t.cancel}</button></div>
    </form>
    {pending && <StepUpDialog description={t.confirm} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={confirm} />}
  </section>;
}
