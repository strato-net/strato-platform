import { useEffect, useMemo, useState } from "react";
import { Search, ChevronsUpDown, ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useContractGroups,
  useContractState,
  useContractInfo,
  isFunctionValue,
  functionArgs,
  isPayable,
} from "@/services/contracts";
import { useAccountDetail } from "@/services/accounts";
import { MethodCaller } from "@/components/contracts/MethodCaller";
import { cn } from "@/lib/utils";

const PAGE_LIMIT = 10;

interface Selected {
  name: string;
  address: string;
}

export function RegistryTab() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);

  const { data: groups, isLoading } = useContractGroups(search, PAGE_LIMIT, offset);

  // Auto-expand all groups while searching so matching instances are visible.
  useEffect(() => {
    if (search.trim()) {
      setExpanded(new Set((groups ?? []).map((g) => g.name)));
    } else {
      setExpanded(new Set());
    }
  }, [search, groups]);

  const totalInstances = useMemo(
    () => (groups ?? []).reduce((acc, g) => acc + g.addresses.length, 0),
    [groups]
  );

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const onSearch = (v: string) => {
    setSearch(v);
    setOffset(0);
    setSelected(null);
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-10 pl-9"
          placeholder="Search contracts by name or address"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Contracts + instances */}
        <div className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : (groups ?? []).length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No contracts found.
              </CardContent>
            </Card>
          ) : (
            (groups ?? []).map((g) => {
              const isOpen = expanded.has(g.name);
              return (
                <Card key={g.name}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                    <CardTitle className="text-base">{g.name}</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => toggle(g.name)} className="gap-1.5">
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                      {isOpen ? "Hide" : "Show"} Contracts
                    </Button>
                  </CardHeader>
                  {isOpen ? (
                    <CardContent className="pt-0">
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        Contract Address
                      </div>
                      <ul className="space-y-1">
                        {g.addresses.map((addr) => {
                          const isSel = selected?.name === g.name && selected?.address === addr;
                          return (
                            <li key={addr}>
                              <button
                                onClick={() => setSelected({ name: g.name, address: addr })}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left font-mono text-xs transition-colors",
                                  isSel
                                    ? "border-primary bg-accent text-accent-foreground"
                                    : "border-border hover:bg-accent/60"
                                )}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{addr}</span>
                              </button>
                            </li>
                          );
                        })}
                        {g.addresses.length === 0 ? (
                          <li className="px-2 py-1.5 text-sm text-muted-foreground">No instances</li>
                        ) : null}
                      </ul>
                    </CardContent>
                  ) : null}
                </Card>
              );
            })
          )}

          {/* Pagination */}
          {(groups ?? []).length > 0 || offset > 0 ? (
            <div className="flex items-center justify-between pt-1 text-sm">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_LIMIT))}
                className="gap-1.5"
              >
                <ArrowLeft className="h-4 w-4" /> Previous
              </Button>
              <span className="text-muted-foreground">
                Contracts {(groups ?? []).length === 0 ? 0 : offset + 1}-
                {offset + (groups ?? []).length} ({totalInstances} Total Instances)
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={(groups ?? []).length < PAGE_LIMIT}
                onClick={() => setOffset((o) => o + PAGE_LIMIT)}
                className="gap-1.5"
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>

        {/* Selected instance state + methods */}
        <div>
          {selected ? (
            <InstanceState key={`${selected.name}-${selected.address}`} {...selected} />
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Select a contract instance to view its state and methods.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function InstanceState({ name, address }: Selected) {
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
