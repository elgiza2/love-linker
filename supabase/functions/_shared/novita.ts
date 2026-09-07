/**
 * @doc Novita Sandbox client for the OpenManus agent runtime.
 *
 * The real OpenManus repository runs inside a Novita sandbox built from the
 * `megsy-openmanus` template (Python 3.11 + OpenManus + Chromium already
 * installed), so a task starts in seconds instead of installing dependencies.
 *
 * Only the few REST calls the bridge needs are wrapped here: create a sandbox,
 * write/read files, run a command (foreground or background) and kill it.
 * Secret: `NOVITA_API_KEY`. Optional overrides: `NOVITA_API_BASE`,
 * `MANUS_TEMPLATE_ID`.
 */
const BASE = (Deno.env.get("NOVITA_API_BASE") || "https://api.novita.ai/sandbox/openapi/v1")
  .replace(/\/$/, "");

/** Template built from the OpenManus repo; override per environment if rebuilt. */
export const TEMPLATE_ID = Deno.env.get("MANUS_TEMPLATE_ID") || "zoqc62arzviqz75ceswp";

export function novitaKey(): string {
  return (Deno.env.get("NOVITA_API_KEY") ?? "").trim();
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${novitaKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`novita ${path} [${res.status}]: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export interface SandboxInfo {
  sandboxId: string;
  status?: string;
}

/** Starts a sandbox from the OpenManus template. `ttlSeconds` bounds its life. */
export async function createSandbox(
  envs: Record<string, string>,
  ttlSeconds = 3600,
): Promise<SandboxInfo> {
  const body = {
    templateId: TEMPLATE_ID,
    timeout: ttlSeconds,
    envs,
    metadata: { app: "megsy", agent: "openmanus" },
  };
  const out = await call<Record<string, any>>("/sandbox/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const id = out.sandboxId ?? out.sandbox_id ?? out.data?.sandboxId ?? out.data?.sandbox_id;
  if (!id) throw new Error(`novita create returned no sandbox id: ${JSON.stringify(out).slice(0, 300)}`);
  return { sandboxId: String(id), status: out.status ?? out.data?.status };
}

export async function killSandbox(sandboxId: string): Promise<void> {
  await call("/sandbox/kill", { method: "POST", body: JSON.stringify({ sandboxId }) });
}

export interface CommandResult {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  pid?: number;
}

/** Runs a shell command. `background: true` returns as soon as it is started. */
export async function runCommand(
  sandboxId: string,
  command: string,
  opts: { background?: boolean; timeoutMs?: number; cwd?: string } = {},
): Promise<CommandResult> {
  const out = await call<Record<string, any>>("/sandbox/command/run", {
    method: "POST",
    body: JSON.stringify({
      sandboxId,
      command,
      background: !!opts.background,
      timeout: Math.ceil((opts.timeoutMs ?? 60_000) / 1000),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    }),
  });
  const d = out.data ?? out;
  return { exitCode: d.exitCode ?? d.exit_code, stdout: d.stdout, stderr: d.stderr, pid: d.pid };
}

export async function writeFile(sandboxId: string, path: string, content: string): Promise<void> {
  await call("/sandbox/file/write", {
    method: "POST",
    body: JSON.stringify({ sandboxId, path, content }),
  });
}

export async function readFile(sandboxId: string, path: string): Promise<string> {
  const out = await call<Record<string, any>>("/sandbox/file/read", {
    method: "POST",
    body: JSON.stringify({ sandboxId, path }),
  });
  const d = out.data ?? out;
  return typeof d === "string" ? d : (d.content ?? "");
}
