import goldstImage from "@/assets/landing/goldst.png";
import usdstImage from "@/assets/landing/usdst.png";
import { EXTERNAL_LINKS } from "@/config/externalLinks";
import type { ProductLandingConfig } from "./types";

export const borrow: ProductLandingConfig = {
  slug: "borrow",
  documentTitle: "STRATO Borrow | Access USDST Without Selling Your Assets | STRATO",
  accent: "blue",
  appPath: "/dashboard/borrow",

  hero: {
    images: [goldstImage, usdstImage],
    eyebrow: "STRATO Borrow",
    headline: "Access USDST Without Selling Your Assets.",
    subhead:
      "Use supported gold, silver or crypto as collateral. Borrow USDST while keeping exposure to the assets you already own.",
  },

  stats: [
    { value: "Keep", label: "Your asset exposure" },
    { value: "USDST", label: "Ready to use onchain" },
    { value: "2", label: "Steps to borrow" },
  ],

  steps: [
    {
      index: "01",
      tag: "Start here",
      title: "Connect Wallet",
      body: "Connect your wallet and keep full control of your position.",
      cta: "Connect Wallet",
    },
    {
      index: "02",
      tag: "Final",
      title: "Add Collateral & Borrow",
      body: "Choose a supported asset and amount, then borrow USDST against it after reviewing your safety buffer.",
      cta: "Borrow USDST",
    },
  ],

  highlight: {
    eyebrow: "Collateral in. USDST out.",
    title: "Keep Your Exposure. Unlock USDST.",
    body: "Your collateral stays in the position while your USDST is free to use across STRATO.",
    flow: {
      fromLabel: "You provide",
      from: "Collateral",
      fromImage: goldstImage,
      toLabel: "You receive",
      to: "USDST",
      toImage: usdstImage,
    },
    chips: ["Gold & Silver", "ETH & BTC", "Selected Stablecoins"],
  },

  assurances: {
    items: [
      "Borrow without selling",
      "Repay on your schedule",
      "Withdraw collateral after repayment",
    ],
    disclaimer:
      "Collateral remains locked while debt is outstanding and borrowing costs accrue. If your safety buffer falls too low, collateral may be liquidated. Rates and risk parameters vary by asset.",
  },

  bands: [
    {
      tone: "navy",
      eyebrow: "One number to watch",
      title: "Know When Your Position Needs Attention.",
      body: "Your safety buffer changes with the value of your collateral. If it falls, add collateral or repay USDST to strengthen the position.",
      link: { label: "Understand Borrowing Risk", href: `${EXTERNAL_LINKS.docs}/borrowing` },
      aside: {
        kind: "status",
        title: "Position Status",
        state: "Healthy",
        scale: ["At risk", "Watch", "Healthy"],
        note: "More collateral or less debt creates a larger safety buffer.",
      },
    },
  ],

  explainers: [
    {
      images: [goldstImage],
      tag: "Your collateral",
      title: "Your Asset Backs The Position.",
      body: "You keep its price exposure while it is locked as collateral. Repay the USDST and accrued costs before withdrawing it.",
      link: { label: "View Supported Assets", href: `${EXTERNAL_LINKS.app}/dashboard/explore` },
    },
    {
      images: [usdstImage],
      tag: "Your asset",
      title: "Use USDST Across STRATO.",
      body: "Hold it, swap it, deposit it into a vault or provide liquidity. The borrowed USDST stays available in your wallet.",
      link: { label: "Explore USDST", href: `${EXTERNAL_LINKS.app}/dashboard/deposits` },
    },
  ],

  ctaBanner: {
    eyebrow: "STRATO Borrow",
    title: "Keep Your Assets. Access USDST.",
    body: "Start with a supported asset and choose a comfortable safety buffer.",
  },
};
