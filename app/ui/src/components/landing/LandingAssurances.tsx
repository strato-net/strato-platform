import { Check } from "lucide-react";
import type { LandingAssurances as Assurances } from "@/config/landing/types";
import { Section } from "./primitives";

const LandingAssurances = ({ assurances }: { assurances: Assurances }) => (
  <Section className="py-0 text-center">
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
      {assurances.items.map((item) => (
        <span key={item} className="inline-flex items-center gap-2 text-xs font-medium">
          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
          {item}
        </span>
      ))}
    </div>
    <p className="mx-auto mt-4 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
      {assurances.disclaimer}
    </p>
  </Section>
);

export default LandingAssurances;
