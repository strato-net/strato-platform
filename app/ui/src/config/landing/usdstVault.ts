import usdstImage from "@/assets/landing/usdst.png";
import savingsVaultImage from "@/assets/landing/usdst-savings-vault.png";
import { EXTERNAL_LINKS } from "@/config/externalLinks";
import type { ProductLandingConfig } from "./types";

export const usdstVault: ProductLandingConfig = {
  slug: "usdst-vault",
  documentTitle: "USDST Savings Vault | Earn More With USDST | STRATO",
  accent: "blue",
  appPath: "/dashboard/earn-save",

  hero: {
    images: [savingsVaultImage],
    eyebrow: "USDST Savings Vault",
    headline: "Earn more with USDST.",
    subhead:
      "Deposit USDST and earn up to 8.60% APY through native vault yield and STRATO Reward Points—while keeping full control of your assets.",
  },

  stats: [
    { value: "3,780+", label: "Wallets already earning" },
    { value: "100%", label: "Self-custody" },
    { value: "3", label: "Simple steps to start" },
  ],

  steps: [
    {
      index: "01",
      tag: "Current",
      title: "Connect wallet",
      body: "Your wallet. Your assets. Connect without giving up custody.",
      cta: "Connect Wallet",
    },
    {
      index: "02",
      tag: "Next",
      title: "Get USDST",
      body: "Buy, swap or bridge into the stable asset built for STRATO.",
      cta: "Get USDST",
      // Funding the account happens on the deposits screen, not the vault.
      appPath: "/dashboard/deposits",
    },
    {
      index: "03",
      tag: "Final",
      title: "Deposit & earn",
      body: "Deposit USDST, receive saveUSDST and start earning automatically.",
      cta: "Deposit USDST",
    },
  ],

  highlight: {
    eyebrow: "Current vault rate",
    title: "One deposit. Two ways to earn.",
    body: "Native vault yield and Reward Points accrue automatically.",
    feature: {
      label: "Best available APY",
      value: "+8.60%",
      note: "Native yield + current rewards",
    },
    metrics: [
      { label: "Native APY", value: "5.00%", note: "Built into saveUSDST" },
      { label: "Rewards APY", value: "3.59%", note: "Current Reward Points equivalent" },
    ],
  },

  assurances: {
    items: ["Earn automatically", "Onchain vault position", "Yield and points tracked separately"],
    disclaimer:
      "Rates and rewards are variable. Review the live terms before depositing.",
  },

  explainers: [
    {
      images: [usdstImage],
      tag: "USDST",
      title: "USDST, built to do more.",
      body: "Hold it. Trade it. Put it to work. USDST moves across STRATO—from everyday transactions to onchain yield.",
      link: { label: "Explore USDST", href: `${EXTERNAL_LINKS.docs}/usdst` },
    },
    {
      images: [savingsVaultImage],
      tag: "Savings Vault",
      title: "Deposit once. Earn automatically.",
      body: "Your deposit becomes saveUSDST. Native yield accrues in the share value while eligible STRATO Reward Points build alongside it.",
      link: { label: "View Vault Details", href: `${EXTERNAL_LINKS.docs}/vaults` },
    },
  ],

  ctaBanner: {
    eyebrow: "USDST Savings Vault",
    title: "Start earning with USDST.",
    body: "Stay in control while your USDST works onchain.",
  },
};
