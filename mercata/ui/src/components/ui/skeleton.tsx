import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

// Specific skeleton components for different use cases
const SkeletonCard = () => (
  <div className="bg-white rounded-lg p-6 animate-pulse">
    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
    <div className="h-8 bg-gray-200 rounded w-1/2"></div>
  </div>
);

const SkeletonTable = () => (
  <div className="bg-white rounded-lg p-6 animate-pulse">
    <div className="space-y-3">
      {[1,2,3,4,5].map(i => (
        <div key={i} className="h-4 bg-gray-200 rounded"></div>
      ))}
    </div>
  </div>
);

const SkeletonChart = () => (
  <div className="bg-white rounded-lg p-6 animate-pulse">
    <div className="h-64 bg-gray-200 rounded"></div>
  </div>
);

const SkeletonList = () => (
  <div className="space-y-4">
    {[1,2,3].map(i => (
      <div key={i} className="bg-white rounded-lg p-4 animate-pulse">
        <div className="flex items-center space-x-4">
          <div className="h-12 w-12 bg-gray-200 rounded-full"></div>
          <div className="space-y-2 flex-1">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
          <div className="h-8 bg-gray-200 rounded w-20"></div>
        </div>
      </div>
    ))}
  </div>
);

const DashboardSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {[1,2,3].map(i => <SkeletonCard key={i} />)}
    </div>
    <SkeletonTable />
    <SkeletonChart />
  </div>
);

export { 
  Skeleton, 
  SkeletonCard, 
  SkeletonTable, 
  SkeletonChart, 
  SkeletonList, 
  DashboardSkeleton 
}