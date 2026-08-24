import { ArrowRight } from "lucide-react";
import type { LandingAccent, LandingHighlight } from "@/config/landing/types";
import { ACCENTS } from "./accents";
import { Eyebrow, Heading, Section } from "./primitives";

interface LandingHighlightPanelProps {
  highlight: LandingHighlight;
  accent: LandingAccent;
}

/**
 * The tinted panel under the steps. One component covers all four mockup
 * variants: a split APY breakdown (USDST), a single figure (GOLDST), a plain
 * feature callout (V3), and a collateral-in/USDST-out flow (borrow).
 * The figures sit in separate white cards with gaps, as drawn.
 */
const LandingHighlightPanel = ({ highlight, accent }: LandingHighlightPanelProps) => {
  const tone = ACCENTS[accent];
  const { feature, metrics, flow, chips } = highlight;
  const hasAside = Boolean(feature || flow || metrics?.length);
  const split = Boolean(feature && metrics?.length);

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
            <div className={split ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "grid gap-3"}>
              {feature && (
                <div className="rounded-xl bg-card p-5 shadow-sm">
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

              {(metrics?.length ?? 0) > 0 && (
                <div className="grid gap-3">
                  {metrics!.map((metric) => (
                    <div key={metric.label} className="rounded-xl bg-card p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Eyebrow className="text-muted-foreground">{metric.label}</Eyebrow>
                          <p className="mt-1 text-[11px] text-muted-foreground">{metric.note}</p>
                        </div>
                        <p className="font-mono text-lg font-bold text-strato-blue dark:text-white">
                          {metric.value}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {flow && (
                <div className="flex items-center justify-center gap-8 rounded-xl bg-card p-6 shadow-sm">
                  <div className="flex flex-col items-center text-center">
                    {flow.fromImage && (
                      <img src={flow.fromImage} alt="" className="mb-2 h-10 w-10" />
                    )}
                    <Eyebrow className="text-muted-foreground">{flow.fromLabel}</Eyebrow>
                    <p className="mt-1 text-sm font-semibold text-strato-blue dark:text-white">
                      {flow.from}
                    </p>
                  </div>
                  <ArrowRight className={`h-5 w-5 shrink-0 ${tone.figure}`} aria-hidden="true" />
                  <div className="flex flex-col items-center text-center">
                    {flow.toImage && <img src={flow.toImage} alt="" className="mb-2 h-10 w-10" />}
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
          {chips.map((chip) => {
            const { label, images } = typeof chip === "string" ? { label: chip, images: undefined } : chip;
            return (
              <div
                key={label}
                className={`flex min-w-[8rem] flex-1 items-center justify-center gap-2 rounded-xl border bg-card px-4 py-3 text-center text-xs font-medium text-foreground/80 ${tone.chip}`}
              >
                {images && (
                  <span className="flex shrink-0">
                    {images.map((src, i) => (
                      <img
                        key={src}
                        src={src}
                        alt=""
                        className={`h-5 w-5 ${i > 0 ? "-ml-1.5" : ""}`}
                      />
                    ))}
                  </span>
                )}
                {label}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
};

export default LandingHighlightPanel;
