import { Vault } from "lucide-react";
import goldstImage from "@/assets/landing/goldst.png";
import { EXTERNAL_LINKS } from "@/config/externalLinks";
import { buildFooterColumns, FULL_APP_LINK, WEBSITE_LINK } from "./footerColumns";
import type { ProductLandingConfig } from "./types";

export const goldVault: ProductLandingConfig = {
  slug: "gold-vault",
  documentTitle: "GOLDST Yield Vault | Get Your Gold Onchain | STRATO",
  accent: "gold",
  appPath: "/dashboard/earn-yield-vault",

  hero: {
    images: [goldstImage],
    eyebrow: "GOLDST Yield Vault",
    headline: "Get Your Gold Onchain. Make It Productive.",
    subhead:
      "Deposit GOLDST into the Yield Vault. Earn STRATO Reward Points while your position stays denominated in GOLDST.",
  },

  stats: [
    { value: "$30,322", label: "Already working in the vault" },
    { value: "+8.20%", label: "Reward Points APY" },
    { value: "3", label: "Steps to start earning" },
  ],

  steps: [
    {
      index: "01",
      tag: "Current",
      title: "Connect Wallet",
      body: "Connect your wallet and keep full control of your assets.",
      cta: "Connect Wallet",
    },
    {
      index: "02",
      tag: "Next",
      title: "Get GOLDST",
      body: "Buy or swap into tokenized, vaulted gold on STRATO.",
      cta: "Get GOLDST",
      // Funding the account happens on the deposits screen, not the vault.
      appPath: "/dashboard/deposits",
    },
    {
      index: "03",
      tag: "Final",
      title: "Deposit & Earn",
      body: "Deposit GOLDST, receive yieldGOLDST and start earning Reward Points.",
      cta: "Deposit GOLDST",
    },
  ],

  highlight: {
    eyebrow: "STRATO Reward Points",
    title: "Earn Reward Points On Your GOLDST.",
    body: "The full +8.20% APY shown here comes from STRATO Reward Points.",
    feature: {
      label: "Reward Points APY",
      value: "+8.20%",
      note: "STRATO Reward Points only",
    },
  },

  assurances: {
    items: [
      "Remain denominated in GOLDST",
      "Earn STRATO Reward Points on your deposit",
      "Keep control through your connected wallet",
    ],
    disclaimer:
      "The +8.20% APY quoted here comes entirely from STRATO Reward Points. Reward point value, TVL and withdrawal liquidity are variable. Redemptions may pause when vault liquidity is unavailable.",
  },

  explainers: [
    {
      // Live GOLDST token image from mainnet asset metadata
      // (BlockApps-Token-images @ cdc93d30182125e05eec985b631c7c61b3f63ff0).
      images: [goldstImage],
      tag: "GOLDST",
      title: "Real Gold. Onchain.",
      body: "Own tokenized, vaulted physical gold. Trade it, transfer it or put it to work across STRATO without giving up your gold exposure.",
      link: { label: "Explore GOLDST", href: `${EXTERNAL_LINKS.website}/defi/gold` },
    },
    {
      icon: Vault,
      tag: "Yield Vault",
      title: "Deposit GOLDST. Earn Points.",
      body: "Your deposit becomes yieldGOLDST while eligible STRATO Reward Points accrue alongside your vault position.",
      link: { label: "View Vault Details", href: `${EXTERNAL_LINKS.docs}/vaults` },
    },
  ],

  ctaBanner: {
    eyebrow: "GOLDST Yield Vault",
    title: "Put Your GOLDST To Work.",
    body: "Keep gold exposure while your vault position earns STRATO Reward Points.",
  },

  footerColumns: buildFooterColumns([FULL_APP_LINK, WEBSITE_LINK]),
};
