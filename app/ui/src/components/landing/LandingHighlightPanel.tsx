import { ArrowRight } from "lucide-react";
import type { LandingAccent, LandingHighlight } from "@/config/landing/types";
import { ACCENTS } from "./accents";
import { Eyebrow, Heading, Section } from "./primitives";

/**
 * Rows the feature figure spans so it sits alongside the stacked metrics rather
 * than leaving a hole in the grid. Written out because Tailwind only picks up
 * class names that appear literally in the source.
 */
const FEATURE_ROW_SPAN: Record<number, string> = {
  1: "",
  2: "sm:row-span-2",
  3: "sm:row-span-3",
};

interface LandingHighlightPanelProps {
  highlight: LandingHighlight;
  accent: LandingAccent;
}

/**
 * The tinted panel under the steps. One component covers all four mockup
 * variants: a split APY breakdown (USDST), a single figure (GOLDST), a plain
 * feature callout (V3), and a collateral-in/USDST-out flow (borrow).
 */
const LandingHighlightPanel = ({ highlight, accent }: LandingHighlightPanelProps) => {
  const tone = ACCENTS[accent];
  const { feature, metrics, flow, chips } = highlight;
  const hasAside = Boolean(feature || flow || metrics?.length);

  return (
    <Section className="pt-0">
      <div className={`rounded-2xl p-6 sm:p-8 ${tone.panel}`}>
        <div
          className={
            hasAside ? "grid grid-cols-1 items-center gap-8 lg:grid-cols-2" : "max-w-2xl"
          }
        >
          <div>
            <Eyebrow className="text-muted-foreground">{highlight.eyebrow}</Eyebrow>
            <Heading className="mt-3">{highlight.title}</Heading>
            <p className="mt-3 text-sm text-muted-foreground">{highlight.body}</p>
          </div>

          {hasAside && (
            <div
              className={
                feature && metrics?.length
                  ? "grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-2"
                  : "grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border"
              }
            >
              {feature && (
                <div className={`bg-card p-5 ${FEATURE_ROW_SPAN[metrics?.length ?? 0] ?? ""}`}>
                  <Eyebrow className="text-muted-foreground">{feature.label}</Eyebrow>
                  <p
                    className={`mt-2 text-3xl font-bold ${tone.figure} ${
                      feature.variant === "text" ? "tracking-tight" : "font-mono"
                    }`}
                  >
                    {feature.value}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">{feature.note}</p>
                </div>
              )}

              {metrics?.map((metric) => (
                <div key={metric.label} className="bg-card p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Eyebrow className="text-muted-foreground">{metric.label}</Eyebrow>
                    <p className="font-mono text-lg font-bold text-strato-blue dark:text-white">
                      {metric.value}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{metric.note}</p>
                </div>
              ))}

              {flow && (
                <div className="flex items-center justify-center gap-5 bg-card p-6">
                  <div className="text-center">
                    <Eyebrow className="text-muted-foreground">{flow.fromLabel}</Eyebrow>
                    <p className="mt-1 text-sm font-semibold text-strato-blue dark:text-white">
                      {flow.from}
                    </p>
                  </div>
                  <ArrowRight className={`h-5 w-5 shrink-0 ${tone.figure}`} aria-hidden="true" />
                  <div className="text-center">
                    <Eyebrow className="text-muted-foreground">{flow.toLabel}</Eyebrow>
                    <p className="mt-1 text-sm font-semibold text-strato-blue dark:text-white">
                      {flow.to}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {chips && (
        <div className="mt-4 flex flex-wrap gap-3">
          {chips.map((chip) => (
            <div
              key={chip}
              className={`min-w-[8rem] flex-1 rounded-xl border bg-card px-4 py-3 text-center text-xs font-medium text-foreground/80 ${tone.chip}`}
            >
              {chip}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
};

export default LandingHighlightPanel;
