import { useNavigate } from "react-router-dom";
import { FileText, ExternalLink, CheckCircle2, Circle, Loader2, AlertTriangle } from "lucide-react";
import {
  detectResearchReportDirection,
  normalizeResearchReport,
} from "@/lib/normalizeResearchReport";
import { RESEARCH_STEPS, type ResearchStepId } from "@/lib/research/deepResearchShared";
import ToolCard from "./primitives/ToolCard";
import { detectLang } from "@/lib/detectLang";

interface DeepResearchCardProps {
  query: string;
  report: string;
  images?: string[];
  sessionKey?: string;
  createdAt?: string;
  /** Live run state. Omit (or "done") for the normal finished-report card. */
  status?: "running" | "error" | "done";
  /** Step currently in progress while status === "running". */
  activeStepId?: ResearchStepId;
  /** Terminal error message (including any missingEnv hint) to show plainly. */
  errorMessage?: string;
  /** Re-runs the failed research request. */
  onRetry?: () => void;
}

const DeepResearchCard = ({
  query,
  report,
  images = [],
  sessionKey,
  status = "done",
  activeStepId,
  errorMessage,
  onRetry,
}: DeepResearchCardProps) => {
  const navigate = useNavigate();
  // Step labels and buttons follow the language of the question the user asked.
  const ar = detectLang(query) === "ar";
  const cleanReport = normalizeResearchReport(report);
  const isRtl = detectResearchReportDirection(cleanReport) === "rtl";
  const isEmpty = !cleanReport?.trim();

  const openPreview = () => {
    const target = sessionKey ? `/research/preview/${sessionKey}` : "/research/preview/new";
    // Keep the raw report here. The preview normalizes only the article body,
    // while its sources drawer still needs the original citation links.
    navigate(target, { state: { reportData: { query, report, images } } });
  };

  if (status === "error") {
    return (
      <ToolCard
        dir={ar ? "rtl" : "ltr"}
        className="max-w-[420px]"
        icon={<AlertTriangle className="h-4 w-4" />}
        title={query}
        subtitle={ar ? "فشل البحث العميق" : "Deep Research failed"}
      >
        <div className={ar ? "text-right" : "text-left"}>
          <p className="mb-3 whitespace-pre-wrap break-words text-sm text-destructive">
            {errorMessage || (ar ? "فشل البحث العميق. حاول تاني." : "Deep Research failed. Please try again.")}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 justify-center px-5 h-9 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              {ar ? "إعادة المحاولة" : "Retry"}
            </button>
          )}
        </div>
      </ToolCard>
    );
  }

  if (status === "running") {
    const activeIndex = RESEARCH_STEPS.findIndex((step) => step.id === activeStepId);
    return (
      <ToolCard
        dir={ar ? "rtl" : "ltr"}
        className="max-w-[420px]"
        icon={<FileText className="h-4 w-4" />}
        title={query}
        subtitle={ar ? "جاري البحث…" : "Researching…"}
      >
        <ol className={`space-y-2 ${ar ? "text-right" : "text-left"}`}>
          {RESEARCH_STEPS.map((step, index) => {
            const isDone = activeIndex >= 0 && index < activeIndex;
            const isActive = index === activeIndex;
            return (
              <li key={step.id} className="flex items-center gap-2 text-sm">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                )}
                <span
                  className={
                    isActive
                      ? "font-medium text-foreground"
                      : isDone
                        ? "text-foreground/80"
                        : "text-muted-foreground"
                  }
                >
                  {ar ? step.labelAr : step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </ToolCard>
    );
  }

  return (
    <ToolCard
      dir={ar ? "rtl" : "ltr"}
      className="max-w-[420px]"
      icon={<FileText className="h-4 w-4" />}
      title={query}
      subtitle={isEmpty ? (ar ? "لا يوجد محتوى" : "No report content") : undefined}
    >
      <div className={ar ? "text-right" : "text-left"}>
        <button
          type="button"
          onClick={openPreview}
          disabled={isEmpty}
          className="inline-flex items-center gap-1.5 justify-center px-5 h-9 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {ar ? "افتح التقرير" : "Open"}
        </button>
      </div>
    </ToolCard>
  );
};

export default DeepResearchCard;
