# إعداد Cloud Firestore عبر الخادم

المشروع لا يستخدم Firebase Authentication ولا يطلب من اللاعبين تسجيل الدخول.
جميع عمليات القراءة والكتابة تمر عبر API الموقع في الخادم باستخدام Service Account،
وهي نفس الفكرة المستخدمة في مشروع CARD المرجعي.

## إضافة مفتاح الخدمة

1. افتح مشروع `school-80a99` في Firebase Console.
2. انتقل إلى **Project settings → Service accounts**.
3. اختر **Generate new private key** ونزّل ملف JSON.
4. أضف محتوى الملف كاملًا في متغير خادم سري باسم:
   `FIREBASE_SERVICE_ACCOUNT_KEY`
5. أبقِ `FIREBASE_PROJECT_ID` بالقيمة `school-80a99`.

يدعم المشروع أيضًا المتغيرات الفردية التالية بدل ملف JSON الكامل:

- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PROJECT_ID`

## الأمان

المتصفح لا يرى مفتاح الخدمة ولا يتصل بـ Firestore مباشرة. يمكن إبقاء قواعد
Firestore على وضع المنع الكامل الموجود في `firestore.rules` لأن اتصالات الخادم
الموثقة بحساب الخدمة تعتمد على IAM وتتجاوز قواعد تطبيقات الويب.

## المجموعات المستخدمة

- `madrasaAlHankaPlayers`: إحصاءات جميع اللاعبين.
- `madrasaAlHankaLeaderboard`: أفضل نتائج الفائزين.
- `madrasaAlHankaMatches`: سجل كل مباراة ومنع احتسابها مرتين.
- `madrasaAlHankaMeta`: بيانات الترحيل والإصدار.

تقرأ الواجهة أحدث البيانات من API الخادم كل أربع ثوانٍ، كما تُحدّثها فور انتهاء
المباراة أو حفظ تعديلات لوحة التحكم؛ ولا تحتاج تغييرات البيانات إلى إعادة نشر الموقع.
