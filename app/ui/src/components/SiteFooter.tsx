import STRATOLOGODARK from "@/assets/strato-dark.png";

/** Shared site footer used by the home page and the product landing pages. */
const SiteFooter = () => (
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

export default SiteFooter;
