import type { LandingAccent, ProductLandingConfig } from "@/config/landing/types";
import { ACCENTS } from "./accents";
import { Eyebrow, Section } from "./primitives";

interface LandingHeroProps {
  hero: ProductLandingConfig["hero"];
  accent: LandingAccent;
}

const LandingHero = ({ hero, accent }: LandingHeroProps) => {
  const tone = ACCENTS[accent];
  const Icon = hero.icon;

  return (
    <Section className="pb-8 pt-28 sm:pt-32 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Two-tone brand ring around the product icon, as drawn in the mockups. */}
      <div
        className="mx-auto h-16 w-16 rounded-full p-[4px] shadow-sm"
        style={{ background: tone.ring }}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full bg-white dark:bg-strato-dark">
          <Icon className="h-6 w-6 text-strato-blue dark:text-white" aria-hidden="true" />
        </div>
      </div>

      <Eyebrow className={`mt-5 ${tone.eyebrow}`}>{hero.eyebrow}</Eyebrow>

      <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold tracking-tight text-strato-blue dark:text-white sm:text-5xl">
        {hero.headline}
      </h1>

      <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">{hero.subhead}</p>
    </Section>
  );
};

export default LandingHero;
