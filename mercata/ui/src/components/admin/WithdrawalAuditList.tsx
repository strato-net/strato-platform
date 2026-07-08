import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  WithdrawalAuditListItem,
  WithdrawalAuditListResponse,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditStatus,
} from "@mercata/shared-types";
import { api } from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatWeiToDecimalHP } from "@/utils/numberUtils";

const statusVariant = (status: WithdrawalAuditStatus): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "complete") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
};

const shortAddress = (value?: string) => {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const WithdrawalAuditList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithdrawalAuditListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusGroup, setStatusGroup] = useState<WithdrawalAuditStatusGroup>("initiated");

  const hasPending = useMemo(
    () => items.some(({ audit }) => audit.status === "queued" || audit.status === "running"),
    [items],
  );

  const loadAudits = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<WithdrawalAuditListResponse>(
        `/bridge/withdrawal-audits/recent?limit=10&statusGroup=${statusGroup}`,
      );
      setItems(data.data || []);
    } finally {
      setLoading(false);
    }
  }, [statusGroup]);

  useEffect(() => {
    loadAudits();
  }, [loadAudits]);

  useEffect(() => {
    if (!hasPending) return;
    const id = window.setInterval(loadAudits, 3000);
    return () => window.clearInterval(id);
  }, [hasPending, loadAudits]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdrawal Reviews</CardTitle>
        <CardDescription>
          Last 10 withdrawal requests with backend WAS trace status. Max trace depth is 5 for this POC.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex justify-end">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs value={statusGroup} onValueChange={(value) => setStatusGroup(value as WithdrawalAuditStatusGroup)}>
              <TabsList>
                <TabsTrigger value="initiated">Initiated</TabsTrigger>
                <TabsTrigger value="pending-review">Pending Review</TabsTrigger>
                <TabsTrigger value="complete">Complete</TabsTrigger>
                <TabsTrigger value="aborted">Aborted</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" onClick={loadAudits} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Route</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Audit</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(({ withdrawal, audit }) => (
              <TableRow key={`${withdrawal.routeType}-${withdrawal.withdrawalId}`}>
                <TableCell className="capitalize">{withdrawal.routeType}</TableCell>
                <TableCell>{withdrawal.withdrawalId}</TableCell>
                <TableCell>{shortAddress(withdrawal.stratoSender)}</TableCell>
                <TableCell>
                  {formatWeiToDecimalHP(withdrawal.stratoTokenAmount || "0", 18)}
                </TableCell>
                <TableCell>{shortAddress(withdrawal.externalRecipient)}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(audit.status)}>{audit.status}</Badge>
                </TableCell>
                <TableCell>{audit.decision || "-"}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(
                        `/dashboard/admin/withdrawal-audits/${withdrawal.routeType}/${withdrawal.withdrawalId}`,
                      )
                    }
                  >
                    View Summary
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  {loading ? "Loading withdrawal audits..." : "No withdrawals found."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default WithdrawalAuditList;
