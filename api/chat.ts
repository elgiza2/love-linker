/** @doc Serverless chat endpoint used when Supabase edge functions are down. */
import { streamChatProxy, type ChatProxyPayload } from "../src/lib/chat/proxyCore";
import { apiHeaders } from "../src/lib/api/authenticateRequest";

export const config = { runtime: "nodejs", maxDuration: 300 };

export default async function handler(req: Request): Promise<Response> {
  const headers = apiHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }
  const payload = (await req.json().catch(() => null)) as ChatProxyPayload | null;
  return streamChatProxy(payload ?? {}, headers as unknown as Record<string, string>);
}
