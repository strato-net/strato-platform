import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { SPONSORED_TXNS_PER_BRIDGE_IN } from "@/lib/firstTimeUser";
import STRATOLOGO from "@/assets/strato.png";
import STRATOLOGODARK from "@/assets/strato-dark.png";
import STRATOMARK from "@/assets/icon.png";

interface FirstTimeUserDialogProps {
  open: boolean;
  /** Close via X / "Maybe Later". */
  onDismiss: () => void;
  /** Any step or the primary CTA — the user is leaving for Fund or Trade. */
  onCta: () => void;
}

const FUND_ROUTE = "/dashboard/deposits";
const TRADE_ROUTE = "/dashboard/swap";

/** The path to a first trade. Step 2 happens on its own, so it has no route. */
const STEPS: Array<{ title: string; detail: string; route?: string }> = [
  {
    title: "Bridge in",
    detail: "Send USDC, USDT, ETH or WBTC from your wallet on Fund. No STRATO needed.",
    route: FUND_ROUTE,
  },
  {
    title: `Get ${SPONSORED_TXNS_PER_BRIDGE_IN} gas sponsored transactions`,
    detail: "Added to your account automatically when your deposit arrives.",
  },
  {
    title: "Make your first trade",
    detail: "Swap into any asset on Trade. Your sponsored transactions pay the network fee.",
    route: TRADE_ROUTE,
  },
];

const HEX_CLIP = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

/** White hexagon tile — a numbered step along the path, or the STRATO mark. */
const HexToken = ({ className, size, step }: { className: string; size: number; step?: number }) => (
  <div
    className={`absolute flex items-center justify-center bg-white shadow-xl ${className}`}
    style={{ clipPath: HEX_CLIP, width: size, height: size }}
  >
    {step ? (
      <span className="font-extrabold text-strato-blue" style={{ fontSize: size * 0.42 }}>
        {step}
      </span>
    ) : (
      <img src={STRATOMARK} alt="" style={{ width: size * 0.58, height: size * 0.58 }} />
    )}
  </div>
);

/**
 * First-time user popup: tells a brand-new account that bridging in is gas
 * sponsored and walks them to their first trade. See lib/firstTimeUser for
 * who counts as first-time.
 */
const FirstTimeUserDialog = ({ open, onDismiss, onCta }: FirstTimeUserDialogProps) => {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const logo = resolvedTheme === "dark" ? STRATOLOGODARK : STRATOLOGO;

  const goTo = (route: string) => {
    onCta();
    navigate(route);
  };

  const headline = "Bridge In. Your Gas Is on Us.";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1180px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 dark:bg-background"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{headline}</DialogPrimitive.Title>

          {/* Header: logo | GAS SPONSORED pill + circled close */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4 sm:px-10">
            <img src={logo} alt="STRATO" className="h-9" />
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-2 rounded-full bg-strato-lightblue/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-strato-blue dark:text-strato-lightblue sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-strato-lightblue" />
                GAS SPONSORED
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
                  WELCOME TO STRATO
                </span>
              </div>

              <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-strato-blue dark:text-foreground sm:text-[44px]">
                {headline}
              </h2>

              <p className="mt-5 max-w-[34rem] text-lg text-muted-foreground">
                Every bridge in adds {SPONSORED_TXNS_PER_BRIDGE_IN} gas sponsored transactions to
                your account, so you can start trading without buying STRATO for fees.
              </p>

              {/* Steps. Bridge in and trade are clickable rows; the sponsored
                  transactions arrive on their own, so that row is static. */}
              <div className="mt-7 rounded-xl border border-border bg-card p-5">
                <span className="font-bold text-strato-blue dark:text-foreground">
                  Three steps to your first trade
                </span>
                <ol className="mt-4 grid gap-2">
                  {STEPS.map((step, i) => {
                    const body = (
                      <>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-strato-lightblue/10 text-sm font-bold text-strato-blue dark:text-strato-lightblue">
                          {i + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-strato-blue dark:text-foreground">
                            {step.title}
                          </span>
                          <span className="block text-muted-foreground">{step.detail}</span>
                        </span>
                      </>
                    );
                    if (!step.route) {
                      return (
                        <li
                          key={step.title}
                          className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm"
                        >
                          {body}
                          <span className="ml-auto hidden shrink-0 text-xs font-semibold text-strato-lightblue sm:inline">
                            Automatic
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={step.title}>
                        <button
                          type="button"
                          onClick={() => goTo(step.route)}
                          className="group flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:border-strato-lightblue hover:bg-strato-lightblue/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-strato-lightblue"
                        >
                          {body}
                          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-strato-lightblue" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* CTAs */}
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 lg:mt-auto lg:pt-10">
                <button
                  type="button"
                  onClick={() => goTo(FUND_ROUTE)}
                  className="w-full rounded-lg bg-strato-blue px-7 py-3.5 text-sm font-semibold sm:w-auto text-white shadow-md transition-colors hover:bg-strato-blue/90 dark:bg-strato-lightblue dark:hover:bg-strato-lightblue/90"
                >
                  Bridge In Now
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
                Each gas sponsored transaction covers the STRATO network fee for one transaction.
                Gas on the chain you bridge from still applies.
              </p>
            </div>

            {/* Right column: illustration — deep blue panel with an ascending
                hexagon staircase, the three steps numbered along the path. On
                mobile it sits above the copy at a fixed height so it's visible
                without scrolling the dialog. */}
            <div className="relative order-first h-[200px] overflow-hidden rounded-2xl bg-gradient-to-br from-[#2F3DF2] via-[#2430D8] to-[#1A23A8] sm:h-[260px] lg:order-none lg:h-auto lg:min-h-[440px]">
              <div
                className="absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
                  backgroundSize: "36px 36px",
                }}
              />
              <div
                className="absolute bottom-[4%] left-[6%] h-20 w-20 bg-[#101B7E]/90 sm:h-28 sm:w-28 lg:h-36 lg:w-36"
                style={{ clipPath: HEX_CLIP }}
              />
              <div
                className="absolute bottom-[22%] left-[34%] h-24 w-24 bg-[#0E1874]/90 sm:h-32 sm:w-32 lg:h-40 lg:w-40"
                style={{ clipPath: HEX_CLIP }}
              />
              <div
                className="absolute bottom-[42%] right-[8%] h-28 w-28 bg-[#0C156A]/90 sm:h-36 sm:w-36 lg:h-44 lg:w-44"
                style={{ clipPath: HEX_CLIP }}
              />
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
              <HexToken className="bottom-[9%] left-[11%] rotate-[8deg]" size={48} step={1} />
              <HexToken className="bottom-[30%] left-[40%] -rotate-[6deg]" size={52} step={2} />
              <HexToken className="right-[24%] top-[36%] rotate-[4deg]" size={48} step={3} />
              <HexToken className="right-[6%] top-[16%] hidden -rotate-[8deg] sm:flex" size={92} />
              <div className="absolute right-[30%] top-[24%] h-3 w-3 rounded-full bg-[#5FD0FF]" />
              <div className="absolute bottom-[16%] right-[16%] h-2 w-2 rounded-full bg-[#5FD0FF]/80" />

              <div className="absolute left-[7%] top-[9%] -rotate-6 rounded-2xl bg-white px-4 py-3 shadow-2xl sm:px-6 sm:py-4">
                <div className="text-[10px] font-bold tracking-[0.18em] text-gray-500">
                  GAS SPONSORED
                </div>
                <div className="mt-1 text-2xl font-extrabold tracking-tight text-strato-blue sm:text-3xl">
                  <span className="text-strato-lightblue">+{SPONSORED_TXNS_PER_BRIDGE_IN}</span> TXNS
                </div>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default FirstTimeUserDialog;
