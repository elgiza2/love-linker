/**
 * @doc Server-only core for the Computer Agent (Megsy Computer).
 * Owns: key-pool selection with automatic failover, task creation/polling/stop
 * against the upstream computer provider, plus conversation memory.
 * The provider name is never exposed to the client — the UI only sees
 * "Megsy Computer".
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dataServiceKey, dataUrl } from "../_shared/dataProject.ts";

// Browser Use Cloud API v2 — https://docs.browser-use.com/cloud/api-v2
const API_BASE = Deno.env.get("BROWSER_USE_API_BASE") || "https://api.browser-use.com/api/v2";

export type ComputerAction = "create" | "poll" | "stop" | "list";

export interface ComputerPayload {
  action?: ComputerAction;
  token?: string;
  prompt?: string;
  conversation_id?: string | null;
  message_id?: string | null;
  attachments?: string[];
  task_id?: string;
}

export interface ComputerResult {
  status: number;
  body: Record<string, unknown>;
}

interface KeyRow {
  id: string;
  api_key: string;
  status: string;
  failure_count: number | null;
  cooldown_until: string | null;
  last_used_at: string | null;
  priority: number | null;
}

function admin(): SupabaseClient {
  const url = dataUrl();
  const serviceKey = dataServiceKey();
  if (!url || !serviceKey) throw new Error("Supabase server credentials are not configured");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function authenticate(supabase: SupabaseClient, token?: string) {
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user ?? null;
}

/**
 * Active keys, least-recently-used first, skipping keys in cooldown.
 * Three pools are merged: the dedicated `browser_use_keys` table (Browser Use
 * Cloud keys), the legacy `manus_keys` table and the shared `provider_api_keys`
 * pool under provider "c".
 */
async function availableKeys(supabase: SupabaseClient): Promise<KeyRow[]> {
  const { data: browserUse } = await supabase
    .from("browser_use_keys")
    .select("id,api_key,status,failure_count,cooldown_until,last_used_at,priority")
    .eq("status", "active");

  const { data } = await supabase
    .from("manus_keys")
    .select("id,api_key,status,failure_count,cooldown_until,last_used_at,priority")
    .eq("status", "active");

  const { data: pool } = await supabase
    .from("provider_api_keys")
    .select("id,api_key,status,failure_count,last_used_at")
    .eq("provider", "c")
    .eq("status", "active");

  const poolRows: KeyRow[] = ((pool ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: `pool:${String(r.id)}`,
    api_key: String(r.api_key ?? ""),
    status: "active",
    failure_count: Number(r.failure_count ?? 0),
    cooldown_until: null,
    last_used_at: (r.last_used_at as string | null) ?? null,
    priority: 0,
  }));

  const browserUseRows: KeyRow[] = ((browserUse ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: `bu:${String(r.id)}`,
    api_key: String(r.api_key ?? ""),
    status: "active",
    failure_count: Number(r.failure_count ?? 0),
    cooldown_until: (r.cooldown_until as string | null) ?? null,
    last_used_at: (r.last_used_at as string | null) ?? null,
    priority: Number(r.priority ?? 0) + 10,
  }));

  const now = Date.now();
  return [...browserUseRows, ...((data ?? []) as KeyRow[]), ...poolRows]
    .filter((k) => k.api_key && (!k.cooldown_until || new Date(k.cooldown_until).getTime() <= now))
    .sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
      const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
      return ta - tb;
    });
}

async function markFailure(
  supabase: SupabaseClient,
  key: KeyRow,
  status: number,
  message: string,
  retryAfterSec?: number,
) {
  if (key.id === "env") return; // env-configured fallback key has no DB row

  if (key.id.startsWith("bu:")) {
    const patch: Record<string, unknown> = {
      failure_count: (key.failure_count ?? 0) + 1,
      last_error: `${status}: ${message}`.slice(0, 500),
      updated_at: new Date().toISOString(),
    };
    if (status === 402 || status === 403) patch.status = "exhausted";
    else if (status === 401) patch.status = "disabled";
    else if (status === 429) {
      patch.cooldown_until = new Date(Date.now() + (retryAfterSec ?? 120) * 1000).toISOString();
    } else patch.cooldown_until = new Date(Date.now() + 30_000).toISOString();
    await supabase.from("browser_use_keys").update(patch).eq("id", key.id.slice(3));
    return;
  }

  if (key.id.startsWith("pool:")) {
    const patch: Record<string, unknown> = {
      failure_count: (key.failure_count ?? 0) + 1,
      last_error: `${status}: ${message}`.slice(0, 500),
    };
    if (status === 401 || status === 402 || status === 403) patch.status = "blocked";
    await supabase.from("provider_api_keys").update(patch).eq("id", key.id.slice(5));
    return;
  }

  const patch: Record<string, unknown> = {
    failure_count: (key.failure_count ?? 0) + 1,
    last_error: `${status}: ${message}`.slice(0, 500),
    updated_at: new Date().toISOString(),
  };
  if (status === 402 || status === 403) {
    patch.status = "exhausted";
  } else if (status === 429) {
    patch.cooldown_until = new Date(Date.now() + (retryAfterSec ?? 120) * 1000).toISOString();
  } else if (status === 401) {
    patch.status = "disabled";
  } else {
    patch.cooldown_until = new Date(Date.now() + 30_000).toISOString();
  }
  await supabase.from("manus_keys").update(patch).eq("id", key.id);
}

async function markSuccess(supabase: SupabaseClient, key: KeyRow) {
  if (key.id === "env") return;
  if (key.id.startsWith("bu:")) {
    await supabase
      .from("browser_use_keys")
      .update({ last_used_at: new Date().toISOString(), failure_count: 0, last_error: null })
      .eq("id", key.id.slice(3));
    return;
  }
  if (key.id.startsWith("pool:")) {
    await supabase
      .from("provider_api_keys")
      .update({ last_used_at: new Date().toISOString(), failure_count: 0, last_error: null })
      .eq("id", key.id.slice(5));
    return;
  }
  await supabase
    .from("manus_keys")
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq("id", key.id);
}

interface UpstreamCall {
  path: string;
  method: "GET" | "POST" | "PATCH";
  body?: unknown;
}

interface UpstreamOk {
  ok: true;
  data: any;
  key: KeyRow;
}
interface UpstreamFail {
  ok: false;
  status: number;
  message: string;
}

/** Runs one upstream call, rotating through the key pool on failure. */
async function callUpstream(
  supabase: SupabaseClient,
  call: UpstreamCall,
  preferKeyId?: string | null,
): Promise<UpstreamOk | UpstreamFail> {
  let keys = await availableKeys(supabase);
  if (preferKeyId) {
    const idx = keys.findIndex((k) => k.id === preferKeyId);
    if (idx > 0) keys = [keys[idx], ...keys.filter((_, i) => i !== idx)];
  }
  // Fallback: a single key configured as a server secret, used when the
  // database key pool is empty (e.g. fresh install).
  const envKey = Deno.env.get("BROWSER_USE_API_KEY");
  if (keys.length === 0 && envKey) {
    keys = [
      {
        id: "env",
        api_key: envKey,
        status: "active",
        failure_count: 0,
        cooldown_until: null,
        last_used_at: null,
        priority: 0,
      },
    ];
  }
  if (keys.length === 0) {
    return { ok: false, status: 503, message: "no_capacity" };
  }

  let last: UpstreamFail = { ok: false, status: 503, message: "no_capacity" };
  for (const key of keys) {
    try {
      const resp = await fetch(`${API_BASE}${call.path}`, {
        method: call.method,
        headers: {
          "Content-Type": "application/json",
          "X-Browser-Use-API-Key": key.api_key,
        },
        body: call.body ? JSON.stringify(call.body) : undefined,
      });
      const text = await resp.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (resp.ok) {
        await markSuccess(supabase, key);
        return { ok: true, data, key };
      }
      const message = String(data?.error?.message || data?.message || data?.error || text || "").slice(0, 300);
      console.error(`browser-use ${call.method} ${call.path} -> ${resp.status}: ${message}`);
      const retryAfter = Number(resp.headers.get("retry-after") || "") || undefined;

      await markFailure(supabase, key, resp.status, message, retryAfter);
      last = { ok: false, status: resp.status, message };
      // Bad request / validation errors are our fault — rotating keys won't help.
      if (resp.status === 400 || resp.status === 422 || resp.status === 404) return last;
    } catch (err) {
      const message = err instanceof Error ? err.message : "network_error";
      await markFailure(supabase, key, 500, message);
      last = { ok: false, status: 502, message };
    }
  }
  return last;
}

/** Conversation memory injected at the top of every new task prompt. */
async function loadMemory(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | null,
): Promise<string> {
  const q = supabase
    .from("computer_memory")
    .select("summary")
    .eq("user_id", userId)
    .limit(1);
  const { data } = conversationId
    ? await q.eq("conversation_id", conversationId)
    : await q.is("conversation_id", null);
  return (data?.[0]?.summary as string | undefined)?.trim() || "";
}

async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | null,
  summary: string,
) {
  await supabase.from("computer_memory").upsert(
    {
      user_id: userId,
      conversation_id: conversationId,
      summary: summary.slice(0, 8000),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_id" },
  );
}

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase();
  if (["finished", "completed", "success", "succeeded", "done"].includes(s)) return "done";
  if (["failed", "error", "canceled", "cancelled", "stopped"].includes(s)) return "failed";
  if (["pending", "queued", "created"].includes(s)) return "pending";
  // A paused agent is still alive — it is waiting, not finished. Never treat it
  // (or any status we do not recognise yet) as a failure, otherwise a live run
  // gets killed mid-task and returns no result at all.
  if (["paused", "pausing", "stopping", "waiting"].includes(s)) return "paused";
  return s ? "running" : "pending";
}

/** Pulls step/file info out of a provider payload without leaking its shape. */
function extractProgress(data: any): {
  status: string;
  progress: string | null;
  resultText: string | null;
  files: { id: string; name: string }[];
  events: { title: string; detail?: string; url?: string }[];
} {
  const status = normalizeStatus(data?.status);
  // Browser Use has shipped both camelCase and snake_case step payloads, and
  // sometimes nests them under `task`/`output`. Accept every shape so the
  // thinking trace is never empty while the agent is clearly working.
  const rawEvents: any[] = Array.isArray(data?.steps)
    ? data.steps
    : Array.isArray(data?.task?.steps)
      ? data.task.steps
      : Array.isArray(data?.history)
        ? data.history
        : [];
  console.log(
    `browser-use payload keys=${Object.keys(data ?? {}).join(",")} steps=${rawEvents.length}`,
  );
  // Only real reasoning/goal text becomes a visible line. A bare step counter
  // says nothing to the reader, so an event without wording is dropped.
  const events = rawEvents
    .map((e) => {
      const title = String(
        e?.nextGoal || e?.next_goal || e?.thought || e?.thinking || e?.goal ||
          e?.evaluationPreviousGoal || e?.evaluation_previous_goal || e?.memory || "",
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      const detail = [
        typeof e?.memory === "string" && e.memory !== title ? e.memory : "",
        Array.isArray(e?.actions)
          ? e.actions
              .map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a)))
              .join(", ")
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 800);
      return {
        title,
        detail: detail || undefined,
        url: typeof e?.url === "string" ? e.url : undefined,
      };
    })
    .filter((e) => !!e.title)
    .slice(-50);


  const rawFiles: any[] = Array.isArray(data?.outputFiles) ? data.outputFiles : [];
  const files = rawFiles
    .filter((f) => f?.id)
    .map((f) => ({ id: String(f.id), name: String(f?.fileName || "file") }));

  const resultText = typeof data?.output === "string" && data.output ? data.output : null;

  const progress = events.length ? events[events.length - 1].title : null;
  return { status, progress, resultText, files, events };
}

export async function handleComputerAgent(payload: ComputerPayload | null): Promise<ComputerResult> {
  if (!payload?.action) return { status: 400, body: { error: "Missing action" } };
  const supabase = admin();
  const user = await authenticate(supabase, payload.token);
  if (!user) return { status: 401, body: { error: "unauthorized" } };

  switch (payload.action) {
    case "create": {
      const prompt = (payload.prompt ?? "").trim();
      if (!prompt) return { status: 400, body: { error: "Missing prompt" } };
      const conversationId = payload.conversation_id ?? null;
      const memory = await loadMemory(supabase, user.id, conversationId);

      const { data: inserted, error: insErr } = await supabase
        .from("computer_tasks")
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          message_id: payload.message_id ?? null,
          prompt,
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        return { status: 500, body: { error: insErr?.message || "insert_failed" } };
      }
      const taskId = inserted.id as string;

      const fullPrompt = memory
        ? `Context from earlier in this conversation:\n${memory}\n\n---\nTask:\n${prompt}`
        : prompt;

      // Browser Use rejects models that the account's plan does not include
      // (403 "not available on the free plan"), so walk a candidate ladder
      // starting from the configured model.
      const llmCandidates = [
        Deno.env.get("BROWSER_USE_LLM")?.trim() || undefined,
        // Free-plan model first: the premium ones 403 on a free account and
        // every rejected attempt just delays the start of the run.
        "bu-2-0-mini-preview",
        "browser-use-llm",
        "gemini-2.5-flash",
        undefined,
      ];


      let res = await callUpstream(supabase, {
        path: "/tasks",
        method: "POST",
        body: {
          task: fullPrompt.slice(0, 50_000),
          llm: llmCandidates[0],
          maxSteps: 100,
          vision: "auto",
        },
      });
      for (let i = 1; i < llmCandidates.length && !res.ok; i += 1) {
        const failMsg = (res as UpstreamFail).message ?? "";
        if (!/not available on the|body.,.llm|Input should be/i.test(failMsg)) break;

        if (llmCandidates[i] === llmCandidates[0]) continue;
        res = await callUpstream(supabase, {
          path: "/tasks",
          method: "POST",
          body: {
            task: fullPrompt.slice(0, 50_000),
            llm: llmCandidates[i],
            maxSteps: 100,
            vision: "auto",
          },
        });
      }


      if (!res.ok) {
        const fail = res as UpstreamFail;
        const message =
          fail.status === 503
            ? "no_capacity"
            : fail.status === 429
              ? "rate_limited"
              : "provider_error";

        await supabase
          .from("computer_tasks")
          .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
          .eq("id", taskId);
        return { status: 200, body: { task_id: taskId, status: "failed", error: message } };
      }

      const providerId = String(
        res.data?.task_id ?? res.data?.id ?? res.data?.data?.task_id ?? res.data?.data?.id ?? "",
      );
      if (!providerId) {
        console.error(`browser-use create: no task id in ${JSON.stringify(res.data).slice(0, 500)}`);

        await supabase
          .from("computer_tasks")
          .update({ status: "failed", error: "provider_error", updated_at: new Date().toISOString() })
          .eq("id", taskId);
        return { status: 200, body: { task_id: taskId, status: "failed", error: "provider_error" } };
      }
      await supabase
        .from("computer_tasks")
        .update({
          provider_task_id: providerId || null,
          // key_id is a uuid FK to manus_keys, so browser-use / shared-pool /
          // env keys stay null.
          key_id: /^[0-9a-f-]{36}$/i.test(res.key.id) && !res.key.id.startsWith("pool:")
            ? res.key.id
            : null,
          status: "running",
          updated_at: new Date().toISOString(),
        })
        .eq("id", taskId);

      return { status: 200, body: { task_id: taskId, status: "running" } };
    }

    case "poll": {
      if (!payload.task_id) return { status: 400, body: { error: "Missing task_id" } };
      const { data: task } = await supabase
        .from("computer_tasks")
        .select("*")
        .eq("id", payload.task_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!task) return { status: 404, body: { error: "not_found" } };

      if (task.status === "done" || task.status === "failed" || !task.provider_task_id) {
        return { status: 200, body: { task: publicTask(task), events: await listEvents(supabase, task.id) } };
      }

      const res = await callUpstream(
        supabase,
        { path: `/tasks/${task.provider_task_id}`, method: "GET" },
        task.key_id,
      );
      if (!res.ok) {
        const patch = { status: "failed", error: "provider_error", updated_at: new Date().toISOString() };
        await supabase.from("computer_tasks").update(patch).eq("id", task.id);
        return {
          status: 200,
          body: { task: publicTask({ ...task, ...patch }), events: await listEvents(supabase, task.id) },
        };
      }

      const info = extractProgress(res.data);
      // A paused agent is resumed automatically so the task actually finishes
      // instead of silently sitting still until it looks dead.
      if (info.status === "paused") {
        const resumed = await callUpstream(
          supabase,
          {
            path: `/tasks/${task.provider_task_id}`,
            method: "PATCH",
            body: { action: "resume_task" },
          },
          task.key_id,
        );
        if (resumed.ok) info.status = "running";
      }
      let liveUrl: string | null = null;
      const sessionId = String(res.data?.sessionId ?? res.data?.session_id ?? "");
      if (sessionId && !["done", "failed"].includes(info.status)) {
        const session = await callUpstream(
          supabase,
          { path: `/sessions/${sessionId}`, method: "GET" },
          task.key_id,
        );
        if (session.ok) liveUrl = String(session.data?.liveUrl ?? session.data?.live_url ?? "") || null;
      }
      // Persist any new steps (dedupe on title+index count).
      const existing = await listEvents(supabase, task.id);
      if (info.events.length > existing.length) {
        const fresh = info.events.slice(existing.length).map((e) => ({
          task_id: task.id,
          user_id: user.id,
          kind: "step",
          title: e.title,
          detail: e.detail ?? null,
          url: e.url ?? null,
        }));
        if (fresh.length) await supabase.from("computer_events").insert(fresh);
      }

      // Output files are referenced by id upstream; resolve short-lived
      // download URLs only once the task produced them.
      const resolvedFiles: { name: string; url: string }[] = [];
      for (const f of info.files) {
        const dl = await callUpstream(
          supabase,
          { path: `/files/tasks/${task.provider_task_id}/output-files/${f.id}`, method: "GET" },
          task.key_id,
        );
        const url = dl.ok ? String((dl.data as any)?.downloadUrl ?? "") : "";
        if (url) resolvedFiles.push({ name: f.name, url });
      }

      const patch = {
        status: info.status,
        progress: info.progress,
        result_text: info.resultText ?? task.result_text,
        files: resolvedFiles.length ? resolvedFiles : task.files,
        updated_at: new Date().toISOString(),
      };
      await supabase.from("computer_tasks").update(patch).eq("id", task.id);

      if (info.status === "done") {
        const memory = await loadMemory(supabase, user.id, task.conversation_id);
        const line = `- ${task.prompt.slice(0, 200)} → ${(info.resultText ?? "completed").slice(0, 400)}`;
        await saveMemory(supabase, user.id, task.conversation_id, `${memory}\n${line}`.trim());
      }

      return {
        status: 200,
        body: {
          task: { ...publicTask({ ...task, ...patch }), live_url: liveUrl },
          events: await listEvents(supabase, task.id),
        },
      };
    }

    case "stop": {
      if (!payload.task_id) return { status: 400, body: { error: "Missing task_id" } };
      const { data: task } = await supabase
        .from("computer_tasks")
        .select("id,provider_task_id,key_id")
        .eq("id", payload.task_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!task) return { status: 404, body: { error: "not_found" } };
      if (task.provider_task_id) {
        await callUpstream(
          supabase,
          {
            path: `/tasks/${task.provider_task_id}`,
            method: "PATCH",
            body: { action: "stop_task_and_session" },
          },
          task.key_id,
        );
      }
      await supabase
        .from("computer_tasks")
        .update({ status: "failed", error: "stopped", updated_at: new Date().toISOString() })
        .eq("id", task.id);
      return { status: 200, body: { ok: true } };
    }

    default:
      return { status: 400, body: { error: "Unknown action" } };
  }
}

function publicTask(task: any) {
  return {
    id: task.id,
    status: task.status,
    progress: task.progress ?? null,
    result_text: task.result_text ?? null,
    files: Array.isArray(task.files) ? task.files : [],
    error: task.error ?? null,
    prompt: task.prompt,
  };
}

async function listEvents(supabase: SupabaseClient, taskId: string) {
  const { data } = await supabase
    .from("computer_events")
    .select("id,title,detail,url,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
