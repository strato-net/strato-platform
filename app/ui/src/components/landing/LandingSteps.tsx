import { Check } from "lucide-react";
import type { LandingStep } from "@/config/landing/types";
import { Eyebrow, Section, Tile } from "./primitives";
import LandingConnectButton from "./LandingConnectButton";
import { useUser } from "@/context/UserContext";
import { cn } from "@/lib/utils";
import { capture } from "@/lib/analytics";

interface LandingStepsProps {
  steps: LandingStep[];
  appPath: string;
  slug: string;
}

/**
 * The numbered onboarding cards — two or three, per config. Step 1 is the
 * wallet connect and turns into a "Connected" marker once that is done; the
 * remaining steps are drawn dimmed because they are not reachable until a
 * wallet is connected, so they stay inert while logged out and open the app in
 * a new tab once it is.
 */
const LandingSteps = ({ steps, appPath, slug }: LandingStepsProps) => {
  const { isLoggedIn } = useUser();
  const [first, ...rest] = steps;

  return (
    <Section>
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          steps.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3",
        )}
      >
        <Tile className="border-strato-lightblue/40 shadow-md">
          <div className="flex items-center justify-between">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-strato-lightblue/10 font-mono text-[10px] font-semibold text-strato-lightblue">
              {first.index}
            </span>
            <Eyebrow className="text-strato-lightblue">{first.tag}</Eyebrow>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-strato-blue dark:text-white">
            {first.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{first.body}</p>
          {isLoggedIn ? (
            <div className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-strato-lightblue/10 px-6 py-3 text-sm font-semibold text-strato-lightblue">
              <Check className="h-4 w-4" />
              Connected
            </div>
          ) : (
            <LandingConnectButton
              appPath={appPath}
              connectedLabel="Connected"
              slug={slug}
              placement="steps"
              className="mt-6"
            />
          )}
        </Tile>

        {rest.map((step) => (
          <Tile key={step.index} className={cn(!isLoggedIn && "opacity-70")}>
            <div className="flex items-center justify-between">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
                {step.index}
              </span>
              <Eyebrow className="text-muted-foreground">{step.tag}</Eyebrow>
            </div>
            <h3 className="mt-5 text-lg font-semibold text-foreground/80">{step.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
            {isLoggedIn ? (
              <a
                href={step.appPath ?? appPath}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  capture("landing_step_clicked", {
                    slug,
                    step_index: step.index,
                    app_path: step.appPath ?? appPath,
                  })
                }
                className="mt-6 block w-full rounded-full border border-strato-blue/30 px-6 py-3 text-center text-sm font-semibold text-strato-blue transition-colors hover:bg-strato-blue/5 dark:border-strato-lightblue/50 dark:text-strato-lightblue dark:hover:bg-strato-lightblue/10"
              >
                {step.cta}
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="mt-6 w-full cursor-not-allowed rounded-lg bg-muted/70 px-6 py-3 text-sm font-semibold text-muted-foreground transition-colors"
              >
                {step.cta}
              </button>
            )}
          </Tile>
        ))}
      </div>
    </Section>
  );
};

export default LandingSteps;
