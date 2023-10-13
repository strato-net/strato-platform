import React, { useEffect, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
// import routes from "../../helpers/routes";
import DataTableComponent from "../DataTableComponent";
import { getStringDate } from "../../helpers/utils";
// import { useNavigate, Link } from "react-router-dom";
import { actions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Pagination } from "antd";
// import TagManager from "react-gtm-module";
import "./ordersTable.css"


const TransfersTable = ({ user }) => {
  const dispatch = useItemDispatch();
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState("createdDate.desc");
  const { itemTransfers, totalItemsTransfered, isFetchingItemTransfers } = useItemState();

  console.log("itemTransfers", itemTransfers);

  useEffect(() => {
    actions.fetchItemTransfers(dispatch, limit, offset, user.userAddress);
  }, [dispatch, limit, offset, user]);

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
        newOwner: transfer.newOwner,
        newOwnerCommonName: transfer.newOwnerCommonName,
        newOwnerOrganization: transfer.newOwnerOrganization,
        oldOwner: transfer.oldOwner,
        oldOwnerCommonName: transfer.oldOwnerCommonName,
        oldOwnerOrganization: transfer.oldOwnerOrganization,
        quantity: transfer.quantity,
        transferDate: getStringDate(transfer.transferDate, US_DATE_FORMAT),
      });
    });
    setdata(items);
  }, [itemTransfers]);

  const column = [
    {
      title: "TRANSFER NUMBER",
      dataIndex: "address",
      key: "address",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "FROM",
      dataIndex: "oldOwnerCommonName",
      key: "oldOwnerCommonName",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "TO",
      dataIndex: "newOwnerCommonName",
      key: "newOwnerCommonName",
      render: (text) => <p>{text}</p>,
    },
    {
      dataIndex: "transferDate",
      key: "transferDate",
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>DATE (MM/DD/YYYY)</div>
          <div>
            {order === "createdDate.desc" ? (
              <UpOutlined className="icon-container icon-hover" onClick={() => setOrder("createdDate.asc")} />
            ) : (
              <DownOutlined className="icon-container icon-hover" onClick={() => setOrder("createdDate.desc")} />
            )}
          </div>
        </div>
      ),
    },
    {
      title: "PRODUCT NAME",
      dataIndex: "inventoryId",
      key: "inventoryId",
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

  return (
    <div>
      <DataTableComponent
        columns={column}
        data={data}
        isLoading={isFetchingItemTransfers}
        pagination={false}
        scrollX="100%"
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
