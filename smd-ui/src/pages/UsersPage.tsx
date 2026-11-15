import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { AddrLink } from "@/components/explorer/AddrLink";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsers } from "@/services/accounts";

export default function UsersPage() {
  const { data: users, isLoading } = useUsers();

  return (
    <div className="space-y-6">
      <Link to="/accounts" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to Accounts
      </Link>
      <PageHeader
        title="All User wallets"
        description="Registered User wallets on this STRATO network."
      />
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((user) => (
                  <TableRow key={user.address || user.username}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <AddrLink address={user.address} full />
                    </TableCell>
                  </TableRow>
                ))}
                {!users?.length ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No User wallets found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
