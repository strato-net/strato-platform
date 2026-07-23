import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import CreateLinkDialog from '@/components/tracking/CreateLinkDialog';
import TrackingLinksTable from '@/components/tracking/TrackingLinksTable';
import { useTrackingAccess, useTrackingData } from '@/hooks/useTracking';

const NoAccessCard = () => (
  <Card className="mx-auto max-w-md">
    <CardContent className="p-8 text-center">
      <p className="text-sm text-muted-foreground">
        You don't have access to tracking links. Contact an administrator to be added.
      </p>
    </CardContent>
  </Card>
);

const TableSkeleton = () => (
  <div className="space-y-2">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-12 w-full" />
    ))}
  </div>
);

const TrackingDashboard = () => {
  const navigate = useNavigate();
  const { authorized, isLoading: accessLoading } = useTrackingAccess();
  const data = useTrackingData(authorized);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            <div className="flex items-center gap-2 md:space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-1 md:space-x-2 px-2 md:px-3"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="text-xs md:text-sm">Back</span>
              </Button>
              <div className="flex items-center gap-1 md:space-x-2">
                <Link2 className="h-5 w-5 md:h-6 md:w-6 text-strato-blue" />
                <h1 className="text-base md:text-xl font-bold whitespace-nowrap">Tracking Links</h1>
              </div>
            </div>
            {authorized && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                New Tracking Link
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        {accessLoading ? (
          <TableSkeleton />
        ) : !authorized ? (
          <NoAccessCard />
        ) : data.isError ? (
          <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
            Failed to load tracking links.{' '}
            <button className="underline" onClick={() => data.refetch()}>
              Retry
            </button>
          </div>
        ) : data.isPending || !data.computed ? (
          <TableSkeleton />
        ) : (
          <TrackingLinksTable links={data.computed.linkSummaries()} />
        )}
      </div>

      <CreateLinkDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
};

export default TrackingDashboard;
