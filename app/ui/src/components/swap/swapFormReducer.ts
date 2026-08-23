import { SwapToken } from "@/interface";

/**
 * Swap form state, Uniswap-style: the user types one side (the independent
 * field); the other side is always derived from the active quote. Selecting a
 * pool card manually pins it until the pair changes.
 */
export type IndependentField = "input" | "output";

export interface SlippageSetting {
  mode: "auto" | "manual";
  /** manual tolerance in percent (0.1 - 10) */
  value: number;
}

export interface TradeFormState {
  tokenIn?: SwapToken;
  tokenOut?: SwapToken;
  /** raw text of the field the user last typed in */
  typedValue: string;
  independentField: IndependentField;
  /** manual pool card selection; null = follow the best-rate pool */
  selectedPoolAddress: string | null;
  slippage: SlippageSetting;
}

export const MANUAL_SLIPPAGE_DEFAULT = 0.5;

export const initialTradeFormState: TradeFormState = {
  typedValue: "",
  independentField: "input",
  selectedPoolAddress: null,
  slippage: { mode: "auto", value: MANUAL_SLIPPAGE_DEFAULT },
};

export type TradeFormAction =
  | { type: "SELECT_TOKEN_IN"; token: SwapToken }
  | { type: "SELECT_TOKEN_OUT"; token: SwapToken }
  | { type: "TYPE_AMOUNT"; field: IndependentField; value: string }
  | { type: "SWITCH_TOKENS" }
  | { type: "SELECT_POOL"; poolAddress: string | null }
  | { type: "SET_SLIPPAGE"; slippage: SlippageSetting }
  | { type: "RESET_AMOUNTS" };

export function tradeFormReducer(state: TradeFormState, action: TradeFormAction): TradeFormState {
  switch (action.type) {
    case "SELECT_TOKEN_IN":
      if (action.token.address === state.tokenOut?.address) return state;
      // a new pair invalidates the manual pool choice
      return { ...state, tokenIn: action.token, selectedPoolAddress: null };
    case "SELECT_TOKEN_OUT":
      if (action.token.address === state.tokenIn?.address) return state;
      return { ...state, tokenOut: action.token, selectedPoolAddress: null };
    case "TYPE_AMOUNT":
      return { ...state, typedValue: action.value, independentField: action.field };
    case "SWITCH_TOKENS":
      // the typed amount follows its token to the other side
      return {
        ...state,
        tokenIn: state.tokenOut,
        tokenOut: state.tokenIn,
        independentField: state.independentField === "input" ? "output" : "input",
        selectedPoolAddress: null,
      };
    case "SELECT_POOL":
      return { ...state, selectedPoolAddress: action.poolAddress };
    case "SET_SLIPPAGE":
      return { ...state, slippage: action.slippage };
    case "RESET_AMOUNTS":
      return { ...state, typedValue: "", independentField: "input" };
    default:
      return state;
  }
}
