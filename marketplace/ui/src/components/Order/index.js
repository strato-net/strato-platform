import { Input, Tabs, Typography, DatePicker } from "antd";
import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import dayjs from "dayjs";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;

  const onChange = (key) => {
   
  };
  
  const [selectedDate, setSelectedDate] = useState("");
  const { Text } = Typography;
  const { state } = useLocation();

  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  return (
    <div>
      <Tabs
        className="mx-16 mt-14"
        defaultActiveKey={state == null ? "Sold" : state.defaultKey}
        onChange={onChange}
        tabBarExtraContent={              
          <div className="text-xs flex items-center">
            <Text className="block text-primaryC text-[13px] mr-2">
              SEARCH BY DATE
            </Text>
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
            label: <p id="sold-tab" className="font-medium text-base">Orders (Sold)</p>,
            key: "Sold",
            children: <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()}/>,
          },
          {
            label: <p id="bought-tab" className="font-medium text-base">Orders (Bought)</p>,
            key: "Bought",
            children: <BoughtOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()}/>,
          },
        ]}
      />
    </div>
  );
};

export default Order;
