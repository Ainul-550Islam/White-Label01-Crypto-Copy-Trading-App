// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appTitle => 'Copy trading';

  @override
  String get signIn => 'Iniciar sesión';

  @override
  String get signOut => 'Cerrar sesión';

  @override
  String get emailLabel => 'Correo electrónico';

  @override
  String get passwordLabel => 'Contraseña';

  @override
  String get signInSubtitle => 'Inicia sesión en tu cuenta para continuar.';

  @override
  String get twoFactorTitle => 'Autenticación de dos factores';

  @override
  String get twoFactorSubtitle =>
      'Ingrese el código de seis dígitos de su aplicación de autenticación.';

  @override
  String get twoFactorCodeLabel => 'código de autenticación';

  @override
  String get recoveryCodeLabel => 'Código de recuperación';

  @override
  String get useRecoveryCode => 'Utilice un código de recuperación en su lugar';

  @override
  String get useAuthenticator =>
      'Utilice mi aplicación de autenticación en su lugar';

  @override
  String get verify => 'verificar';

  @override
  String get cancel => 'Cancelar';

  @override
  String get homeTitle => 'Descripción general';

  @override
  String get settingsTitle => 'Configuración';

  @override
  String get securityTitle => 'Seguridad';

  @override
  String get loading => 'Cargando';

  @override
  String get emailRequired => 'Introduce tu dirección de correo electrónico';

  @override
  String get emailInvalid =>
      'Introduzca una dirección de correo electrónico válida';

  @override
  String get passwordRequired => 'Introduce tu contraseña';

  @override
  String get codeRequired => 'Ingrese su código de autenticación';

  @override
  String get genericError => 'Algo salió mal. Por favor inténtalo de nuevo.';

  @override
  String get sessionExpired =>
      'Tu sesión ha caducado. Por favor inicia sesión nuevamente.';

  @override
  String get welcomeBack => 'Bienvenido de nuevo';

  @override
  String get accountSection => 'cuenta';

  @override
  String get securitySection => 'Seguridad';

  @override
  String get twoFactorEnabled =>
      'La autenticación de dos factores está activada';

  @override
  String get twoFactorDisabled =>
      'La autenticación de dos factores está desactivada';

  @override
  String get activeSessions => 'Dispositivos activos';

  @override
  String get changePassword => 'Cambiar contraseña';

  @override
  String get securityWebManagement =>
      'Administre sus dispositivos activos y su contraseña en la configuración de seguridad web.';

  @override
  String get executionDisabledNotice =>
      'La ejecución de órdenes reales está desactivada en esta versión.';

  @override
  String get strategiesTitle => 'Estrategias';

  @override
  String get strategiesSubtitle =>
      'Ver el estado de la estrategia y los resultados simulados.';

  @override
  String get strategyReadOnlyNotice =>
      'Esta pantalla es de sólo lectura. Las estrategias se inician, detienen y configuran desde la consola de administración.';

  @override
  String get strategyPanelsDegraded =>
      'Algunos paneles no se pudieron cargar. Tire hacia abajo para intentarlo de nuevo.';

  @override
  String get liveExecutionReachable =>
      'La ejecución en vivo es accesible en esta implementación';

  @override
  String get liveExecutionNotReachable =>
      'No se puede acceder a la ejecución en vivo en esta implementación';

  @override
  String get strategyEngineLabel => 'Motor de estrategia';

  @override
  String get paperTradingLabel => 'Operativa simulada';

  @override
  String get backtestingLabel => 'Prueba retrospectiva';

  @override
  String get tradingModeLabel => 'Modo';

  @override
  String get strategyInstancesSection => 'Instancias';

  @override
  String get paperSessionsSection => 'Sesiones de operativa simulada';

  @override
  String get backtestsSection => 'Pruebas retrospectivas';

  @override
  String get strategyNoInstances =>
      'No se han creado instancias de estrategia.';

  @override
  String get strategyNoPaperSessions =>
      'Aún no se han realizado sesiones de operativa simulada.';

  @override
  String get strategyNoBacktests =>
      'No se han realizado pruebas retrospectivas.';

  @override
  String get instancesLabel => 'Instancias';

  @override
  String get runningLabel => 'En ejecución';

  @override
  String get needsAttentionLabel => 'Requiere atención';

  @override
  String get openIncidentsLabel => 'Incidencias abiertas';

  @override
  String get enabledLabel => 'Habilitado';

  @override
  String get disabledLabel => 'Desactivado';

  @override
  String get consecutiveErrorsLabel => 'Errores consecutivos';

  @override
  String get lastHeartbeatLabel => 'Última señal de actividad';

  @override
  String get noHeartbeatYet => 'Aún no se ha recibido una señal de actividad';

  @override
  String get statusLabel => 'Estado';

  @override
  String get equityLabel => 'Patrimonio';

  @override
  String get realisedPnlLabel => 'PnL realizado';

  @override
  String get netPnlLabel => 'Pérdida y ganancia neta';

  @override
  String get tradesLabel => 'Operaciones';

  @override
  String get winRateLabel => 'Tasa de ganancia';

  @override
  String get sharpeLabel => 'Sharpe';

  @override
  String get maxDrawdownLabel => 'Caída máxima';

  @override
  String get simulatedFillsLabel => 'Órdenes / ejecuciones';

  @override
  String get riskRejectionsLabel => 'Rechazos por riesgo';

  @override
  String get simulatedBadge => 'SIMULADO';

  @override
  String get insufficientData => 'Datos insuficientes';

  @override
  String get notAvailableShort => 'N/A';

  @override
  String get statusQueued => 'En cola';

  @override
  String get statusRunning => 'En ejecución';

  @override
  String get statusCompleted => 'Completado';

  @override
  String get statusStopped => 'Detenido';

  @override
  String get statusFailed => 'Fallido';

  @override
  String get statusCancelled => 'Cancelado';

  @override
  String get backtestNotReproducible =>
      'Esta ejecución no tiene suma de verificación del conjunto de datos y no se puede reproducir exactamente.';

  @override
  String get simulationDisclaimerTitle => 'Sobre estos números';

  @override
  String get backtestDisclaimer =>
      'El rendimiento de la prueba retrospectiva no indica el rendimiento futuro.';

  @override
  String get paperDisclaimer =>
      'El rendimiento de la operativa simulada no indica el rendimiento real.';

  @override
  String get executionQualityDisclaimer =>
      'La simulación no garantiza una calidad de ejecución real.';

  @override
  String get insufficientDataDisclaimer =>
      'Las cifras ajustadas por riesgo se retienen cuando hubo muy pocas observaciones. Los datos insuficientes no son cero.';

  @override
  String get riskTitle => 'Riesgo';

  @override
  String get riskSubtitle =>
      'Estado de las detenciones y actualización de los datos de su organización.';

  @override
  String get riskEngineOn =>
      'El motor de riesgo interviene en el procesamiento de órdenes';

  @override
  String get riskEngineOff =>
      'Motor de riesgo desactivado: modo de herramientas locales';

  @override
  String get riskFailClosedLabel => 'Bloqueo seguro ante fallos';

  @override
  String get riskCadenceLabel => 'Actualización / antigüedad máxima';

  @override
  String get riskCadenceWarn =>
      'La instantánea no se actualiza más rápido que el límite de antigüedad; pueden rechazarse solicitudes por datos obsoletos.';

  @override
  String get riskReadOnlyNotice =>
      'Las interrupciones de riesgo son de solo lectura aquí. Para activar o desactivar una protección, la consola exige un motivo y una confirmación escrita.';

  @override
  String get riskPanelsDegraded =>
      'No se pudieron cargar algunos paneles de riesgo. Tire hacia abajo para intentarlo de nuevo.';

  @override
  String get riskMirrorSection => 'Últimos datos reflejados por cuenta';

  @override
  String get riskSwitchesSection => 'Protecciones de detención activas';

  @override
  String get riskEventsSection => 'Eventos de riesgo recientes';

  @override
  String get riskNoMirror =>
      'Todavía no hay estado reflejado de la cuenta. El motor rechaza órdenes nuevas hasta que se sincronice el proceso de riesgo; es una medida de seguridad, no un error de pantalla.';

  @override
  String get riskNoSwitches => 'No hay detenciones activas.';

  @override
  String get riskNoEvents => 'No se registraron eventos de riesgo.';

  @override
  String get riskEngagedStopsLabel => 'Detenciones activas';

  @override
  String get riskTriggeredProtectionsLabel => 'Protecciones activadas';

  @override
  String get riskStaleMirrorsLabel => 'Datos de cuentas desactualizados';

  @override
  String get riskSevereEventsLabel => 'Eventos severos (24h)';

  @override
  String get riskSnapshotLabel => 'Instantánea';

  @override
  String get riskCapturedLabel => 'capturado';

  @override
  String get riskEquityLabel => 'Patrimonio';

  @override
  String get riskDayPnlLabel => 'Pérdida y ganancia neta diaria';

  @override
  String get riskGrossLabel => 'Valor nocional bruto';

  @override
  String get riskOpenOrdersLabel => 'Órdenes abiertas';

  @override
  String get riskStaleSourcesLabel => 'Fuentes obsoletas';

  @override
  String get riskStaleBadge => 'DESACTUALIZADO';

  @override
  String get riskReasonLabel => 'Razón';

  @override
  String get riskEngagedManualLabel => 'parada manual';

  @override
  String get riskExplicitClearNotice =>
      'El motor activó esta protección. No se puede eliminar desde la aplicación; confirme y elimínela en la consola de administración con una confirmación escrita.';

  @override
  String get riskDisclaimer =>
      'Los controles de riesgo reducen el riesgo operativo pero no pueden garantizar contra todas las pérdidas.';

  @override
  String get retry => 'Inténtalo de nuevo';

  @override
  String get accountDisabled => 'Cuenta inhabilitada';

  @override
  String get accountLabel => 'Nombre de cuenta';

  @override
  String get activityTab => 'Actividad';

  @override
  String get allMarkedRead => 'Todas las notificaciones marcadas como leídas';

  @override
  String get allocationLabel => 'Asignación (monto o %)';

  @override
  String get apiKeyLabel => 'clave API';

  @override
  String get apiSecretLabel => 'secreto de API';

  @override
  String get baseCurrencyLabel => 'Moneda base';

  @override
  String get checkHealth => 'Comprobar conexión';

  @override
  String get confirm => 'Confirmar';

  @override
  String get connect => 'Conectar';

  @override
  String get connectExchange => 'Conectar plataforma de intercambio';

  @override
  String get connectExchangeFirst =>
      'Conecte primero una cuenta de intercambio para copiar operaciones.';

  @override
  String get copiesLabel => 'Copias';

  @override
  String get copyAction => 'Copiar';

  @override
  String get copyRiskAcknowledgement =>
      'Entiendo que las operaciones copiadas pueden hacer perder dinero, el rendimiento pasado no predice los resultados y detener una copia no cierra las posiciones abiertas.';

  @override
  String get copyTradingSubtitle =>
      'Encuentre operadores, gestione sus copias y vea las operaciones copiadas.';

  @override
  String get copyTradingTitle => 'Copy trading';

  @override
  String get copyingAccountLabel => 'Cuenta de intercambio que copia';

  @override
  String get costBasisLabel => 'base de costo';

  @override
  String get disable => 'Desactivar';

  @override
  String get disableAccountMessage =>
      'La copia y el comercio en esta cuenta se detienen hasta que se vuelva a habilitar desde la consola web.';

  @override
  String get disableAccountTitle => '¿Desactivar esta cuenta?';

  @override
  String get drawdownLabel => 'Caída máxima';

  @override
  String get environmentLabel => 'Medio ambiente';

  @override
  String get exchangeAccountsSubtitle =>
      'Plataformas conectadas, estado de las claves y conexión.';

  @override
  String get exchangeAccountsTitle => 'Cuentas de intercambio';

  @override
  String get exchangeConnected => 'Plataforma de intercambio conectada';

  @override
  String get failedLabel => 'Fallido';

  @override
  String get fieldRequired => 'Requerido';

  @override
  String get followersLabel => 'Seguidores';

  @override
  String get fundingSubtitle =>
      'Cuentas, solicitudes de depósito e historial de transferencias.';

  @override
  String get fundingTitle => 'Financiamiento';

  @override
  String get healthCheckDone => 'Comprobación de conexión finalizada';

  @override
  String get holdingsLabel => 'Activos';

  @override
  String get inboxTab => 'Bandeja de entrada';

  @override
  String get lastErrorLabel => 'último error';

  @override
  String get lastVerifiedLabel => 'Última verificación';

  @override
  String get liveKeyWarning =>
      'Las claves de producción operan con fondos reales. Use claves solo para operar y con retiros desactivados.';

  @override
  String get liveTradingOffNotice =>
      'La operativa real no está habilitada para esta cuenta.';

  @override
  String get markAllRead => 'Marcar las notificaciones como leídas';

  @override
  String get markedRead => 'Marcado como leído';

  @override
  String get maxAllocationLabel => 'Asignación máxima (opcional)';

  @override
  String get myCopiesTab => 'mis copias';

  @override
  String get navLabel => 'Valor liquidativo';

  @override
  String get noCopyActivity => 'Aún no hay operaciones copiadas.';

  @override
  String get noCopyableStrategies =>
      'Este operador no tiene estrategias disponibles para copiar.';

  @override
  String get noExchangeAccounts =>
      'Aún no hay cuentas de intercambio. Conecte una para empezar.';

  @override
  String get noNotifications => 'Sin notificaciones.';

  @override
  String get noPortfolio =>
      'Aún no se ha configurado ninguna cartera para su cuenta.';

  @override
  String get noSubscriptions => 'No estás copiando a nadie todavía.';

  @override
  String get noTraders => 'No hay operadores disponibles.';

  @override
  String get noTransactions => 'Aún no hay transacciones.';

  @override
  String get nothingHereYet => 'Nada aquí todavía.';

  @override
  String get notificationsTitle => 'Notificaciones';

  @override
  String get partialDataNotice => 'Algunos datos no se pudieron cargar.';

  @override
  String get passphraseLabel => 'frase de contraseña API';

  @override
  String get pastPerformanceNotice =>
      'El rendimiento pasado no es garantía de resultados futuros.';

  @override
  String get pause => 'Pausa';

  @override
  String get paused => 'Copia en pausa';

  @override
  String get pnlLabel => 'PNL';

  @override
  String get portfolioLabel => 'Portafolio';

  @override
  String get portfolioSubtitle =>
      'Activos, valor liquidativo y pérdidas y ganancias.';

  @override
  String get portfolioTitle => 'Portafolio';

  @override
  String get preferencesSaved => 'Preferencias guardadas';

  @override
  String get preferencesTab => 'Preferencias';

  @override
  String get displayPreferences => 'Preferencias de visualización';

  @override
  String get languageLabel => 'Idioma';

  @override
  String get displayCurrencyLabel => 'Moneda de visualización';

  @override
  String get timeZoneLabel => 'Zona horaria (IANA)';

  @override
  String get timeZoneRequired => 'Introduce una zona horaria';

  @override
  String get dateFormatLabel => 'Formato de fecha';

  @override
  String get preferencesSupportNotice =>
      'Las preferencias se guardan en su cuenta. La compatibilidad con el formato de moneda, zona horaria y fecha varía según la pantalla.';

  @override
  String get savePreferences => 'Guardar preferencias';

  @override
  String get resume => 'Reanudar';

  @override
  String get resumed => 'Se reanudó la copia';

  @override
  String get sizingModeLabel => 'Modo de dimensionamiento';

  @override
  String get startCopying => 'Empezar a copiar';

  @override
  String get startedLabel => 'iniciado';

  @override
  String get stop => 'Detener';

  @override
  String get stopCopyingMessage =>
      'Las nuevas operaciones ya no se copiarán. Las posiciones ya abiertas permanecen abiertas hasta que las cierres.';

  @override
  String get stopCopyingTitle => '¿Dejar de copiar?';

  @override
  String get stopped => 'Copia detenida';

  @override
  String get subscribed => 'Ahora estás copiando esta estrategia.';

  @override
  String get tradeOnlyKeysNotice =>
      'Sus claves se envían una vez a través de una conexión cifrada y nunca se almacenan en este dispositivo.';

  @override
  String get tradersTab => 'Operadores';

  @override
  String get transactionsTab => 'Transacciones';

  @override
  String get venueLabel => 'Plataforma de intercambio';

  @override
  String get withdrawOnWebNotice =>
      'Los retiros no están disponibles en esta aplicación. Comuníquese con su proveedor sobre los canales de retiro aprobados.';

  @override
  String get accountsTab => 'Cuentas';

  @override
  String get noFundingAccounts =>
      'Aún no hay cuenta. Complete la incorporación para abrir uno.';

  @override
  String get requestDeposit => 'Solicitar depósito';

  @override
  String get depositRequested => 'Solicitud de depósito enviada';

  @override
  String get depositUnconfirmed =>
      'No se pudo confirmar la solicitud de depósito. Verifique su historial de financiación antes de volver a intentarlo.';

  @override
  String get amountLabel => 'Cantidad';

  @override
  String get currencyLabel => 'Moneda';

  @override
  String get transferReferenceLabel =>
      'Referencia de transferencia (obligatoria)';

  @override
  String get transferReferenceRequired =>
      'Introduzca la referencia de la transferencia.';

  @override
  String get depositRequestNotice =>
      'Una solicitud de depósito registra la transferencia que desea realizar. El saldo se acredita solo después de que el equipo de operaciones confirme la recepción de los fondos.';

  @override
  String get invalidAmount => 'Ingrese una cantidad mayor que cero.';

  @override
  String get invalidCurrency => 'Ingrese un código de moneda como USDT.';

  @override
  String get depositsUnavailable => 'Depósitos no disponibles';

  @override
  String get depositLabel => 'Depósito';

  @override
  String get withdrawalLabel => 'Retiro';

  @override
  String get confirmedAmountLabel => 'Confirmado';

  @override
  String get pendingNotCompleted =>
      'Las solicitudes pendientes no son transferencias completadas.';

  @override
  String get deviceNotificationsTitle =>
      'Permiso de notificación del dispositivo';

  @override
  String get deviceNotificationsExplanation =>
      'Este permiso solo afecta a este dispositivo. La entrega de notificaciones también requiere un servicio push configurado.';

  @override
  String get deviceNotificationsUndetermined => 'Aún no solicitado';

  @override
  String get deviceNotificationsAllowed => 'Permitido';

  @override
  String get deviceNotificationsLimited => 'Permitido con entrega limitada';

  @override
  String get deviceNotificationsDenied =>
      'Denegado en la configuración del dispositivo';

  @override
  String get deviceNotificationsUnavailable =>
      'El estado del permiso no está disponible en este dispositivo';

  @override
  String get deviceNotificationsRequest => 'Solicitar permiso del dispositivo';

  @override
  String get deviceNotificationsSettings =>
      'Abrir la configuración del dispositivo';

  @override
  String get deviceNotificationsSettingsError =>
      'No se pudo abrir la configuración del dispositivo.';

  @override
  String get devicePushRegistered =>
      'Dispositivo registrado. No se garantiza la entrega por parte del proveedor.';

  @override
  String get devicePushUnavailable =>
      'El registro del dispositivo no está disponible. Verifique la conexión y vuelva a intentarlo.';

  @override
  String get devicePushRetry => 'Reintentar el registro del dispositivo';

  @override
  String get destinationCheckTitle => 'Verificar destino de retiro';

  @override
  String get destinationCheckNotice =>
      'Compruebe si una dirección está actualmente en su lista permitida. Esta comprobación no crea un retiro ni garantiza una transferencia futura.';

  @override
  String get destinationNetwork => 'Red';

  @override
  String get destinationAddress => 'Dirección de destino';

  @override
  String get destinationAddressInvalid =>
      'Introduzca una dirección de entre 16 y 128 caracteres.';

  @override
  String get destinationCheckAction => 'Verificar lista de permitidos';

  @override
  String get destinationCheckAllowed =>
      'La dirección está en su lista permitida en el momento de la comprobación. Se siguen aplicando las demás condiciones de retiro.';

  @override
  String get destinationCheckPending =>
      'Este destino está pendiente de activación y no se puede utilizar actualmente.';

  @override
  String get destinationCheckDenied =>
      'Este destino no está aprobado y activo para esta red.';

  @override
  String get destinationCheckError =>
      'No se pudo comprobar el destino. Comprueba tu conexión y vuelve a intentarlo.';

  @override
  String get riskPanelUnavailable =>
      'Este panel de riesgo no está disponible. Deslice hacia abajo para reintentar.';

  @override
  String get riskSwitchListIncomplete =>
      'El número y la lista de detenciones pueden estar incompletos o desactualizados. Actualice para comprobar.';

  @override
  String get copyBudgetTitle => 'Presupuesto de copia';

  @override
  String get copyBudgetAbout =>
      'Reduce el límite configurado del presupuesto de copia. No es un límite de riesgo de toda la cuenta ni cierra posiciones existentes.';

  @override
  String get copyBudgetEffective => 'Límite efectivo actual';

  @override
  String get copyBudgetUnlimited => 'Sin límite establecido';

  @override
  String get copyBudgetCommitted => 'Suma de valores de asignación activos';

  @override
  String get copyBudgetNewLimit => 'Nuevo máximo';

  @override
  String get copyBudgetHelp =>
      'Aquí solo puedes reducir el límite. Usa un punto decimal, sin separadores de miles; hasta 16 dígitos enteros y 12 decimales.';

  @override
  String get copyBudgetInvalid =>
      'Introduce un importe no negativo con hasta 12 decimales.';

  @override
  String get copyBudgetTooHigh =>
      'El nuevo límite no puede superar el límite efectivo actual.';

  @override
  String get copyBudgetReduce => 'Reducir límite';

  @override
  String get copyBudgetSaving => 'Guardando…';

  @override
  String get copyBudgetSaved =>
      'La reducción se registró. El límite actual aparece arriba.';

  @override
  String get copyBudgetUnavailable =>
      'El presupuesto de copia no está disponible. Inténtalo de nuevo.';

  @override
  String get copyBudgetFailed =>
      'No se pudo confirmar la reducción. Actualiza y vuelve a intentarlo.';

  @override
  String get copyBudgetEstimateWarning =>
      'Los valores de asignación pueden usar unidades distintas; no son una exposición en vivo verificada ni una garantía contra pérdidas.';

  @override
  String get copyBudgetMetricUnavailable =>
      'Estimación de asignación no disponible.';

  @override
  String get copyBudgetCurrencyUnavailable =>
      'No hay una moneda de presupuesto configurada. Contacta con tu operador.';

  @override
  String get copyBudgetEnforcementUnavailable =>
      'Las órdenes de copia con un presupuesto configurado se bloquean hasta poder verificar la exposición en vivo y las reservas de órdenes.';
}
