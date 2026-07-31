import { Slider } from "@/components/ui/slider";
import { SlippageSetting, MANUAL_SLIPPAGE_DEFAULT } from "@/components/swap/swapFormReducer";

// ============================================================================
// SLIPPAGE CONTROL
// Auto mode derives the tolerance from the active quote's price impact
// (floored at 0.5%, capped at 5%); Manual keeps the 0.1-10% slider.
// ============================================================================
interface SlippageControlProps {
  slippage: SlippageSetting;
  /** the effective tolerance in percent (auto-derived or the manual value) */
  effectivePercent: number;
  onChange: (slippage: SlippageSetting) => void;
  disabled?: boolean;
}

export const SlippageControl = ({ slippage, effectivePercent, onChange, disabled = false }: SlippageControlProps) => {
  const isAuto = slippage.mode === "auto";
  const isHighSlippage = effectivePercent > 5;
  const isLowSlippage = !isAuto && effectivePercent < 0.5;
  const slippageClass = isHighSlippage || isLowSlippage
    ? 'border-yellow-400 text-yellow-600'
    : 'border-border text-foreground';

  return (
    <div className="flex flex-col gap-1 mt-2">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm mb-1">
        <span className="text-muted-foreground">Max slippage</span>
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            className={`px-2 md:px-3 py-1 rounded-full text-xs font-medium border ${
              isAuto ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'
              } border-border ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => { if (!disabled) onChange({ mode: "auto", value: slippage.value }); }}
            disabled={disabled}
          >
            Auto
          </button>
          <button
            className={`px-2 md:px-3 py-1 rounded-full text-xs font-medium border ${
              !isAuto ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'
              } border-border ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => { if (!disabled) onChange({ mode: "manual", value: slippage.value || MANUAL_SLIPPAGE_DEFAULT }); }}
            disabled={disabled}
          >
            Manual
          </button>
          <span className={`ml-1 md:ml-2 px-2 md:px-3 py-1 rounded-full border text-xs font-semibold ${slippageClass}`}>
            {isAuto ? `Auto · ${effectivePercent.toFixed(2)}%` : `${effectivePercent}%`}
          </span>
        </div>
      </div>
      {!isAuto && (
        <div className="flex items-center gap-2 mt-2">
          <Slider
            value={[slippage.value]}
            min={0.1}
            max={10}
            step={0.1}
            onValueChange={(value) => { if (!disabled) onChange({ mode: "manual", value: value[0] }); }}
            className="w-full"
            disabled={disabled}
          />
        </div>
      )}
      {isHighSlippage && (
        <div className="text-xs text-yellow-600 mt-1 font-bold">⚠️ High slippage</div>
      )}
      {isLowSlippage && (
        <div className="text-xs text-yellow-600 mt-1 font-bold">⚠️ Low slippage</div>
      )}
    </div>
  );
};
