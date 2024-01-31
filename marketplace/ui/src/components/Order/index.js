import { Tabs, DatePicker, Breadcrumb, Button, Spin } from "antd";
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

  
  function mapOrderData(orders) {
    return orders.flatMap(order => 
      order.assets.map((asset, index) => {
        const { category, subCategory } = getCategoryAndSubcategory(asset.contract_name);
        return {
          address: order.address,
          category,
          subCategory,
          assetName: asset.name,
          assetPricePerUnit: asset.salePrice,
          quantity: order.quantities[index],
          salePrice: asset.salePrice * order.quantities[index],
          orderTotalPrice: order.totalPrice,
          createdDate: order.createdDate,
          orderId: order.orderId,
          purchasersAddress: order.purchasersAddress,
          purchasersCommonName: order.purchasersCommonName,
          status: OrderStatus[order.status] || "Unknown",
          comments: order.comments,
          fulfillmentDate: order.fulfillmentDate,
          sellersCommonName: order.sellersCommonName,
        };
      })
    );
  }
  
  function mapTransfersData(transfers) {
    return transfers.map(order => {
      const { category, subCategory } = getCategoryAndSubcategory(order.contract_name);
      return {
        address: order.address,
        category,
        subCategory,
        assetName: order.assetName,
        quantity: order.quantity,
        createdDate: order.transferDate,
        orderId: order.id,
        address: order.address,
        assetAddress: order.assetAddress,
        oldOwner: order.oldOwner,
        oldOwnerCommonName: order.oldOwnerCommonName,
        newOwner: order.newOwner,
        newOwnerCommonName: order.newOwnerCommonName
      };
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
            <Button className="md:hidden" onClick={() => download('xlsx')} disabled={isAllOrdersLoading} loading={isAllOrdersLoading}>Excel</Button>
            <Button className="md:hidden" onClick={() => download('csv')} disabled={isAllOrdersLoading} loading={isAllOrdersLoading}>CSV</Button>

            <Button className="hidden md:block" onClick={() => download('xlsx')} disabled={isAllOrdersLoading} loading={isAllOrdersLoading}>Export to Excel</Button>
            <Button className="hidden md:block" onClick={() => download('csv')} disabled={isAllOrdersLoading} loading={isAllOrdersLoading}>Export to CSV</Button>


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
