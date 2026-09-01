import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CheckCircle2, Circle, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Progress } from "@/components/ui/progress";
import {
  MILESTONE_ACTIONS,
  nextMoveRoute,
  type MemberBenefitPopup,
} from "@/lib/memberBenefits";
import STRATOLOGO from "@/assets/strato.png";
import STRATOLOGODARK from "@/assets/strato-dark.png";
import STRATOMARK from "@/assets/icon.png";

interface MemberBenefitDialogProps {
  popup: MemberBenefitPopup | null;
  open: boolean;
  /** Close via X / "Maybe Later". */
  onDismiss: () => void;
  /** Primary CTA — navigates to the next incomplete action. */
  onCta: () => void;
}

const HEX_CLIP = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

/** White hexagon tile holding the STRATO mark — the floating tokens in the art. */
const HexToken = ({ className, size }: { className: string; size: number }) => (
  <div
    className={`absolute flex items-center justify-center bg-white shadow-xl ${className}`}
    style={{ clipPath: HEX_CLIP, width: size, height: size }}
  >
    <img src={STRATOMARK} alt="" style={{ width: size * 0.58, height: size * 0.58 }} />
  </div>
);

/**
 * Returning-user milestone popup ("One More Move Unlocks 500 Points", mock
 * slide 3). Shown on the dashboard when the user has completed some but not
 * all of the milestone actions — see lib/memberBenefits for the selection.
 */
const MemberBenefitDialog = ({ popup, open, onDismiss, onCta }: MemberBenefitDialogProps) => {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === "dark" ? STRATOLOGODARK : STRATOLOGO;

  if (!popup) return null;

  const totalActions = MILESTONE_ACTIONS.length;
  const percent = Math.round((popup.completedCount / totalActions) * 100);

  const handleCta = () => {
    onCta();
    navigate(nextMoveRoute(popup.completion));
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1180px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 dark:bg-background"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            One More Move Unlocks 500 Points.
          </DialogPrimitive.Title>

          {/* Header: logo | MEMBER BENEFIT pill + circled close */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4 sm:px-10">
            <img src={logo} alt="STRATO" className="h-9" />
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-2 rounded-full bg-strato-lightblue/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-strato-blue dark:text-strato-lightblue sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-strato-lightblue" />
                MEMBER BENEFIT
              </span>
              <DialogPrimitive.Close className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted focus:outline-none">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:py-10">
            {/* Left column */}
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <span className="h-[3px] w-7 rounded-full bg-strato-orange" />
                <span className="text-xs font-bold tracking-[0.22em] text-strato-lightblue">
                  YOUR NEXT MILESTONE
                </span>
              </div>

              <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-strato-blue dark:text-foreground sm:text-[44px]">
                One More Move Unlocks 500 Points.
              </h2>

              <p className="mt-5 max-w-[34rem] text-lg text-muted-foreground">
                Complete one eligible action to finish this milestone and collect your bonus.
              </p>

              {/* Progress card */}
              <div className="mt-7 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-strato-blue dark:text-foreground">
                    {popup.completedCount} of {totalActions} actions complete
                  </span>
                  <span className="text-sm font-semibold text-strato-lightblue">{percent}%</span>
                </div>
                <Progress
                  value={percent}
                  className="mt-3 h-2 bg-muted [&>div]:bg-strato-lightblue"
                />
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {MILESTONE_ACTIONS.map((a) => {
                    const done = popup.completion[a.key];
                    return (
                      <li key={a.key} className="flex items-center gap-2 text-sm">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-strato-lightblue" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                        )}
                        <span
                          className={
                            done
                              ? "font-medium text-strato-blue line-through decoration-strato-lightblue/60 dark:text-foreground"
                              : "font-medium text-muted-foreground"
                          }
                        >
                          {a.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* CTAs */}
              <div className="mt-8 flex items-center gap-6 lg:mt-auto lg:pt-10">
                <button
                  type="button"
                  onClick={handleCta}
                  className="rounded-lg bg-strato-blue px-7 py-3.5 text-sm font-semibold text-white shadow-md transition-colors hover:bg-strato-blue/90 dark:bg-strato-lightblue dark:hover:bg-strato-lightblue/90"
                >
                  Choose Your Next Move
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  Maybe Later
                </button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground/80">
                Complete one eligible action to unlock the campaign reward. Terms apply.
              </p>
            </div>

            {/* Right column: illustration — deep blue panel with the ascending
                hexagon "staircase" from the mockup, approximated in CSS. */}
            <div className="relative min-h-[300px] overflow-hidden rounded-2xl bg-gradient-to-br from-[#2F3DF2] via-[#2430D8] to-[#1A23A8] lg:min-h-[440px]">
              {/* faint grid, as in the mock's backdrop */}
              <div
                className="absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
                  backgroundSize: "36px 36px",
                }}
              />
              {/* dark plinths stepping up to the right */}
              <div
                className="absolute bottom-[4%] left-[6%] h-28 w-28 bg-[#101B7E]/90 lg:h-36 lg:w-36"
                style={{ clipPath: HEX_CLIP }}
              />
              <div
                className="absolute bottom-[22%] left-[34%] h-32 w-32 bg-[#0E1874]/90 lg:h-40 lg:w-40"
                style={{ clipPath: HEX_CLIP }}
              />
              <div
                className="absolute bottom-[42%] right-[8%] h-36 w-36 bg-[#0C156A]/90 lg:h-44 lg:w-44"
                style={{ clipPath: HEX_CLIP }}
              />
              {/* glowing path connecting the plinths */}
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path
                  d="M 14 88 L 44 66 L 78 44"
                  stroke="#7C8CFF"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.9"
                />
              </svg>
              {/* floating hexagon tokens along the path */}
              <HexToken className="bottom-[9%] left-[11%] rotate-[8deg]" size={44} />
              <HexToken className="bottom-[30%] left-[40%] -rotate-[6deg]" size={52} />
              <HexToken className="right-[24%] top-[36%] rotate-[4deg]" size={40} />
              <HexToken className="right-[6%] top-[16%] -rotate-[8deg]" size={92} />
              <div className="absolute right-[30%] top-[24%] h-3 w-3 rounded-full bg-[#5FD0FF]" />
              <div className="absolute bottom-[16%] right-[16%] h-2 w-2 rounded-full bg-[#5FD0FF]/80" />

              {/* milestone bonus card */}
              <div className="absolute left-[7%] top-[9%] -rotate-6 rounded-2xl bg-white px-6 py-4 shadow-2xl">
                <div className="text-[10px] font-bold tracking-[0.18em] text-gray-500">
                  MILESTONE BONUS
                </div>
                <div className="mt-1 text-3xl font-extrabold tracking-tight text-strato-blue">
                  <span className="text-strato-lightblue">+500</span> PTS
                </div>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default MemberBenefitDialog;
