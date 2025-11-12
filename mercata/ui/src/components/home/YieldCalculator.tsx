import { useState } from 'react';
import { Calculator, TrendingUp } from 'lucide-react';

type AssetType = {
  name: string;
  apy: number;
  icon: string;
};

const ASSETS: AssetType[] = [
  { name: 'USDC', apy: 5.2, icon: '💵' },
  { name: 'Gold (XAUt)', apy: 4.8, icon: '🥇' },
  { name: 'Silver (XAGt)', apy: 4.5, icon: '🥈' },
  { name: 'ETH', apy: 6.3, icon: '💎' },
];

const TIME_PERIODS = [
  { label: '1 Month', months: 1 },
  { label: '6 Months', months: 6 },
  { label: '1 Year', months: 12 },
  { label: '2 Years', months: 24 },
];

const YieldCalculator = () => {
  const [amount, setAmount] = useState<string>('10000');
  const [selectedAsset, setSelectedAsset] = useState<AssetType>(ASSETS[0]);
  const [selectedPeriod, setSelectedPeriod] = useState(TIME_PERIODS[2]);

  const calculateYield = () => {
    const principal = parseFloat(amount) || 0;
    const years = selectedPeriod.months / 12;
    const rate = selectedAsset.apy / 100;

    // Simple interest calculation for display purposes
    const interest = principal * rate * years;
    const total = principal + interest;

    return {
      interest: interest.toFixed(2),
      total: total.toFixed(2),
    };
  };

  const results = calculateYield();

  return (
    <section className="py-20 bg-gradient-to-br from-gray-50 to-white">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[#f5a623] rounded-full mb-6">
              <Calculator className="w-8 h-8 text-[#001f5c]" />
            </div>
            <h2 className="text-4xl md:text-5xl font-bold text-[#001f5c] mb-4">
              Calculate Your Earnings
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              See how much you can earn by depositing your assets on Mercata. Choose your asset, enter an amount, and watch your potential earnings grow.
            </p>
          </div>

          {/* Calculator Card */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
            <div className="grid md:grid-cols-2 gap-0">
              {/* Input Section */}
              <div className="p-8 md:p-12 bg-gradient-to-br from-[#001f5c] to-[#003580]">
                <h3 className="text-2xl font-bold text-white mb-8">Your Investment</h3>

                {/* Amount Input */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 text-xl">
                      $
                    </span>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full pl-10 pr-4 py-4 bg-white/10 border-2 border-white/20 rounded-xl text-white text-xl font-semibold focus:outline-none focus:border-[#f5a623] transition-colors placeholder-gray-400"
                      placeholder="Enter amount"
                      min="0"
                    />
                  </div>
                </div>

                {/* Asset Selection */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Select Asset
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {ASSETS.map((asset) => (
                      <button
                        key={asset.name}
                        onClick={() => setSelectedAsset(asset)}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          selectedAsset.name === asset.name
                            ? 'bg-[#f5a623] border-[#f5a623] text-[#001f5c]'
                            : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                        }`}
                      >
                        <div className="text-2xl mb-1">{asset.icon}</div>
                        <div className="font-semibold text-sm">{asset.name}</div>
                        <div className="text-xs opacity-80">{asset.apy}% APY</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time Period */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Time Period
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {TIME_PERIODS.map((period) => (
                      <button
                        key={period.label}
                        onClick={() => setSelectedPeriod(period)}
                        className={`py-3 px-4 rounded-xl border-2 font-medium text-sm transition-all ${
                          selectedPeriod.label === period.label
                            ? 'bg-[#f5a623] border-[#f5a623] text-[#001f5c]'
                            : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                        }`}
                      >
                        {period.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Results Section */}
              <div className="p-8 md:p-12 bg-gradient-to-br from-gray-50 to-white flex flex-col justify-center">
                <div className="flex items-center mb-6">
                  <TrendingUp className="w-6 h-6 text-[#f5a623] mr-2" />
                  <h3 className="text-2xl font-bold text-[#001f5c]">Projected Earnings</h3>
                </div>

                <div className="space-y-6">
                  {/* Initial Investment */}
                  <div className="pb-4 border-b border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Initial Investment</div>
                    <div className="text-3xl font-bold text-[#001f5c]">
                      ${parseFloat(amount || '0').toLocaleString()}
                    </div>
                  </div>

                  {/* Interest Earned */}
                  <div className="pb-4 border-b border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Interest Earned</div>
                    <div className="text-3xl font-bold text-green-600">
                      +${parseFloat(results.interest).toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {selectedAsset.apy}% APY over {selectedPeriod.label.toLowerCase()}
                    </div>
                  </div>

                  {/* Total Value */}
                  <div className="bg-gradient-to-br from-[#f5a623]/10 to-[#f5a623]/5 rounded-xl p-6">
                    <div className="text-sm text-gray-700 mb-2 font-medium">Total Value</div>
                    <div className="text-4xl font-bold text-[#001f5c] mb-2">
                      ${parseFloat(results.total).toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">
                      After {selectedPeriod.label.toLowerCase()}
                    </div>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-xs text-gray-600 leading-relaxed">
                    <strong className="text-[#001f5c]">Note:</strong> These calculations are for illustrative purposes only. Actual returns may vary based on market conditions. APY rates are subject to change.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default YieldCalculator;
