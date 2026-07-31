import { createContext, useContext, useReducer, ReactNode, Dispatch } from "react";
import {
  TradeFormState,
  TradeFormAction,
  tradeFormReducer,
  initialTradeFormState,
} from "@/components/swap/swapFormReducer";

/**
 * Trade-page-local form state (selected pair, typed amount, pool choice,
 * slippage). Provided by the Trade page only — the swap widget and the trade
 * history table are siblings and both need the selected pair.
 */
interface TradeFormContextValue {
  state: TradeFormState;
  dispatch: Dispatch<TradeFormAction>;
}

const TradeFormContext = createContext<TradeFormContextValue | undefined>(undefined);

export const TradeFormProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(tradeFormReducer, initialTradeFormState);
  return (
    <TradeFormContext.Provider value={{ state, dispatch }}>
      {children}
    </TradeFormContext.Provider>
  );
};

export const useTradeForm = (): TradeFormContextValue => {
  const context = useContext(TradeFormContext);
  if (!context) {
    throw new Error("useTradeForm must be used within a TradeFormProvider");
  }
  return context;
};
