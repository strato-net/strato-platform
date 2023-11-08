import { Input, Tabs } from "antd";
import React from "react";
import { useLocation } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;
  const onChange = (key) => { };
  const { state } = useLocation();

  return (
    <>
      <BreadCrumbComponent />
      <div>
        <Tabs
          className="mx-16 mt-2"
          defaultActiveKey={state == null ? "Sold" : state.defaultKey}
          onChange={onChange}
          tabBarExtraContent={<Search placeholder="Search" className="w-80" />}
          items={[
            {
              label: <p id="sold-tab" className="font-medium text-base">Orders (Sold)</p>,
              key: "Sold",
              children: <SoldOrdersTable user={user} />,
            },
            {
              label: <p id="bought-tab" className="font-medium text-base">Orders (Bought)</p>,
              key: "Bought",
              children: <BoughtOrdersTable user={user} />,
            },
          ]}
        />
      </div>
    </>
  );
};

export default Order;
