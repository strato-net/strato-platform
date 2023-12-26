import { Input, Tabs, Typography, DatePicker, Breadcrumb } from "antd";
import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import TransfersTable from "./TransfersTable";
import dayjs from "dayjs";
import routes from "../../helpers/routes";
import ClickableCell from "../ClickableCell";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;
  const { state } = useLocation();
  const [activeTab, setActiveTab] = useState(state?.defaultKey || 'Sold')

  const onChange = (key) => {
    setActiveTab(key)
  };
  
  const [selectedDate, setSelectedDate] = useState("");
  const { Text } = Typography;

  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  return (
    <div>
      <div className="px-4 md:px-20 py-2 md:py-10">
      <Breadcrumb>
        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            <p className="text-sm text-[#13188A] font-semibold">

            Home
            </p>
          </ClickableCell>
        </Breadcrumb.Item>
        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
          <p className=" text-sm text-[#202020] font-medium">
            {'Orders (' + activeTab + ')'}
          </p>
        </Breadcrumb.Item>
      </Breadcrumb>
      </div>
      <Tabs
        className="mx-4 md:mx-20 mt-0"
        defaultActiveKey={state == null ? "Sold" : state.defaultKey}
        onChange={onChange}
        tabBarExtraContent={              
          <div className="text-xs md:flex items-center hidden">
            <DatePicker
              value={
                selectedDate
              }
              disabledDate={(current) => {
                const currentDate = dayjs().startOf('day'); // Get the start of today
                const selectedDate = dayjs(current).startOf('day');

                return selectedDate.isAfter(currentDate);
              }}
              onChange={onDateChange}
              disabled={false}
            />
          </div>
        }
        items={[
          {
            label: <p id="sold-tab" className="font-semibold text-sm md:text-base">Orders (Sold)</p>,
            key: "Sold",
            children: <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} onDateChange={onDateChange}/>
          },
          {
            label: <p id="bought-tab" className="font-semibold text-sm md:text-base">Orders (Bought)</p>,
            key: "Bought",
            children: <BoughtOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} onDateChange={onDateChange}/>
          },
          {
            label: <p id="transfers-tab" className="font-semibold text-sm md:text-base">Transfers</p>,
            key: "Transfers",
            children: <TransfersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()}/>
          }
        ]}
      />
    </div>
  );
};

export default Order;
