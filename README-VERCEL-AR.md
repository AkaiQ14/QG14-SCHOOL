# رفع مدرسة الحنكة على Vercel

هذه النسخة مضبوطة لتعمل كمشروع Next.js على Vercel. لا ترفع ملف Service Account JSON نفسه إلى GitHub أو Vercel، ولا تضع المفتاح داخل الكود.

## الطريقة الموصى بها

1. فك ضغط ملف المشروع.
2. ارفع المجلد إلى مستودع GitHub خاص.
3. افتح Vercel واختر **Add New → Project** ثم استورد المستودع.
4. استخدم الإعدادات التالية:
   - Framework Preset: `Next.js`
   - Root Directory: `./`
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: اتركها فارغة؛ Vercel يحددها تلقائيًا.
   - Node.js Version: `22.x`
5. قبل النشر، افتح **Environment Variables** وأضف المتغيرات الموضحة أدناه إلى Production وPreview وDevelopment.
6. اضغط **Deploy**.

## متغيرات البيئة

### الخيار الأول — الموصى به

- `FIREBASE_SERVICE_ACCOUNT_KEY`: الصق محتوى ملف Service Account JSON كاملًا كقيمة واحدة.
- `FIREBASE_PROJECT_ID`: ضع `school-80a99`.

لا تضف بادئة `NEXT_PUBLIC_` لأي متغير، لأن بيانات حساب الخدمة يجب أن تبقى على الخادم فقط.

### الخيار الثاني — بديل

بدل متغير JSON الكامل، أضف:

- `FIREBASE_PROJECT_ID`: معرّف مشروع Firebase.
- `FIREBASE_CLIENT_EMAIL`: قيمة `client_email` من ملف Service Account.
- `FIREBASE_PRIVATE_KEY`: قيمة `private_key` كاملة، بما فيها سطرا BEGIN وEND. يقبل المشروع الأسطر الحقيقية أو `\n`.

استخدم أحد الخيارين فقط. لا تحتاج متغيرات Firebase الخاصة بتطبيق الويب مثل `apiKey` أو `authDomain` أو `measurementId`، ولا تحتاج Firebase Authentication.

## Firestore Rules

يمكن إبقاء القواعد على المنع الكامل:

```text
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

اتصال المشروع يتم من الخادم باستخدام Service Account وIAM، لذلك لا يعتمد على وصول المتصفح المباشر إلى Firestore Rules.

## التشغيل محليًا على Windows

```bat
copy .env.example .env.local
npm install
npm run dev
```

بعد تعديل `.env.local` بالقيم الصحيحة، افتح `http://localhost:3000`.

## اختبار الاتصال بعد النشر

افتح هذا المسار على رابط مشروعك:

```text
/api/firestore/stats
```

إذا كان الإعداد صحيحًا فستظهر استجابة JSON بدل رسالة خطأ. إذا أضفت أو عدّلت متغيرات البيئة بعد أول نشر، نفّذ **Redeploy** حتى تستخدمها النسخة الجديدة.

## تنبيه أمني مهم

إذا سبق أن شاركت ملف Service Account أو رفعته في مكان عام، احذف المفتاح القديم من Firebase/Google Cloud وأنشئ مفتاحًا جديدًا قبل نشر المشروع.
