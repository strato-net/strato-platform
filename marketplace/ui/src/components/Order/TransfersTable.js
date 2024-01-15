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
import { useLocation, useNavigate, useParams } from "react-router-dom";


const TransfersTable = ({ user, selectedDate }) => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const searchVal = searchParams.get('search');
  const { type } = params;

  const dispatch = useInventoryDispatch();
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const { itemTransfers, totalItemsTransfered, isFetchingItemTransfers } = useInventoryState();
  const [order, setOrder] = useState("desc")

  useEffect(() => {
    if (user?.commonName) {
      actions.fetchItemTransfers(dispatch, limit, offset, user?.commonName, order, selectedDate, searchVal);
    }
  }, [dispatch, limit, offset, user, order, selectedDate, searchVal]);

  useEffect(() => {
    setPage(1);
    setOffset(0);
  }, [totalItemsTransfered]);

  const [data, setdata] = useState([]);
  useEffect(() => {
    let items = [];
    if (itemTransfers) {
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
    if (order === "desc") {
      setOrder("asc")
    } else {
      setOrder("desc")
    }
  };

  const handleEnterSearch = (e) => {
    const value = e.target.value;
    if (value.length === 0) {
      navigate(`/order/${type}`)
    } else {
      navigate(`/order/${type}?search=${value}`)
    }
  }

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    if (value.length === 0) {
      navigate(`/order/${type}`)
    }
  }

  return (
    <div>
      <Input className="text-base orders_searchbar md:p-3 rounded-full bg-[#F6F6F6]"
        onChange={(e) => { handleChangeSearch(e) }}
        onPressEnter={(e) => { handleEnterSearch(e) }}
        prefix={<SearchOutlined />}
        placeholder="Search Transfers" />
      <div className="flex md:hidden order_responsive">
        <ResponsiveTransferOrderCard
          data={data}
          isLoading={isFetchingItemTransfers}
        />
      </div>
      <div className="hidden md:block mt-5">
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
