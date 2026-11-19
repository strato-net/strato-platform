import { useState } from "react";

interface Tab {
  name: string;
  content: React.ReactNode;
}

/** Tabbed panels that crossfade: every panel stays mounted and only the active one shows. */
export const Tabs = ({ tabs }: { tabs: Tab[] }) => {
  const [active, setActive] = useState(tabs[0].name);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-border px-3 py-1.5 text-sm">
        {tabs.map(({ name }) => (
          <button
            key={name}
            onClick={() => setActive(name)}
            className={`rounded px-2 py-0.5 ${
              name === active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map(({ name, content }) => (
          <div
            key={name}
            aria-hidden={name !== active}
            className={`absolute inset-0 overflow-y-auto transition-opacity duration-200 ${
              name === active ? "" : "pointer-events-none opacity-0"
            }`}
          >
            {content}
          </div>
        ))}
      </div>
    </div>
  );
};
