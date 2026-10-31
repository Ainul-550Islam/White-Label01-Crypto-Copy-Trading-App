// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Turkish (`tr`).
class AppLocalizationsTr extends AppLocalizations {
  AppLocalizationsTr([String locale = 'tr']) : super(locale);

  @override
  String get appTitle => 'İşlem kopyalama';

  @override
  String get signIn => 'Oturum aç';

  @override
  String get signOut => 'Oturumu kapat';

  @override
  String get emailLabel => 'E-posta';

  @override
  String get passwordLabel => 'Şifre';

  @override
  String get signInSubtitle => 'Devam etmek için hesabınızda oturum açın.';

  @override
  String get twoFactorTitle => 'İki faktörlü kimlik doğrulama';

  @override
  String get twoFactorSubtitle =>
      'Kimlik doğrulayıcı uygulamanızdan altı haneli kodu girin.';

  @override
  String get twoFactorCodeLabel => 'Kimlik doğrulama kodu';

  @override
  String get recoveryCodeLabel => 'Kurtarma kodu';

  @override
  String get useRecoveryCode => 'Bunun yerine bir kurtarma kodu kullanın';

  @override
  String get useAuthenticator =>
      'Bunun yerine kimlik doğrulayıcı uygulamamı kullan';

  @override
  String get verify => 'Doğrula';

  @override
  String get cancel => 'İptal';

  @override
  String get homeTitle => 'Genel Bakış';

  @override
  String get settingsTitle => 'Ayarlar';

  @override
  String get securityTitle => 'Güvenlik';

  @override
  String get loading => 'Yükleniyor';

  @override
  String get emailRequired => 'E-posta adresinizi girin';

  @override
  String get emailInvalid => 'Geçerli bir e-posta adresi girin';

  @override
  String get passwordRequired => 'Şifrenizi girin';

  @override
  String get codeRequired => 'Kimlik doğrulama kodunuzu girin';

  @override
  String get genericError => 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';

  @override
  String get sessionExpired =>
      'Oturumunuzun süresi doldu. Lütfen tekrar oturum açın.';

  @override
  String get welcomeBack => 'Tekrar hoş geldiniz';

  @override
  String get accountSection => 'Hesap';

  @override
  String get securitySection => 'Güvenlik';

  @override
  String get twoFactorEnabled => 'İki faktörlü kimlik doğrulama açık';

  @override
  String get twoFactorDisabled => 'İki faktörlü kimlik doğrulama kapalı';

  @override
  String get activeSessions => 'Aktif cihazlar';

  @override
  String get changePassword => 'Şifreyi değiştir';

  @override
  String get securityWebManagement =>
      'Web güvenliği ayarlarında etkin cihazlarınızı ve şifrenizi yönetin.';

  @override
  String get executionDisabledNotice =>
      'Bu sürümde gerçek emirlerin yürütülmesi devre dışıdır.';

  @override
  String get strategiesTitle => 'Stratejiler';

  @override
  String get strategiesSubtitle =>
      'Strateji sağlığını ve simüle edilmiş sonuçları görüntüleyin.';

  @override
  String get strategyReadOnlyNotice =>
      'Bu ekran salt okunurdur. Stratejiler yönetici konsolundan başlatılır, durdurulur ve yapılandırılır.';

  @override
  String get strategyPanelsDegraded =>
      'Bazı paneller yüklenemedi. Tekrar denemek için aşağı çekin.';

  @override
  String get liveExecutionReachable =>
      'Bu dağıtımda canlı yürütmeye ulaşılabilir';

  @override
  String get liveExecutionNotReachable =>
      'Bu dağıtımda canlı yürütmeye ulaşılamıyor';

  @override
  String get strategyEngineLabel => 'Strateji motoru';

  @override
  String get paperTradingLabel => 'Sanal işlem';

  @override
  String get backtestingLabel => 'Geriye dönük test';

  @override
  String get tradingModeLabel => 'Mod';

  @override
  String get strategyInstancesSection => 'Örnekler';

  @override
  String get paperSessionsSection => 'Sanal işlem oturumları';

  @override
  String get backtestsSection => 'Geriye dönük testler';

  @override
  String get strategyNoInstances => 'Hiçbir strateji örneği oluşturulmadı.';

  @override
  String get strategyNoPaperSessions => 'Henüz sanal işlem oturumu yapılmadı.';

  @override
  String get strategyNoBacktests => 'Hiçbir geriye dönük test yapılmadı.';

  @override
  String get instancesLabel => 'Örnekler';

  @override
  String get runningLabel => 'Çalışıyor';

  @override
  String get needsAttentionLabel => 'Dikkat edilmesi gerekiyor';

  @override
  String get openIncidentsLabel => 'Açık olaylar';

  @override
  String get enabledLabel => 'Etkin';

  @override
  String get disabledLabel => 'Devre dışı';

  @override
  String get consecutiveErrorsLabel => 'Ardışık hatalar';

  @override
  String get lastHeartbeatLabel => 'Son durum sinyali';

  @override
  String get noHeartbeatYet => 'Henüz durum sinyali alınmadı';

  @override
  String get statusLabel => 'Durum';

  @override
  String get equityLabel => 'Öz sermaye';

  @override
  String get realisedPnlLabel => 'Gerçekleşen PnL';

  @override
  String get netPnlLabel => 'Net kâr ve zarar';

  @override
  String get tradesLabel => 'İşlemler';

  @override
  String get winRateLabel => 'Kazanma oranı';

  @override
  String get sharpeLabel => 'Sharpe';

  @override
  String get maxDrawdownLabel => 'Maksimum düşüş';

  @override
  String get simulatedFillsLabel => 'Emirler / gerçekleşen işlemler';

  @override
  String get riskRejectionsLabel => 'Risk nedeniyle reddedilenler';

  @override
  String get simulatedBadge => 'SİMÜLE EDİLMİŞ';

  @override
  String get insufficientData => 'Yetersiz veri';

  @override
  String get notAvailableShort => 'Yok';

  @override
  String get statusQueued => 'Sıraya alındı';

  @override
  String get statusRunning => 'Çalışıyor';

  @override
  String get statusCompleted => 'Tamamlandı';

  @override
  String get statusStopped => 'Durduruldu';

  @override
  String get statusFailed => 'Başarısız';

  @override
  String get statusCancelled => 'İptal edildi';

  @override
  String get backtestNotReproducible =>
      'Bu çalıştırmanın veri kümesi sağlama toplamı yoktur ve tam olarak çoğaltılamaz.';

  @override
  String get simulationDisclaimerTitle => 'Bu sayılar hakkında';

  @override
  String get backtestDisclaimer =>
      'Geriye dönük test performansı gelecekteki performansın göstergesi değildir.';

  @override
  String get paperDisclaimer =>
      'Sanal işlem performansı, gerçek işlem performansının göstergesi değildir.';

  @override
  String get executionQualityDisclaimer =>
      'Simülasyon gerçek yürütme kalitesini garanti etmez.';

  @override
  String get insufficientDataDisclaimer =>
      'Çok az gözlemin olduğu durumlarda riske göre düzeltilmiş rakamlar saklı tutulmaktadır. Yetersiz veri sıfır değildir.';

  @override
  String get riskTitle => 'Risk';

  @override
  String get riskSubtitle =>
      'Kuruluşunuzun durdurma durumu ve yansıtılan verilerin güncelliği.';

  @override
  String get riskEngineOn => 'Risk motoru emir işleme yolunda etkin';

  @override
  String get riskEngineOff => 'Risk motoru devre dışı — yerel araç modu';

  @override
  String get riskFailClosedLabel => 'Hata durumunda güvenli ret';

  @override
  String get riskCadenceLabel => 'Yenileme / izin verilen veri yaşı';

  @override
  String get riskCadenceWarn =>
      'Görüntü yenilemesi izin verilen veri yaşından hızlı değil; eski veriler nedeniyle istekler reddedilebilir.';

  @override
  String get riskReadOnlyNotice =>
      'Risk durdurmaları burada salt okunurdur. Anahtarı etkinleştirmek veya kaldırmak için yönetici konsolunda gerekçe ve yazılı onay gerekir.';

  @override
  String get riskPanelsDegraded =>
      'Bazı risk panelleri yüklenemedi. Tekrar denemek için aşağı çekin.';

  @override
  String get riskMirrorSection => 'Hesaba göre son yansıtılan veriler';

  @override
  String get riskSwitchesSection => 'Etkin durdurma anahtarları';

  @override
  String get riskEventsSection => 'Son risk olayları';

  @override
  String get riskNoMirror =>
      'Henüz yansıtılmış hesap durumu yok. Risk durumu servisi eşitlenene kadar motor yeni emirleri reddeder; bu bir güvenlik önlemidir, ekran hatası değildir.';

  @override
  String get riskNoSwitches => 'Etkin bir durdurma yok.';

  @override
  String get riskNoEvents => 'Hiçbir risk olayı kaydedilmedi.';

  @override
  String get riskEngagedStopsLabel => 'Etkin durdurmalar';

  @override
  String get riskTriggeredProtectionsLabel => 'Tetiklenen korumalar';

  @override
  String get riskStaleMirrorsLabel => 'Güncelliğini yitirmiş hesap verileri';

  @override
  String get riskSevereEventsLabel => 'Şiddetli olaylar (24 saat)';

  @override
  String get riskSnapshotLabel => 'Anlık Görüntü';

  @override
  String get riskCapturedLabel => 'Yakalandı';

  @override
  String get riskEquityLabel => 'Öz sermaye';

  @override
  String get riskDayPnlLabel => 'Günlük net kâr ve zarar';

  @override
  String get riskGrossLabel => 'Brüt nominal değer';

  @override
  String get riskOpenOrdersLabel => 'Açık emirler';

  @override
  String get riskStaleSourcesLabel => 'Eski kaynaklar';

  @override
  String get riskStaleBadge => 'GÜNCEL DEĞİL';

  @override
  String get riskReasonLabel => 'Sebep';

  @override
  String get riskEngagedManualLabel => 'manuel durdurma';

  @override
  String get riskExplicitClearNotice =>
      'Bu koruma motor tarafından tetiklendi ve uygulamadan kaldırılamaz. Yönetici konsolunda yazılı onayla kabul edilip kaldırılabilir.';

  @override
  String get riskDisclaimer =>
      'Risk kontrolleri operasyonel riski azaltır ancak tüm kayıplara karşı garanti veremez.';

  @override
  String get retry => 'Tekrar dene';

  @override
  String get accountDisabled => 'Hesap devre dışı bırakıldı';

  @override
  String get accountLabel => 'Hesap adı';

  @override
  String get activityTab => 'Etkinlik';

  @override
  String get allMarkedRead => 'Okundu olarak işaretlenen tüm bildirimler';

  @override
  String get allocationLabel => 'Tahsis (tutar veya %)';

  @override
  String get apiKeyLabel => 'API anahtarı';

  @override
  String get apiSecretLabel => 'API sırrı';

  @override
  String get baseCurrencyLabel => 'Temel para birimi';

  @override
  String get checkHealth => 'Bağlantıyı kontrol edin';

  @override
  String get confirm => 'Onayla';

  @override
  String get connect => 'Bağlan';

  @override
  String get connectExchange => 'Borsayı bağla';

  @override
  String get connectExchangeFirst =>
      'İşlemleri kopyalamak için önce bir borsa hesabı bağlayın.';

  @override
  String get copiesLabel => 'Kopyalar';

  @override
  String get copyAction => 'Kopyala';

  @override
  String get copyRiskAcknowledgement =>
      'Kopyalanan işlemlerin para kaybedebileceğini, geçmiş performansın sonuçları öngörmediğini ve bir kopyayı durdurmanın açık pozisyonları kapatmadığını anlıyorum.';

  @override
  String get copyTradingSubtitle =>
      'Yatırımcıları bulun, kopyalarınızı yönetin ve kopyalanan işlemleri görün.';

  @override
  String get copyTradingTitle => 'İşlem kopyalama';

  @override
  String get copyingAccountLabel => 'Kopyalama yapan borsa hesabı';

  @override
  String get costBasisLabel => 'Maliyet esası';

  @override
  String get disable => 'Devre dışı bırak';

  @override
  String get disableAccountMessage =>
      'Bu hesapta kopyalama ve ticaret, web konsolundan yeniden etkinleştirilene kadar durdurulur.';

  @override
  String get disableAccountTitle => 'Bu hesap devre dışı bırakılsın mı?';

  @override
  String get drawdownLabel => 'Maksimum düşüş';

  @override
  String get environmentLabel => 'Çevre';

  @override
  String get exchangeAccountsSubtitle =>
      'Bağlı borsalar, anahtar durumu ve bağlantı sağlığı.';

  @override
  String get exchangeAccountsTitle => 'Borsa hesapları';

  @override
  String get exchangeConnected => 'Borsa bağlandı';

  @override
  String get failedLabel => 'Başarısız';

  @override
  String get fieldRequired => 'Gerekli';

  @override
  String get followersLabel => 'Takipçiler';

  @override
  String get fundingSubtitle =>
      'Hesaplar, para yatırma talepleri ve transfer geçmişi.';

  @override
  String get fundingTitle => 'Finansman';

  @override
  String get healthCheckDone => 'Bağlantı kontrolü tamamlandı';

  @override
  String get holdingsLabel => 'Varlıklar';

  @override
  String get inboxTab => 'Gelen kutusu';

  @override
  String get lastErrorLabel => 'Son hata';

  @override
  String get lastVerifiedLabel => 'Son doğrulandı';

  @override
  String get liveKeyWarning =>
      'CANLI anahtarlar gerçek parayla işlem yapar. Yalnızca işlem yetkili ve para çekme yetkisi kapalı anahtarlar kullanın.';

  @override
  String get liveTradingOffNotice =>
      'Bu hesapta gerçek işlem etkinleştirilmemiştir.';

  @override
  String get markAllRead => 'Tümünü okundu olarak işaretle';

  @override
  String get markedRead => 'Okundu olarak işaretlendi';

  @override
  String get maxAllocationLabel => 'Maksimum tahsis (isteğe bağlı)';

  @override
  String get myCopiesTab => 'Kopyalarım';

  @override
  String get navLabel => 'Net varlık değeri';

  @override
  String get noCopyActivity => 'Henüz kopyalanmış işlem yok.';

  @override
  String get noCopyableStrategies =>
      'Bu yatırımcının kopyalamaya açık bir stratejisi yok.';

  @override
  String get noExchangeAccounts =>
      'Henüz borsa hesabı yok. Başlamak için bir hesap bağlayın.';

  @override
  String get noNotifications => 'Bildirim yok.';

  @override
  String get noPortfolio => 'Hesabınız için henüz bir portföy oluşturulmadı.';

  @override
  String get noSubscriptions => 'Henüz kimseyi kopyalamıyorsunuz.';

  @override
  String get noTraders => 'Kullanılabilir yatırımcı yok.';

  @override
  String get noTransactions => 'Henüz işlem yok.';

  @override
  String get nothingHereYet => 'Burada henüz bir şey yok.';

  @override
  String get notificationsTitle => 'Bildirimler';

  @override
  String get partialDataNotice => 'Bazı veriler yüklenemedi';

  @override
  String get passphraseLabel => 'API parolası';

  @override
  String get pastPerformanceNotice =>
      'Geçmiş performans gelecekteki sonuçların garantisi değildir.';

  @override
  String get pause => 'Duraklat';

  @override
  String get paused => 'Kopyalama duraklatıldı';

  @override
  String get pnlLabel => 'PnL';

  @override
  String get portfolioLabel => 'Portföy';

  @override
  String get portfolioSubtitle =>
      'Varlıklar, net varlık değeri ve kâr ve zarar.';

  @override
  String get portfolioTitle => 'Portföy';

  @override
  String get preferencesSaved => 'Tercihler kaydedildi';

  @override
  String get preferencesTab => 'Tercihler';

  @override
  String get displayPreferences => 'Görüntüleme tercihleri';

  @override
  String get languageLabel => 'Dil';

  @override
  String get displayCurrencyLabel => 'Görüntüleme para birimi';

  @override
  String get timeZoneLabel => 'Saat dilimi (IANA)';

  @override
  String get timeZoneRequired => 'Bir saat dilimi girin';

  @override
  String get dateFormatLabel => 'Tarih formatı';

  @override
  String get preferencesSupportNotice =>
      'Tercihler hesabınıza kaydedilir. Para birimi, saat dilimi ve tarih formatı desteği ekrana göre değişir.';

  @override
  String get savePreferences => 'Tercihleri kaydet';

  @override
  String get resume => 'Devam et';

  @override
  String get resumed => 'Kopyalama devam ettirildi';

  @override
  String get sizingModeLabel => 'Boyutlandırma modu';

  @override
  String get startCopying => 'Kopyalamaya başla';

  @override
  String get startedLabel => 'Başlatıldı';

  @override
  String get stop => 'Durdur';

  @override
  String get stopCopyingMessage =>
      'Yeni işlemler artık kopyalanmayacak. Zaten açık olan pozisyonlar siz kapatana kadar açık kalır.';

  @override
  String get stopCopyingTitle => 'Kopyalama durdurulsun mu?';

  @override
  String get stopped => 'Kopyalama durduruldu';

  @override
  String get subscribed => 'Şimdi bu stratejiyi kopyalıyorsunuz';

  @override
  String get tradeOnlyKeysNotice =>
      'Anahtarlarınız şifreli bağlantı üzerinden bir kez gönderilir ve hiçbir zaman bu cihazda saklanmaz.';

  @override
  String get tradersTab => 'Yatırımcılar';

  @override
  String get transactionsTab => 'İşlemler';

  @override
  String get venueLabel => 'Borsa';

  @override
  String get withdrawOnWebNotice =>
      'Bu uygulamada para çekme işlemi mümkün değildir. Onaylanmış para çekme kanalları hakkında sağlayıcınızla iletişime geçin.';

  @override
  String get accountsTab => 'Hesaplar';

  @override
  String get noFundingAccounts =>
      'Henüz hesap yok. Bir tane açmak için katılım işlemini tamamlayın.';

  @override
  String get requestDeposit => 'Para yatırma talebi oluştur';

  @override
  String get depositRequested => 'Para yatırma talebi gönderildi';

  @override
  String get depositUnconfirmed =>
      'Para yatırma isteği onaylanamadı. Tekrar denemeden önce finansman geçmişinizi kontrol edin.';

  @override
  String get amountLabel => 'Tutar';

  @override
  String get currencyLabel => 'Para birimi';

  @override
  String get transferReferenceLabel => 'Transfer referansı (gerekli)';

  @override
  String get transferReferenceRequired => 'Transfer referansınızı girin.';

  @override
  String get depositRequestNotice =>
      'Para yatırma talebi yapmayı planladığınız transferi kaydeder. Bakiye ancak operasyon ekibi fonların alındığını onayladıktan sonra hesabınıza yansıtılır.';

  @override
  String get invalidAmount => 'Sıfırdan büyük bir miktar girin.';

  @override
  String get invalidCurrency => 'USDT gibi bir para birimi kodu girin.';

  @override
  String get depositsUnavailable => 'Para yatırma kullanılamıyor';

  @override
  String get depositLabel => 'Para yatırma';

  @override
  String get withdrawalLabel => 'Para çekme';

  @override
  String get confirmedAmountLabel => 'Onaylandı';

  @override
  String get pendingNotCompleted =>
      'Bekleyen talepler tamamlanmış transferler değildir.';

  @override
  String get deviceNotificationsTitle => 'Cihaz bildirim izni';

  @override
  String get deviceNotificationsExplanation =>
      'Bu izin yalnızca bu cihazı etkiler. Bildirimlerin iletilmesi için yapılandırılmış bir bildirim hizmeti de gerekir.';

  @override
  String get deviceNotificationsUndetermined => 'Henüz talep edilmedi';

  @override
  String get deviceNotificationsAllowed => 'İzin verildi';

  @override
  String get deviceNotificationsLimited => 'Sınırlı teslimatla izin veriliyor';

  @override
  String get deviceNotificationsDenied => 'Cihaz ayarlarında reddedildi';

  @override
  String get deviceNotificationsUnavailable =>
      'İzin durumu bu cihazda kullanılamıyor';

  @override
  String get deviceNotificationsRequest => 'Cihaz izni iste';

  @override
  String get deviceNotificationsSettings => 'Cihaz ayarlarını aç';

  @override
  String get deviceNotificationsSettingsError => 'Cihaz ayarları açılamadı.';

  @override
  String get devicePushRegistered =>
      'Cihaz kaydedildi. Sağlayıcı üzerinden teslimat garanti edilmez.';

  @override
  String get devicePushUnavailable =>
      'Cihaz kaydı kullanılamıyor. Bağlantıyı kontrol edip tekrar deneyin.';

  @override
  String get devicePushRetry => 'Cihaz kaydını yeniden deneyin';

  @override
  String get destinationCheckTitle => 'Para çekme hedefini kontrol edin';

  @override
  String get destinationCheckNotice =>
      'Bir adresin şu anda izin verilenler listenizde olup olmadığını kontrol edin. Bu kontrol para çekme talebi oluşturmaz ve gelecekteki transferi garanti etmez.';

  @override
  String get destinationNetwork => 'Ağ';

  @override
  String get destinationAddress => 'Hedef adresi';

  @override
  String get destinationAddressInvalid =>
      '16 ila 128 karakter arasında bir adres girin.';

  @override
  String get destinationCheckAction => 'İzin verilenler listesini kontrol edin';

  @override
  String get destinationCheckAllowed =>
      'Adres bu kontrol anında izin verilenler listenizde. Diğer para çekme koşulları da geçerlidir.';

  @override
  String get destinationCheckPending =>
      'Bu hedef etkinleştirilmeyi bekliyor ve şu anda kullanılamıyor.';

  @override
  String get destinationCheckDenied =>
      'Bu ağ için etkin ve onaylı bir hedef değil.';

  @override
  String get destinationCheckError =>
      'Hedef kontrol edilemedi. Bağlantınızı kontrol edip tekrar deneyin.';

  @override
  String get riskPanelUnavailable =>
      'Bu risk paneli kullanılamıyor. Yeniden denemek için aşağı çekin.';

  @override
  String get riskSwitchListIncomplete =>
      'Durdurma sayısı ve listesi eksik veya uyumsuz olabilir. Kontrol etmek için yenileyin.';

  @override
  String get copyBudgetTitle => 'Kopyalama bütçesi';

  @override
  String get copyBudgetAbout =>
      'Yapılandırılmış kopyalama bütçesi limitini düşürün. Bu, hesap genelinde risk limiti değildir ve mevcut pozisyonları kapatmaz.';

  @override
  String get copyBudgetEffective => 'Geçerli etkin limit';

  @override
  String get copyBudgetUnlimited => 'Limit belirlenmedi';

  @override
  String get copyBudgetCommitted => 'Etkin tahsis değerlerinin toplamı';

  @override
  String get copyBudgetNewLimit => 'Yeni üst sınır';

  @override
  String get copyBudgetHelp =>
      'Burada yalnızca limiti düşürebilirsiniz. Binlik ayırıcı kullanmayın; ondalık için nokta ve en fazla 16 tam, 12 ondalık basamak kullanın.';

  @override
  String get copyBudgetInvalid =>
      'En fazla 12 ondalık basamaklı, negatif olmayan bir tutar girin.';

  @override
  String get copyBudgetTooHigh => 'Yeni limit geçerli etkin limiti aşamaz.';

  @override
  String get copyBudgetReduce => 'Limiti düşür';

  @override
  String get copyBudgetSaving => 'Kaydediliyor…';

  @override
  String get copyBudgetSaved =>
      'Limit düşürme kaydedildi. Geçerli limit yukarıda gösterilir.';

  @override
  String get copyBudgetUnavailable =>
      'Kopyalama bütçesi kullanılamıyor. Yeniden deneyin.';

  @override
  String get copyBudgetFailed =>
      'Limit düşürme doğrulanamadı. Yenileyip tekrar deneyin.';

  @override
  String get copyBudgetEstimateWarning =>
      'Tahsis değerleri farklı birimler kullanabilir; doğrulanmış canlı maruziyet veya zarara karşı garanti değildir.';

  @override
  String get copyBudgetMetricUnavailable => 'Tahsis tahmini kullanılamıyor.';

  @override
  String get copyBudgetCurrencyUnavailable =>
      'Bütçe para birimi yapılandırılmamış. Operatörünüzle iletişime geçin.';

  @override
  String get copyBudgetEnforcementUnavailable =>
      'Canlı maruziyet ve emir rezervasyonları doğrulanana kadar yapılandırılmış bütçeye sahip kopyalama emirleri engellenir.';

  @override
  String get venueStatusTitle => 'Borsa durumu';

  @override
  String get venueStatusEmpty => 'Hesabınız için henüz listelenmiş borsa yok.';

  @override
  String get venueStatusOperational => 'Çalışıyor';

  @override
  String get venueStatusDegraded => 'Kısıtlı çalışıyor';

  @override
  String get venueStatusMaintenance => 'Bakımda';

  @override
  String get venueStatusOutage => 'Kesinti';

  @override
  String get venueStatusUnknown => 'Durum bilinmiyor';

  @override
  String get venueStatusSince => 'Başlangıç';

  @override
  String get venueStatusUnverified =>
      'Platform bunu şu anda doğrulamadı — işlem başarısız olabilir.';

  @override
  String get venueStatusOperatorSet =>
      'Yalnızca borsanın kendi akışıyla değil, bir operatör tarafından belirlendi.';

  @override
  String get venueStatusChecked => 'Son kontrol';

  @override
  String get venueStatusSubtitle =>
      'İşlem yaptığınız borsaların şu anda açık olup olmadığı';

  @override
  String get loginAlertsTitle => 'Giriş uyarıları';

  @override
  String get loginAlertsAll => 'Tümü';

  @override
  String get loginAlertsSignIns => 'Girişler';

  @override
  String get loginAlertsFailures => 'Başarısız girişler';

  @override
  String get loginAlertsNewDevice => 'Yeni cihaz';

  @override
  String get loginAlertsSuspicious => 'Şüpheli';

  @override
  String get loginAlertsPassword => 'Parola değişiklikleri';

  @override
  String get loginAlertsEmpty => 'Hesabınızda kayıtlı giriş etkinliği yok.';

  @override
  String get loginAlertsAdvice =>
      'Tanımadığınız bir olay varsa parolanızı değiştirin ve web güvenlik ayarlarından etkin cihazlarınızı gözden geçirin.';

  @override
  String get loginAlertsSeverityLabel => 'Önem derecesi';

  @override
  String get loginAlertsDevice => 'Cihaz';

  @override
  String get dataExportTitle => 'Verileriniz';

  @override
  String get dataExportAbout =>
      'Kişisel verilerinizin bir kopyasını isteyin. Hazır olduğunda bilgilendirileceksiniz; ardından bir kez çalışan ve süresi dolan bir bağlantı oluşturabilirsiniz.';

  @override
  String get dataExportJurisdiction => 'Yetki bölgesi';

  @override
  String get dataExportRequest => 'Kopya isteyin';

  @override
  String get dataExportWorking => 'İşleniyor…';

  @override
  String get dataExportRequests => 'Talepleriniz';

  @override
  String get dataExportNone => 'Henüz verilerinizin bir kopyasını istemediniz.';

  @override
  String get dataExportRequestedSent => 'Talep alındı. Referansı';

  @override
  String get dataExportRequestedAtLabel => 'Talep tarihi';

  @override
  String get dataExportNeedsYou =>
      'Devam etmek için sizden bir şey gerekiyor. E-postanızı kontrol edin.';

  @override
  String get dataExportRetention =>
      'Bazı kayıtlar yasa gereği saklanmalıdır ve şu anda silinemez.';

  @override
  String get dataExportLegalHold =>
      'Bu kayıtlar yasal saklama altında ve silinemez.';

  @override
  String get dataExportGetLink => 'İndirme bağlantısı oluştur';

  @override
  String get dataExportTokenIssued =>
      'Tek kullanımlık bağlantı şu ana kadar hazır:';

  @override
  String get dataExportTokenNoExpiry =>
      'Bir bağlantı verildi ancak son kullanma zamanı okunamadı. Ona güvenmeden önce yenisini isteyin.';

  @override
  String get feeScheduleTitle => 'Ücretler';

  @override
  String get feeScheduleEffective => 'Şu anda yürürlükte';

  @override
  String get feeScheduleEmpty => 'Henüz bir ücret tarifesi yayımlanmadı.';

  @override
  String get feeScheduleFromLabel => 'Başlangıç';

  @override
  String get feeScheduleUntilLabel => 'Bitiş';

  @override
  String get feeScheduleManagement => 'Yönetim ücreti';

  @override
  String get feeScheduleProfitShare => 'Kâr payı';

  @override
  String get feeScheduleCurrency => 'Para birimi';

  @override
  String get feeScheduleVersion => 'Sürüm';

  @override
  String get feeScheduleHistory => 'Önceki sürümler';

  @override
  String get feeScheduleOverride =>
      'Bu tarife operatörünüz tarafından belirlenmiştir ve platform varsayılanından farklıdır.';
}
