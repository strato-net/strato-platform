import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { EyeOutlined, DownOutlined, UpOutlined  } from "@ant-design/icons";
import routes from "../../helpers/routes";
import DataTableComponent from "../DataTableComponent";
import { getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
import { useNavigate, Link } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Pagination, DatePicker} from "antd";
import TagManager from "react-gtm-module";
import "./ordersTable.css"
import dayjs from "dayjs";


const BoughtOrdersTable = ({ user }) => {
  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState("createdDate.desc");
  const [selectedDate, setSelectedDate] = useState("");
  
  
  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  const { orders, isordersLoading, orderBoughtTotal} = useOrderState();

  useEffect(() => {
    actions.fetchOrder(
      dispatch,
      limit,
      offset,
      debouncedSearchTerm,
      user?.organization,
      order,
      dayjs(selectedDate).startOf('day').unix()
    );
  }, [dispatch, limit, offset, debouncedSearchTerm, user, order, selectedDate]);
  
  useEffect(() => {
    setPage(1);
    setOffset(0);
  }, [orderBoughtTotal]);

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
              `${routes.BoughtOrderDetails.url.replace(":id", order.address)}`
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
      dataIndex: "date",
      key: "date",
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {/* <div>{"Date (mm/dd/yyyy)".toUpperCase()}</div> */}
          <div>
            <DatePicker
              value={selectedDate}
              disabledDate={(current) => {
                const currentDate = dayjs().startOf("day"); // Get the start of today
                const selectedDate = dayjs(current).startOf("day");

                return selectedDate.isAfter(currentDate);
              }}
              onChange={onDateChange}
              disabled={false}
            />
          </div>
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
                event: "view_invoice_in_orders_bought",
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
        pagination={false}
        isLoading={isordersLoading}
        // naviroute={routes.BoughtOrderDetails.url}
        scrollX="100%"
      />
      <Pagination
        current={page}
        onChange={onPageChange}
        total={orderBoughtTotal}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default BoughtOrdersTable;
