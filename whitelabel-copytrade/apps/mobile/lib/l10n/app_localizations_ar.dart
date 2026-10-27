// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'نسخ التداول';

  @override
  String get signIn => 'تسجيل الدخول';

  @override
  String get signOut => 'تسجيل الخروج';

  @override
  String get emailLabel => 'البريد الإلكتروني';

  @override
  String get passwordLabel => 'كلمة المرور';

  @override
  String get signInSubtitle => 'قم بتسجيل الدخول إلى حسابك للمتابعة.';

  @override
  String get twoFactorTitle => 'المصادقة الثنائية';

  @override
  String get twoFactorSubtitle =>
      'أدخل الرمز المكون من ستة أرقام من تطبيق المصادقة الخاص بك.';

  @override
  String get twoFactorCodeLabel => 'رمز المصادقة';

  @override
  String get recoveryCodeLabel => 'رمز الاسترداد';

  @override
  String get useRecoveryCode => 'استخدم رمز الاسترداد بدلاً من ذلك';

  @override
  String get useAuthenticator => 'استخدم تطبيق المصادقة الخاص بي بدلاً من ذلك';

  @override
  String get verify => 'تحقق';

  @override
  String get cancel => 'إلغاء';

  @override
  String get homeTitle => 'نظرة عامة';

  @override
  String get settingsTitle => 'الإعدادات';

  @override
  String get securityTitle => 'الأمن';

  @override
  String get loading => 'جاري التحميل';

  @override
  String get emailRequired => 'أدخل عنوان بريدك الإلكتروني';

  @override
  String get emailInvalid => 'أدخل عنوان بريد إلكتروني صالحًا';

  @override
  String get passwordRequired => 'أدخل كلمة المرور الخاصة بك';

  @override
  String get codeRequired => 'أدخل رمز المصادقة الخاص بك';

  @override
  String get genericError => 'حدث خطأ ما. يرجى المحاولة مرة أخرى.';

  @override
  String get sessionExpired =>
      'لقد انتهت صلاحية جلستك. الرجاء تسجيل الدخول مرة أخرى.';

  @override
  String get welcomeBack => 'مرحبًا بعودتك';

  @override
  String get accountSection => 'الحساب';

  @override
  String get securitySection => 'الأمن';

  @override
  String get twoFactorEnabled => 'المصادقة الثنائية قيد التشغيل';

  @override
  String get twoFactorDisabled => 'تم إيقاف المصادقة الثنائية';

  @override
  String get activeSessions => 'الأجهزة النشطة';

  @override
  String get changePassword => 'تغيير كلمة المرور';

  @override
  String get securityWebManagement =>
      'قم بإدارة أجهزتك النشطة وكلمة المرور في إعدادات أمان الويب.';

  @override
  String get executionDisabledNotice =>
      'تنفيذ الأوامر الحقيقية معطّل في هذا الإصدار.';

  @override
  String get strategiesTitle => 'الاستراتيجيات';

  @override
  String get strategiesSubtitle => 'عرض صحة الإستراتيجية والنتائج المحاكاة.';

  @override
  String get strategyReadOnlyNotice =>
      'هذه الشاشة للقراءة فقط. يتم بدء الاستراتيجيات وإيقافها وتكوينها من وحدة تحكم المشرف.';

  @override
  String get strategyPanelsDegraded =>
      'لا يمكن تحميل بعض اللوحات. اسحب لأسفل للمحاولة مرة أخرى.';

  @override
  String get liveExecutionReachable =>
      'يمكن الوصول إلى التنفيذ المباشر في هذا النشر';

  @override
  String get liveExecutionNotReachable =>
      'لا يمكن الوصول إلى التنفيذ المباشر في هذا النشر';

  @override
  String get strategyEngineLabel => 'محرك الاستراتيجية';

  @override
  String get paperTradingLabel => 'التداول التجريبي';

  @override
  String get backtestingLabel => 'الاختبار بأثر رجعي';

  @override
  String get tradingModeLabel => 'الوضع';

  @override
  String get strategyInstancesSection => 'المثيلات';

  @override
  String get paperSessionsSection => 'جلسات التداول التجريبي';

  @override
  String get backtestsSection => 'الاختبارات بأثر رجعي';

  @override
  String get strategyNoInstances => 'لم يتم إنشاء أي حالات استراتيجية.';

  @override
  String get strategyNoPaperSessions => 'لم تُجرَ جلسات تداول تجريبي بعد.';

  @override
  String get strategyNoBacktests => 'لم تُجرَ اختبارات بأثر رجعي بعد.';

  @override
  String get instancesLabel => 'المثيلات';

  @override
  String get runningLabel => 'قيد التشغيل';

  @override
  String get needsAttentionLabel => 'يحتاج إلى اهتمام';

  @override
  String get openIncidentsLabel => 'الحوادث المفتوحة';

  @override
  String get enabledLabel => 'ممكّن';

  @override
  String get disabledLabel => 'معطّل';

  @override
  String get consecutiveErrorsLabel => 'الأخطاء المتتالية';

  @override
  String get lastHeartbeatLabel => 'آخر إشارة اتصال';

  @override
  String get noHeartbeatYet => 'لم تُبلَّغ إشارة اتصال بعد';

  @override
  String get statusLabel => 'الحالة';

  @override
  String get equityLabel => 'حقوق الملكية';

  @override
  String get realisedPnlLabel => 'الربح والخسارة المحققة';

  @override
  String get netPnlLabel => 'صافي الربح والخسارة';

  @override
  String get tradesLabel => 'الصفقات';

  @override
  String get winRateLabel => 'معدل الفوز';

  @override
  String get sharpeLabel => 'شارب';

  @override
  String get maxDrawdownLabel => 'أقصى تراجع';

  @override
  String get simulatedFillsLabel => 'الأوامر / التنفيذات';

  @override
  String get riskRejectionsLabel => 'رفض المخاطر';

  @override
  String get simulatedBadge => 'محاكاة';

  @override
  String get insufficientData => 'بيانات غير كافية';

  @override
  String get notAvailableShort => 'لا يوجد';

  @override
  String get statusQueued => 'في قائمة الانتظار';

  @override
  String get statusRunning => 'قيد التشغيل';

  @override
  String get statusCompleted => 'مكتمل';

  @override
  String get statusStopped => 'توقف';

  @override
  String get statusFailed => 'فشل';

  @override
  String get statusCancelled => 'تم الإلغاء';

  @override
  String get backtestNotReproducible =>
      'لا يحتوي هذا التشغيل على مجموع اختباري لمجموعة البيانات ولا يمكن إعادة إنتاجه بالضبط.';

  @override
  String get simulationDisclaimerTitle => 'حول هذه الأرقام';

  @override
  String get backtestDisclaimer =>
      'أداء الاختبار بأثر رجعي لا يدل على الأداء المستقبلي.';

  @override
  String get paperDisclaimer =>
      'أداء التداول التجريبي لا يدل على الأداء في التداول الحقيقي.';

  @override
  String get executionQualityDisclaimer =>
      'المحاكاة لا تضمن جودة التنفيذ الحقيقية.';

  @override
  String get insufficientDataDisclaimer =>
      'يتم حجب الأرقام المعدلة حسب المخاطر عندما تكون الملاحظات قليلة جدًا. البيانات غير الكافية ليست صفراً.';

  @override
  String get riskTitle => 'المخاطر';

  @override
  String get riskSubtitle => 'حالة الإيقاف وحداثة بيانات الحسابات في مؤسستك.';

  @override
  String get riskEngineOn => 'محرك المخاطر مفعّل في مسار الأوامر';

  @override
  String get riskEngineOff => 'محرك المخاطر معطّل — وضع الأدوات المحلية';

  @override
  String get riskFailClosedLabel => 'الرفض الآمن عند الفشل';

  @override
  String get riskCadenceLabel => 'معدل التحديث / الحد الأقصى لعمر البيانات';

  @override
  String get riskCadenceWarn =>
      'لا تُحدَّث اللقطة أسرع من الحد الأقصى لعمر البيانات؛ قد تُرفض الطلبات بسبب تقادمها.';

  @override
  String get riskReadOnlyNotice =>
      'إيقاف المخاطر للقراءة فقط هنا. يتطلب تفعيل الإيقاف أو إلغاؤه سببًا وتأكيدًا كتابيًا في لوحة الإدارة.';

  @override
  String get riskPanelsDegraded =>
      'تعذر تحميل بعض لوحات المخاطر. اسحب لأسفل للمحاولة مرة أخرى.';

  @override
  String get riskMirrorSection => 'أحدث بيانات الحسابات المنسوخة';

  @override
  String get riskSwitchesSection => 'إيقافات الحماية المفعّلة';

  @override
  String get riskEventsSection => 'أحداث المخاطر الأخيرة';

  @override
  String get riskNoMirror =>
      'لا تتوفر حالة منسوخة للحساب بعد. يرفض المحرك الأوامر الجديدة حتى تتزامن خدمة حالة المخاطر؛ هذا إجراء أمان وليس خطأ في الشاشة.';

  @override
  String get riskNoSwitches => 'لا توجد إيقافات مفعّلة.';

  @override
  String get riskNoEvents => 'لم يتم تسجيل أي أحداث خطرة.';

  @override
  String get riskEngagedStopsLabel => 'الإيقافات المفعّلة';

  @override
  String get riskTriggeredProtectionsLabel => 'الحماية المثارة';

  @override
  String get riskStaleMirrorsLabel => 'بيانات الحسابات القديمة';

  @override
  String get riskSevereEventsLabel => 'الأحداث الشديدة (24 ساعة)';

  @override
  String get riskSnapshotLabel => 'لقطة';

  @override
  String get riskCapturedLabel => 'تم التقاطها';

  @override
  String get riskEquityLabel => 'حقوق الملكية';

  @override
  String get riskDayPnlLabel => 'صافي الربح والخسارة اليومي';

  @override
  String get riskGrossLabel => 'القيمة الاسمية الإجمالية';

  @override
  String get riskOpenOrdersLabel => 'الأوامر المفتوحة';

  @override
  String get riskStaleSourcesLabel => 'مصادر قديمة';

  @override
  String get riskStaleBadge => 'قديم';

  @override
  String get riskReasonLabel => 'السبب';

  @override
  String get riskEngagedManualLabel => 'التوقف اليدوي';

  @override
  String get riskExplicitClearNotice =>
      'فعّل المحرك هذه الحماية ولا يمكن إلغاؤها من التطبيق. يمكن تأكيدها وإزالتها من لوحة الإدارة بعد التأكيد الكتابي.';

  @override
  String get riskDisclaimer =>
      'تعمل ضوابط المخاطر على تقليل المخاطر التشغيلية ولكنها لا تضمن ضد جميع الخسائر.';

  @override
  String get retry => 'حاول مرة أخرى';

  @override
  String get accountDisabled => 'تم تعطيل الحساب';

  @override
  String get accountLabel => 'اسم الحساب';

  @override
  String get activityTab => 'النشاط';

  @override
  String get allMarkedRead => 'تم وضع علامة \"مقروءة\" على جميع الإشعارات';

  @override
  String get allocationLabel => 'التخصيص (المبلغ أو النسبة المئوية)';

  @override
  String get apiKeyLabel => 'مفتاح واجهة برمجة التطبيقات';

  @override
  String get apiSecretLabel => 'سر واجهة برمجة التطبيقات';

  @override
  String get baseCurrencyLabel => 'العملة الأساسية';

  @override
  String get checkHealth => 'تحقق من الاتصال';

  @override
  String get confirm => 'تأكيد';

  @override
  String get connect => 'الاتصال';

  @override
  String get connectExchange => 'ربط منصة تداول';

  @override
  String get connectExchangeFirst => 'اربط حساب منصة تداول أولاً لنسخ الصفقات.';

  @override
  String get copiesLabel => 'نسخ';

  @override
  String get copyAction => 'نسخ';

  @override
  String get copyRiskAcknowledgement =>
      'أدرك أن الصفقات المنسوخة يمكن أن تخسر المال، وأن الأداء السابق لا يتنبأ بالنتائج، وأن إيقاف النسخ لا يؤدي إلى إغلاق المراكز المفتوحة.';

  @override
  String get copyTradingSubtitle =>
      'اعثر على المتداولين وأدر عمليات النسخ والصفقات المنسوخة.';

  @override
  String get copyTradingTitle => 'نسخ التداول';

  @override
  String get copyingAccountLabel => 'حساب منصة التداول المستخدم للنسخ';

  @override
  String get costBasisLabel => 'أساس التكلفة';

  @override
  String get disable => 'تعطيل';

  @override
  String get disableAccountMessage =>
      'يتوقف النسخ والتداول على هذا الحساب حتى تتم إعادة تمكينه من وحدة تحكم الويب.';

  @override
  String get disableAccountTitle => 'هل تريد تعطيل هذا الحساب؟';

  @override
  String get drawdownLabel => 'أقصى تراجع';

  @override
  String get environmentLabel => 'البيئة';

  @override
  String get exchangeAccountsSubtitle =>
      'منصات التداول المرتبطة وحالة المفاتيح والاتصال.';

  @override
  String get exchangeAccountsTitle => 'حسابات منصات التداول';

  @override
  String get exchangeConnected => 'تم ربط منصة التداول';

  @override
  String get failedLabel => 'فشل';

  @override
  String get fieldRequired => 'مطلوب';

  @override
  String get followersLabel => 'المتابعون';

  @override
  String get fundingSubtitle => 'الحسابات وطلبات الإيداع وسجل التحويلات.';

  @override
  String get fundingTitle => 'التمويل';

  @override
  String get healthCheckDone => 'تم الانتهاء من فحص الاتصال';

  @override
  String get holdingsLabel => 'الأصول';

  @override
  String get inboxTab => 'البريد الوارد';

  @override
  String get lastErrorLabel => 'الخطأ الأخير';

  @override
  String get lastVerifiedLabel => 'آخر التحقق';

  @override
  String get liveKeyWarning =>
      'المفاتيح الحقيقية تتداول بأموال حقيقية. استخدم مفاتيح للتداول فقط مع تعطيل السحب.';

  @override
  String get liveTradingOffNotice => 'التداول الحقيقي غير مفعّل لهذا الحساب.';

  @override
  String get markAllRead => 'وضع علامة على الكل كمقروءة';

  @override
  String get markedRead => 'تم وضع علامة كمقروءة';

  @override
  String get maxAllocationLabel => 'الحد الأقصى للتخصيص (اختياري)';

  @override
  String get myCopiesTab => 'نسخي';

  @override
  String get navLabel => 'صافي قيمة الأصول';

  @override
  String get noCopyActivity => 'لا توجد صفقات منسوخة حتى الآن.';

  @override
  String get noCopyableStrategies =>
      'لا توجد لدى هذا المتداول استراتيجية متاحة للنسخ.';

  @override
  String get noExchangeAccounts =>
      'لا توجد حسابات منصات تداول بعد. اربط حساباً للبدء.';

  @override
  String get noNotifications => 'لا الإخطارات.';

  @override
  String get noPortfolio => 'لم يتم إعداد أي محفظة لحسابك حتى الآن.';

  @override
  String get noSubscriptions => 'أنت لا تقلد أي شخص بعد.';

  @override
  String get noTraders => 'لا يوجد متداولون متاحون.';

  @override
  String get noTransactions => 'لا توجد معاملات حتى الآن.';

  @override
  String get nothingHereYet => 'لا شيء هنا بعد.';

  @override
  String get notificationsTitle => 'الإخطارات';

  @override
  String get partialDataNotice => 'لا يمكن تحميل بعض البيانات';

  @override
  String get passphraseLabel => 'عبارة مرور API';

  @override
  String get pastPerformanceNotice =>
      'الأداء السابق ليس ضمانا للنتائج المستقبلية.';

  @override
  String get pause => 'وقفة';

  @override
  String get paused => 'توقف النسخ مؤقتًا';

  @override
  String get pnlLabel => 'الربح والخسارة';

  @override
  String get portfolioLabel => 'المحفظة';

  @override
  String get portfolioSubtitle => 'الأصول وصافي قيمتها والأرباح والخسائر.';

  @override
  String get portfolioTitle => 'المحفظة';

  @override
  String get preferencesSaved => 'تم حفظ التفضيلات';

  @override
  String get preferencesTab => 'التفضيلات';

  @override
  String get displayPreferences => 'عرض التفضيلات';

  @override
  String get languageLabel => 'اللغة';

  @override
  String get displayCurrencyLabel => 'عملة العرض';

  @override
  String get timeZoneLabel => 'المنطقة الزمنية (IANA)';

  @override
  String get timeZoneRequired => 'أدخل منطقة زمنية';

  @override
  String get dateFormatLabel => 'تنسيق التاريخ';

  @override
  String get preferencesSupportNotice =>
      'يتم حفظ التفضيلات في حسابك. يختلف دعم تنسيق العملة والمنطقة الزمنية والتاريخ حسب الشاشة.';

  @override
  String get savePreferences => 'حفظ التفضيلات';

  @override
  String get resume => 'استئناف';

  @override
  String get resumed => 'تم استئناف النسخ';

  @override
  String get sizingModeLabel => 'وضع التحجيم';

  @override
  String get startCopying => 'ابدأ بالنسخ';

  @override
  String get startedLabel => 'بدأت';

  @override
  String get stop => 'توقف';

  @override
  String get stopCopyingMessage =>
      'لن يتم نسخ الصفقات الجديدة بعد الآن. تظل المراكز المفتوحة بالفعل مفتوحة حتى تقوم بإغلاقها.';

  @override
  String get stopCopyingTitle => 'التوقف عن النسخ؟';

  @override
  String get stopped => 'توقف النسخ';

  @override
  String get subscribed => 'أنت الآن تنسخ هذه الإستراتيجية';

  @override
  String get tradeOnlyKeysNotice =>
      'يتم إرسال مفاتيحك مرة واحدة عبر اتصال مشفر ولا يتم تخزينها مطلقًا على هذا الجهاز.';

  @override
  String get tradersTab => 'المتداولون';

  @override
  String get transactionsTab => 'المعاملات';

  @override
  String get venueLabel => 'منصة التداول';

  @override
  String get withdrawOnWebNotice =>
      'عمليات السحب غير متوفرة في هذا التطبيق. اتصل بمزود الخدمة الخاص بك بشأن قنوات السحب المعتمدة.';

  @override
  String get accountsTab => 'الحسابات';

  @override
  String get noFundingAccounts =>
      'لا يوجد حساب بعد. أكمل عملية الإعداد لفتح واحدة.';

  @override
  String get requestDeposit => 'طلب إيداع';

  @override
  String get depositRequested => 'تم تقديم طلب الإيداع';

  @override
  String get depositUnconfirmed =>
      'لا يمكن تأكيد طلب الإيداع. تحقق من تاريخ التمويل الخاص بك قبل المحاولة مرة أخرى.';

  @override
  String get amountLabel => 'المبلغ';

  @override
  String get currencyLabel => 'العملة';

  @override
  String get transferReferenceLabel => 'مرجع التحويل (مطلوب)';

  @override
  String get transferReferenceRequired => 'أدخل مرجع التحويل.';

  @override
  String get depositRequestNotice =>
      'يسجل طلب الإيداع التحويل الذي تنوي إجراءه. يُضاف الرصيد فقط بعد تأكيد فريق العمليات استلام الأموال.';

  @override
  String get invalidAmount => 'أدخل مبلغًا أكبر من الصفر.';

  @override
  String get invalidCurrency => 'أدخل رمز العملة مثل USDT.';

  @override
  String get depositsUnavailable => 'الإيداع غير متاح';

  @override
  String get depositLabel => 'إيداع';

  @override
  String get withdrawalLabel => 'سحب';

  @override
  String get confirmedAmountLabel => 'تم التأكيد';

  @override
  String get pendingNotCompleted => 'الطلبات المعلّقة ليست تحويلات مكتملة.';

  @override
  String get deviceNotificationsTitle => 'إذن إعلام الجهاز';

  @override
  String get deviceNotificationsExplanation =>
      'يتحكم هذا الإذن في هذا الجهاز فقط. يتطلب وصول الإشعارات أيضاً خدمة إشعارات مهيأة.';

  @override
  String get deviceNotificationsUndetermined => 'لم يطلب بعد';

  @override
  String get deviceNotificationsAllowed => 'مسموح';

  @override
  String get deviceNotificationsLimited => 'مسموح به مع تسليم محدود';

  @override
  String get deviceNotificationsDenied => 'مرفوض في إعدادات الجهاز';

  @override
  String get deviceNotificationsUnavailable =>
      'حالة الإذن غير متاحة على هذا الجهاز';

  @override
  String get deviceNotificationsRequest => 'طلب إذن الجهاز';

  @override
  String get deviceNotificationsSettings => 'افتح إعدادات الجهاز';

  @override
  String get deviceNotificationsSettingsError => 'لا يمكن فتح إعدادات الجهاز.';

  @override
  String get devicePushRegistered =>
      'تم تسجيل الجهاز. وصول الإشعارات عبر المزود غير مضمون.';

  @override
  String get devicePushUnavailable =>
      'تسجيل الجهاز غير متاح. تحقق من الاتصال وحاول مرة أخرى.';

  @override
  String get devicePushRetry => 'أعد محاولة تسجيل الجهاز';

  @override
  String get destinationCheckTitle => 'التحقق من وجهة السحب';

  @override
  String get destinationCheckNotice =>
      'تحقق مما إذا كان العنوان مدرجاً في قائمة العناوين المسموح بها حالياً. لا يؤدي هذا الفحص إلى إنشاء طلب سحب أو ضمان تحويل لاحق.';

  @override
  String get destinationNetwork => 'الشبكة';

  @override
  String get destinationAddress => 'عنوان الوجهة';

  @override
  String get destinationAddressInvalid =>
      'أدخل عنوانًا يتكون من 16 إلى 128 حرفًا.';

  @override
  String get destinationCheckAction => 'تحقق من القائمة المسموح بها';

  @override
  String get destinationCheckAllowed =>
      'العنوان مدرج في قائمتك المسموح بها وقت الفحص. لا تزال شروط السحب الأخرى سارية.';

  @override
  String get destinationCheckPending =>
      'هذه الوجهة في انتظار التنشيط ولا يمكن استخدامها حاليًا.';

  @override
  String get destinationCheckDenied =>
      'هذه ليست وجهة معتمدة ونشطة لهذه الشبكة.';

  @override
  String get destinationCheckError =>
      'لا يمكن التحقق من الوجهة. تحقق من اتصالك وحاول مرة أخرى.';

  @override
  String get riskPanelUnavailable =>
      'لوحة المخاطر هذه غير متاحة. اسحب لأسفل للمحاولة مجدداً.';

  @override
  String get riskSwitchListIncomplete =>
      'قد يكون عدد الإيقافات وقائمتها غير مكتملين أو غير متزامنين. حدّث للتحقق.';

  @override
  String get copyBudgetTitle => 'ميزانية التداول بالنسخ';

  @override
  String get copyBudgetAbout =>
      'خفض حد ميزانية التداول بالنسخ المُعدّ. هذا ليس حد مخاطر للحساب كله ولا يغلق المراكز الحالية.';

  @override
  String get copyBudgetEffective => 'الحد الفعلي الحالي';

  @override
  String get copyBudgetUnlimited => 'لم يُحدَّد حد';

  @override
  String get copyBudgetCommitted => 'مجموع قيم التخصيص النشطة';

  @override
  String get copyBudgetNewLimit => 'الحد الأقصى الجديد';

  @override
  String get copyBudgetHelp =>
      'يمكنك خفض الحد فقط هنا. استخدم نقطة عشرية دون فواصل تجميع؛ بحد أقصى ١٦ رقمًا صحيحًا و١٢ منزلة عشرية.';

  @override
  String get copyBudgetInvalid =>
      'أدخل مبلغًا غير سالب بما لا يزيد على ١٢ منزلة عشرية.';

  @override
  String get copyBudgetTooHigh =>
      'لا يمكن أن يتجاوز الحد الجديد الحد الفعلي الحالي.';

  @override
  String get copyBudgetReduce => 'خفض الحد';

  @override
  String get copyBudgetSaving => 'جارٍ الحفظ…';

  @override
  String get copyBudgetSaved => 'تم تسجيل خفض الحد. يظهر الحد الحالي أعلاه.';

  @override
  String get copyBudgetUnavailable => 'ميزانية النسخ غير متاحة. حاول مجددًا.';

  @override
  String get copyBudgetFailed =>
      'تعذر تأكيد خفض الحد. حدّث البيانات وحاول مجددًا.';

  @override
  String get copyBudgetEstimateWarning =>
      'قد تستخدم قيم التخصيص وحدات مختلفة؛ وهي ليست تعرضًا آنيًا متحققًا منه ولا ضمانًا ضد الخسائر.';

  @override
  String get copyBudgetMetricUnavailable => 'تقدير التخصيص غير متاح.';

  @override
  String get copyBudgetCurrencyUnavailable =>
      'لم تُضبط عملة الميزانية. تواصل مع المشغّل.';

  @override
  String get copyBudgetEnforcementUnavailable =>
      'تُحظر أوامر النسخ ذات الميزانية المُعدّة حتى يمكن التحقق من التعرض الآني وحجوزات الأوامر.';
}
