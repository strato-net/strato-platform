import React from "react";
import { Input, Tabs } from "antd";
import AssetsTable from "./AssetsTable";
import SalesTable from "./SalesTable";

const { Search } = Input; 

const Storage = ({ user }) => {
  const onChange = (key) => {

  };

  return (
    <div>
      <Tabs 
        className="mx-16 mt-14"
        defaultActiveKey={"Assets"}
        onChange={onChange}
        tabBarExtraContent={<Search placeholder="Search" className="w-80" />}
        items={[
          {
            label: <p id="assets-tab" className="font-medium text-base">Assets</p>,
            key: "Assets",
            children: <AssetsTable user={user} />,
          },
          {
            label: <p id="sales-tab" className="font-medium text-base">Sales</p>,
            key: "Sales",
            children: <SalesTable user={user} />,
          }
        ]}
      />
    </div>
  );
};

export default Storage;