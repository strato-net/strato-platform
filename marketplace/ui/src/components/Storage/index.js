import React, { useState } from "react";
import { Input, Tabs } from "antd";
import AssetsTable from "./AssetsTable";
import routes from "../../helpers/routes";
import SalesTable from "./SalesTable";

const { Search } = Input; 

const Storage = ({ user }) => {
  const [searchValue, setSearchValue] = useState("");
  const showStorage = user && user.organization && user.organization === "BlockApps" ? true : false

  const onChange = (key) => {

  };

  const onSearch = (value, event) => {
    setSearchValue(value);
  }

  return (
    <>
    {showStorage ?
    (<div>
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
    </div>) : <p>It appears that you do not have access to this page. Click <a className="font-bold text-blue" href={routes.Marketplace.url}>here</a> to go back to the homepage.</p>
    }
    </>
  );
};

export default Storage;