import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function MyPoolParticipationSection() {
  const lendingPool = {
    token: "mUSDC",
    balance: "2,500",
    value: "$2,500.00",
  };

  const swapLp = {
    token: "ETH/USDC LP",
    balance: "120",
    value: "$3,750.00",
  };

  return (
    <Card className="rounded-2xl shadow-sm w-full mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-semibold text-gray-800">
          My Pool Participation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Header Row */}
        <div className="grid grid-cols-3 px-4 text-sm text-gray-500 font-medium">
          <div>Token</div>
          <div className="text-center">Balance</div>
          <div className="text-right">Value</div>
        </div>

        {/* Lending Pool Row */}
        <div className="grid grid-cols-3 items-center bg-gray-50 px-4 py-3 rounded-md">
          <div className="font-semibold text-gray-700">mUSDC</div>
          <div className="text-center font-medium text-gray-900">2,500</div>
          <div className="text-right font-semibold text-gray-900">$2,500.00</div>
        </div>

        {/* Swap LP Tokens Row */}
        <div className="grid grid-cols-3 items-center bg-gray-50 px-4 py-3 rounded-md">
          <div className="font-semibold text-gray-700">ETH/USDC LP</div>
          <div className="text-center font-medium text-gray-900">120</div>
          <div className="text-right font-semibold text-gray-900">$3,750.00</div>
        </div>
      </CardContent>
    </Card>
  );
}
