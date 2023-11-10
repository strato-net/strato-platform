import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { EyeOutlined } from "@ant-design/icons";
import TagManager from "react-gtm-module";
import classNames from "classnames";
import { Pagination } from "antd";
// Components
import DataTableComponent from "../DataTableComponent";

import routes from "../../helpers/routes";
import { getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
// Actions
import { actions as orderActions } from "../../contexts/order/actions";
// Dispatch and States
import { useOrderDispatch, useOrderState } from "../../contexts/order";
// Utils, Constants.
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT } from "../../helpers/constants";
import helper from "../../helpers/helper.json";
const { orderTableFilter } = helper;

const BoughtOrdersTable = ({ user }) => {
  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(10);
  const [page, setPage] = useState(1);

  const { orders, isordersLoading } = useOrderState();

  useEffect(() => {
    if (user?.organization) {
      orderActions.fetchOrder(
        dispatch,
        limit,
        offset,
        debouncedSearchTerm,
        user?.organization
      )
    }
  }, [dispatch, limit, offset, debouncedSearchTerm, user?.organization]);

  const navigate = useNavigate();
  const [data, setdata] = useState([]);
  useEffect(() => {

    let items = [];
    orders.forEach((order) => {
      items.push({
        address: order.address,
        chainId: order.chainId,
        key: order.address,
        orderNumber: order,
        sellerOrganization: order.sellerOrganization,
        orderTotal: order.orderTotal,
        date: getStringDate(order.orderDate, US_DATE_FORMAT),
        status: getStatus(parseInt(order.status)),
        invoice: order,
      });
    });
    setdata(items);
  }, [orders]);

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
              `${routes.BoughtOrderDetails.url.replace(
                ":id",
                order.address
              )}`
            );
          }}
          className="text-primary hover:text-primaryHover cursor-pointer"
        >
          {`#${order.orderId}`}
        </p>
      ),
    },
    {
      title: "seller".toUpperCase(),
      dataIndex: "sellerOrganization",
      key: "sellerOrganization",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "order total ($)".toUpperCase(),
      dataIndex: "orderTotal",
      key: "orderTotal",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "Date (mm/dd/yyyy)".toUpperCase(),
      dataIndex: "date",
      key: "date",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "invoice".toUpperCase(),
      dataIndex: "invoice",
      key: "invoice",
      render: (text) => (
        <button onClick={() => {
          TagManager.dataLayer({
            dataLayer: {
              event: 'view_invoice_in_orders_bought',
            },
          });
        }}>
          <Link to={`${routes.Invoice.url.replace(":id", text.address)}`} target="_blank" >
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
      filters: orderTableFilter,
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

  useEffect(() => {
    let len = data.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [data]);

  return (
    <div>
      <DataTableComponent
        columns={column}
        data={data}
        pagination={false}
        isLoading={isordersLoading}
        // naviroute={routes.BoughtOrderDetails.url}
        scrollX="100%"
      />
      <Pagination
        current={page}
        onChange={onPageChange}
        total={total}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default BoughtOrdersTable;
