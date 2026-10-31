#!/usr/bin/env python3
"""Append the Batch 05 mobile strings to the ARB files and the checked-in
localization classes.

The generated `app_localizations*.dart` files are committed to the repo (see the
comment in l10n.yaml) and the build has no Flutter SDK, so `flutter gen-l10n`
cannot be run here. This script performs exactly what gen-l10n would: append the
key to every ARB, append the abstract getter with its doc comment to
`app_localizations.dart`, and append the `@override` getter to each locale class.

Every string is a plain getter. The existing 264 keys use no ICU placeholders --
interpolation happens at the call site -- so these follow the same rule and the
script fails loudly if a translation contains braces.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path('/home/user/repo/whitelabel-copytrade/apps/mobile/lib/l10n')

LOCALES = {'en': 'En', 'ar': 'Ar', 'bn': 'Bn', 'es': 'Es', 'tr': 'Tr'}

# key: (en, ar, bn, es, tr) -- index order below is fixed by COLUMNS.
COLUMNS = ['en', 'ar', 'bn', 'es', 'tr']

STRINGS: list[tuple[str, list[str]]] = [
    # ---- venue status (customer-facing) ----
    ('venueStatusTitle', ['Venue status', 'حالة المنصات', 'ভেন্যুর অবস্থা', 'Estado de los mercados', 'Borsa durumu']),
    ('venueStatusEmpty', [
        'No venues are listed for your account yet.',
        'لا توجد منصات مُدرجة لحسابك بعد.',
        'আপনার অ্যাকাউন্টের জন্য এখনো কোনো ভেন্যু তালিকাভুক্ত নেই।',
        'Todavía no hay mercados asociados a su cuenta.',
        'Hesabınız için henüz listelenmiş borsa yok.',
    ]),
    ('venueStatusOperational', ['Operational', 'تعمل بشكل طبيعي', 'স্বাভাবিক চলছে', 'Operativo', 'Çalışıyor']),
    ('venueStatusDegraded', ['Degraded', 'أداء متدهور', 'কর্মক্ষমতা কম', 'Degradado', 'Kısıtlı çalışıyor']),
    ('venueStatusMaintenance', ['Under maintenance', 'تحت الصيانة', 'রক্ষণাবেক্ষণে', 'En mantenimiento', 'Bakımda']),
    ('venueStatusOutage', ['Outage', 'انقطاع', 'বিভ্রাট', 'Interrupción', 'Kesinti']),
    ('venueStatusUnknown', ['Status unknown', 'الحالة غير معروفة', 'অবস্থা অজানা', 'Estado desconocido', 'Durum bilinmiyor']),
    ('venueStatusSince', ['Since', 'منذ', 'থেকে', 'Desde', 'Başlangıç']),
    ('venueStatusUnverified', [
        'Not confirmed by the platform just now — trading may still fail.',
        'لم تؤكّدها المنصة الآن — قد يفشل التداول.',
        'প্ল্যাটফর্ম এইমাত্র নিশ্চিত করেনি — ট্রেডিং ব্যর্থ হতে পারে।',
        'La plataforma no lo ha confirmado ahora mismo: la negociación puede fallar.',
        'Platform bunu şu anda doğrulamadı — işlem başarısız olabilir.',
    ]),
    ('venueStatusOperatorSet', [
        "Set by an operator, not only by the venue's own feed.",
        'محدَّدة من مشغّل، وليس من تغذية المنصة وحدها.',
        'অপারেটর নির্ধারিত, কেবল ভেন্যুর নিজস্ব ফিড থেকে নয়।',
        'Fijado por un operador, no solo por el canal del mercado.',
        'Yalnızca borsanın kendi akışıyla değil, bir operatör tarafından belirlendi.',
    ]),
    ('venueStatusChecked', ['Last checked', 'آخر تحقّق', 'সর্বশেষ যাচাই', 'Última comprobación', 'Son kontrol']),
    ('venueStatusSubtitle', [
        'Whether the exchanges you trade on are up right now',
        'هل منصات التداول التي تتداول عليها تعمل الآن',
        'আপনি যে এক্সচেঞ্জে ট্রেড করেন সেগুলো এখন চালু আছে কি না',
        'Si los mercados en los que opera están disponibles ahora',
        'İşlem yaptığınız borsaların şu anda açık olup olmadığı',
    ]),
    # ---- sign-in alerts ----
    ('loginAlertsTitle', ['Sign-in alerts', 'تنبيهات تسجيل الدخول', 'সাইন-ইন সতর্কতা', 'Alertas de inicio de sesión', 'Giriş uyarıları']),
    ('loginAlertsAll', ['All', 'الكل', 'সব', 'Todas', 'Tümü']),
    ('loginAlertsSignIns', ['Sign-ins', 'عمليات تسجيل الدخول', 'সাইন-ইন', 'Inicios de sesión', 'Girişler']),
    ('loginAlertsFailures', ['Failed sign-ins', 'محاولات فاشلة', 'ব্যর্থ সাইন-ইন', 'Inicios fallidos', 'Başarısız girişler']),
    ('loginAlertsNewDevice', ['New device', 'جهاز جديد', 'নতুন ডিভাইস', 'Dispositivo nuevo', 'Yeni cihaz']),
    ('loginAlertsSuspicious', ['Suspicious', 'مشبوهة', 'সন্দেহজনক', 'Sospechosos', 'Şüpheli']),
    ('loginAlertsPassword', ['Password changes', 'تغييرات كلمة المرور', 'পাসওয়ার্ড পরিবর্তন', 'Cambios de contraseña', 'Parola değişiklikleri']),
    ('loginAlertsEmpty', [
        'No sign-in activity has been recorded for your account.',
        'لم يُسجَّل أي نشاط تسجيل دخول على حسابك.',
        'আপনার অ্যাকাউন্টে কোনো সাইন-ইন কার্যকলাপ নথিভুক্ত হয়নি।',
        'No se ha registrado actividad de inicio de sesión en su cuenta.',
        'Hesabınızda kayıtlı giriş etkinliği yok.',
    ]),
    ('loginAlertsAdvice', [
        'If you do not recognise an event, change your password and review your active devices in the web security settings.',
        'إذا لم تتعرّف على حدث، فغيّر كلمة المرور وراجع أجهزتك النشطة في إعدادات أمان الويب.',
        'কোনো ঘটনা চিনতে না পারলে পাসওয়ার্ড পরিবর্তন করুন এবং ওয়েব নিরাপত্তা সেটিংসে আপনার সক্রিয় ডিভাইস পর্যালোচনা করুন।',
        'Si no reconoce un evento, cambie su contraseña y revise sus dispositivos activos en la configuración de seguridad web.',
        'Tanımadığınız bir olay varsa parolanızı değiştirin ve web güvenlik ayarlarından etkin cihazlarınızı gözden geçirin.',
    ]),
    ('loginAlertsSeverityLabel', ['Severity', 'الخطورة', 'তীব্রতা', 'Gravedad', 'Önem derecesi']),
    ('loginAlertsDevice', ['Device', 'الجهاز', 'ডিভাইস', 'Dispositivo', 'Cihaz']),
    # ---- privacy / data export ----
    ('dataExportTitle', ['Your data', 'بياناتك', 'আপনার ডেটা', 'Sus datos', 'Verileriniz']),
    ('dataExportAbout', [
        'Request a copy of your personal data. You will be told when it is ready and can then create a link that works once and expires.',
        'اطلب نسخة من بياناتك الشخصية. سنُخبرك عند جاهزيتها ويمكنك حينها إنشاء رابط يعمل مرة واحدة وينتهي.',
        'আপনার ব্যক্তিগত ডেটার একটি অনুলিপি অনুরোধ করুন। প্রস্তুত হলে জানানো হবে, এরপর আপনি একবার কাজ করে মেয়াদোত্তীর্ণ হয় এমন একটি লিংক তৈরি করতে পারবেন।',
        'Solicite una copia de sus datos personales. Le avisaremos cuando esté lista y entonces podrá crear un enlace de un solo uso que caduca.',
        'Kişisel verilerinizin bir kopyasını isteyin. Hazır olduğunda bilgilendirileceksiniz; ardından bir kez çalışan ve süresi dolan bir bağlantı oluşturabilirsiniz.',
    ]),
    ('dataExportJurisdiction', ['Jurisdiction', 'الاختصاص القضائي', 'এখতিয়ার', 'Jurisdicción', 'Yetki bölgesi']),
    ('dataExportRequest', ['Request a copy', 'اطلب نسخة', 'অনুলিপি অনুরোধ করুন', 'Solicitar una copia', 'Kopya isteyin']),
    ('dataExportWorking', ['Working…', 'جارٍ التنفيذ…', 'চলছে…', 'Procesando…', 'İşleniyor…']),
    ('dataExportRequests', ['Your requests', 'طلباتك', 'আপনার অনুরোধসমূহ', 'Sus solicitudes', 'Talepleriniz']),
    ('dataExportNone', [
        'You have not requested a copy of your data yet.',
        'لم تطلب نسخة من بياناتك بعد.',
        'আপনি এখনো আপনার ডেটার অনুলিপি অনুরোধ করেননি।',
        'Aún no ha solicitado una copia de sus datos.',
        'Henüz verilerinizin bir kopyasını istemediniz.',
    ]),
    ('dataExportRequestedSent', [
        'Request received. Its reference is',
        'تم استلام الطلب. مرجعه',
        'অনুরোধ পাওয়া গেছে। এর রেফারেন্স',
        'Solicitud recibida. Su referencia es',
        'Talep alındı. Referansı',
    ]),
    ('dataExportRequestedAtLabel', ['Requested', 'تاريخ الطلب', 'অনুরোধের সময়', 'Solicitada', 'Talep tarihi']),
    ('dataExportNeedsYou', [
        'We need something from you before this can continue. Check your email.',
        'نحتاج شيئًا منك قبل المتابعة. تحقّق من بريدك الإلكتروني.',
        'এগিয়ে যাওয়ার আগে আপনার কাছ থেকে কিছু প্রয়োজন। আপনার ইমেইল দেখুন।',
        'Necesitamos algo de usted para continuar. Revise su correo electrónico.',
        'Devam etmek için sizden bir şey gerekiyor. E-postanızı kontrol edin.',
    ]),
    ('dataExportRetention', [
        'Some records must be kept by law and cannot be deleted yet.',
        'بعض السجلات يجب الاحتفاظ بها قانونًا ولا يمكن حذفها الآن.',
        'কিছু রেকর্ড আইন অনুযায়ী রাখতে হয়, এখন মুছে ফেলা যাবে না।',
        'Algunos registros deben conservarse por ley y aún no pueden eliminarse.',
        'Bazı kayıtlar yasa gereği saklanmalıdır ve şu anda silinemez.',
    ]),
    ('dataExportLegalHold', [
        'These records are under a legal hold and cannot be deleted.',
        'هذه السجلات تحت حجز قانوني ولا يمكن حذفها.',
        'এই রেকর্ডগুলো আইনি হেফাজতে আছে, মুছে ফেলা যাবে না।',
        'Estos registros están bajo retención legal y no pueden eliminarse.',
        'Bu kayıtlar yasal saklama altında ve silinemez.',
    ]),
    ('dataExportGetLink', [
        'Create download link',
        'إنشاء رابط التنزيل',
        'ডাউনলোড লিংক তৈরি করুন',
        'Crear enlace de descarga',
        'İndirme bağlantısı oluştur',
    ]),
    ('dataExportTokenIssued', [
        'A single-use link is ready until',
        'رابط للاستخدام مرة واحدة جاهز حتى',
        'একবার ব্যবহারযোগ্য লিংক প্রস্তুত, মেয়াদ শেষ',
        'Hay un enlace de un solo uso disponible hasta',
        'Tek kullanımlık bağlantı şu ana kadar hazır:',
    ]),
    ('dataExportTokenNoExpiry', [
        'A link was issued but its expiry could not be read. Request another one before relying on it.',
        'صدر رابط لكن تعذّرت قراءة انتهائه. اطلب رابطًا آخر قبل الاعتماد عليه.',
        'লিংক দেওয়া হয়েছে কিন্তু তার মেয়াদ পড়া যায়নি। নির্ভর করার আগে আরেকটি অনুরোধ করুন।',
        'Se emitió un enlace pero no se pudo leer su caducidad. Solicite otro antes de confiar en él.',
        'Bir bağlantı verildi ancak son kullanma zamanı okunamadı. Ona güvenmeden önce yenisini isteyin.',
    ]),
    # ---- fee schedule ----
    ('feeScheduleTitle', ['Fees', 'الرسوم', 'ফি', 'Comisiones', 'Ücretler']),
    ('feeScheduleEffective', ['In force now', 'الساري الآن', 'এখন কার্যকর', 'En vigor ahora', 'Şu anda yürürlükte']),
    ('feeScheduleEmpty', [
        'No fee schedule is published yet.',
        'لم يُنشر جدول رسوم بعد.',
        'এখনো কোনো ফি সূচি প্রকাশিত হয়নি।',
        'Todavía no se ha publicado ninguna tabla de comisiones.',
        'Henüz bir ücret tarifesi yayımlanmadı.',
    ]),
    ('feeScheduleFromLabel', ['From', 'من', 'শুরু', 'Desde', 'Başlangıç']),
    ('feeScheduleUntilLabel', ['Until', 'حتى', 'শেষ', 'Hasta', 'Bitiş']),
    ('feeScheduleManagement', ['Management fee', 'رسوم الإدارة', 'ব্যবস্থাপনা ফি', 'Comisión de gestión', 'Yönetim ücreti']),
    ('feeScheduleProfitShare', ['Profit share', 'حصة الأرباح', 'লাভের অংশ', 'Reparto de beneficios', 'Kâr payı']),
    ('feeScheduleCurrency', ['Currency', 'العملة', 'মুদ্রা', 'Moneda', 'Para birimi']),
    ('feeScheduleVersion', ['Version', 'الإصدار', 'সংস্করণ', 'Versión', 'Sürüm']),
    ('feeScheduleHistory', ['Previous versions', 'الإصدارات السابقة', 'পূর্ববর্তী সংস্করণ', 'Versiones anteriores', 'Önceki sürümler']),
    ('feeScheduleOverride', [
        'This schedule is set by your operator and differs from the platform default.',
        'هذا الجدول محدَّد من مشغّلك ويختلف عن الافتراضي للمنصة.',
        'এই সূচি আপনার অপারেটর নির্ধারিত এবং প্ল্যাটফর্ম ডিফল্ট থেকে আলাদা।',
        'Esta tabla la fija su operador y difiere de la predeterminada de la plataforma.',
        'Bu tarife operatörünüz tarafından belirlenmiştir ve platform varsayılanından farklıdır.',
    ]),
]


def check() -> None:
    for key, values in STRINGS:
        if len(values) != len(COLUMNS):
            sys.exit(f'{key}: expected {len(COLUMNS)} translations, got {len(values)}')
        for value in values:
            if '{' in value or '}' in value:
                sys.exit(f'{key}: brace in a value; these keys must be plain strings')
            if not value.strip():
                sys.exit(f'{key}: empty translation')


def dart_quote(value: str) -> str:
    """Single-quoted Dart literal, escaped the way gen-l10n escapes one.

    An apostrophe becomes a backslash-quote and a dollar sign becomes a
    backslash-dollar -- without the second rule a translation containing a price
    would be read by Dart as an interpolation and fail to compile.
    """
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$') + "'"


def wrap_indent(prefix: str, value: str, indent: str = '      ') -> str:
    """Emit the getter exactly the way gen-l10n does.

    The rule is the dominant one in the 264 getters already in the repository: a
    getter stays on one line when the whole line fits in 80 columns, and wraps
    otherwise (378 of 387 pre-existing wrapped getters are 81+ columns; the nine
    exceptions are hand-edited outliers). Following the majority rule keeps the
    `flutter gen-l10n` drift check in CI stable for the keys added here. If that
    check ever does report a difference, the fix is to commit gen-l10n's own output
    -- these files are generated, and this script only exists because the build
    that produced them has no Flutter SDK available.
    """
    one_line = f'  String get {prefix} => {dart_quote(value)};'
    if len(one_line) <= 80:
        return '  @override\n' + one_line
    return f'  @override\n  String get {prefix} =>\n{indent}{dart_quote(value)};'


def main() -> None:
    check()

    # 1. ARB files: append in key order, preserving the file's 2-space JSON format.
    for locale in COLUMNS:
        path = ROOT / f'app_{locale}.arb'
        original = path.read_text()
        data = json.loads(original)
        # Prove the round-trip is byte-identical before touching anything, so the
        # append below cannot reformat 264 existing keys.
        if json.dumps(data, indent=2, ensure_ascii=False) + '\n' != original:
            sys.exit(f'{path.name}: does not round-trip through json.dumps(indent=2); refusing to rewrite it')
        for key, values in STRINGS:
            data[key] = values[COLUMNS.index(locale)]
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        print(f'{path.name}: {len(data) - 1} keys')

    # 2. Abstract class: doc comment + getter, appended before the closing brace.
    abstract = ROOT / 'app_localizations.dart'
    text = abstract.read_text()
    block = []
    for key, values in STRINGS:
        block.append(
            f'  /// No description provided for @{key}.\n'
            f'  ///\n'
            f'  /// In en, this message translates to:\n'
            f'  /// **{dart_quote(values[0])}**\n'
            f'  String get {key};\n'
        )
    added = '\n'.join(block)
    assert text.rstrip().endswith('}')
    text = text.rstrip()[:-1].rstrip('\n') + '\n\n' + added + '}\n'
    abstract.write_text(text)
    print(f'{abstract.name}: +{len(STRINGS)} getters')

    # 3. Locale implementations: @override getter, appended before the closing brace.
    for locale, cls in LOCALES.items():
        path = ROOT / f'app_localizations_{locale}.dart'
        text = path.read_text()
        assert text.rstrip().endswith('}'), path
        block = [wrap_indent(key, values[COLUMNS.index(locale)]) for key, values in STRINGS]
        added = '\n\n'.join(block)
        text = text.rstrip()[:-1].rstrip('\n') + '\n\n' + added + '\n}\n'
        path.write_text(text)
        print(f'{path.name}: +{len(STRINGS)} overrides')


if __name__ == '__main__':
    main()
