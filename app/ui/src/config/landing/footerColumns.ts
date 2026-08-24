import { EXTERNAL_LINKS } from "@/config/externalLinks";
import type { FooterColumn } from "./types";

const LEARN_DEFAULT = [
  { label: "Docs", href: EXTERNAL_LINKS.docs },
  { label: "Blog", href: EXTERNAL_LINKS.blog },
];

/**
 * Support and Legal are identical on all five landing pages; Product always
 * differs and Learn occasionally does, so only those two are parameters.
 */
export const buildFooterColumns = (
  product: { label: string; href: string }[],
  learn: { label: string; href: string }[] = LEARN_DEFAULT,
): FooterColumn[] => [
  { heading: "Product", links: product },
  { heading: "Learn", links: learn },
  {
    heading: "Support",
    links: [
      { label: "Contact", href: EXTERNAL_LINKS.contact },
      { label: "Discord", href: EXTERNAL_LINKS.discord },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: EXTERNAL_LINKS.privacy },
      { label: "Terms", href: EXTERNAL_LINKS.terms },
    ],
  },
];

export const FULL_APP_LINK = { label: "Full STRATO App", href: "/dashboard" };
export const WEBSITE_LINK = { label: "STRATO Website", href: EXTERNAL_LINKS.website };
