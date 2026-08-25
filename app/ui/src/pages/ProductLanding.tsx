import { useEffect } from "react";
import Navbar from "@/components/Navbar";
import SiteFooter from "@/components/SiteFooter";
import LandingAssurances from "@/components/landing/LandingAssurances";
import LandingCtaBanner from "@/components/landing/LandingCtaBanner";
import LandingExplainerCards from "@/components/landing/LandingExplainerCards";
import LandingFeatureBand from "@/components/landing/LandingFeatureBand";
import LandingHero from "@/components/landing/LandingHero";
import LandingHighlightPanel from "@/components/landing/LandingHighlightPanel";
import LandingStatStrip from "@/components/landing/LandingStatStrip";
import LandingSteps from "@/components/landing/LandingSteps";
import { LANDING_CONFIGS } from "@/config/landing";
import { capture } from "@/lib/analytics";
import NotFound from "./NotFound";

/**
 * Single-product landing page (`/defi/*`). Every page shares this skeleton and
 * differs only by its config object, so all copy edits happen in
 * `src/config/landing/<slug>.ts`.
 */
const ProductLanding = ({ slug }: { slug: string }) => {
  const config = LANDING_CONFIGS[slug];

  useEffect(() => {
    if (!config) return;
    document.title = config.documentTitle;
    // Autocapture already records the URL, but a named event carrying the slug
    // is what makes the acquisition funnel buildable without regex filters.
    capture("landing_page_viewed", { slug });
  }, [config, slug]);

  if (!config) return <NotFound />;

  const connectedLabel = config.steps[config.steps.length - 1].cta;

  return (
    <div className="min-h-screen bg-white dark:bg-background">
      <Navbar variant="landing" />

      <main>
        <LandingHero hero={config.hero} accent={config.accent} />
        <LandingStatStrip stats={config.stats} />
        <LandingSteps steps={config.steps} appPath={config.appPath} slug={slug} />
        <LandingHighlightPanel highlight={config.highlight} accent={config.accent} />
        <LandingAssurances assurances={config.assurances} />

        {config.bands?.map((band) => <LandingFeatureBand key={band.title} band={band} />)}

        <LandingExplainerCards cards={config.explainers} accent={config.accent} />
        <LandingCtaBanner
          banner={config.ctaBanner}
          appPath={config.appPath}
          connectedLabel={connectedLabel}
          slug={slug}
        />
      </main>

      <SiteFooter />
    </div>
  );
};

export default ProductLanding;
