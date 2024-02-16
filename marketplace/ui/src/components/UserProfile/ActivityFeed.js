import React from 'react';
import { ShoppingCartOutlined, CalendarOutlined, SwapOutlined } from '@ant-design/icons';
import { Typography, Button } from 'antd';

const { Text } = Typography;

const ActivityIcon = ({ type }) => {
  switch (type) {
    case 'sold':
      return <ShoppingCartOutlined />;
    case 'bought':
      return <CalendarOutlined />;
    case 'transfer':
      return <SwapOutlined />;
    default:
      return null;
  }
};

const ActivityFeed = ({ type, description, timestamp }) => {
  return (
    <div className="activity-item flex items-center p-4 border-b">
      <div className="activity-icon mr-4">
        <ActivityIcon type={type} />
      </div>
      <div className="activity-info flex-1">
        <div className="activity-description">
          <Text>{description}</Text>
        </div>
        <div className="activity-time">
          <Text type="secondary">{new Date(timestamp).toLocaleString()}</Text>
        </div>
      </div>
      <div className="activity-action">
        <Button type="link">Check Now</Button>
      </div>
    </div>
  );
};

export default ActivityFeed;
