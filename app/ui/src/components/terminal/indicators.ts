// ============================================================================
// CHART INDICATORS
// Each is computed from the candles' closes and gives one value per candle,
// null until it has enough history.
// ============================================================================

export type IndicatorValues = (number | null)[];

/** Simple moving average */
export const sma = (values: number[], period: number): IndicatorValues => {
  let sum = 0;
  return values.map((value, i) => {
    sum += value - (i >= period ? values[i - period] : 0);
    return i >= period - 1 ? sum / period : null;
  });
};

/** Exponential moving average, started from the simple average of the first `period` values */
export const ema = (values: number[], period: number): IndicatorValues => {
  const weight = 2 / (period + 1);
  let sum = 0;
  let average: number | null = null;
  return values.map((value, i) => {
    if (i < period) {
      sum += value;
      average = i === period - 1 ? sum / period : null;
    } else {
      average = value * weight + average! * (1 - weight);
    }
    return average;
  });
};

/** A moving average with bands `width` standard deviations either side of it */
export const bollinger = (values: number[], period = 20, width = 2) => {
  const middle = sma(values, period);
  const band = (sign: 1 | -1): IndicatorValues =>
    middle.map((mean, i) => {
      if (mean === null) return null;
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
      return mean + sign * width * Math.sqrt(variance / period);
    });
  return { upper: band(1), middle, lower: band(-1) };
};

/** Relative strength index (Wilder's smoothing), 0–100; 50 while the price has not moved */
export const rsi = (values: number[], period = 14): IndicatorValues => {
  let gain = 0;
  let loss = 0;
  return values.map((value, i) => {
    if (i === 0) return null;
    const change = value - values[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
      if (i < period) return null;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  });
};

/** MACD: the gap between a fast and a slow EMA, its own EMA (signal), and their difference */
export const macd = (values: number[], fast = 12, slow = 26, signalPeriod = 9) => {
  const fastAverage = ema(values, fast);
  const line = ema(values, slow).map((slowAverage, i) => (slowAverage === null ? null : fastAverage[i]! - slowAverage));
  const start = line.findIndex((value) => value !== null);
  const smoothed = start < 0 ? [] : ema(line.slice(start) as number[], signalPeriod);
  const signal = line.map((_, i) => (start < 0 || i < start ? null : smoothed[i - start]));
  const histogram = line.map((value, i) => (value === null || signal[i] === null ? null : value - signal[i]!));
  return { line, signal, histogram };
};

export interface IndicatorPlot {
  /** theme token of the plot's color; a histogram is colored by its sign instead */
  color?: string;
  dashed?: boolean;
  thin?: boolean;
  histogram?: boolean;
  values: IndicatorValues;
}

export interface Indicator {
  id: string;
  label: string;
  /** drawn over the price; otherwise in a pane of its own */
  overlay: boolean;
  /** fixed value range and guide levels of an indicator's own pane */
  range?: [number, number];
  levels?: number[];
  plots: (closes: number[]) => IndicatorPlot[];
}

// Color is the average's speed (fast, medium, slow), the dash is its kind (simple, exponential):
// only three hues stay apart on one pane for every kind of color vision.
export const INDICATORS: Indicator[] = [
  { id: "ma20", label: "MA 20", overlay: true, plots: (c) => [{ color: "series-1", values: sma(c, 20) }] },
  { id: "ma50", label: "MA 50", overlay: true, plots: (c) => [{ color: "series-2", values: sma(c, 50) }] },
  { id: "ma200", label: "MA 200", overlay: true, plots: (c) => [{ color: "series-3", values: sma(c, 200) }] },
  { id: "ema12", label: "EMA 12", overlay: true, plots: (c) => [{ color: "series-1", dashed: true, values: ema(c, 12) }] },
  { id: "ema26", label: "EMA 26", overlay: true, plots: (c) => [{ color: "series-2", dashed: true, values: ema(c, 26) }] },
  {
    id: "bb",
    label: "Bollinger 20, 2",
    overlay: true,
    plots: (c) => {
      const { upper, middle, lower } = bollinger(c);
      return [upper, middle, lower].map((values) => ({ color: "muted-foreground", thin: true, values }));
    },
  },
  {
    id: "rsi",
    label: "RSI 14",
    overlay: false,
    range: [0, 100],
    levels: [30, 70],
    plots: (c) => [{ color: "series-4", values: rsi(c) }],
  },
  {
    id: "macd",
    label: "MACD 12, 26, 9",
    overlay: false,
    plots: (c) => {
      const { line, signal, histogram } = macd(c);
      return [{ histogram: true, values: histogram }, { color: "series-1", values: line }, { color: "series-2", values: signal }];
    },
  },
];
