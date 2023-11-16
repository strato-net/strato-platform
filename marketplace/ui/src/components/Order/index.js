import React from "react";
import { Input, Tabs } from "antd";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";

const { Search } = Input;

const Order = ({ user }) => {
  const navigate = useNavigate();
  const { type } = useParams();
  // const naviroute = routes.OrderDetail.url;
  const onChange = (key) => {
    navigate(`/orderList/${key}`)
  };
  const { state } = useLocation();

  return (
    <>
      <BreadCrumbComponent />
      <div>
        <Tabs
          className="mx-16 mt-2"
          defaultActiveKey={state == null ? type : state.defaultKey}
          onChange={onChange}
          tabBarExtraContent={<Search placeholder="Search" className="w-80" />}
          items={[
            {
              label: <p id="sold-tab" className="font-medium text-base">Orders (Sold)</p>,
              key: "sold",
              children: <SoldOrdersTable user={user} />,
            },
            {
              label: <p id="bought-tab" className="font-medium text-base">Orders (Bought)</p>,
              key: "bought",
              children: <BoughtOrdersTable user={user} />,
            },
          ]}
        />
      </div>
    </>
  );
};

export default Order;
