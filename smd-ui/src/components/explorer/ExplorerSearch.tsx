import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { classifyQuery } from "@/services/explorer";

export function ExplorerSearch({ className }: { className?: string }) {
  const [term, setTerm] = useState("");
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = term.trim();
    if (!t) return;
    const kind = classifyQuery(t);
    if (kind === "block") navigate(`/explorer/blocks/${t}`);
    else if (kind === "hash") navigate(`/explorer/transactions/${t.startsWith("0x") ? t : `0x${t}`}`);
    else navigate(`/explorer/search?q=${encodeURIComponent(t)}`);
    setTerm("");
  };

  return (
    <form onSubmit={submit} className={className}>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="w-64 pl-8"
          placeholder="Block #, tx hash, or account"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
    </form>
  );
}
