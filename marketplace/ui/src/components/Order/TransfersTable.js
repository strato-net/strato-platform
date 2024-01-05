import React, { useEffect, useState } from "react";
import DataTableComponent from "../DataTableComponent";
import { getStringDate } from "../../helpers/utils";
import { actions } from "../../contexts/inventory/actions";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Input, Pagination } from "antd";
import "./ordersTable.css"
import { DownOutlined, SearchOutlined, UpOutlined } from "@ant-design/icons";
import { ResponsiveOrderCard } from "./ResponsiveOrdersCard";
import { ResponsiveTransferOrderCard } from "./ResponsiveTransferOrdersCard";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";


const TransfersTable = ({ user, selectedDate }) => {
  const dispatch = useInventoryDispatch();
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const { itemTransfers, totalItemsTransfered, isFetchingItemTransfers } = useInventoryState();
  const [order, setOrder] = useState("desc")

  console.log("selectedDate", selectedDate)
  useEffect(() => {
    actions.fetchItemTransfers(dispatch, limit, offset, user.commonName, order, selectedDate);
  }, [dispatch, limit, offset, user, order, selectedDate]);

  useEffect(() => {
    setPage(1);
    setOffset(0);
  }, [totalItemsTransfered]);

  const [data, setdata] = useState([]);
  useEffect(() => {
    let items = [];
    if(itemTransfers)
    {
    itemTransfers.forEach((transfer) => {
      items.push({
        address: transfer.address,
        key: transfer.address,
        assetAddress: transfer.assetAddress,
        assetName: decodeURIComponent(transfer.assetName),
        newOwner: transfer.newOwner,
        newOwnerCommonName: transfer.newOwnerCommonName,
        oldOwner: transfer.oldOwner,
        oldOwnerCommonName: transfer.oldOwnerCommonName,
        quantity: transfer.quantity,
        transferDate: getStringDate(transfer.transferDate, US_DATE_FORMAT),
        transferNumber: transfer.transferNumber,
      });
    });
  }
    setdata(items);
  }, [itemTransfers]);

  
  const column = [
    {
      title: "Transfer Number",
      dataIndex: "transferNumber",
      key: "transferNumber",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "From",
      key: "oldOwnerCommonName",
      render: (text, record) => <p>{record.oldOwnerCommonName}</p>,
    },
    {
      title: "To",
      key: "newOwnerCommonName",
      render: (text, record) => <p>{record.newOwnerCommonName}</p>,
    },
    {
      dataIndex: "transferDate",
      key: "transferDate",
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: "flex" }}>
          <div className="mt-1.5">{"Date"}</div>
          <div>
            {order === "desc" ? (
              <UpOutlined className="icon-container icon-hover" onClick={() => setOrder("asc")} />
            ) : (
              <DownOutlined className="icon-container icon-hover" onClick={() => setOrder("desc")} />
            )}
          </div>
        </div>
      ),
    },
    {
      title: "Asset Name",
      dataIndex: "assetName",
      key: "assetName",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      render: (text) => <p>{text}</p>,
      width: "15%",
    },
  ];


  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  const onChange = (pagination, filters, sorter) => {
    console.log(sorter);
    if (order === "desc") {
      setOrder("asc")
    } else {
      setOrder("desc")
    }
  };

  return (
    <div>
      <Input className="text-base orders_searchbar mb-5 rounded-full bg-[#F6F6F6]" prefix={<SearchOutlined />} placeholder="Search Markeplace" />
      <div className="flex md:hidden order_responsive">
        <ResponsiveTransferOrderCard
          data={data}
          isLoading={isFetchingItemTransfers}
        />
      </div>
      <div className="hidden md:block">
        <DataTableComponent
          columns={column}
          data={data}
          isLoading={isFetchingItemTransfers}
          pagination={false}
          scrollX="100%"
          rowKey={record => record.transferNumber}
          onChange={onChange}
        />
      </div>
      <Pagination
        current={page}
        onChange={onPageChange}
        total={totalItemsTransfered}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default TransfersTable;
