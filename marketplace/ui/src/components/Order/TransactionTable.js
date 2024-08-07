import React, { useEffect, useState } from "react";
import { Button, Dropdown, Space, Typography, Input, Row, Col, Popover, Card, Tooltip, Select } from "antd";
import { DownOutlined, UpOutlined, DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import classNames from "classnames";
// Components
import DataTableComponent from "../DataTableComponent";
import { dummyData, getStatus } from "./constant";
import { getStringDate } from "../../helpers/utils";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import useDebounce from "../UseDebounce";
import { US_DATE_FORMAT, STRATS_CONVERSION, TRANSACTION_STATUS, TRANSACTION_STATUS_CLASSES, TRANSACTION_SORT, TRANSACTION_STATUS_COLOR, DOWNLOAD_OPTIONS } from "../../helpers/constants";
import { FilterIcon } from "../../images/SVGComponents";
import "./ordersTable.css"
import routes from "../../helpers/routes";
import { Images } from "../../images";
import dayjs from "dayjs";
import TransactionResponsive from "./TransactionResponsive";
import { actions as transactionAction } from "../../contexts/transaction/actions";
import { useTransactionDispatch, useTransactionState } from "../../contexts/transaction";

const limit = 10;

const TransactionTable = ({ user, selectedDate, onDateChange, download, isAllOrdersLoading }) => {
  const StratsIcon = <img src={Images.logo} alt="" className="mx-1 w-3 h-3" />
  const { userTransactions, globalTransaction, isTransactionLoading } = useTransactionState();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const transactionDispatch = useTransactionDispatch();

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
    transactionAction.fetchUserTransaction(transactionDispatch);
  }, [])

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

  // useEffect(() => {
  //   const fetchData = async () => {
  //     const updatedData = ordersSold.map((order) => {
  //       return {
  //         address: order?.id ? order?.transaction_hash : order?.address,
  //         chainId: order?.chainId,
  //         key: order?.id ? order?.transaction_hash : order?.address,
  //         orderNumber: order,
  //         buyersCommonName: order?.purchasersCommonName,
  //         orderTotal: order?.currency === "STRATS" ? (order?.totalPrice * STRATS_CONVERSION).toFixed(0) : order?.totalPrice,
  //         date: getStringDate(order?.createdDate, US_DATE_FORMAT),
  //         status: getStatus(parseInt(order?.status)),
  //         invoice: order?.id ? order?.transaction_hash : order?.address,
  //         currency: order?.currency ? order?.currency : "USD"
  //       };
  //     });
  //     setIsLoading(false);
  //     setdata(updatedData);
  //   };

  //   fetchData();
  // }, [ordersSold]);

  const handleSort = (data) => {
    setSelectedValue(data)
    setFilter(data);
    setDropdownVisible(false)
    setMDropdownVisible(false)
  }

  const Sorting = (classes) => {
    return (
      <div className={classes.className}>
        {TRANSACTION_SORT.map(({ label, value }) => <Typography onClick={() => handleSort(value)}>{label}</Typography>)}
      </div>
    )
  }

  const Content = ({ data }) => {
    return <div style={{ width: '460px', height: '170px' }}>
      <Card>
        <Row>
          <Col span={6}>
            <img src={data?.imageURL[0]} alt={data?.assetName} className="border w-88 h-88 border-indigo-600 rounded-md" />
          </Col>
          <Col span={8} offset={1}>
            <p className="text-base font-bold">{data?.assetName}</p>
            <p style={{ color: '#827474' }} className="font-medium"><Tooltip placement="topRight" title={"description......."}> Lorem ipsum dolor sit amet, consectetur adipiscing elit </Tooltip></p>
          </Col>
          <Col span={8} offset={1}>
            <p className="text-right flex justify-end items-center"> <b>$ {data?.totalPrice} </b> &nbsp; ({data?.totalPrice * 100} {StratsIcon}) </p>
            <p className="text-bold text-right mt-2">Sold Out</p>
          </Col>
        </Row>
      </Card>
    </div>
  };

  const column = [
    {
      title: "#",
      dataIndex: "reference",
      key: "reference",
      responsive: ['sm'],
      render: (reference) => (
        <p
          id={reference}
          onClick={() => { }}
          className="text-[#13188A] hover:text-primaryHover cursor-pointer"
        >
          {`#${`${reference}`.substring(0, 6)}`}
        </p>
      ),
    },
    // {
    //   title: <p className="text-center font-bold">Type</p>,
    //   dataIndex: "type",
    //   key: "type",
    //   responsive: ['sm'],
    //   render: (text) => (<p style={{ background: TRANSACTION_STATUS_COLOR[text] }} className={`bg-${TRANSACTION_STATUS_COLOR[text]} min-w-[80px] text-center cursor-default px-2 py-2 rounded-lg text-white`}>{text}</p>),
    // },
    // {
    //   title: "Asset",
    //   dataIndex: "Item",
    //   key: "Item",
    //   align: "center",
    //   render: (asset, data) => <>
    //     <Popover className="flex justify-center items-center" content={<Content data={data} />} trigger="hover">
    //       <div >
    //         <img src={data?.imageURL[0]} alt={data?.assetName} width={24} height={30} className="border border-indigo-600 rounded-md" />
    //         <span className="ml-1"> {data?.assetName} </span>
    //       </div>
    //     </Popover>
    //   </>
    // },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      align: "center",
      width: '100px',
      // render : (data, {quantities, BlockApps-Mercata-Order-quantities}) => <span>{quantities[0] || BlockApps-Mercata-Order-quantities.value}</span>
      render: (data, { quantity }) => <span>{quantity}</span>
    },
    {
      title: "Price ($)",
      dataIndex: "price",
      key: "price",
      align: "right",
      width: '100px',
      render: (data, { totalPrice }) => <p>{totalPrice}</p>
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
      title: "Hash",
      dataIndex: "hash",
      key: "hash",
      align: "left",
      render: (data, { block_hash }) => <Tooltip placement="topRight" title={block_hash}>
        <p className="text-[#13188A] hover:text-primaryHover cursor-pointer " >{`# ${block_hash.slice(0, 5)}..`}</p>
      </Tooltip>
    },
    {
      dataIndex: "date",
      key: "date",
      render: (text, { block_timestamp }) => <p>{block_timestamp}</p>,
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

    const { textClass, bgClass } = TRANSACTION_STATUS_CLASSES[status] || { textClass: "bg-[#FFF6EC]", bgClass: "bg-[#119B2D]" };
    return (
      <div className={classNames(textClass, "w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p>{TRANSACTION_STATUS[status]}</p>
      </div>
    );
  };

  // const onPageChange = (page) => {
  //   const baseUrl = new URL(`/order/${type}`, window.location.origin);
  //   if (searchVal) {
  //     baseUrl.searchParams.set("search", searchVal);
  //   }

  //   baseUrl.searchParams.set("page", page);
  //   const url = baseUrl.pathname + baseUrl.search;
  //   navigate(url, { new: true });
  // };

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value)
  }

  return (
    <Row>
      {/* <Col span={4}></Col> */}
      <Col span={22} className="mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="hidden md:block"> My Transactions </h2>
          <div className="flex gap-2 items-center mb-5 mt-4">
            <Select className="hidden lg:block" defaultValue={"Redemption"}>
              <Select.Option value="Order" > Order </Select.Option>
              <Select.Option value="Transfer" > Transfer </Select.Option>
              <Select.Option value="Redemption" > Redemption </Select.Option>
            </Select>
            <Input className="text-base orders_searchbar md:p-3 rounded-full bg-[#F6F6F6]"
              key={searchVal}
              onChange={(e) => { handleChangeSearch(e) }}
              defaultValue={searchVal}
              prefix={<SearchOutlined />}
              placeholder="Search Transactions #" />
            <Dropdown
              className="md:hidden customButton"
              menu={{ items: DOWNLOAD_OPTIONS, onClick: (e) => download(e.key) }}
              disabled={isAllOrdersLoading}
              trigger={['click']}
            >
              <Button loading={isAllOrdersLoading} className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex justify-center items-center">
                <Space>
                  <DownloadOutlined />
                </Space>
              </Button>
            </Dropdown>
            <div className="relative">
              <div onClick={() => setMDropdownVisible(!mDropdownVisible)} className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex md:hidden justify-center items-center">
                <FilterIcon />
              </div>
              {mDropdownVisible && <Sorting className="md:hidden flex flex-col gap-1 absolute right-0 top-10 w-max shadow-card_shadow z-[99999] bg-white sort_conatiner py-1" />}
            </div>
          </div>
        </div>
        <div className="flex lg:hidden order_responsive">
          {/* <ResponsiveSoldOrderCard
          data={data}
          isLoading={isordersSoldLoading || isLoading}
        /> */}
          <TransactionResponsive data={userTransactions} />
        </div>
        <div className="hidden lg:block">
           < DataTableComponent
            columns={column}
            data={userTransactions}
            isLoading={isTransactionLoading}
            pagination={false}
            scrollX="100%"
          /> 
        </div>
        {/* <Pagination
        current={pageNo}
        onChange={onPageChange}
        total={orderSoldTotal}
        showSizeChanger={false}
        className="flex justify-center my-5"
      /> */}
      </Col>
    </Row>
  );
};

export default TransactionTable;
