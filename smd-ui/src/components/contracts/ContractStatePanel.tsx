import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useContractState,
  useContractInfo,
  isFunctionValue,
  functionArgs,
  isPayable,
} from "@/services/contracts";
import { useAccountDetail } from "@/services/accounts";
import { MethodCaller } from "@/components/contracts/MethodCaller";

/**
 * Renders a contract instance's current state (variables) and its functions as
 * callable buttons (opening the MethodCaller modal). Shared by the Contracts
 * registry and the address detail page.
 */
export function ContractStatePanel({ name, address }: { name: string; address: string }) {
  const { data: state, isLoading } = useContractState(name, address);
  const { data: info } = useContractInfo(name, address);
  const { data: account } = useAccountDetail(address);

  const entries = Object.entries(state ?? {}).filter(([k]) => k !== "constructor");
  const vars = entries.filter(([, v]) => !isFunctionValue(v));
  const funcs = entries.filter(([, v]) => isFunctionValue(v));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="text-base">{name}</CardTitle>
        <span className="font-mono text-xs text-muted-foreground">
          Contract Balance: {account?.balance ?? "0"} wei
        </span>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <th className="w-1/3 px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {vars.map(([k, v]) => (
                  <tr key={k} className="border-t border-border align-top">
                    <td className="break-words px-3 py-2 font-mono text-xs">{k}</td>
                    <td className="px-3 py-2">
                      <div className="max-h-48 overflow-auto whitespace-pre font-mono text-xs">
                        {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
                      </div>
                    </td>
                  </tr>
                ))}
                {funcs.map(([k, v]) => {
                  const sig = typeof v === "string" ? v.replace(/^function\s*/, "") : "";
                  return (
                    <tr key={k} className="border-t border-border align-middle">
                      <td className="break-words px-3 py-2">
                        <MethodCaller
                          contractName={name}
                          contractAddress={address}
                          method={k}
                          args={functionArgs(info, k)}
                          payable={isPayable(info, k)}
                          signature={sig}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="overflow-x-auto whitespace-pre font-mono text-xs text-muted-foreground">
                          {String(v)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                      No state.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
