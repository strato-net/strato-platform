import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "@/lib/axios";
import { TokenApyEntry } from "@mercata/shared-types";

interface EarnContextType {
  tokenApys: TokenApyEntry[];
  tokenApysLoaded: boolean;
}

const EarnContext = createContext<EarnContextType | undefined>(undefined);

export const EarnProvider = ({ children }: { children: ReactNode }) => {
  const [tokenApys, setTokenApys] = useState<TokenApyEntry[]>([]);
  const [tokenApysLoaded, setTokenApysLoaded] = useState(false);

  useEffect(() => {
    api.get<TokenApyEntry[]>("/earn/token-apys")
      .then(({ data }) => { setTokenApys(data || []); setTokenApysLoaded(true); })
      .catch(() => { setTokenApys([]); setTokenApysLoaded(true); });
  }, []);

  return (
    <EarnContext.Provider value={{ tokenApys, tokenApysLoaded }}>
      {children}
    </EarnContext.Provider>
  );
};

export const useEarnContext = (): EarnContextType => {
  const context = useContext(EarnContext);
  if (!context) throw new Error("useEarnContext must be used within an EarnProvider");
  return context;
};
