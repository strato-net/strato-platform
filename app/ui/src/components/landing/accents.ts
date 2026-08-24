import type { LandingAccent } from "@/config/landing/types";

/**
 * Per-product accent. The mockups tint the highlight panel and its figures to
 * match the asset — blue for USDST/borrow, gold for GOLDST, teal for V3 fees.
 */
export const ACCENTS: Record<
  LandingAccent,
  { panel: string; badge: string; figure: string; chip: string }
> = {
  blue: {
    panel: "bg-[#F4F6FD] dark:bg-strato-lightblue/10",
    badge: "bg-strato-lightblue/10 text-strato-lightblue",
    figure: "text-strato-blue dark:text-strato-lightblue",
    chip: "border-strato-blue/15 dark:border-strato-lightblue/25",
  },
  gold: {
    panel: "bg-[#FDF6E3] dark:bg-strato-gold/10",
    badge: "bg-strato-gold/20 text-[#8A6A00] dark:text-strato-gold",
    figure: "text-[#8A6A00] dark:text-strato-gold",
    chip: "border-strato-gold/40",
  },
  teal: {
    panel: "bg-[#EAF7F4] dark:bg-teal-400/10",
    badge: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    figure: "text-teal-700 dark:text-teal-300",
    chip: "border-teal-500/30",
  },
};
