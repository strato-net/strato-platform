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

const ActivityFeed = ({ type, description, timestamp, href }) => {
  const timeDate = new Date(timestamp);
  const year = timeDate.getFullYear();
  const month = String(timeDate.getMonth() + 1).padStart(2, '0');
  const day = String(timeDate.getDate()).padStart(2, '0');
  const hour = String(timeDate.getHours()).padStart(2, '0');
  const minute = String(timeDate.getMinutes()).padStart(2, '0');
  const second = String(timeDate.getSeconds()).padStart(2, '0');
  
  const formattedDate = `${year}-${month}-${day} ${hour}:${minute}:${second}`;

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
          <Text type="secondary">{formattedDate}</Text>
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
