import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { EyeOutlined, DownOutlined, UpOutlined, DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import routes from "../../helpers/routes";
import DataTableComponent from "../DataTableComponent";
import { dummyData, getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
import { useNavigate, Link, useParams, useLocation } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT, STRATS_CONVERSION } from "../../helpers/constants";
import { Pagination, Button, Dropdown, Menu, DatePicker, Space, Typography, Input, Row, Col } from "antd";
import TagManager from "react-gtm-module";
import "./ordersTable.css"
import { FilterIcon } from "../../images/SVGComponents";
import dayjs from "dayjs";
import { ResponsiveSoldOrderCard } from "./ResponsiveSoldOrdersCard";
import { Images } from "../../images";

const limit = 10;

const TransactionTable = ({ user, selectedDate, onDateChange, download, isAllOrdersLoading }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const searchParams = new URLSearchParams(location.search);
  const searchVal = searchParams.get('search');
  const pageVal = searchParams.get('page');
  const pageNo = pageVal ? parseInt(pageVal) : 1;
  const { type } = params;

  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);

  const offset = ((pageNo - 1) * limit)
  const [order, setOrder] = useState("createdDate.desc");
  const [filter, setFilter] = useState(0)
  const [selectedValue, setSelectedValue] = useState(null);
  const [search, setSearch] = useState("")
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [mDropdownVisible, setMDropdownVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [shouldRefetch, setShouldRefetch] = useState(true);

  const { ordersSold, isordersSoldLoading, orderSoldTotal } = useOrderState();

  useEffect(() => {
    if (user?.commonName && type === 'sold') {
      actions.fetchOrderSold(
        dispatch,
        limit,
        offset,
        user?.commonName,
        selectedDate,
        filter,
        order,
        searchVal
      );
    }
  }, [dispatch, limit, offset, debouncedSearchTerm, user, order, selectedDate, filter, shouldRefetch, searchVal]);

  // useEffect(() => {
  //   const timeout = setTimeout(() => {
  //     if (search.length === 0) {
  //       navigate(`/order/${type}`)
  //     } else {
  //       navigate(`/order/${type}?search=${search}`)
  //     }
  //   }, 1000)
  //   return () => {
  //     clearTimeout(timeout)
  //   }
  // }, [search])

  const [data, setdata] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const updatedData = ordersSold.map((order) => {
        return {
          address: order?.id ? order?.transaction_hash : order?.address,
          chainId: order?.chainId,
          key: order?.id ? order?.transaction_hash : order?.address,
          orderNumber: order,
          buyersCommonName: order?.purchasersCommonName,
          orderTotal: order?.currency === "STRATS" ? (order?.totalPrice * STRATS_CONVERSION).toFixed(0) : order?.totalPrice,
          date: getStringDate(order?.createdDate, US_DATE_FORMAT),
          status: getStatus(parseInt(order?.status)),
          invoice: order?.id ? order?.transaction_hash : order?.address,
          currency: order?.currency ? order?.currency : "USD"
        };
      });
      setIsLoading(false);
      setdata(updatedData);
    };

    fetchData();
  }, [ordersSold]);

  const handleSort = (data) => {
    setSelectedValue(data)
    setFilter(data);
    setDropdownVisible(false)
    setMDropdownVisible(false)
  }

  const Sorting = (classes) => {
    return (
      <div className={classes.className}>
        <Typography onClick={() => handleSort(0)}>All</Typography>
        <Typography onClick={() => handleSort(1)}>Awaiting Fulfillment</Typography>
        <Typography onClick={() => handleSort(2)}>Awaiting Shipment</Typography>
        <Typography onClick={() => handleSort(3)}>Closed</Typography>
        <Typography onClick={() => handleSort(4)}>Canceled</Typography>
        <Typography onClick={() => handleSort(5)}>Payment Pending</Typography>
      </div>
    )
  }

  const typeColor = {
  Order:"#2A53FF",
  Transfer:"#FF0000",
  Redemption:"#001C76"
  }

  const column = [
    {
      title: "(£)",
      dataIndex: "reference",
      key: "reference",
      render: (reference) => (
        <p
          id={reference}
          onClick={() => {  }}
          className="text-[#13188A] hover:text-primaryHover cursor-pointer"
        >
          {`#${`${reference}`.substring(0, 6)}`}
        </p>
      ),
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      render: (text) => ( <span style={{background:typeColor[text]}} className={`bg-${typeColor[text]} min-w-12 px-2 py-2 rounded-lg text-white`}>{text}</span>),
    },
    {
      title: "Item",
      dataIndex: "Item",
      key: "Item",
      render : (data, {imageURL, assetName}) => <div className="flex items-center"> <img src={imageURL[0]} alt={assetName} width={24} height={30} className="border border-indigo-600 rounded-md"  /> <span className="ml-1"> {assetName} </span> </div>
    },
    {
      title: "Qty",
      dataIndex: "qty",
      key: "qty",
      align: "center",
      // render : (data, {quantities, BlockApps-Mercata-Order-quantities}) => <span>{quantities[0] || BlockApps-Mercata-Order-quantities.value}</span>
       render : (data, {qty}) => <span>{qty}</span>
    },
    {
      title: "Price ($)",
      dataIndex: "price",
      key: "price",
      align: "center",
      render : (data, {totalPrice}) => <span>{totalPrice}</span>
    },
    {
      title: "From",
      dataIndex: "from",
      key: "from",
      align: "center",
    },
    {
      title: "To",
      dataIndex: "to",
      key: "to",
      align: "center",
    },
    {
      title: "# Hash",
      dataIndex: "hash",
      key: "hash",
      align: "center",
      render: (data, {block_hash}) => <p className="text-[#13188A] hover:text-primaryHover cursor-pointer " >{`# ${block_hash.slice(0, 8)}..`}</p>
    },
    {
      dataIndex: "date",
      key: "date",
      render: (text, {block_timestamp}) => <p>{block_timestamp}</p>,
      title: (
        <div style={{ display: "flex" }}>
          <div className="mt-1.5">{"Date"}</div>
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
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (text) => statusComponent(text),
      filterDropdown: ({ confirm }) => dropdownVisible && <Sorting className="hidden md:flex flex-col gap-1 sort_conatiner py-1" />,
      filterIcon: () => (<FilterIcon />),
      onFilterDropdownOpenChange: (visible) => { setDropdownVisible(visible) },
      filterSearch: true,
      filterMultiple: false,
      filterResetToDefaultFilteredValue: true,
      // width: "15%",
    },
  ];

  const statusComponent = (status) => {
    const statusClasses = {
      1: {
        textClass: "bg-[#EBF7FF]",
        bgClass: "bg-[#13188A]"
      },
      2: {
        textClass: "bg-[#FF8C0033]",
        bgClass: "bg-[#FF8C00]"
      },
      3: {
        textClass: "bg-[#FF8C0033]",
        bgClass: "bg-[#FF8C00]"
      },
      4: {
        textClass: "bg-[#119B2D33]",
        bgClass: "bg-[#119B2D]"
      },
      5: {
        textClass: "bg-[#FFF0F0]",
        bgClass: "bg-[#FF0000]"
      },
    };

    const statusName = {
      1 : 'payment Pending',
      2 : 'closed',
      3 : 'cancelled',
      4 : 'awaiting',
      5 : 'awaiting shipment'
    }

    const { textClass, bgClass } = statusClasses[status] || { textClass: "bg-[#FFF6EC]", bgClass: "bg-[#119B2D]" };
    return (
      <div className={classNames(textClass, "w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p>{statusName[status].slice(0, 12)}</p>
      </div>
    );
  };

  const onPageChange = (page) => {
    const baseUrl = new URL(`/order/${type}`, window.location.origin);
    if (searchVal) {
      baseUrl.searchParams.set("search", searchVal);
    }

    baseUrl.searchParams.set("page", page);
    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { new: true });
  };

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value)
  }

  const menuItems = [
    {
      key: 'xls',
      label: 'Excel',
    },
    {
      key: 'csv',
      label: 'CSV',
    },
  ];

  return (
    <Row>
      <Col span={4}></Col>
      <Col span={20}>
      <div className="flex items-center justify-between">
      <h2> My Transactions </h2>
      <div className="flex gap-2 items-center mb-5">
        <Input className="text-base orders_searchbar md:p-3 rounded-full bg-[#F6F6F6]"
          key={searchVal}
          onChange={(e) => { handleChangeSearch(e) }}
          defaultValue={searchVal}
          prefix={<SearchOutlined />}
          placeholder="Search Transactions #" />
        <Dropdown
          className="md:hidden customButton"
          menu={{ items: menuItems, onClick: (e) => download(e.key) }}
          disabled={isAllOrdersLoading}
          trigger={['click']}
        >
          <Button loading={isAllOrdersLoading} className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex md:hidden justify-center items-center">
            <Space>
              <DownloadOutlined />
            </Space>
          </Button>
        </Dropdown>
        <div className="text-xs flex items-center md:hidden">
          <DatePicker
            className="h-[32px] w-[33px] custom-picker"
            disabledDate={(current) => {
              const currentDate = dayjs().startOf('day'); // Get the start of today
              const selectedDate = dayjs(current).startOf('day');

              return selectedDate.isAfter(currentDate);
            }}
            onChange={onDateChange}
            disabled={false}
            suffixIcon={<img src={Images.calender} alt="calender" className="w-5 h-5" style={{ maxWidth: "none" }} />}
          />
        </div>
        <div className="relative">
          <div onClick={() => setMDropdownVisible(!mDropdownVisible)} className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex md:hidden justify-center items-center">
            <FilterIcon />
          </div>
          {mDropdownVisible && <Sorting className="md:hidden flex flex-col gap-1 absolute right-0 top-10 w-max shadow-card_shadow z-[99999] bg-white sort_conatiner py-1" />}
        </div>
      </div>
      </div>
      <div className="flex md:hidden order_responsive">
        <ResponsiveSoldOrderCard
          data={data}
          isLoading={isordersSoldLoading || isLoading}
        />
      </div>
      <div className="hidden md:block">
        <DataTableComponent
          columns={column}
          data={dummyData}
          isLoading={isordersSoldLoading || isLoading}
          pagination={false}
          scrollX="100%"
        />
      </div>
      <Pagination
        current={pageNo}
        onChange={onPageChange}
        total={orderSoldTotal}
        showSizeChanger={false}
        className="flex justify-center my-5"
      />
      </Col>
    </Row>
  );
};

export default TransactionTable;
