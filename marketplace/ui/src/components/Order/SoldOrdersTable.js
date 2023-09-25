import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { EyeOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import routes from "../../helpers/routes";
import DataTableComponent from "../DataTableComponent";
import { getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
import { useNavigate, Link } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Pagination, Button} from "antd";
import TagManager from "react-gtm-module";
import "./ordersTable.css"


const SoldOrdersTable = ({ user, selectedDate }) => {
  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState("createdDate.desc");

  const { ordersSold, isordersSoldLoading, orderTotal } = useOrderState();

  useEffect(() => {
       actions.fetchOrderSold(
        dispatch,
        limit,
        offset,
        debouncedSearchTerm,
        user?.organization,
        order,
        selectedDate
      );
    
   
  }, [dispatch, limit, offset, debouncedSearchTerm, user, order, selectedDate]);

  useEffect(() => {
    setPage(1);
    setOffset(0);
  }, [orderTotal]);
  
  const navigate = useNavigate();
  const [data, setdata] = useState([]);
  useEffect(() => {
    let items = [];
    ordersSold.forEach((order) => {
      items.push({
        address: order.address,
        chainId: order.chainId,
        key: order.address,
        orderNumber: order,
        buyerOrganization: order.buyerOrganization,
        orderTotal: order.orderTotal,
        date: getStringDate(order.orderDate, US_DATE_FORMAT),
        status: getStatus(parseInt(order.status)),
        invoice: order,
      });
    });
    setdata(items);
  }, [ordersSold]);

  const column = [
    {
      title: "Order Number".toUpperCase(),
      dataIndex: "orderNumber",
      key: "orderNumber",
      render: (order) => (
        <p
          id={order.orderId}
          onClick={() => {
            navigate(
              `${routes.SoldOrderDetails.url.replace(":id", order.address)}`
            );
          }}
          className="text-primary hover:text-primaryHover cursor-pointer"
        >
          {`#${order.orderId}`}
        </p>
      ),
    },
    {
      title: "buyer".toUpperCase(),
      dataIndex: "buyerOrganization",
      key: "buyerOrganization",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "order total ($)".toUpperCase(),
      dataIndex: "orderTotal",
      key: "orderTotal",
      render: (text) => <p>{text}</p>,
    },
    {
      dataIndex: "date",
      key: "date",
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>{"Date (mm/dd/yyyy)".toUpperCase()}</div>
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
      title: "invoice".toUpperCase(),
      dataIndex: "invoice",
      key: "invoice",
      render: (text) => (
        <button
          onClick={() => {
            TagManager.dataLayer({
              dataLayer: {
                event: "view_invoice_in_orders_sold",
              },
            });
          }}
        >
          <Link
            to={`${routes.Invoice.url.replace(":id", text.address)}`}
            target="_blank"
          >
            <div className="flex items-center cursor-pointer hover:text-primary">
              <EyeOutlined className="mr-2" />
              <p>View</p>
            </div>
          </Link>
        </button>
      ),
    },
    {
      title: "status".toUpperCase(),
      dataIndex: "status",
      key: "status",
      render: (text) => statusComponent(text),
      filters: [
        {
          text: "Awaiting Fulfillment",
          value: "Awaiting Fulfillment",
        },
        {
          text: "Awaiting Shipment",
          value: "Awaiting Shipment",
        },
        {
          text: "Canceled",
          value: "Canceled",
        },
        {
          text: "Closed",
          value: "Closed",
        },
      ],
      onFilter: (value, record) => record.status.startsWith(value),
      filterSearch: true,
      width: "15%",
    },
  ];

  const statusComponent = (status) => {
    let textClass = "text-orange bg-[#FFF6EC]";
    if (status === "Awaiting Shipment") {
      textClass = "text-blue  bg-[#EBF7FF]";
    } else if (status === "Closed") {
      textClass = "text-success  bg-[#EAFFEE]";
    } else if (status === "Canceled") {
      textClass = "text-error  bg-[#FFF0F0]";
    }

    return (
      <div className={classNames(textClass, "text-center py-1 rounded")}>
        <p>{status}</p>
      </div>
    );
  };

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };


  return (
    <div>
      <DataTableComponent
        columns={column}
        data={data}
        isLoading={isordersSoldLoading}
        pagination={false}
        // naviroute={routes.SoldOrderDetails.url}
        scrollX="100%"
      />
      <Pagination
        current={page}
        onChange={onPageChange}
        total={orderTotal}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default SoldOrdersTable;
