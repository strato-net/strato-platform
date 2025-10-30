import React from 'react';
import { Tabs, Button } from 'antd';

const { TabPane } = Tabs;

const TimeRangeTabs = ({ onChange, activeKey }) => {
  const handleChange = (key) => {
    onChange(key);
  };

  return (
    <Tabs
      defaultActiveKey="1"
      activeKey={activeKey}
      onChange={handleChange}
      centered
    >
      <TabPane tab="6M" key="1" />
      <TabPane tab="1Y" key="2" />
      <TabPane tab={<Button type="primary">All</Button>} key="3" />
    </Tabs>
  );
};

export default TimeRangeTabs;
