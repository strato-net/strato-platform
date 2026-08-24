import { useTheme } from "next-themes";
import STRATOLOGO from "@/assets/strato.png";
import STRATOLOGODARK from "@/assets/strato-dark.png";
import { EXTERNAL_LINKS, TWITTER_HANDLE } from "@/config/externalLinks";
import type { FooterColumn } from "@/config/landing/types";

interface SiteFooterProps {
  /**
   * Link columns to show. Omitted on the home page, which keeps the original
   * dark logo-and-tagline-only footer; the product landing pages pass their
   * own columns and render the light variant drawn in the mockups.
   */
  columns?: FooterColumn[];
}

const SiteFooter = ({ columns }: SiteFooterProps) => {
  const { resolvedTheme } = useTheme();

  // Landing variant: light surface with a hairline top border, per the mockups.
  if (columns) {
    const logo = resolvedTheme === "dark" ? STRATOLOGODARK : STRATOLOGO;
    return (
      <footer className="border-t border-border bg-background py-14">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
            <div>
              <img src={logo} alt="STRATO" className="h-9" />
              <p className="mt-4 text-sm text-muted-foreground">
                DeFi powered by precious metals.
              </p>
              <a
                href={EXTERNAL_LINKS.twitter}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs font-semibold text-strato-lightblue hover:underline"
              >
                {TWITTER_HANDLE} &#8599;
              </a>
            </div>

            <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:col-span-2">
              {columns.map((column) => (
                <div key={column.heading}>
                  <h3 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {column.heading}
                  </h3>
                  <ul className="space-y-2.5">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          target={link.href.startsWith("http") ? "_blank" : undefined}
                          rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                          className="text-sm text-foreground/70 hover:text-strato-blue dark:hover:text-white"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} BlockApps Inc. All rights reserved.</p>
          </div>
        </div>
      </footer>
    );
  }

  // Home page: original dark footer, unchanged.
  return (
    <footer className="bg-strato-dark text-white py-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center mb-4">
              <img src={STRATOLOGODARK} alt="STRATO" className="h-10 mr-3" />
              <span className="sr-only">STRATO</span>
            </div>
            <p className="text-muted-foreground text-sm">
              Where Stability Meets Opportunity. Easily earn on vaulted gold, silver & crypto.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border text-sm text-muted-foreground">
          <div className="flex flex-col md:flex-row justify-between">
            <p>&copy; {new Date().getFullYear()} BlockApps Inc. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
