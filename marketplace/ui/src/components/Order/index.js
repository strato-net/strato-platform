import { Tabs, DatePicker, Breadcrumb, Button, Dropdown, Menu, Space  } from "antd";
import { DownloadOutlined, DownOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryState, useCategoryDispatch } from "../../contexts/category";
import startCase from 'lodash/startCase';

const Order = ({ user }) => {

  const navigate = useNavigate();
  const params = useParams();
  const { type } = params;
  const dispatch = useOrderDispatch();
  const categoryDispatch = useCategoryDispatch();
  const [callExcel, setCallExcel] = useState(false);
  const [callCSV, setCallCSV] = useState(false);
  const { allOrders, isAllOrdersLoading } = useOrderState();
  const { categorys } = useCategoryState();
  
  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const onChange = (key) => {
    navigate(`/order/${key}`)
  };

  const [selectedDate, setSelectedDate] = useState("");


  const onDateChange = (date) => {
    setSelectedDate(date);
  };
  
  // --------------------- EXPORT TO EXCEL AND CSV START ---------------------
  function getCategoryAndSubcategory(contractName) {
    for (const category of categorys) {
      for (const subCategory of category.subCategories) {
        // endsWith is used to match the contract name with the subcategory contract
        if (contractName.endsWith(subCategory.contract)) {
          return { category: category.name, subCategory: subCategory.name };
        }
      }
    }
    return { category: 'Unknown', subCategory: 'Unknown' };
  }
  
  const OrderStatus = [
    "NULL",
    "AWAITING_FULFILLMENT",
    "AWAITING_SHIPMENT",
    "CLOSED",
    "CANCELED",
    "PAYMENT_PENDING"
  ];
  
  function formatDate(epochTime) {
    return new Date(epochTime * 1000).toLocaleDateString("en-US"); // Adjust date format as needed
  }
  
  function formatDataObject(dataObject) {
    let formattedObject = {};
    Object.keys(dataObject).forEach(key => {
      let value = dataObject[key];
      if (key.endsWith('Date')) {
        value = formatDate(value); // Assuming formatDate converts epoch to readable date
      } else if (key === 'comments') {
        value = decodeURIComponent(value);
      }
      formattedObject[startCase(key)] = value;
    });
    return formattedObject;
  }
  
  function mapOrderData(orders) {
    return orders.flatMap(order => 
      order.assets.map((asset, index) => {
        const { category, subCategory } = getCategoryAndSubcategory(asset.contract_name);
        return formatDataObject({
          orderNumber: order.orderId,
          category,
          subCategory,
          assetName: asset.name,
          assetPrice: asset.salePrice,
          quantity: order.quantities[index],
          totalOrderAmount: order.totalPrice,
          orderDate: order.createdDate,
          purchaserName: order.purchasersCommonName,
          status: OrderStatus[order.status] || "Unknown",
          comments: order.comments,
          orderFulfillmentDate: order.fulfillmentDate,
          address: order.address
        });
      })
    );
  }
  
  function mapTransfersData(transfers) {
    return transfers.map(order => {
      const { category, subCategory } = getCategoryAndSubcategory(order.contract_name);
      return formatDataObject({
        orderNumber: order.id,
        category,
        subCategory,
        assetName: order.assetName,
        quantity: order.quantity,
        transferDate: order.transferDate,
        oldOwnerCommonName: order.oldOwnerCommonName,
        newOwnerCommonName: order.newOwnerCommonName,
        address: order.address
      });
    });
  }

  
  useEffect(() => {
    if (allOrders && callExcel && !isAllOrdersLoading) {
      const wb = XLSX.utils.book_new();
      const wsSold = XLSX.utils.json_to_sheet(mapOrderData(allOrders.bodySold));
      const wsBought = XLSX.utils.json_to_sheet(mapOrderData(allOrders.bodyBought));
      const wsTransferred = XLSX.utils.json_to_sheet(mapTransfersData(allOrders.bodyTransfers));
    
      // Append each worksheet to the workbook
      XLSX.utils.book_append_sheet(wb, wsSold, 'Sold Orders');
      XLSX.utils.book_append_sheet(wb, wsBought, 'Bought Orders');
      XLSX.utils.book_append_sheet(wb, wsTransferred, 'Transfers');
    
      // Write the workbook to a binary string
      const wbout = XLSX.write(wb, {bookType: 'xlsx', type: 'binary'});
    
      // Convert the binary string to a Blob and save it
      const blob = new Blob([s2ab(wbout)], {type: 'application/octet-stream'});
      saveAs(blob, 'mercata-orders.xlsx');
      setCallExcel(false);
      setCallCSV(false);
    }
    if (allOrders && callCSV && !isAllOrdersLoading) {
      // Adding an extra column to distinguish data
      const addTypeColumn = (data, type) => data.map(row => ({ ...row, Type: type }));

      const soldData = addTypeColumn(mapOrderData(allOrders.bodySold), 'Sold');
      const boughtData = addTypeColumn(mapOrderData(allOrders.bodyBought), 'Bought');
      const transferredData = addTypeColumn(mapTransfersData(allOrders.bodyTransfers), 'Transferred');

      const combinedData = [...soldData, ...boughtData, ...transferredData];
      const ws = XLSX.utils.json_to_sheet(combinedData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');

      const wbout = XLSX.write(wb, {bookType: 'csv', type: 'binary'});
      const blob = new Blob([s2ab(wbout)], {type: 'text/csv'});
      saveAs(blob, 'mercata-orders.csv');
      setCallCSV(false);
      setCallExcel(false);
    }
  }, [allOrders, callExcel, callCSV, isAllOrdersLoading]);
  
  const download = async (format) => {
    if (user?.commonName) {
      await actions.fetchAllOrders(
        dispatch,
        user?.commonName
      );
      if (format === 'xlsx'){
        setCallExcel(true);
        setCallCSV(false);
      } 
      else if (format === 'csv'){
        setCallCSV(true);
        setCallExcel(false);
      }
      
    }
  };
  
  // Utility function to convert a binary string to an ArrayBuffer
  function s2ab(s) {
    const buf = new ArrayBuffer(s.length);
    const view = new Uint8Array(buf);
    for (let i=0; i<s.length; i++) view[i] = s.charCodeAt(i) & 0xFF;
    return buf;
  }
  
  const menuItems = [
    {
      key: 'xlsx',
      label: 'Excel',
      disabled: isAllOrdersLoading,
    },
    {
      key: 'csv',
      label: 'CSV',
      disabled: isAllOrdersLoading,
    },
  ];
  // --------------------- EXPORT TO EXCEL AND CSV END ---------------------

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
          <div className="text-xs md:flex items-center orders_page">
            <Dropdown
              className="md:flex hidden"
              menu={{ items: menuItems, onClick: (e) => download(e.key) }}
              disabled={isAllOrdersLoading}
              trigger={['click']}
            >
              <Button loading={isAllOrdersLoading}>
                <Space>
                  <DownloadOutlined />
                </Space>
              </Button>
            </Dropdown>

            <DatePicker
              className="md:flex hidden"
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
            children: <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} onDateChange={onDateChange} download={download} isAllOrdersLoading={isAllOrdersLoading}/>
          },
          {
            label: <p id="bought-tab" className="font-semibold text-sm md:text-base">Orders (Bought)</p>,
            key: "bought",
            children: <BoughtOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} onDateChange={onDateChange} download={download} isAllOrdersLoading={isAllOrdersLoading}/>
          },
          {
            label: <p id="transfers-tab" className="font-semibold text-sm md:text-base">Transfers</p>,
            key: "transfers",
            children: <TransfersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} download={download} isAllOrdersLoading={isAllOrdersLoading}/>
          }
        ]}
      />
    </div>
  );
};

export default Order;
