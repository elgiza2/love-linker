/**
 * Shared video-provider helpers (DeAPI, Renderful, Alibaba/DashScope).
 *
 * Keys come from function secrets (DEAPI_API_KEY / RENDERFUL_API_KEY);
 * Alibaba keeps using the media_provider_keys pool via acquire_media_key.
 */

export const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/api/v1";

// DeAPI catalogue slug -> live model + sampling defaults.
export const DEAPI_VIDEO: Record<string, { api: string; steps: number; fps: number }> = {
  "deapi-ltx-video": { api: "Ltxv_13B_0_9_8_Distilled_FP8", steps: 1, fps: 30 },
};

/**
 * Renderful ids as they appear in the live catalogue. Our own slugs are
 * prefixed with `renderful-`, so the prefix is stripped before calling the API
 * and the image-to-video twin is `<id>-i2v` unless it needs an explicit map.
 */
export const RENDERFUL_I2V: Record<string, string> = {
  "veo-3-fast": "google-veo-3-fast-i2v",
  "runway-gen4-turbo": "runway-gen4-turbo",
  "kling-o1": "kling-o1",
};

export function renderfulModelId(slug: string, i2v: boolean): string {
  const bare = (slug || "").replace(/^renderful-/i, "");
  if (!i2v) return bare;
  return RENDERFUL_I2V[bare] ?? (bare.endsWith("-i2v") ? bare : `${bare}-i2v`);
}


export const VIDEO_SLUG_ALIASES: Record<string, string> = {
  "deapi-ltx-2": "deapi-ltx-video",
  "deapi-video": "deapi-ltx-video",
  "ltx-video": "deapi-ltx-video",
};

export function normalizeVideoSlug(slug: string): string {
  const s = (slug || "").trim();
  return VIDEO_SLUG_ALIASES[s] ?? s;
}

export function providerForSlug(slug: string): "deapi" | "renderful" | "alibaba" {
  if (/^wan|^alibaba|dashscope/i.test(slug)) return "alibaba";
  if (/^renderful/i.test(slug)) return "renderful";
  return "deapi";
}

export function firstVideoUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    if (/^https?:\/\/\S+\.(mp4|webm|mov|m4v)(\?\S*)?$/i.test(value)) return value;
    if (/^https?:\/\/\S*(results|cdn|output|video)\S*/i.test(value) && /mp4|webm|mov/i.test(value)) {
      return value;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = firstVideoUrl(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = firstVideoUrl(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** DeAPI caps a video frame at 768px on the long edge and 120 frames total. */
export function deapiDims(aspect?: string): [number, number] {
  if (aspect === "9:16") return [448, 768];
  if (aspect === "1:1") return [640, 640];
  return [768, 448];
}

export async function deapiVideoSubmit(opts: {
  key: string;
  model: string;
  prompt: string;
  steps: number;
  fps: number;
  duration: number;
  aspectRatio?: string;
  image?: string;
}): Promise<string> {
  const [width, height] = deapiDims(opts.aspectRatio);
  // DeAPI requires fps >= 30 and at most 120 frames (so up to 4 seconds).
  const fps = 30;
  const frames = Math.max(24, Math.min(120, Math.round(opts.duration * fps)));

  let res: Response;
  if (opts.image) {
    const r = await fetch(opts.image);
    if (!r.ok) throw new Error(`failed to download the reference image (${r.status})`);
    const ct = r.headers.get("content-type") ?? "image/png";
    const ext = ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png";
    const form = new FormData();
    form.append("model", opts.model);
    form.append("prompt", opts.prompt);
    form.append("width", String(width));
    form.append("height", String(height));
    form.append("seed", String(Math.floor(Math.random() * 2_147_483_647)));
    form.append("frames", String(frames));
    form.append("fps", String(fps));
    form.append("steps", String(opts.steps));
    form.append("image", await r.blob(), `frame.${ext}`);
    res = await fetch("https://api.deapi.ai/api/v2/videos/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.key}`, Accept: "application/json" },
      body: form,
    });
  } else {
    res = await fetch("https://api.deapi.ai/api/v2/videos/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        width,
        height,
        seed: Math.floor(Math.random() * 2_147_483_647),
        frames,
        fps,
        steps: opts.steps,
      }),
    });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`deapi ${res.status}: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const id = payload?.data?.request_id ?? payload?.request_id ?? payload?.data?.id ?? payload?.id;
  if (!id) throw new Error(`deapi: no video request id (${text.slice(0, 200)})`);
  return String(id);
}

export async function renderfulVideoSubmit(opts: {
  key: string;
  model: string;
  prompt: string;
  duration: number;
  aspectRatio?: string;
  image?: string;
  lastFrame?: string;
}): Promise<string> {
  const i2v = !!opts.image;
  const model = renderfulModelId(opts.model, i2v);
  const body: Record<string, unknown> = {
    type: i2v ? "image-to-video" : "text-to-video",
    model,
    prompt: opts.prompt,
    duration: opts.duration,
  };
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (opts.image) body.image_url = opts.image;
  if (opts.lastFrame) body.last_frame_url = opts.lastFrame;

  const res = await fetch("https://api.renderful.ai/api/v1/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`renderful ${res.status}: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const id = payload?.id ?? payload?.task_id ?? payload?.data?.id;
  if (!id) throw new Error(`renderful: no video task id (${text.slice(0, 200)})`);
  return String(id);
}

export type PollResult =
  | { status: "processing"; progress?: number }
  | { status: "completed"; video_url: string }
  | { status: "failed"; error: string };

export async function deapiVideoPoll(key: string, id: string): Promise<PollResult> {
  const st = await fetch(`https://api.deapi.ai/api/v2/jobs/${id}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!st.ok) return { status: "processing" };
  const job: any = await st.json().catch(() => null);
  const status = String(job?.data?.status ?? job?.status ?? "").toLowerCase();
  if (["done", "completed", "complete", "succeeded", "success"].includes(status)) {
    const url = firstVideoUrl(job) ?? job?.data?.result_url ?? null;
    if (url) return { status: "completed", video_url: String(url) };
    return { status: "failed", error: "deapi finished without a video URL" };
  }
  if (["failed", "error", "cancelled"].includes(status)) {
    return { status: "failed", error: String(job?.data?.error ?? "deapi video job failed") };
  }
  return { status: "processing", progress: Number(job?.data?.progress ?? 0) };
}

export async function renderfulVideoPoll(key: string, id: string): Promise<PollResult> {
  const st = await fetch(`https://api.renderful.ai/api/v1/generations/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!st.ok) return { status: "processing" };
  const job: any = await st.json().catch(() => null);
  const status = String(job?.status ?? "").toLowerCase();
  if (["succeeded", "completed", "complete", "success"].includes(status)) {
    const url = firstVideoUrl(job?.output ?? job?.outputs ?? job);
    if (url) return { status: "completed", video_url: url };
    return { status: "failed", error: "renderful finished without a video URL" };
  }
  if (["failed", "error", "cancelled"].includes(status)) {
    return { status: "failed", error: String(job?.error ?? "renderful video task failed") };
  }
  return { status: "processing", progress: Number(job?.progress ?? 0) };
}
