import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSocketRoom } from "@/hooks/useSocketRoom";
import { ROOMS } from "@/lib/socket";

interface Peer {
  ip?: string;
  nodeId?: string;
  enode?: string;
}

export function PeersCard() {
  const peers = useSocketRoom<Record<string, Peer>>(ROOMS.GET_PEERS, {});
  const entries = Object.entries(peers || {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4" /> Peers ({entries.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connected peers.</p>
        ) : (
          <ScrollArea className="h-48 pr-2">
            <ul className="space-y-1">
              {entries.map(([ip, peer]) => (
                <li key={ip} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="font-mono">{peer.ip || ip}</div>
                  {peer.nodeId ? (
                    <div className="truncate font-mono text-xs text-muted-foreground">{peer.nodeId}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
