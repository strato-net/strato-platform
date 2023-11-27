import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { EyeOutlined, DownOutlined, UpOutlined, FilterFilled } from "@ant-design/icons";
import routes from "../../helpers/routes";
import DataTableComponent from "../DataTableComponent";
import { getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
import { useNavigate, Link } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT } from "../../helpers/constants";
import { Pagination, Button, Radio, Space} from "antd";
import TagManager from "react-gtm-module";
import "./ordersTable.css"


const BoughtOrdersTable = ({ user, selectedDate }) => {
  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState("createdDate.desc");
  const [filter, setFilter] = useState(0)
  const [selectedValue, setSelectedValue] = useState(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);

  const { orders, isordersLoading, orderBoughtTotal} = useOrderState();

  useEffect(() => {
    actions.fetchOrder(
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
        sellersCommonName: order.sellersCommonName,
        orderTotal: order.totalPrice,
        date: getStringDate(order.createdDate, US_DATE_FORMAT),
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
      dataIndex: "sellersCommonName",
      key: "sellersCommonName",
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
          <div className="mt-1.5">{"Date (mm/dd/yyyy)".toUpperCase()}</div>
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
      filterDropdown: ({confirm}) => ( dropdownVisible && (
        <div style={{ padding: 8 }}>
          <Radio.Group
            onChange={(e) => {
              setSelectedValue(e.target.value);
            }}
            value={selectedValue}
            vertical={true}
          >
            <Space direction="vertical">
              <Radio value={1}>Awaiting Fulfillment</Radio>
              <Radio value={2}>Awaiting Shipment</Radio>
              <Radio value={3}>Closed</Radio>
              <Radio value={4}>Canceled</Radio>
            </Space>
          </Radio.Group>
          <div className="mt-2" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              type="primary"
              onClick={() => {
                setFilter(0);
                setSelectedValue(null);
                setDropdownVisible(false);
                confirm();
              }}
              style={{ marginRight: 8 }}
            >
              Reset
            </Button>
            <Button
              type="primary"
              onClick={() => {
                if (selectedValue === null) {
                  setFilter(0);
                }
                else {
                  setFilter(selectedValue);
                }
                confirm();
              }}
            >
              OK
            </Button>
          </div>
        </div>
      )),
      filterIcon: () => (<FilterFilled style={{ color: filter !== 0 ? '#1890ff' : undefined }}/>),
      onFilterDropdownOpenChange: (visible) => {setDropdownVisible(visible)},
      filterSearch: true,
      filterMultiple: false,
      filterResetToDefaultFilteredValue: true,
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
