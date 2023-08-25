import React, { useState } from "react";
import { Input, Tabs } from "antd";
import AssetsTable from "./AssetsTable";
import SalesTable from "./SalesTable";

const { Search } = Input; 

const Storage = ({ user }) => {
  const [searchValue, setSearchValue] = useState("");

  const onChange = (key) => {

  };

  const onSearch = (value, event) => {
    setSearchValue(value);
  }

  return (
    <div>
      <Tabs 
        className="mx-16 mt-14"
        defaultActiveKey={"Asset"}
        onChange={onChange}
        tabBarExtraContent={<Search placeholder="Search" className="w-80" onSearch={onSearch}/>}
        items={[
          {
            label: <p id="assets-tab" className="font-medium text-base">Assets</p>,
            key: "Asset",
            children: <AssetsTable user={user} searchQuery={searchValue} />,
          },
          {
            label: <p id="sales-tab" className="font-medium text-base">Sales</p>,
            key: "Sale",
            children: <SalesTable user={user} searchQuery={searchValue} />,
          }
        ]}
      />
    </div>
  );
};

export default Storage;