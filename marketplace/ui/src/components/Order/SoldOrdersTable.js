import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { EyeOutlined, DownOutlined, UpOutlined, FilterFilled} from "@ant-design/icons";
import routes from "../../helpers/routes";
import DataTableComponent from "../DataTableComponent";
import { getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
import { useNavigate, Link } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Pagination, Button, Radio, Space, Typography} from "antd";
import TagManager from "react-gtm-module";
import "./ordersTable.css"
import { FilterIcon } from "../../images/SVGComponents";


const SoldOrdersTable = ({ user, selectedDate }) => {
  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState("createdDate.desc");
  const [filter, setFilter] = useState(0)
  const [selectedValue, setSelectedValue] = useState(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);

  const { ordersSold, isordersSoldLoading, orderSoldTotal } = useOrderState();

  useEffect(() => {
    actions.fetchOrderSold(
      dispatch,
      limit,
      offset,
      user?.commonName,
      selectedDate,
      filter,
      order
    );

  }, [dispatch, limit, offset, debouncedSearchTerm, user, order, selectedDate, filter]);

  useEffect(() => {
    setPage(1);
    setOffset(0);
  }, [orderSoldTotal]);

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
        buyersCommonName: order.purchasersCommonName,
        orderTotal: order.totalPrice,
        date: getStringDate(order.createdDate, US_DATE_FORMAT),
        status: getStatus(parseInt(order.status)),
        invoice: order,
      });
    });
    setdata(items);
  }, [ordersSold]);

  const handleSort = (data) => {
    setSelectedValue(data)
    setFilter(data);
    setDropdownVisible(false)
  }

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
          className="text-[#13188A] hover:text-primaryHover cursor-pointer"
        >
          {`#${order.orderId}`}
        </p>
      ),
    },
    {
      title: "buyer".toUpperCase(),
      dataIndex: "buyersCommonName",
      key: "buyersCommonName",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "order total ($)".toUpperCase(),
      dataIndex: "orderTotal",
      key: "orderTotal",
      render: (text) => <p>${text}</p>,
    },
    {
      dataIndex: "date",
      key: "date",
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: "flex" }}>
          <div className="mt-1.5">{"Date".toUpperCase()}</div>
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
            window.LOQ.push(['ready', async LO => {
              await LO.$internal.ready('events')
              LO.events.track('Orders Sold: View Invoice')
            }])
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
      filterDropdown: ({confirm}) => ( dropdownVisible && (
        <div className="flex flex-col gap-2 sort_conatiner py-1">
          <Typography onClick={()=>handleSort(0)}>All</Typography>
          <Typography onClick={()=>handleSort(1)}>Awaiting Fulfillment</Typography>
          <Typography onClick={()=>handleSort(2)}>Awaiting Shipment</Typography>
          <Typography onClick={()=>handleSort(3)}>Closed</Typography>
          <Typography onClick={()=>handleSort(4)}>Canceled</Typography>
        </div>
    )),
      filterIcon: () => (<FilterIcon />),
      onFilterDropdownOpenChange: (visible) => {setDropdownVisible(visible)},
      filterSearch: true,
      filterMultiple: false,
      filterResetToDefaultFilteredValue: true,
      width: "15%",
    },
  ];

  const statusComponent = (status) => {
    let textClass = "bg-[#FFF6EC]";
    if (status === "Awaiting Shipment") {
      textClass = "bg-[#EBF7FF]";
    } else if (status === "Awaiting Fulfillment"){
      textClass = "bg-[#FF8C0033]"
    } else if (status === "Closed") {
      textClass = "bg-[#119B2D33]";
    } else if (status === "Canceled") {
      textClass = "bg-[#FFF0F0]";
    }
    let bgClass = "bg-[#119B2D]";
    if (status === "Awaiting Shipment") {
      bgClass = "bg-[#13188A]";
    } else if (status === "Awaiting Fulfillment"){
      bgClass = "bg-[#FF8C00]"
    } else if (status === "Closed") {
      bgClass = "bg-[#119B2D]";
    } else if (status === "Canceled") {
      bgClass = "bg-[#FF0000]";
    }
    return (
      <div className={classNames(textClass, "w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
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
        scrollX="100%"
      />
      <Pagination
        current={page}
        onChange={onPageChange}
        total={orderSoldTotal}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default SoldOrdersTable;
