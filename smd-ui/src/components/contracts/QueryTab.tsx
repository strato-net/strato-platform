import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { queryCirrus } from "@/services/contracts";

export function QueryTab() {
  const [table, setTable] = useState("");
  const [queryString, setQueryString] = useState("select=*&limit=25");
  const [results, setResults] = useState<any[] | null>(null);
  const [pending, setPending] = useState(false);

  const run = async () => {
    if (!table.trim()) {
      toast.error("Enter a contract / table name");
      return;
    }
    setPending(true);
    try {
      const data = await queryCirrus(table.trim(), queryString.trim());
      setResults(Array.isArray(data) ? data : [data]);
    } catch (err: any) {
      toast.error("Query failed", { description: err?.message });
      setResults(null);
    } finally {
      setPending(false);
    }
  };

  const columns = results && results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cirrus query</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="table">Table / contract</Label>
            <Input id="table" placeholder="e.g. MyContract" value={table} onChange={(e) => setTable(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qs">Query string</Label>
            <Input id="qs" placeholder="select=*&limit=25" value={queryString} onChange={(e) => setQueryString(e.target.value)} />
          </div>
          <Button onClick={run} disabled={pending}>
            {pending ? "Running…" : "Run"}
          </Button>
        </div>

        {results ? (
          results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows.</p>
          ) : (
            <div className="max-h-[28rem] w-full overflow-auto rounded-md border border-border">
              <table className="w-max min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {columns.map((c) => (
                        <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono">
                          {typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
