# Roadmap

## مكتمل
- [x] تشغيل المشروع من المستودع
- [x] إعادة تصميم الشيبس وتنظيف مربع الإدخال على الهاتف
- [x] تذييل الهاتف: صورة واسم المستخدم تفتح الإعدادات + زر إعدادات (Cog) + ترقية بنجمة زرقاء
- [x] الشريط السفلي: أصغر، دائري خفيف، شفاف، بدون حدود
- [x] نص الترقية أبيض (هاتف inline style + زر الديسكتوب الأخضر #ffffff)
- [x] حذف شيبس Documents
- [x] تكبير مربع الإدخال عند تفعيل خدمة
- [x] شريط التفعيل: مدمج تمامًا بلا خلفية — زر اختيار النموذج/القالب فقط للصور والفيديو والسلايدز، نص بسيط فقط لباقي الخدمات، زر إغلاق صغير
- [x] قائمة النماذج بلغة واضحة (سرعة · جودة · تكلفة) + قفل Pro + علامة المختار

## متبقي
- [x] تصغير مربع الإدخال، إضافة حواف نظيفة لعناصر التفعيل، وتثبيت الشريط داخل أعلى المربع
- [x] التحقق المرئي من تذييل المستخدم المسجل
- [x] إزالة صورة Megsy من قائمة اختيار النموذج (trigger + صفوف القائمة)

## طلبات 2026-09-07
- [x] القائمة الجانبية: ترتيب الأزرار والمسافات + استبدال زر "الرئيسية" بزر "محادثة جديدة"
- [x] القائمة الجانبية: حذف زر البحث وزر الإضافة (+)
- [x] البريد: حذف شريط التنقل السفلي (المهملات..) وزر + ونص "الوارد" ونص Refresh
- [x] الشيبس: إصلاح الشكل الغريب والنص المتآكل
- [x] الخط في نص وسط الصفحة (الترحيب) — تحسينه
- [x] إعادة تصميم قائمة زر + (المرفقات/الأدوات)
- [x] إعادة تصميم قائمة التكاملات
- [x] إعادة الشيبس إلى الشريط الأفقي السابق
- [x] إظهار زر «محادثة جديدة» فوق Mail في القائمة الجانبية وتغيير Megsy Email إلى Mail
- [x] إزالة مؤشر التركيز المربع من قوائم نماذج الصور والفيديو
- [x] Redesign the mobile + menu with Files and Images tiles, then Skills only.
- [x] Make the Skills action open the Skills page directly.
- [x] Make the mobile + menu smaller, calmer, and better proportioned.
- [x] Remove the top drag indicator from the mobile + menu.
- [x] Fix the first and last service chips being clipped.
- [x] Make Mail and Referrals standalone pages outside the Settings layout.
- [x] Match the Mail and Referrals mobile sidebar button to Chat exactly in style and placement.
- [x] Move referral Invite/Get Pro actions into the natural end of page content with no separate background or sticky bar.
- [x] Place the referral actions as the final element inside the page content column.
- [x] Raise the mobile sidebar navigation actions slightly while preserving spacing.
- [x] Stretch the service row so Images begins at the screen edge and Research ends at the opposite edge.
- [x] Keep service names fully visible on mobile chips.
- [x] Make mobile service chips simple rounded rectangles.
- [x] Push the referral Invite/Get Pro actions to the literal bottom of the screen.

## طلبات 2026-09-07 (جديدة)
- [x] شريط الكومبيوتر: تصميم موحد مع الشيبس + شريط إغلاق علوي عند التوسيع
- [x] مؤشر التفكير/الخطوات: إزالة الأرقام واستبدالها بأيقونات الأدوات، وتنظيف نص "Plan set"

## Full audit (2026)
- [x] Welcome screen limited to phones
- [x] Arabic-only user messages moved to English source + Arabic dictionary entries
- [x] Sidebar "New chat"/"New project" labels unified with translation layer
- [x] React hook-order bugs fixed (ChatMessage, AssistantMediaBlock)
- [x] Missing @doc tags added (chat-alibaba, storage-purge); stale slides test fixed — full suite green
- [x] Browser sweep of main pages (desktop + phone): no console errors, no horizontal overflow, 404 page correct
- [ ] Optional: repo-wide Prettier formatting pass (20k formatting-only lint notes)
- [x] Referrals backend live: milestone grants table, 3 required tasks, read/claim functions + auto-check trigger
- [ ] Add real links for the 3 required steps (Trustpilot review, X follow, X like+repost)

## OpenManus agent replacement (2026-09-07)
- [x] DECISION: Kortix/Suna dropped (signups closed, needs VPS). New target: run real OpenManus inside a hosted Novita sandbox.
- [x] NOVITA_API_KEY saved as a Supabase secret
- [x] Constraint: keep the existing AI text provider — do NOT switch model providers
- [x] Constraint: everything on the user's own Supabase; nothing on Lovable Cloud
- [x] Novita template `megsy-openmanus` (zoqc62arzviqz75ceswp): Python 3.11 + upstream OpenManus + Chromium
- [x] manus_runs/manus_steps/manus_tool_calls/manus_artifacts schema with RLS + GRANTs
- [x] `manus-proxy`: per-run OpenAI-compatible endpoint, provider keys stay in Supabase
- [x] `manus-bridge`: start/poll/answer/stop, ships om_runner.py, persists steps and tool calls
- [x] Verified end to end: real web-research task, 10 steps, browser use, final answer with source
- [x] Chat now runs OpenManus instead of the in-tab loop; `src/lib/manusLoop.ts` deleted
- [ ] Dedicated agent screen: live steps, artifacts, answer-the-agent input, stop button
- [ ] Remove remaining legacy engines: src/lib/agentkernel, _shared/agentkernel, long-run, agent-tick, operator-orchestrator
- [ ] Artifact capture: save files the agent produces into manus_artifacts + storage


