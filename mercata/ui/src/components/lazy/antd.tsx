import React from 'react';

// Lazy load Ant Design components
export const AntTable = React.lazy(() => 
  import('antd').then(module => ({ default: module.Table }))
);

export const AntModal = React.lazy(() => 
  import('antd').then(module => ({ default: module.Modal }))
);

export const AntTabs = React.lazy(() => 
  import('antd').then(module => ({ default: module.Tabs }))
);

// For message, we need to handle it differently since it's a function, not a component
export const getAntMessage = async () => {
  const antd = await import('antd');
  return antd.message;
};

// Lazy load Ant Design icons
export const CopyOutlined = React.lazy(() => 
  import('@ant-design/icons').then(module => ({ default: module.CopyOutlined }))
);

export const LinkOutlined = React.lazy(() => 
  import('@ant-design/icons').then(module => ({ default: module.LinkOutlined }))
);

export const FrownOutlined = React.lazy(() => 
  import('@ant-design/icons').then(module => ({ default: module.FrownOutlined }))
);

// Loading fallback for Ant Design components
export const AntLoadingFallback = () => (
  <div className="flex items-center justify-center p-4">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
  </div>
);

// Icon loading fallback
export const IconLoadingFallback = () => (
  <div className="w-4 h-4 bg-gray-200 rounded animate-pulse"></div>
); 