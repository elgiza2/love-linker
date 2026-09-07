/** @doc Deep Research core — production transport adapter (Abliteration).
 * Prompts, depth scaling and validation live in the shared module ported
 * from `src/lib/research/deepResearchShared.ts` so dev and prod never
 * silently diverge; only the upstream transport differs. The client-visible
 * SSE event shapes (`response.output_text.delta`,
 * `response.reasoning_summary_text.delta`, `response.web_search_call.searching`,
 * `response.output_text.annotation.added`, `response.failed`) are the same
 * contract the client already parses.
 */
import { MODELS, modelKeys } from "../_shared/abliteration.ts";
import {
  errorMessage,
  researchInstructions,
  depthScale,
  validateResearchPayload,
  type ResearchPayload,
} from "./sharedResearch.ts";

export type { ResearchPayload };

const BASE = (Deno.env.get("ABLITERATION_API_BASE") || "https://api.abliteration.ai/v1").replace(/\/$/, "");

export async function streamDeepResearch(payload: ResearchPayload): Promise<Response> {
  const validated = validateResearchPayload(payload);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: validated.status });
  }
  const { query, context, depth } = validated.value;
  const scale = depthScale(depth);

  const keys = await modelKeys(null);
  if (!keys.length) {
    return Response.json(
      { error: "Deep Research is not configured: missing ABLITERATION_API_KEY.", missingEnv: "ABLITERATION_API_KEY" },
      { status: 500 },
    );
  }

  const input = context
    ? `${query}\n\nConversation context for disambiguation only:\n${context}`
    : query;

  const body = {
    model: MODELS.standard,
    stream: true,
    messages: [
      { role: "system", content: researchInstructions(query, depth) },
      { role: "user", content: input },
    ],
    reasoning_effort: scale.effort,
    web_search_options: { search_count: scale.requestSearches },
    max_tokens: scale.maxOutputTokens,
  };

  let upstream: Response | null = null;
  for (const entry of keys) {
    try {
      const resp = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${entry.key}` },
        body: JSON.stringify(body),
      });
      if (resp.ok && resp.body) {
        upstream = resp;
        break;
      }
      console.error(`deep-research upstream [${resp.status}]`, await resp.text().catch(() => ""));
    } catch (error) {
      console.error("deep-research upstream request failed", error);
    }
  }

  if (!upstream || !upstream.body) {
    return Response.json(
      { error: "Deep Research failed. Please try again.", retryable: true },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sources = new Map<string, { url: string; title: string }>();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const reader = upstream!.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            let chunk: Record<string, any>;
            try {
              chunk = JSON.parse(raw);
            } catch {
              continue;
            }

            const choice = chunk.choices?.[0];
            const delta = choice?.delta ?? {};

            if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
              send({ type: "response.reasoning_summary_text.delta", delta: delta.reasoning_content });
            }
            if (typeof delta.content === "string" && delta.content) {
              send({ type: "response.output_text.delta", delta: delta.content });
            }
            const annotations = Array.isArray(delta.annotations) ? delta.annotations : [];
            for (const ann of annotations) {
              const url = String(ann?.url_citation?.url ?? ann?.url ?? "");
              if (!url || sources.has(url)) continue;
              sources.set(url, { url, title: String(ann?.url_citation?.title ?? ann?.title ?? url) });
              send({
                type: "response.output_text.annotation.added",
                annotation: { type: "url_citation", url, title: sources.get(url)!.title },
              });
            }
            const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
            if (toolCalls.length) {
              send({ type: "response.web_search_call.searching" });
            }
            if (choice?.finish_reason === "content_filter") {
              send({ type: "response.failed", error: { message: "Deep Research was filtered." } });
            }
          }
        }
      } catch (error) {
        send({
          type: "response.failed",
          error: { message: error instanceof Error ? error.message : "stream failed" },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
