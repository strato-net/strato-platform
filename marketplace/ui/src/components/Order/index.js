import { Input, Tabs} from "antd";
import React from "react";
import { useLocation } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;

  const onChange = (key) => {
   
  };
  const { state } = useLocation();


  return (
    <div>
      <Tabs
        className="mx-16 mt-14"
        defaultActiveKey={state == null ? "Sold" : state.defaultKey}
        onChange={onChange}
        items={[
          {
            label: <p id="sold-tab" className="font-medium text-base">Orders (Sold)</p>,
            key: "Sold",
            children: <SoldOrdersTable user={user}/>,
          },
          {
            label: <p id="bought-tab" className="font-medium text-base">Orders (Bought)</p>,
            key: "Bought",
            children: <BoughtOrdersTable user={user} selectedDate={""}/>,
          },
        ]}
      />
    </div>
  );
};

export default Order;
