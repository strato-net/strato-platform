import type { LandingBand } from "@/config/landing/types";
import { Eyebrow } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * Full-bleed explanatory band. Navy on the borrow/staking pages, light on the
 * staking unbonding section. The aside varies per band, so it is a small union.
 */
const LandingFeatureBand = ({ band }: { band: LandingBand }) => {
  const navy = band.tone === "navy";

  return (
    <section className={cn("py-14 sm:py-16", navy ? "bg-strato-blue dark:bg-strato-dark" : "bg-card")}>
      <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <div>
            <Eyebrow className={navy ? "text-white/50" : "text-muted-foreground"}>
              {band.eyebrow}
            </Eyebrow>
            <h2
              className={cn(
                "mt-3 text-2xl font-bold tracking-tight sm:text-3xl",
                navy ? "text-white" : "text-strato-blue dark:text-white",
              )}
            >
              {band.title}
            </h2>
            <p className={cn("mt-3 text-sm", navy ? "text-white/70" : "text-muted-foreground")}>
              {band.body}
            </p>
            {band.link && (
              <a
                href={band.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-5 inline-block text-xs font-semibold hover:underline",
                  navy ? "text-white" : "text-strato-lightblue",
                )}
              >
                {band.link.label} &#8599;
              </a>
            )}
          </div>

          <div
            className={cn(
              "rounded-2xl border p-6",
              navy ? "border-white/15 bg-white/5" : "border-border bg-background",
            )}
          >
            {band.aside.kind === "status" && (
              <>
                <div className="flex items-center justify-between">
                  <p className={cn("text-xs font-semibold", navy ? "text-white" : "text-foreground")}>
                    {band.aside.title}
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    {band.aside.state}
                  </span>
                </div>
                <div className="mt-5 flex justify-between">
                  {band.aside.scale.map((step) => (
                    <Eyebrow key={step} className={navy ? "text-white/40" : "text-muted-foreground"}>
                      {step}
                    </Eyebrow>
                  ))}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-green-500" />
                <p className={cn("mt-4 text-[11px]", navy ? "text-white/60" : "text-muted-foreground")}>
                  {band.aside.note}
                </p>
              </>
            )}

            {(band.aside.kind === "list" || band.aside.kind === "steps") && (
              <ul className={cn(band.aside.kind === "steps" ? "grid grid-cols-3 gap-4" : "space-y-4")}>
                {band.aside.items.map((item) => (
                  <li key={item.index}>
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-semibold",
                        navy ? "bg-white/10 text-white/70" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {item.index}
                    </span>
                    <p
                      className={cn(
                        "mt-2 text-sm font-semibold",
                        navy ? "text-white" : "text-foreground",
                      )}
                    >
                      {item.title}
                    </p>
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        navy ? "text-white/60" : "text-muted-foreground",
                      )}
                    >
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingFeatureBand;
