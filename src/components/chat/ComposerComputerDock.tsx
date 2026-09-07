/**
 * @doc Computer surface embedded straight into the composer.
 *
 * Collapsed: a chip-style button with a very small square peek of the live
 * screen inside it, at the same chip height.
 * Expanded: a browser preview area with a thin top bar that collapses it again.
 * The chip closes itself when the task ends so the input is never left alone
 * with an empty screen.
 */
import { useEffect } from "react";
import { useComputerLiveView } from "@/lib/computer/liveView";
import { useUserLang } from "@/lib/authI18n";
import { useComposerComputer } from "./ComposerComputerContext";

export function ComposerComputerDock({ className = "" }: { className?: string }) {
  const view = useComputerLiveView();
  const lang = useUserLang();
  const { open, toggle, setOpen } = useComposerComputer();
  const isAr = lang.startsWith("ar");

  const empty = !view || (!view.active && !view.url && !view.poster);

  // When the run ends there is nothing left to show, so fold the screen back
  // down instead of leaving an expanded panel behind.
  useEffect(() => {
    if (empty && open) setOpen(false);
  }, [empty, open, setOpen]);

  if (empty) return null;

  const title = isAr ? "كمبيوتر ميغسي" : "Megsy Computer";
  const closeLabel = isAr ? "إغلاق الكمبيوتر" : "Close computer";

  return (
    <div
      data-composer-computer
      className={`w-full ${className}`}
      dir={isAr ? "rtl" : "ltr"}
    >
      {open ? (
        <div className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background">
          {/* Top bar — same chip look, closes the preview when tapped. */}
          <button
            type="button"
            onClick={toggle}
            aria-label={closeLabel}
            className="group flex h-10 w-full items-center justify-between gap-2 border-b border-border/60 bg-card px-3.5 text-start transition-[background-color] duration-150 hover:bg-muted"
          >
            <span className="truncate text-[13px] font-medium text-foreground">
              {title}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {isAr ? "إغلاق" : "Close"}
            </span>
          </button>
          <div className="relative w-full" style={{ height: "min(50vh, 360px)" }}>
            {view.url ? (
              <iframe
                src={view.url}
                title={title}
                className="absolute inset-0 h-full w-full border-0"
                allow="clipboard-read; clipboard-write"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : view.poster ? (
              <img
                src={view.poster}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-top"
              />
            ) : (
              <div className="absolute inset-0 bg-muted" />
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={isAr ? "تكبير كومبيوتر ميغسي" : "Expand Megsy Computer"}
          className="group flex h-11 w-full items-center gap-2.5 rounded-2xl border border-border/60 bg-card px-2.5 text-start transition-[background-color] duration-150 hover:bg-muted"
        >
          {/* Tiny square peek of the live screen, same height as the chip. */}
          <span className="relative block h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted">
            {view.url ? (
              <iframe
                src={view.url}
                title=""
                aria-hidden
                tabIndex={-1}
                scrolling="no"
                className="pointer-events-none absolute left-0 top-0 h-[360px] w-[540px] origin-top-left border-0"
                style={{ transform: "scale(0.052)" }}
                sandbox="allow-scripts allow-same-origin"
              />
            ) : view.poster ? (
              <img
                src={view.poster}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-top"
              />
            ) : (
              <span className="absolute inset-0 animate-pulse bg-muted-foreground/20" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {title}
          </span>
          {view.active ? (
            <span className="me-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden />
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {isAr ? "فتح" : "Open"}
          </span>
        </button>
      )}
    </div>
  );
}

export default ComposerComputerDock;
