/** @doc Deep Research core — production transport adapter.
 *
 * Provider: the SAME routing ladder the rest of the app uses
 * (`_shared/abliteration.ts::callModel` → Cerebras primary, abliteration.ai
 * fallback). The old code called abliteration.ai directly and relied on its
 * `web_search_options`, so Deep Research broke whenever that legacy key was
 * absent. Live sources now come from our own search stack
 * (`_shared/search/webSearchCore.ts` + `readUrlCore.ts`) and the model only
 * synthesizes the report, which keeps the provider decision in one place.
 *
 * Prompts, depth scaling and validation stay in `sharedResearch.ts`.
 * The client-visible SSE contract is unchanged:
 * `response.web_search_call.searching`, `response.output_text.annotation.added`,
 * `response.reasoning_summary_text.delta`, `response.output_text.delta`,
 * `response.failed`.
 */
import { callModel } from "../_shared/abliteration.ts";
import { webSearch, type WebSearchResult } from "../_shared/search/webSearchCore.ts";
import { readUrls } from "../_shared/search/readUrlCore.ts";
import {
  researchInstructions,
  depthScale,
  validateResearchPayload,
  type ResearchPayload,
} from "./sharedResearch.ts";

export type { ResearchPayload };

const MAX_SOURCE_CHARS = 42_000;

/** Cheap model call that expands the question into distinct search queries. */
async function planQueries(query: string, wanted: number): Promise<string[]> {
  const fallback = [query];
  try {
    const result = await callModel(null, [], {
      agentRole: "fast",
      stream: false,
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You turn a research question into distinct web-search queries. " +
            `Reply with ONLY a JSON array of ${wanted} short query strings, no prose. ` +
            "Keep the user's language, cover different angles, and avoid duplicates.",
        },
        { role: "user", content: query },
      ],
    });
    if (!result?.response.ok) return fallback;
    const data = await result.response.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return fallback;
    const parsed = JSON.parse(text.slice(start, end + 1));
    const queries = Array.isArray(parsed)
      ? parsed.map((q) => String(q).trim()).filter((q) => q.length > 2)
      : [];
    const unique = Array.from(new Set([query, ...queries])).slice(0, wanted);
    return unique.length ? unique : fallback;
  } catch {
    return fallback;
  }
}

export async function streamDeepResearch(payload: ResearchPayload): Promise<Response> {
  const validated = validateResearchPayload(payload);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: validated.status });
  }
  const { query, context, depth } = validated.value;
  const scale = depthScale(depth);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const fail = (message: string) => {
        send({ type: "response.failed", error: { message } });
      };

      try {
        // ---------------------------------------------------------- search
        const queryCount = Math.max(2, Math.min(6, Math.round(scale.requestSearches / 3)));
        const queries = await planQueries(query, queryCount);

        const seen = new Map<string, WebSearchResult>();
        for (const q of queries) {
          send({ type: "response.web_search_call.searching" });
          const found = await webSearch(q, Math.min(8, scale.requestSearches)).catch(
            () => ({ results: [] as WebSearchResult[] }),
          );
          for (const item of found.results ?? []) {
            const url = String(item.url ?? "");
            if (!url || seen.has(url)) continue;
            seen.set(url, {
              url,
              title: String(item.title ?? url),
              snippet: String(item.snippet ?? ""),
            });
          }
        }

        const sources = [...seen.values()].slice(0, Math.min(18, scale.requestSearches * 2));
        if (!sources.length) {
          fail("Deep Research could not reach any live sources. Please try again.");
          return;
        }
        for (const source of sources) {
          send({
            type: "response.output_text.annotation.added",
            annotation: { type: "url_citation", url: source.url, title: source.title },
          });
        }

        // ------------------------------------------------------ read pages
        const readCount = Math.min(sources.length, depth === "fast" ? 5 : 10);
        const perPage = Math.max(2_000, Math.floor(MAX_SOURCE_CHARS / Math.max(1, readCount)));
        const pages = await readUrls(
          sources.slice(0, readCount).map((s) => s.url),
          perPage,
        ).catch(() => []);

        const corpus: string[] = [];
        let used = 0;
        sources.forEach((source, index) => {
          const page = pages.find((p) => p.url === source.url);
          const body = (page?.text || source.snippet || "").trim();
          if (!body) return;
          const block = `[${index + 1}] ${source.title}\n${source.url}\n${body}`;
          if (used + block.length > MAX_SOURCE_CHARS) return;
          used += block.length;
          corpus.push(block);
        });

        if (!corpus.length) {
          fail("Deep Research could not read the sources it found. Please try again.");
          return;
        }

        // ------------------------------------------------------- synthesis
        const userContent = [
          `Research question: ${query}`,
          context ? `Conversation context for disambiguation only:\n${context}` : "",
          "",
          "Live sources gathered for you (cite them inline as markdown links using the exact URLs):",
          corpus.join("\n\n---\n\n"),
        ]
          .filter(Boolean)
          .join("\n");

        const result = await callModel(null, [], {
          agentRole: "research",
          stream: true,
          reasoning_effort: scale.effort,
          max_tokens: scale.maxOutputTokens,
          messages: [
            { role: "system", content: researchInstructions(query, depth) },
            { role: "user", content: userContent },
          ],
        });

        if (!result?.response.ok || !result.response.body) {
          fail("Deep Research failed. Please try again.");
          return;
        }

        const reader = result.response.body.getReader();
        let buffer = "";
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
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === "string" && reasoning) {
              send({ type: "response.reasoning_summary_text.delta", delta: reasoning });
            }
            if (typeof delta.content === "string" && delta.content) {
              send({ type: "response.output_text.delta", delta: delta.content });
            }
            if (choice?.finish_reason === "content_filter") {
              fail("Deep Research was filtered.");
            }
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : "Deep Research failed. Please try again.");
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
