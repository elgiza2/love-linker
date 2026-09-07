# خطة: استبدال محرك الوكيل بـ Kortix المستضاف + Browser Use Cloud

## لماذا هذا الاتجاه
المستخدم لا يستطيع استئجار VPS. لذلك بدل self-hosting لـ Suna/Kortix، نستخدم **المنصة المستضافة من Kortix** (`https://api.kortix.com/v1`) عبر REST API و`@kortix/sdk`. وبدل تجهيز سيرفر لـ browser-use/Skyvern، نستخدم **Browser Use Cloud** (`https://cloud.browser-use.com`) كأداة متصفح مستضافة. Skyvern يُرجأ لاحقًا بسبب ترخيص AGPL وحاجته لاستضافة.

## ما سيتغير للمستخدم
- تبويب الوكيل يشغل مهام حقيقية: خطوات، أدوات، ملفات ناتجة، إيقاف ومتابعة بعد إغلاق التاب.
- المهام الطويلة تكمل على سيرفر Kortix، والتطبيق يراقب حالتها عبر الـ API + الجداول المحلية.
- المتصفح يُستخدم كأداة داخلية عندما يحتاج الوكيل Kortix إلى فورمات أو تسجيل دخول أو مواقع معقدة.
- التصميم الحالي كما هو؛ التغيير في المحرك والربط فقط.

## المتطلبات من المستخدم قبل البدء
1. **حساب Kortix** على `https://kortix.com` مع API key من `settings/api-keys`. الخطة المجانية تبدأ بـ 200 credit/shard. ([1](https://kortix.com/pricing))
2. **حساب Browser Use Cloud** على `https://cloud.browser-use.com` مع API key يبدأ بـ `bu_`. ([2](https://docs.browser-use.com/cloud/llms.txt))
3. مفاتيح النماذج (Bring Your Own Key) داخل Kortix إذا لم يرغب في استخدام الـ managed models المدفوعة.

## المراحل

### 1) توحيد قاعدة البيانات
حذف/تجاهل الجداول المتفرقة الحالية (`long_runs`, `operator_runs`, `computer_tasks`, `dev_runs`) واستبدالها بأربعة جداول موحّدة:
- `agent_runs` — المستخدم، الحالة، المهمة، معرّف Kortix، التوقيتات، metadata.
- `agent_steps` — رقم الخطوة، النص/الملخص، الحالة.
- `agent_tool_calls` — اسم الأداة، المدخلات، النتيجة المختصرة، الخطوة المرتبطة.
- `agent_artifacts` — الملفات الناتجة + مسار Supabase Storage.

RLS: كل مستخدم يرى تشغيلاته فقط. GRANTs مطلوبة لـ `authenticated` و`service_role`.

### 2) بوابة Edge Functions
إنشاء دالة واحدة `agent-gateway` تتولى:
- التحقق من الجلسة والحصص.
- إنشاء التشغيل في `agent_runs`.
- استدعاء Kortix API (`POST /agent/start` أو ما يعادله في `@kortix/sdk`) ([3](https://kortix-ai-suna.mintlify.app/api/agents/run)).
- تخزين معرّف Kortix والرد المختصر.

دوال إضافية:
- `agent-stream` — تمرير أحداث Kortix SSE إلى الواجهة.
- `agent-stop` — إيقاف تشغيل.
- `agent-answer` — الإجابة على أسئلة توضيحية أثناء التشغيل.

الأسرار المطلوبة: `KORTIX_API_KEY`، `KORTIX_API_URL` (افتراضي `https://api.kortix.com/v1`)، `BROWSER_USE_API_KEY`.

### 3) أداة المتصفح المستضافة
بدل Skyvern، نبني أداة `browser-use-cloud`:
- Edge Function تستقبل هدفًا وصفحة/فورم، وتستدعي Browser Use Cloud Agent API.
- تُرجع نتيجة النص + لقطات الشاشة أو روابطها.
- تُسجَّل كأداة داخل Kortix (custom tool / MCP) بحيث يقرر الوكيل الأساسي وحده متى يستدعيها.
- في البداية يمكن أن تكون أداة منفصلة يستدعيها التطبيق عندما يكتشف أن المهمة تحتاج متصفحًا، إلى حين دمجها داخل Kortix.

### 4) تحويل الواجهة
- استبدال `useLongRun` وكل محركاته بـ `useAgentRun` واحد.
- `useAgentRun` يقرأ من `agent_runs` + `agent_steps` + `agent_artifacts`، ويستمع إلى SSE من `agent-stream`.
- ربط تبويب الوكيل والشات به، وعرض الأدوات والملفات الناتجة.

### 5) إزالة المحركات القديمة
تعطيل/حذف: `src/lib/manusLoop.ts`، `src/lib/agentkernel/*`، `supabase/functions/_shared/agentkernel/*`، `operator-orchestrator`، `long-run` edge function، `computer-agent` edge function، `agent-tick`.

### 6) اختبار حقيقي
- مهمة بحث + تقرير ملف.
- مهمة تتطلب فورم أو تسجيل دخول عبر المتصفح.
- مهمة طويلة: إغلاق التاب ثم العودة والتشغيل مستمر.
- التأكد من أن Kortix يستمر في التشغيل حتى لو فصل الواجهة.

## من أين نبدأ الآن
نبدأ بـ **المراحل 1 و2 و4** (الجداول + البوابة + الواجهة). بعد تجهيزها، التطبيق يصبح جاهزًا لحظة إدخال `KORTIX_API_KEY` و`BROWSER_USE_API_KEY`. Browser Use Cloud يُضاف بعد أن يثبت Kortix الأساسي.
