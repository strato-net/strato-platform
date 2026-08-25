import { Percent } from "lucide-react";
import goldstImage from "@/assets/landing/goldst.png";
import usdcImage from "@/assets/landing/usdc.png";
import usdstImage from "@/assets/landing/usdst.png";
import usdtImage from "@/assets/landing/usdt.png";
import { EXTERNAL_LINKS } from "@/config/externalLinks";
import type { ProductLandingConfig } from "./types";

export const liquidity: ProductLandingConfig = {
  slug: "liquidity",
  documentTitle: "STRATO V3 Liquidity | Earn Trading Fees | STRATO",
  accent: "teal",
  appPath: "/dashboard/v3-liquidity",

  hero: {
    images: [goldstImage, usdstImage],
    eyebrow: "STRATO V3 Liquidity",
    headline: "Put Your Assets To Work. Earn Trading Fees.",
    subhead:
      "Choose a pool, set your range and earn a share of trading fees while your liquidity is active.",
  },

  stats: [
    { value: "5", label: "Live pools" },
    { value: "24/7", label: "Onchain markets" },
    { value: "2", label: "Steps to open a position" },
  ],

  steps: [
    {
      index: "01",
      tag: "Start here",
      title: "Connect Wallet",
      body: "Connect your wallet and keep full control of your assets.",
      cta: "Connect Wallet",
    },
    {
      index: "02",
      tag: "Final",
      title: "Choose A Pool & Deposit",
      body: "Pick the token pair, choose where your liquidity is active, then deposit both assets.",
      cta: "Add Liquidity",
    },
  ],

  highlight: {
    eyebrow: "Active liquidity",
    title: "Earn Fees While Your Range Is Active.",
    body: "When trades happen inside the price range you select, your position earns its share of the pool fee.",
    feature: {
      label: "You earn",
      value: "Trading Fees",
      variant: "text",
      note: "From swaps inside your active range",
    },
    chips: [
      { label: "USDC / USDST", images: [usdcImage, usdstImage] },
      { label: "GOLDST / USDST", images: [goldstImage, usdstImage] },
      { label: "USDT / USDST", images: [usdtImage, usdstImage] },
      "+2 more pools",
    ],
  },

  assurances: {
    items: ["Choose the pool", "Choose your active price range", "Keep control of your position"],
    disclaimer:
      "Positions earn fees only while the pool price is inside the selected range. Returns vary. Providing liquidity carries smart contract and impermanent loss risk.",
  },

  explainers: [
    {
      images: [goldstImage, usdstImage],
      tag: "Your strategy",
      title: "Choose Where Your Liquidity Works.",
      body: "Concentrate liquidity around the prices where you want it active. A tighter range can use capital more efficiently, but may need more attention.",
      link: { label: "Explore V3 Pools", href: "/dashboard/v3-liquidity" },
    },
    {
      icon: Percent,
      tag: "Fees from trades",
      title: "Trades Generate Your Fees.",
      body: "When swaps happen inside your range, your position earns a share of the pool fee. Outside the range, earning pauses until the price returns.",
      link: { label: "Learn About Liquidity", href: `${EXTERNAL_LINKS.docs}/liquidity` },
    },
  ],

  ctaBanner: {
    eyebrow: "STRATO V3 Liquidity",
    title: "Choose A Pool. Start Earning Fees.",
    body: "Open a V3 position and put your assets to work onchain.",
  },
};
