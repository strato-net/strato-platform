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
      <div
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-4 ring-inset ${tone.badge}`}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>

      <Eyebrow className="mt-4 text-muted-foreground">{hero.eyebrow}</Eyebrow>

      <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold tracking-tight text-strato-blue dark:text-white sm:text-5xl">
        {hero.headline}
      </h1>

      <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">{hero.subhead}</p>
    </Section>
  );
};

export default LandingHero;
