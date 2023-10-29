import React from "react";
import { Input, Tabs } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
import { setCookie } from "../../helpers/cookie";

const { Search } = Input;

const Order = ({ user }) => {
  const navigate = useNavigate();
  const { type } = useParams();

  const onChange = (key) => {
    setCookie("returnUrl", `/marketplace/orders/${key}`, 10);
    navigate(`/orders/${key}`)
  };

  const item = [
    {
      label: <p id="sold-tab" className="font-medium text-base">Orders (Sold)</p>,
      key: "sold",
      children: (user && <SoldOrdersTable user={user} />),
    },
    {
      label: <p id="bought-tab" className="font-medium text-base">Orders (Bought)</p>,
      key: "bought",
      children: (user && <BoughtOrdersTable user={user} />),
    },
  ]

  return (
    <>
      <BreadCrumbComponent />
      <Tabs
        className="mx-16 mt-4"
        defaultActiveKey={type}
        onChange={onChange}
        tabBarExtraContent={<Search placeholder="Search" className="w-80" />}
        items={item}
      />
    </>
  );
};

export default Order;
