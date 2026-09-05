import { cn } from "@/lib/utils";

/** Page-width wrapper. Matches the container convention used across the app. */
export const Section = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <section className={cn("py-8 sm:py-10", className)}>
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">{children}</div>
  </section>
);

/** The white bordered card the mockups use for every tile. */
export const Tile = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={cn("rounded-2xl border border-border bg-card p-6", className)}>{children}</div>
);

/** Small uppercase label above a heading. */
export const Eyebrow = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <p className={cn("text-[11px] font-semibold uppercase tracking-[0.18em]", className)}>
    {children}
  </p>
);

/** Section heading, navy in light mode as drawn. */
export const Heading = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <h2
    className={cn(
      "text-2xl sm:text-3xl font-bold tracking-tight text-strato-blue dark:text-white",
      className,
    )}
  >
    {children}
  </h2>
);
