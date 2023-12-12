import React, { useEffect, useState } from "react";
import DataTableComponent from "../DataTableComponent";
import { getStringDate } from "../../helpers/utils";
import { actions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Pagination } from "antd";
import "./ordersTable.css"
import { DownOutlined, UpOutlined } from "@ant-design/icons";


const TransfersTable = ({ user, selectedDate }) => {
  const dispatch = useItemDispatch();
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const { itemTransfers, totalItemsTransfered, isFetchingItemTransfers } = useItemState();
  const [order, setOrder] = useState("desc")

  console.log("selectedDate", selectedDate)
  useEffect(() => {
    actions.fetchItemTransfers(dispatch, limit, offset, user.organization, order, selectedDate);
  }, [dispatch, limit, offset, user, order, selectedDate]);

  useEffect(() => {
    setPage(1);
    setOffset(0);
  }, [totalItemsTransfered]);

  const [data, setdata] = useState([]);
  useEffect(() => {
    let items = [];
    itemTransfers.forEach((transfer) => {
      items.push({
        address: transfer.address,
        key: transfer.address,
        inventoryId: transfer.inventoryId,
        productName: decodeURIComponent(transfer.productName),
        newOwner: transfer.newOwner,
        newOwnerCommonName: transfer.newOwnerCommonName,
        newOwnerOrganization: transfer.newOwnerOrganization,
        oldOwner: transfer.oldOwner,
        oldOwnerCommonName: transfer.oldOwnerCommonName,
        oldOwnerOrganization: transfer.oldOwnerOrganization,
        quantity: transfer.quantity,
        transferDate: getStringDate(transfer.transferDate, US_DATE_FORMAT),
        transferNumber: transfer.transferNumber,
      });
    });
    setdata(items);
  }, [itemTransfers]);
  
  const column = [
    {
      title: "TRANSFER NUMBER",
      dataIndex: "transferNumber",
      key: "transferNumber",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "FROM",
      key: "oldOwnerCommonName",
      render: (text, record) => <p>{record.oldOwnerOrganization.startsWith("Mercata Account") ? record.oldOwnerCommonName : record.oldOwnerOrganization}</p>,
    },
    {
      title: "TO",
      key: "newOwnerCommonName",
      render: (text, record) => <p>{record.newOwnerOrganization.startsWith("Mercata Account") ? record.newOwnerCommonName : record.newOwnerOrganization}</p>,
    },
    {
      dataIndex: "transferDate",
      key: "transferDate",
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: "flex" }}>
          <div className="mt-1.5">{"Date".toUpperCase()}</div>
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
      title: "PRODUCT NAME",
      dataIndex: "productName",
      key: "productName",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "QUANTITY",
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
      <DataTableComponent
        columns={column}
        data={data}
        isLoading={isFetchingItemTransfers}
        pagination={false}
        scrollX="100%"
        rowKey={record => record.transferNumber}
        onChange={onChange}
      />
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
