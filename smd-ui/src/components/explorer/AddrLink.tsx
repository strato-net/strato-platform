import { Link } from "react-router-dom";
import { shortenHex } from "@/lib/utils";

/** Renders an address as a link to its detail page (shortened, monospace-friendly). */
export function AddrLink({ address, full }: { address?: string | null; full?: boolean }) {
  if (!address) return <>—</>;
  return (
    <Link to={`/explorer/accounts/${address}`} className="text-primary hover:underline">
      {full ? address : shortenHex(address)}
    </Link>
  );
}
