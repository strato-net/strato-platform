import React from 'react';

// Dashboard Components
export const LiquidityDepositModal = React.lazy(() => 
  import('@/components/dashboard/LiquidityDepositModal')
);

export const LendingPoolSection = React.lazy(() => 
  import('@/components/dashboard/LendingPoolSection')
);

export const ActivityFeedList = React.lazy(() => 
  import('@/components/dashboard/ActivityFeedList')
);

export const AssetsList = React.lazy(() => 
  import('@/components/dashboard/AssetsList')
);

export const LiquidationsSection = React.lazy(() => 
  import('@/components/dashboard/LiquidationsSection')
);

export const LiquidityWithdrawModal = React.lazy(() => 
  import('@/components/dashboard/LiquidityWithdrawModal')
);

// Swap Components
export const SwapWidget = React.lazy(() => 
  import('@/components/swap/SwapWidget')
);

export const SwapHistory = React.lazy(() => 
  import('@/components/swap/SwapHistory')
);

// Bridge Components
export const BridgeIn = React.lazy(() => 
  import('@/components/bridge/BridgeIn')
);

export const BridgeOut = React.lazy(() => 
  import('@/components/bridge/BridgeOut')
);

export const BridgeWidget = React.lazy(() => 
  import('@/components/bridge/BridgeWidget')
);

// Admin Components
export const ConfigureAssetModal = React.lazy(() => 
  import('@/components/admin/ConfigureAssetModal')
);

export const CreateTokenForm = React.lazy(() => 
  import('@/components/admin/CreateTokenForm')
);

export const TokenConfigTable = React.lazy(() => 
  import('@/components/admin/TokenConfigTable')
);

export const ListAssetForm = React.lazy(() => 
  import('@/components/admin/ListAssetForm')
);

// Borrow Components
export const RepayForm = React.lazy(() => 
  import('@/components/borrow/RepayForm')
);

export const CollateralModal = React.lazy(() => 
  import('@/components/borrow/CollateralModal')
);

// Loading fallback for components
export const ComponentLoadingFallback = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

// Skeleton loading for lists/tables
export const ListLoadingFallback = () => (
  <div className="space-y-4">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="h-16 bg-gray-100 rounded animate-pulse"></div>
    ))}
  </div>
);

// Modal loading fallback
export const ModalLoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
); 