import React from 'react';
import {
  ShoppingCartOutlined,
  CalendarOutlined,
  SwapOutlined,
} from '@ant-design/icons';
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

const ActivityFeed = ({ type, description, timestamp, href }) => {
  return (
    <div className="activity-item flex items-center py-4 border-b">
      <div className="activity-icon mr-4">
        <ActivityIcon type={type} />
      </div>
      <div className="activity-info flex-1">
        <div className="activity-description">
          <Text>{description}</Text>
        </div>
        <div className="activity-time">
          <Text type="secondary">
            {new Date(timestamp.replace(/-/g, '/')).toLocaleString()}
          </Text>{' '}
        </div>
      </div>
      <div className="activity-action">
        <a href={href} target="_blank" rel="noopener noreferrer">
          <Button type="link">Review Now</Button>
        </a>
      </div>
    </div>
  );
};

export default ActivityFeed;
