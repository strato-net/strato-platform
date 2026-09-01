import type { LandingStat } from "@/config/landing/types";
import { Section, Tile } from "./primitives";

const LandingStatStrip = ({ stats }: { stats: LandingStat[] }) => (
  <Section className="py-0">
    <Tile className="mx-auto grid max-w-2xl grid-cols-1 gap-6 p-5 sm:grid-cols-3">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={
            i > 0 ? "text-center sm:border-l sm:border-border sm:pl-6" : "text-center"
          }
        >
          <p className="font-mono text-lg font-bold text-strato-blue dark:text-white">
            {stat.value}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{stat.label}</p>
        </div>
      ))}
    </Tile>
  </Section>
);

export default LandingStatStrip;
