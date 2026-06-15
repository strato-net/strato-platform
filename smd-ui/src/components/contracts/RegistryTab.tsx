import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useContracts, useContractAddresses, useContractXabi } from "@/services/contracts";
import { useUser } from "@/context/UserContext";
import { MethodCaller } from "@/components/contracts/MethodCaller";
import { shortenHex } from "@/lib/utils";

export function RegistryTab() {
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const { userAddress } = useUser();
  const { data: contracts, isLoading } = useContracts(search);
  const { data: addresses } = useContractAddresses(selectedName);
  const { data: xabi } = useContractXabi(selectedName, selectedAddress);

  const selectName = (name: string) => {
    setSelectedName(name);
    setSelectedAddress(null);
  };

  const vars = xabi?.xabi?.vars ?? {};
  const funcs = xabi?.xabi?.funcs ?? {};

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registry</CardTitle>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ) : (
            <ScrollArea className="h-[26rem] pr-2">
              <ul className="space-y-1">
                {(contracts ?? []).map((name) => (
                  <li key={name}>
                    <button
                      onClick={() => selectName(name)}
                      className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        selectedName === name
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/60"
                      }`}
                    >
                      {name}
                    </button>
                  </li>
                ))}
                {(contracts ?? []).length === 0 ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">No contracts found.</li>
                ) : null}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selectedName ?? "Select a contract"}
          </CardTitle>
          {selectedName && addresses && addresses.length > 0 ? (
            <Select value={selectedAddress ?? ""} onValueChange={setSelectedAddress}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Select an instance address" />
              </SelectTrigger>
              <SelectContent>
                {addresses.map((addr) => (
                  <SelectItem key={addr} value={addr} className="font-mono text-xs">
                    {shortenHex(addr, 10, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardHeader>
        <CardContent>
          {!selectedAddress ? (
            <p className="text-sm text-muted-foreground">
              Choose a contract and instance to inspect its state and methods.
            </p>
          ) : (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-semibold">State variables</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.keys(vars).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No state variables.</p>
                  ) : (
                    Object.entries(vars).map(([k, v]) => (
                      <div key={k} className="rounded-md border border-border p-2 text-sm">
                        <div className="font-mono text-xs text-muted-foreground">{k}</div>
                        <div className="break-all">{JSON.stringify((v as any)?.value ?? v)}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Methods</h3>
                {!userAddress ? (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Connect a wallet (STRATO or external) to invoke write methods.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Object.keys(funcs).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No methods.</p>
                  ) : (
                    Object.entries(funcs).map(([name, def]) => (
                      <MethodCaller
                        key={name}
                        contractName={selectedName!}
                        contractAddress={selectedAddress}
                        method={name}
                        args={(def as any)?.args ?? {}}
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
