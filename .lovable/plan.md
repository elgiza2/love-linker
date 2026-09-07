# استبدال الوكيل الحالي بمحرك OpenManus كامل

## المشكلة الحقيقية (نتيجة الفحص)

عندنا حاليًا **4 محركات وكيل منفصلة** بتتعارض:

1. `src/lib/manusLoop.ts` — لوب صغير جوه كل رسالة شات (5 أدوات، بدون حفظ، بدون تنفيذ كود).
2. `src/lib/agentkernel/*` — نسخة تانية بتشتغل في التاب فقط، بتقفل لو التاب اتقفل.
3. `supabase/functions/_shared/agentkernel/*` (3120 سطر) — النسخة "الحقيقية" على السيرفر.
4. `supabase/functions/operator-orchestrator` — **مش بينفذ أي أداة أصلًا**، بس بيكتب وصف خطوات ويقول "تم".

وكمان: 4 جداول مختلفة لنفس المفهوم (`long_runs`, `operator_runs`, `computer_tasks`, `dev_runs`)، تبديل صامت بين محرك السيرفر ومحرك التاب في منتصف المهمة، ومفيش استخدام لـ tool-calling الحقيقي — كل حاجة JSON مستخرج بالنص (سبب أساسي في الفشل والتخبيط)، ومفيش sandbox حقيقي لتنفيذ كود.

## الهدف

محرك واحد فقط، نسخة أمينة من معمارية OpenManus بـ TypeScript، بيشتغل فعليًا على السيرفر مع أدوات حقيقية.

## المعمارية الجديدة (مطابقة لـ OpenManus)

```text
BaseAgent      → run loop, memory, state machine, max_steps, stuck detection
  ReActAgent   → think() / act()
    ToolCallAgent → tool_calls حقيقية، tool_choice (auto/required/none)، max_observe،
                    special tools (terminate)
      Manus      → السيستم برومبت + next_step_prompt + الأدوات + MCP
      SweAgent   → أدوات الكود فقط
      DataAgent  → تحليل بيانات ورسومات
PlanningFlow + PlanningTool → خطة خطوات، كل خطوة يشغّلها الوكيل المناسب
```

- الذاكرة: `Message[]` بسقف 100 رسالة + قص بالتوكن.
- كشف التكرار: نفس منطق OpenManus (`duplicate_threshold = 2`) مع تعديل البرومبت لتغيير الاستراتيجية، مربوط بسلّم التصعيد الموجود عندنا (`loopGuard`).
- حالة الوكيل: `IDLE / RUNNING / FINISHED / ERROR` محفوظة في الداتابيز، فالمهمة تكمل بعد قفل التاب وتستكمل بالكرون.

## الأدوات (كلها تنفيذ حقيقي، مش وصف)

| الأداة | التنفيذ عندنا |
| --- | --- |
| `python_execute` | Sandbox حقيقي (E2B) — بايثون كامل + pip |
| `bash` | نفس الـ sandbox، سيشن واحدة مستمرة |
| `str_replace_editor` | ملفات الـ sandbox: view/create/str_replace/insert/undo |
| `browser` | Browser Use Cloud (المفتاح موجود بالفعل) — تنقل/كتابة/كليك/استخراج |
| `web_search` | Brave + قراءة الصفحات (موجود) |
| `mcp_*` | عميل MCP الحقيقي على سيرفرات المستخدم (موجود، هيتنقل كما هو) |
| `ask_human` | يوقف الرن ويسأل في الواجهة (جدول `agent_questions` الموجود) |
| `planning` | إنشاء/تحديث/تعليم الخطوات |
| `terminate` | إنهاء الرن بنتيجة |
| أدوات التطبيق | ريجستري `agent_tools_registry` الحالي يتحول لأدوات tool-calling عادية |

## نداء الموديل

نستخدم tool-calling الأصلي بدل استخراج JSON بالنص، عبر AI SDK + بوابة Lovable AI (`openai/gpt-5.6-sol`)، مع الإبقاء على مسار الموديل الحالي كـ fallback واحد فقط. ده لوحده هيقضي على معظم "الوكيل بيهرّج" لأن الأدوات بتتنادى بمخطط ملزم.

## التغييرات في الكود

**جديد** `supabase/functions/_shared/openmanus/`:
`agent/base.ts`, `agent/react.ts`, `agent/toolcall.ts`, `agent/manus.ts`, `schema.ts` (Message/Memory/ToolCall/AgentState), `llm.ts` (tool-calling + عدّ توكن + قص), `tools/` (كل أداة في ملف), `tools/collection.ts`, `flow/planning.ts`, `sandbox/e2b.ts`, `mcp/client.ts`, `prompts.ts`.

**جديد** `supabase/functions/agent-run/` — الواجهة الوحيدة: `start / step / status / answer / stop / cron_tick`.

**يتحول لـ shim ثم يُحذف**: `supabase/functions/long-run`, `_shared/agentkernel/*`, `operator-orchestrator`, `src/lib/manusLoop.ts`, `src/lib/agentkernel/*` (نخلي redirect مؤقت أسبوع لأي رن قديم شغال).

**الداتابيز**: جداول موحدة `agent_runs`, `agent_steps`, `agent_tool_calls`, `agent_artifacts` + RLS + GRANT، مع إبقاء `agent_questions`/`agent_memory` كما هي، وview توافقية على `long_runs` لحد ما الواجهة تتحول.

**الواجهة**: `useLongRun` يتحول لـ `useAgentRun` على الجداول الجديدة، وبنفس شكل العرض الحالي بالحرف — الخطة/الخطوات/الأسئلة/الملفات. **مفيش أي تغيير في التصميم.**

## الترتيب التنفيذي

1. الأساس: schema + memory + state + llm بـ tool-calling (+ تست وحدات على اللوب وكشف التكرار).
2. ToolCallAgent + `terminate` + `web_search` — أول رن حقيقي من الطرف للطرف.
3. Sandbox: `python_execute` + `bash` + `str_replace_editor` (مفتاح E2B مطلوب).
4. المتصفح + MCP + أدوات التطبيق المسجلة.
5. PlanningTool + PlanningFlow + `ask_human`.
6. جداول جديدة + كرون + استكمال بعد قفل التاب.
7. تحويل الواجهة، ثم حذف المحركات الأربعة القديمة.
8. اختبار حقيقي: 6 مهام (بحث، كتابة كود وتشغيله، ملف Excel، مهمة متصفح بتسجيل دخول، مهمة تسأل المستخدم، مهمة طويلة بعد قفل التاب) + قياس أن كل خطوة نفذت فعلًا مش وصف.

## حاجة واحدة محتاجة منك

مفتاح **E2B API key** (أو بديل sandbox تحبه) علشان `python_execute`/`bash` يشتغلوا بجد. لو مش متاح، الخطوة 3 تشتغل بجافاسكريبت في sandbox أضعف لحد ما توفر المفتاح، وباقي المحرك يخلص عادي.

## معايير القبول

- محرك واحد فقط في الكود، ومفيش أي مسار بينفذ خطوة "وهمية".
- كل خطوة في الترايس لها نداء أداة حقيقي بنتيجة محفوظة.
- المهمة تكمل والتاب مقفول وتستكمل بعد الرجوع.
- تكرار نفس الفعل مرتين يغيّر الاستراتيجية أوتوماتيك، و4 مرات يوقف ويسأل.
- التصميم زي ما هو بالظبط.
