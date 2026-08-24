import STRATOLOGODARK from "@/assets/strato-dark.png";
import { EXTERNAL_LINKS, TWITTER_HANDLE } from "@/config/externalLinks";
import type { FooterColumn } from "@/config/landing/types";

interface SiteFooterProps {
  /**
   * Link columns to show. Omitted on the home page, which keeps the original
   * logo-and-tagline-only footer; the product landing pages pass their own.
   */
  columns?: FooterColumn[];
}

const SiteFooter = ({ columns }: SiteFooterProps) => (
  <footer className="bg-strato-dark text-white py-16">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="flex items-center mb-4">
            <img src={STRATOLOGODARK} alt="STRATO" className="h-10 mr-3" />
            <span className="sr-only">STRATO</span>
          </div>
          <p className="text-muted-foreground text-sm">
            {columns
              ? "DeFi powered by precious metals."
              : "Where Stability Meets Opportunity. Easily earn on vaulted gold, silver & crypto."}
          </p>
          {columns && (
            <a
              href={EXTERNAL_LINKS.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-xs font-semibold text-strato-lightblue hover:underline"
            >
              {TWITTER_HANDLE}
            </a>
          )}
        </div>

        {columns && (
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:col-span-2">
            {columns.map((column) => (
              <div key={column.heading}>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-4">
                  {column.heading}
                </h3>
                <ul className="space-y-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={link.href.startsWith("http") ? "_blank" : undefined}
                        rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="text-sm text-muted-foreground hover:text-white"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-12 pt-8 border-t border-border text-sm text-muted-foreground">
        <div className="flex flex-col md:flex-row justify-between">
          <p>&copy; {new Date().getFullYear()} BlockApps Inc. All rights reserved.</p>
        </div>
      </div>
    </div>
  </footer>
);

export default SiteFooter;
