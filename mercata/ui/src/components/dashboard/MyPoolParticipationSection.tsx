import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatUnits } from "ethers";

export default function MyPoolParticipationSection({ liquidityInfo, loadingLiquidity, lpTokens, loadingLpTokens }: any) {

  const formatBalance = (balance: any) =>
    balance ? Number(formatUnits(balance, 18)).toFixed(2) : "0.00";

  
  const formatValue = (rawBalance: any, price: any): string => {
    if (!rawBalance || !price) return "0.00";

    const balance = parseFloat(formatUnits(rawBalance, 18));
    const value = balance * parseFloat(price);

    return value.toFixed(2);
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

        {loadingLiquidity || loadingLpTokens ? (
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
            <span className="text-sm text-gray-600">Loading...</span>
          </div>
        ) : (
          <>
            {/* Lending Pool Row */}
            {liquidityInfo?.withdrawable ? (
              <div className="grid grid-cols-3 items-center bg-gray-50 px-4 py-3 rounded-md mb-2">
                <div className="font-semibold text-gray-700">{liquidityInfo.withdrawable._name}</div>
                <div className="text-center font-medium text-gray-900">
                  {/* {formatUnits(liquidityInfo?.withdrawable?.userBalance || 0, 18)} */}
                  {liquidityInfo?.withdrawable?.userBalance
                      ? formatBalance(liquidityInfo?.withdrawable?.userBalance)
                      : "0.00"}
                </div>
                <div className="text-right font-semibold text-gray-900">
                  {liquidityInfo?.withdrawable?._totalSupply
                      ? formatValue(liquidityInfo?.withdrawable?.userBalance,liquidityInfo?.withdrawable?.price)
                      : "0.00"}
                </div>
              </div>
            ) : null}

            {/* LP Token Rows */}
            {lpTokens.length > 0 ? (
              lpTokens.map((lpToken, idx) => (
                <div
                  key={lpToken?.lpToken?.address || idx}
                  className="grid grid-cols-3 items-center bg-gray-50 px-4 py-3 rounded-md mb-2"
                >
                  <div className="font-semibold text-gray-700">{lpToken.lpToken._name}</div>
                  <div className="text-center font-medium text-gray-900">
                    {lpToken?.lpToken?.balances[0]?.balance
                      ? formatBalance(lpToken?.lpToken?.balances[0]?.balance)
                      : "0.00"}
                  </div>
                  <div className="text-right font-semibold text-gray-900">
                    {lpToken?.lpToken?._totalSupply
                      ? formatValue(lpToken?.lpToken?.balances[0].balance,lpToken?.lpTokenPrice)
                      : "0.00"}
                  </div>
                </div>
              ))
            ) : !liquidityInfo?.withdrawable && Array.isArray(lpTokens) && lpTokens.length > 0 ? (
              <div className="p-2 flex justify-center">No data to show</div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
