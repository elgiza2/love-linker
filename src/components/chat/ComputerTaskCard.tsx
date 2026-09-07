/**
 * @doc Silent in-chat surface for a Computer Agent task.
 *
 * Deliberately chrome-less: while the computer works it is a single quiet
 * progress line — no labels, no icons, no buttons. The narration lives in the
 * thinking trace above it, so this surface only carries what the task actually
 * produced (text + files) once it is finished.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  computerErrorMessage,
  pollComputerTask,
  stopComputerTask,
  type ComputerTask,
  type ComputerEvent,
} from "@/lib/computer/client";
import ThinkingTrace from "@/components/chat/ThinkingTrace";
import ChatMessage from "@/components/chat/ChatMessage";

import { clearActiveComputerRun, setActiveComputerRun } from "@/lib/computer/activeRun";
import { clearComputerLiveView, setComputerLiveView } from "@/lib/computer/liveView";
import { cleanTrace } from "@/lib/computer/traceCleanup";


interface Props {
  taskId: string;
}

const POLL_MS = 3000;
const TASK_TIMEOUT_MS = 15 * 60 * 1000;

export default function ComputerTaskCard({ taskId }: Props) {
  const [task, setTask] = useState<ComputerTask | null>(null);
  const [events, setEvents] = useState<ComputerEvent[]>([]);
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const deadline = Date.now() + TASK_TIMEOUT_MS;

    const tick = async () => {
      try {
        if (Date.now() >= deadline) {
          setTimedOut(true);
          clearActiveComputerRun(taskId);
          await stopComputerTask(taskId).catch(() => undefined);
          return;
        }
        const res = await pollComputerTask(taskId);
        if (cancelled) return;
        setTask(res.task);
        setEvents(res.events ?? []);
        const finished = res.task.status === "done" || res.task.status === "failed";
        if (finished) clearActiveComputerRun(taskId);
        else {
          setActiveComputerRun(taskId);
          timer.current = setTimeout(tick, POLL_MS);
        }
      } catch {
        if (!cancelled) timer.current = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      clearActiveComputerRun(taskId);
    };
  }, [taskId]);

  const running =
    !timedOut && (!task || task.status === "pending" || task.status === "running" || task.status === "paused");
  const files = task?.files ?? [];
  // Internal bookkeeping (checkpoints, raw errors, JSON) never reaches the chat.
  const traceSteps = useMemo(() => cleanTrace(events.map((event) => event.title)), [events]);
  const traceText = useMemo(
    () => cleanTrace(events.map((event) => event.detail)).join("\n\n"),
    [events],
  );

  const liveUrl = task?.live_url ? `${task.live_url}${task.live_url.includes("?") ? "&" : "?"}view_only=true` : null;

  // While it works the screen lives inside the composer dock, not in the chat.
  useEffect(() => {
    if (!running) {
      clearComputerLiveView(taskId);
      return;
    }
    setComputerLiveView({
      id: taskId,
      url: liveUrl,
      poster: null,
      status: task?.progress || events.at(-1)?.title || "",
      active: true,
    });
  }, [running, liveUrl, taskId, task?.progress, events]);
  useEffect(() => () => clearComputerLiveView(taskId), [taskId]);

  if (running) {
    return (
      <div className="my-4 flex w-full flex-col">
        <ThinkingTrace
          active
          variant="tools"
          status={task?.progress || events.at(-1)?.title || ""}
          steps={traceSteps}
          text={traceText}
          tool="browser"
          running
          className="mb-0"
        />
      </div>
    );
  }

  if (timedOut || task?.status === "failed") {
    const reason =
      (timedOut ? "المهمة استغرقت وقتًا أطول من المتوقع وتم إيقافها." : "") ||
      computerErrorMessage(task?.error) ||
      (task?.result_text || "").trim() ||
      "المهمة على الكمبيوتر اتوقفت قبل ما تخلص. جرّب تبعتها تاني بصيغة أوضح.";
    return (
      <div className="my-4 space-y-4">
        {traceSteps.length > 0 && (
          <ThinkingTrace variant="tools" steps={traceSteps} text={traceText} tool="browser" />
        )}
        <p className="text-[13px] leading-relaxed text-destructive">{reason}</p>
      </div>
    );
  }

  if (!task?.result_text && files.length === 0) {
    return (
      <div className="my-4 space-y-4">
        {traceSteps.length > 0 && (
          <ThinkingTrace variant="tools" steps={traceSteps} text={traceText} tool="browser" />
        )}
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          المهمة خلصت من غير نتيجة مكتوبة.
        </p>
      </div>
    );
  }


  return (
    <div className="my-4 space-y-4">
      <ThinkingTrace variant="tools" steps={traceSteps} text={traceText} tool="browser" />
      {task?.result_text && <ChatMessage role="assistant" content={task.result_text} />}


      {files.length > 0 && (
        <div className="mt-2 space-y-2">
          {files.map((f) => {
            const isImage = /\.(png|jpe?g|webp|gif|avif)$/i.test(f.url) || f.type?.startsWith("image/");
            const isVideo = /\.(mp4|webm|mov)$/i.test(f.url) || f.type?.startsWith("video/");
            return (
              <div key={f.url} className="overflow-hidden rounded-xl border border-border/40">
                {isImage ? (
                  <img src={f.url} alt={f.name} loading="lazy" className="max-h-64 w-full object-cover" />
                ) : isVideo ? (
                  <video src={f.url} controls className="max-h-64 w-full" />
                ) : (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate px-3 py-2 text-[12.5px] text-foreground/85 hover:bg-foreground/5"
                  >
                    {f.name}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
