import { Input, Tabs, Typography, DatePicker, Breadcrumb } from "antd";
import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import TransfersTable from "./TransfersTable";
import dayjs from "dayjs";
import { SearchOutlined } from "@ant-design/icons";
import routes from "../../helpers/routes";
import ClickableCell from "../ClickableCell";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;
  const { state } = useLocation();
  const [activeTab, setActiveTab] = useState(state?.defaultKey)

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
      <div className="px-20 py-10">
      <Breadcrumb>
        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            Home
          </ClickableCell>
        </Breadcrumb.Item>
        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
          <p className=" text-primary">
            {'Orders (' + activeTab + ')'}
          </p>
        </Breadcrumb.Item>
      </Breadcrumb>
      </div>
      <Tabs
        className="mx-20 mt-0"
        defaultActiveKey={state == null ? "Sold" : state.defaultKey}
        onChange={onChange}
        tabBarExtraContent={              
          <div className="text-xs flex items-center">
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
            label: <p id="sold-tab" className="font-semibold text-base">Orders (Sold)</p>,
            key: "Sold",
            children: 
            <div className="flex flex-col mt-3">
                <Input className="text-base orders_searchbar mb-5 p-3 rounded-full bg-[#F6F6F6]" prefix={<SearchOutlined />} placeholder="Search Markeplace" />
                <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()}/>
            </div>,
          },
          {
            label: <p id="bought-tab" className="font-semibold text-base">Orders (Bought)</p>,
            key: "Bought",
            children: 
            <div className="flex flex-col mt-3">
                <Input className="text-base orders_searchbar mb-5 p-3 rounded-full bg-[#F6F6F6]" prefix={<SearchOutlined />} placeholder="Search Markeplace" />
                <BoughtOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()}/>
            </div>,
          },
          {
            label: <p id="transfers-tab" className="font-semibold text-base">Transfers</p>,
            key: "Transfers",
            children: 
            <div className="flex flex-col mt-3">
                <Input className="text-base orders_searchbar mb-5 p-3 rounded-full bg-[#F6F6F6]" prefix={<SearchOutlined />} placeholder="Search Markeplace" />
                <TransfersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()}/>
            </div>,
          }
        ]}
      />
    </div>
  );
};

export default Order;
