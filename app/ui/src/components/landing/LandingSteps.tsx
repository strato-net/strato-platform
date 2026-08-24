import type { LandingStep } from "@/config/landing/types";
import { Eyebrow, Section, Tile } from "./primitives";
import LandingConnectButton from "./LandingConnectButton";
import { useUser } from "@/context/UserContext";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface LandingStepsProps {
  steps: LandingStep[];
  appPath: string;
}

/**
 * The three numbered onboarding cards. Step 1 is always live; steps 2 and 3 are
 * drawn dimmed because they are not reachable until a wallet is connected — so
 * they stay inert while logged out and become real links once it is.
 */
const LandingSteps = ({ steps, appPath }: LandingStepsProps) => {
  const { isLoggedIn } = useUser();
  const navigate = useNavigate();
  const [first, ...rest] = steps;

  return (
    <Section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile className="border-strato-lightblue/40 shadow-md">
          <div className="flex items-center justify-between">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-muted-foreground">
              {first.index}
            </span>
            <Eyebrow className="text-strato-lightblue">{first.tag}</Eyebrow>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-strato-blue dark:text-white">
            {first.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{first.body}</p>
          <LandingConnectButton
            appPath={appPath}
            connectedLabel={steps[steps.length - 1].cta}
            className="mt-6"
          />
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
            <button
              type="button"
              disabled={!isLoggedIn}
              onClick={() => navigate(appPath)}
              className={cn(
                "mt-6 w-full rounded-full px-6 py-3 text-sm font-semibold transition-colors",
                isLoggedIn
                  ? "border border-strato-blue/30 text-strato-blue hover:bg-strato-blue/5 dark:border-strato-lightblue/50 dark:text-strato-lightblue dark:hover:bg-strato-lightblue/10"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {step.cta}
            </button>
          </Tile>
        ))}
      </div>
    </Section>
  );
};

export default LandingSteps;
