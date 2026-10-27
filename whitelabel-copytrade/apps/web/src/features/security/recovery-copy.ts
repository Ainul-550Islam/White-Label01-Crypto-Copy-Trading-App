export type RecoveryLocale = 'en' | 'bn' | 'ar' | 'es' | 'tr';

type Copy = {
  language: string; requestStep: string; verifyStep: string; resetStep: string; doneStep: string;
  title: string; email: string; privacy: string; send: string; sending: string; accepted: string;
  code: string; codeHint: string; continue: string; checking: string; startAgain: string;
  resetTitle: string; password: string; confirm: string; policy: string; mfa: string; save: string; saving: string;
  doneTitle: string; recovered: string; sessions: string; signIn: string; security: string;
  unavailable: string; invalid: string; mismatch: string; emailError: string; rate: string; policyError: string;
};

export const recoveryCopy: Record<RecoveryLocale, Copy> = {
  en: {
    language:'Language', requestStep:'1. Request a link', verifyStep:'2. Confirm the link', resetStep:'3. Set a password', doneStep:'Done',
    title:'Recover your account', email:'Email address', privacy:'For your safety, this form does not confirm whether an address is registered.', send:'Send the link', sending:'Sending…', accepted:'If an eligible account matches, recovery instructions may be sent.',
    code:'Recovery code', codeHint:'Open the link or paste its code. It can be used once and expires 30 minutes after the request.', continue:'Continue', checking:'Checking…', startAgain:'Start again',
    resetTitle:'Choose a new password', password:'New password', confirm:'Repeat password', policy:'Use at least 12 characters and include uppercase, lowercase, a number and a symbol.', mfa:'Existing sessions will be signed out. Your two-factor authentication settings will remain unchanged.', save:'Set new password', saving:'Saving…',
    doneTitle:'Password changed', recovered:'Your password was changed and your existing sessions were signed out.', sessions:'Sessions signed out', signIn:'Sign in', security:'Security settings',
    unavailable:'Account recovery is temporarily unavailable. Please try again or contact support.', invalid:'This link is invalid, expired or already used. Request a new link.', mismatch:'The passwords do not match.', emailError:'Enter the email address on your account.', rate:'Too many requests. Please try again later.', policyError:'The password does not meet the account security requirements.',
  },
  bn: {
    language:'ভাষা', requestStep:'১. লিংক অনুরোধ করুন', verifyStep:'২. লিংক নিশ্চিত করুন', resetStep:'৩. পাসওয়ার্ড দিন', doneStep:'সম্পন্ন',
    title:'অ্যাকাউন্ট পুনরুদ্ধার', email:'ইমেইল ঠিকানা', privacy:'নিরাপত্তার জন্য এই ফর্ম কোনো ঠিকানা নিবন্ধিত কি না জানায় না।', send:'লিংক পাঠান', sending:'পাঠানো হচ্ছে…', accepted:'যোগ্য অ্যাকাউন্ট মিললে পুনরুদ্ধারের নির্দেশনা পাঠানো হতে পারে।',
    code:'পুনরুদ্ধার কোড', codeHint:'লিংক খুলুন বা এর কোড পেস্ট করুন। কোড একবার ব্যবহারযোগ্য এবং অনুরোধের ৩০ মিনিট পরে মেয়াদ শেষ হয়।', continue:'চালিয়ে যান', checking:'যাচাই হচ্ছে…', startAgain:'আবার শুরু করুন',
    resetTitle:'নতুন পাসওয়ার্ড বেছে নিন', password:'নতুন পাসওয়ার্ড', confirm:'পাসওয়ার্ড আবার লিখুন', policy:'অন্তত ১২টি অক্ষর ব্যবহার করুন; বড় হাতের ও ছোট হাতের অক্ষর, সংখ্যা এবং প্রতীক রাখুন।', mfa:'বিদ্যমান সেশনগুলো থেকে সাইন আউট হবে। আপনার দুই-ধাপ যাচাইয়ের সেটিংস অপরিবর্তিত থাকবে।', save:'নতুন পাসওয়ার্ড সেট করুন', saving:'সংরক্ষণ হচ্ছে…',
    doneTitle:'পাসওয়ার্ড পরিবর্তিত হয়েছে', recovered:'আপনার পাসওয়ার্ড পরিবর্তিত হয়েছে এবং বিদ্যমান সেশনগুলো থেকে সাইন আউট হয়েছে।', sessions:'সাইন আউট হওয়া সেশন', signIn:'সাইন ইন', security:'নিরাপত্তা সেটিংস',
    unavailable:'অ্যাকাউন্ট পুনরুদ্ধার সাময়িকভাবে অনুপলব্ধ। আবার চেষ্টা করুন বা সহায়তার সাথে যোগাযোগ করুন।', invalid:'এই লিংক অবৈধ, মেয়াদোত্তীর্ণ বা ব্যবহৃত। নতুন লিংক অনুরোধ করুন।', mismatch:'পাসওয়ার্ড দুটি মিলছে না।', emailError:'অ্যাকাউন্টের ইমেইল ঠিকানা লিখুন।', rate:'অনেক বেশি অনুরোধ করা হয়েছে। পরে আবার চেষ্টা করুন।', policyError:'পাসওয়ার্ডটি অ্যাকাউন্টের নিরাপত্তার শর্ত পূরণ করে না।',
  },
  ar: {
    language:'اللغة', requestStep:'١. طلب رابط', verifyStep:'٢. تأكيد الرابط', resetStep:'٣. تعيين كلمة مرور', doneStep:'تم',
    title:'استعادة حسابك', email:'عنوان البريد الإلكتروني', privacy:'لحمايتك، لا يؤكد هذا النموذج ما إذا كان العنوان مسجلاً.', send:'إرسال الرابط', sending:'جارٍ الإرسال…', accepted:'إذا وُجد حساب مؤهل مطابق، فقد تُرسل تعليمات الاستعادة.',
    code:'رمز الاستعادة', codeHint:'افتح الرابط أو الصق رمزه. يُستخدم مرة واحدة وتنتهي صلاحيته بعد ٣٠ دقيقة من الطلب.', continue:'متابعة', checking:'جارٍ التحقق…', startAgain:'البدء من جديد',
    resetTitle:'اختر كلمة مرور جديدة', password:'كلمة المرور الجديدة', confirm:'أعد كتابة كلمة المرور', policy:'استخدم ١٢ حرفاً على الأقل، بما فيها أحرف كبيرة وصغيرة ورقم ورمز.', mfa:'سيتم تسجيل الخروج من الجلسات الحالية. ستبقى إعدادات المصادقة الثنائية دون تغيير.', save:'تعيين كلمة المرور الجديدة', saving:'جارٍ الحفظ…',
    doneTitle:'تم تغيير كلمة المرور', recovered:'تم تغيير كلمة المرور وتسجيل الخروج من جلساتك الحالية.', sessions:'الجلسات التي تم تسجيل الخروج منها', signIn:'تسجيل الدخول', security:'إعدادات الأمان',
    unavailable:'استعادة الحساب غير متاحة مؤقتاً. حاول مجدداً أو اتصل بالدعم.', invalid:'هذا الرابط غير صالح أو انتهت صلاحيته أو استُخدم. اطلب رابطاً جديداً.', mismatch:'كلمتا المرور غير متطابقتين.', emailError:'أدخل عنوان البريد الإلكتروني لحسابك.', rate:'طلبات كثيرة جداً. حاول لاحقاً.', policyError:'كلمة المرور لا تستوفي متطلبات أمان الحساب.',
  },
  es: {
    language:'Idioma', requestStep:'1. Solicitar enlace', verifyStep:'2. Confirmar enlace', resetStep:'3. Crear contraseña', doneStep:'Listo',
    title:'Recuperar tu cuenta', email:'Correo electrónico', privacy:'Por seguridad, este formulario no confirma si una dirección está registrada.', send:'Enviar enlace', sending:'Enviando…', accepted:'Si coincide una cuenta elegible, se podrán enviar instrucciones de recuperación.',
    code:'Código de recuperación', codeHint:'Abre el enlace o pega su código. Se puede usar una vez y caduca 30 minutos después de la solicitud.', continue:'Continuar', checking:'Comprobando…', startAgain:'Empezar de nuevo',
    resetTitle:'Elige una contraseña nueva', password:'Contraseña nueva', confirm:'Repite la contraseña', policy:'Usa al menos 12 caracteres e incluye mayúsculas, minúsculas, un número y un símbolo.', mfa:'Se cerrarán las sesiones existentes. La configuración de autenticación de dos factores no cambiará.', save:'Guardar contraseña nueva', saving:'Guardando…',
    doneTitle:'Contraseña cambiada', recovered:'Se cambió tu contraseña y se cerraron tus sesiones existentes.', sessions:'Sesiones cerradas', signIn:'Iniciar sesión', security:'Ajustes de seguridad',
    unavailable:'La recuperación no está disponible temporalmente. Inténtalo de nuevo o contacta con soporte.', invalid:'Este enlace no es válido, ha caducado o ya se usó. Solicita otro.', mismatch:'Las contraseñas no coinciden.', emailError:'Introduce el correo electrónico de tu cuenta.', rate:'Demasiadas solicitudes. Inténtalo más tarde.', policyError:'La contraseña no cumple los requisitos de seguridad de la cuenta.',
  },
  tr: {
    language:'Dil', requestStep:'1. Bağlantı iste', verifyStep:'2. Bağlantıyı doğrula', resetStep:'3. Parola belirle', doneStep:'Tamamlandı',
    title:'Hesabını kurtar', email:'E-posta adresi', privacy:'Güvenliğiniz için bu form bir adresin kayıtlı olup olmadığını doğrulamaz.', send:'Bağlantıyı gönder', sending:'Gönderiliyor…', accepted:'Uygun bir hesap eşleşirse kurtarma talimatları gönderilebilir.',
    code:'Kurtarma kodu', codeHint:'Bağlantıyı açın veya kodunu yapıştırın. Kod bir kez kullanılabilir ve istekten 30 dakika sonra sona erer.', continue:'Devam et', checking:'Kontrol ediliyor…', startAgain:'Yeniden başla',
    resetTitle:'Yeni bir parola seçin', password:'Yeni parola', confirm:'Parolayı tekrar yazın', policy:'En az 12 karakter kullanın; büyük ve küçük harf, sayı ve simge ekleyin.', mfa:'Mevcut oturumlar kapatılacak. İki faktörlü doğrulama ayarlarınız değişmeyecek.', save:'Yeni parolayı kaydet', saving:'Kaydediliyor…',
    doneTitle:'Parola değiştirildi', recovered:'Parolanız değiştirildi ve mevcut oturumlarınız kapatıldı.', sessions:'Kapatılan oturumlar', signIn:'Giriş yap', security:'Güvenlik ayarları',
    unavailable:'Hesap kurtarma geçici olarak kullanılamıyor. Tekrar deneyin veya destekle iletişime geçin.', invalid:'Bu bağlantı geçersiz, süresi dolmuş veya kullanılmış. Yeni bağlantı isteyin.', mismatch:'Parolalar eşleşmiyor.', emailError:'Hesabınızın e-posta adresini girin.', rate:'Çok fazla istek var. Daha sonra tekrar deneyin.', policyError:'Parola hesap güvenliği gereksinimlerini karşılamıyor.',
  },
};
