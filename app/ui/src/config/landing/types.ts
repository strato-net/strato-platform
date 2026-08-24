/**
 * Shape of a single-product landing page (`/defi/*`).
 *
 * Every string and number rendered on these pages lives in a config object, so
 * revising a page is a one-file edit and swapping a static figure for live data
 * later is a config change rather than a component rewrite.
 */

import type { LucideIcon } from "lucide-react";

export type LandingAccent = "blue" | "gold" | "teal";

export interface LandingStat {
  value: string;
  label: string;
}

/** Step 1 is always the wallet connect; 2 and 3 stay inert until connected. */
export interface LandingStep {
  index: string;
  tag: string;
  title: string;
  body: string;
  cta: string;
}

export interface LandingMetric {
  label: string;
  note: string;
  value: string;
  /** "figure" renders the mono numeric style; "text" is for values like "Trading Fees". */
  variant?: "figure" | "text";
}

/** The tinted panel below the steps. Renders whichever aside the product needs. */
export interface LandingHighlight {
  eyebrow: string;
  title: string;
  body: string;
  /** Large left-hand figure, e.g. "+8.60%". */
  feature?: LandingMetric;
  /** Stacked rows to the right of the feature, e.g. native vs rewards APY. */
  metrics?: LandingMetric[];
  /** "You provide X -> you receive Y" diagram used by the borrow page. */
  flow?: {
    fromLabel: string;
    from: string;
    fromImage?: string;
    toLabel: string;
    to: string;
    toImage?: string;
  };
  /** Pill row under the panel (pool pairs, supported collateral). */
  chips?: (string | LandingChip)[];
}

export interface LandingAssurances {
  items: string[];
  disclaimer: string;
}

export type LandingBandAside =
  | { kind: "status"; title: string; state: string; scale: string[]; note: string }
  | { kind: "list"; items: { index: string; title: string; body: string }[] }
  | { kind: "steps"; items: { index: string; title: string; body: string }[] };

export interface LandingBand {
  tone: "navy" | "light";
  eyebrow: string;
  title: string;
  body: string;
  link?: { label: string; href: string };
  aside: LandingBandAside;
}

export interface LandingExplainer {
  icon?: LucideIcon;
  /** Token/product image rendered in the chip instead of a Lucide icon. */
  image?: string;
  tag: string;
  title: string;
  body: string;
  link: { label: string; href: string };
}

export interface FooterColumn {
  heading: string;
  links: { label: string; href: string }[];
}

/** A pill under the highlight panel; paired token images render as in the mockups. */
export interface LandingChip {
  label: string;
  images?: string[];
}

export interface ProductLandingConfig {
  slug: string;
  documentTitle: string;
  accent: LandingAccent;
  /** Dashboard route the CTAs open once a wallet is connected. */
  appPath: string;
  hero: {
    /** Lucide fallback, rendered inside the brand ring. */
    icon?: LucideIcon;
    /** Token/product images (1 or 2, overlapped) that replace the icon+ring. */
    images?: string[];
    eyebrow: string;
    headline: string;
    subhead: string;
  };
  stats: LandingStat[];
  steps: LandingStep[];
  highlight: LandingHighlight;
  assurances: LandingAssurances;
  bands?: LandingBand[];
  explainers: LandingExplainer[];
  ctaBanner: { eyebrow: string; title: string; body: string };
  footerColumns: FooterColumn[];
}
