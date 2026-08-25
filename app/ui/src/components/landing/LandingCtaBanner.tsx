import type { ProductLandingConfig } from "@/config/landing/types";
import LandingConnectButton from "./LandingConnectButton";
import { Eyebrow, Section } from "./primitives";

interface LandingCtaBannerProps {
  banner: ProductLandingConfig["ctaBanner"];
  appPath: string;
  connectedLabel: string;
  slug: string;
}

const LandingCtaBanner = ({ banner, appPath, connectedLabel, slug }: LandingCtaBannerProps) => (
  <Section>
    <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-strato-blue p-8 dark:bg-strato-dark sm:flex-row sm:items-center">
      <div>
        <Eyebrow className="text-white/50">{banner.eyebrow}</Eyebrow>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">{banner.title}</h2>
        <p className="mt-2 text-sm text-white/70">{banner.body}</p>
      </div>
      <LandingConnectButton
        appPath={appPath}
        connectedLabel={connectedLabel}
        slug={slug}
        placement="cta_banner"
        className="w-full shrink-0 bg-white text-strato-blue hover:bg-white/90 sm:w-auto"
      />
    </div>
  </Section>
);

export default LandingCtaBanner;
