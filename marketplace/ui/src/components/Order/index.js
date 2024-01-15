import { Input, Tabs, Typography, DatePicker, Breadcrumb } from "antd";
import React, { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import TransfersTable from "./TransfersTable";
import dayjs from "dayjs";
import routes from "../../helpers/routes";
import ClickableCell from "../ClickableCell";
import { Images } from "../../images";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;
  const navigate = useNavigate();
  const params = useParams();
  const { type } = params;
  const { state } = useLocation();

  const onChange = (key) => {
    navigate(`/order/${key}`)
  };

  const [selectedDate, setSelectedDate] = useState("");
  const { Text } = Typography;

  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  return (
    <div>
      <div className="px-4 md:px-20 lg:py-2 lg:mt-3 orders">
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
              {'Orders (' + type + ')'}
            </p>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>
      <Tabs
        className="mx-4 md:mx-20 lg:mt-[10px]"
        defaultActiveKey={type}
        onChange={onChange}
        tabBarExtraContent={
          <div className="text-xs md:flex items-center hidden orders_page">
            <DatePicker
              style={{ backgroundColor: "#F6F6F6" }}
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
              suffixIcon={<img src={Images.calender} alt="calender" className=" w-[18px] h-5" style={{ maxWidth: "none" }} />}
            />
          </div>
        }
        items={[
          {
            label: <p id="sold-tab" className="font-semibold text-sm md:text-base">Orders (Sold)</p>,
            key: "sold",
            children: <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} onDateChange={onDateChange} />
          },
          {
            label: <p id="bought-tab" className="font-semibold text-sm md:text-base">Orders (Bought)</p>,
            key: "bought",
            children: <BoughtOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} onDateChange={onDateChange} />
          },
          {
            label: <p id="transfers-tab" className="font-semibold text-sm md:text-base">Transfers</p>,
            key: "transfers",
            children: <TransfersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />
          }
        ]}
      />
    </div>
  );
};

export default Order;
