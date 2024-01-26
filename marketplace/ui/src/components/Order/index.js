import { Input, Tabs, Typography, DatePicker, Breadcrumb, Button } from "antd";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import SoldOrdersTable from "./SoldOrdersTable";
import BoughtOrdersTable from "./BoughtOrdersTable";
import TransfersTable from "./TransfersTable";
import dayjs from "dayjs";
import routes from "../../helpers/routes";
import ClickableCell from "../ClickableCell";
import { Images } from "../../images";
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { actions } from "../../contexts/order/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { useOrderDispatch } from "../../contexts/order";
import { useInventoryDispatch } from "../../contexts/inventory";
import { useInventoryState } from "../../contexts/inventory";
import { useOrderState } from "../../contexts/order";

const { Search } = Input;

const Order = ({ user }) => {
  // const naviroute = routes.OrderDetail.url;
  const navigate = useNavigate();
  const params = useParams();
  const { type } = params;
  const { state } = useLocation();
  const dispatch = useOrderDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const [call, setCall] = useState(false);
  const { allOrders, isAllOrdersLoading } = useOrderState();

  const onChange = (key) => {
    navigate(`/order/${key}`)
  };

  const [selectedDate, setSelectedDate] = useState("");
  const { Text } = Typography;

  const onDateChange = (date) => {
    setSelectedDate(date);
  };
  
  useEffect(() => {
    console.log("isAllOrdersLoading: ", isAllOrdersLoading);
    console.log("call: ", call);
    console.log("allOrders1: ", allOrders);
    if (allOrders && call && !isAllOrdersLoading) {
      const wb = XLSX.utils.book_new();
      console.log("Waiting for data to load...");
      console.log("allOrders2: ", allOrders);
      const wsSold = XLSX.utils.json_to_sheet(allOrders.bodySold);
      const wsBought = XLSX.utils.json_to_sheet(allOrders.bodyBought);
      const wsTransferred = XLSX.utils.json_to_sheet(allOrders.bodyTransfers);
    
      // Append each worksheet to the workbook
      XLSX.utils.book_append_sheet(wb, wsSold, 'Sold Orders');
      XLSX.utils.book_append_sheet(wb, wsBought, 'Bought Orders');
      XLSX.utils.book_append_sheet(wb, wsTransferred, 'Transfers');
    
      // Write the workbook to a binary string
      const wbout = XLSX.write(wb, {bookType: 'xlsx', type: 'binary'});
    
      // Convert the binary string to a Blob and save it
      const blob = new Blob([s2ab(wbout)], {type: 'application/octet-stream'});
      saveAs(blob, 'mercata-orders.xlsx');
      setCall(false);
    }
  }, [allOrders, call, isAllOrdersLoading]);
  
  const downloadExcel = async () => {
    // Fetch the data for each table
    if (user?.commonName) {
      console.log("Fetching data...");
      await actions.fetchAllOrders(
        dispatch,
        user?.commonName
      );
      setCall(true);
    }
  };
  
  // Utility function to convert a binary string to an ArrayBuffer
  function s2ab(s) {
    const buf = new ArrayBuffer(s.length);
    const view = new Uint8Array(buf);
    for (let i=0; i<s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
    return buf;
  }

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
        key={type}
        defaultActiveKey={type}
        onChange={onChange}
        tabBarExtraContent={
          <div className="text-xs md:flex items-center hidden orders_page">
            <Button style={{ backgroundColor: "#F6F6F6" }} onClick={downloadExcel}>Export tables to Excel</Button>
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
