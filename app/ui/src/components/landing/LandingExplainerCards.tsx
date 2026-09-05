import type { LandingAccent, LandingExplainer } from "@/config/landing/types";
import { ACCENTS } from "./accents";
import { Eyebrow, Heading, Tile } from "./primitives";

interface LandingExplainerCardsProps {
  cards: LandingExplainer[];
  accent: LandingAccent;
}

/** Two-up explainer cards on the lavender band. */
const LandingExplainerCards = ({ cards, accent }: LandingExplainerCardsProps) => {
  const tone = ACCENTS[accent];

  return (
    <section className="bg-[#E8EBF7] py-16 dark:bg-strato-dark/40">
      <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Tile key={card.title} className="p-8">
                <div className="flex items-center gap-3">
                  {card.images?.length ? (
                    <span className="flex shrink-0">
                      {card.images.map((src, i) => (
                        <img
                          key={src}
                          src={src}
                          alt=""
                          className={`h-9 w-9 ${i > 0 ? "-ml-3" : "relative z-10"}`}
                        />
                      ))}
                    </span>
                  ) : Icon ? (
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${tone.badge}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  ) : null}
                  <Eyebrow className="text-muted-foreground">{card.tag}</Eyebrow>
                </div>
                <Heading className="mt-5">{card.title}</Heading>
                <p className="mt-3 text-sm text-muted-foreground">{card.body}</p>
                <a
                  href={card.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-block text-xs font-semibold text-strato-lightblue hover:underline"
                >
                  {card.link.label} &#8599;
                </a>
              </Tile>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default LandingExplainerCards;
