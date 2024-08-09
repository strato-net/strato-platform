import React, { useEffect, useState } from "react";
import { Button, Dropdown, Space, Typography, Input, Row, Col, Popover, Card, Tooltip, Select } from "antd";
import { DownOutlined, UpOutlined, DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import classNames from "classnames";
// Components
import DataTableComponent from "../DataTableComponent";
import { TRANSACTION_FILTER, dummyData, getStatus } from "./constant";
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

const limit = '', offset = '';

const TransactionTable = ({ user, selectedDate, onDateChange, download, isAllOrdersLoading }) => {
  const StratsIcon = <img src={Images.logo} alt="" className="mx-1 w-3 h-3" />
  const { userTransactions, globalTransaction, isTransactionLoading } = useTransactionState();
  const navigate = useNavigate();
  const location = useLocation();
  const transactionDispatch = useTransactionDispatch();

  const searchParams = new URLSearchParams(location.search);
  const searchVal = searchParams.get('search');
  const pageVal = searchParams.get('page');
  const type = searchParams.get('type');
  const pageNo = pageVal ? parseInt(pageVal) : 1;   
  const debouncedSearchTerm = useDebounce("", 1000);

  // const offset = ((pageNo - 1) * limit)
  const [order, setOrder] = useState("createdDate.desc");
  const [filter, setFilter] = useState(0)
  const [selectedValue, setSelectedValue] = useState(null);
  const [search, setSearch] = useState("")
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [mDropdownVisible, setMDropdownVisible] = useState(false);

  useEffect(() => {
    if(user?.commonName){
    transactionAction.fetchUserTransaction(
      transactionDispatch, 
      limit,
      offset,
      user?.commonName,
      type,
      searchVal);
    }
  }, [user, type, searchVal])

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (search.length === 0) {
        if(type){
          navigate(`/transaction?type=${type}`)
        }else{
          navigate(`/transaction`)
        }
      } else {
        if(type){
          navigate(`/transaction?type=${type}&search=${search}`)
        }else{
          navigate(`/transaction?search=${search}`)
        }
      }
    }, 1000)
    return () => {
      clearTimeout(timeout)
    }
  }, [search])


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
    return <div className="min-h-44 h-full" style={{ width: '460px' }}>
      <Card>
        <Row>
          <Col span={6}>
            <img src={data?.assetImage} alt={data?.assetName} className="border w-88 h-88 border-indigo-600 rounded-md" />
          </Col>
          <Col span={8} offset={1}>
            <p className="text-base font-bold">{data?.assetName}</p>
            <p style={{ color: '#827474' }} className="font-medium"><Tooltip placement="topRight" title={"description"}> {`${data.assetDescription.replace(/<\/?[^>]+(>|$)/g, "")?.slice(0, 25)}...`} </Tooltip></p>
          </Col>
          <Col span={8} offset={1}>
            <p className="text-right flex justify-end items-center"> <b>$ {data?.assetPrice} </b> &nbsp; ({data?.assetPrice * STRATS_CONVERSION} {StratsIcon}) </p>
            <p className="text-bold text-right mt-2">Sold Out</p>
          </Col>
        </Row>
      </Card>
    </div>
  };

  const handleDetailRedirection = (type, Id) => {
    let route;  
    // if(type==='Order'){
    //     route = `/order${routes.SoldOrderDetails.url.replace(":id", Id)}`
    //   }
    //   navigate(route)
      // else if(type==='Transfer'){
      //   route = `${routes.SoldOrderDetails.url.replace(":id", order.id ? order.transaction_hash : order.address)}`
      // }else if(type==='Redemption'){
      //   route = `${routes.SoldOrderDetails.url.replace(":id", order.id ? order.transaction_hash : order.address)}`
      // }
  }

  const column = [
    {
      title: "#",
      dataIndex: "reference",
      key: "reference",
      width: '80px',
      render: (reference, data) => (
        <p
          id={reference}
          onClick={() => {
            handleDetailRedirection(data.type, reference)
          }}
          className="text-[#13188A] hover:text-primaryHover cursor-pointer"
        >
          {`#${`${reference}`.substring(0, 6)}`}
        </p>
      ),
    },
    {
      title: <p className="text-center font-bold">Type</p>,
      dataIndex: "type",
      key: "type",
      width: "150px", 
      render: (text) => (<p style={{ background: TRANSACTION_STATUS_COLOR[text] }} className={`bg-${TRANSACTION_STATUS_COLOR[text]} min-w-[80px] text-center cursor-default px-2 py-2 rounded-lg text-white`}>{text}</p>),
    },
    {
      title: "Asset",
      dataIndex: "Item",
      key: "Item",
      align: "left",
      width: '150px',
      render: (asset, data) => <>
        <Popover className="flex " content={<Content data={data} />} trigger="hover">
          <div className="flex items-center">
            <img src={data?.assetImage} alt={data?.assetName} width={24} height={30} className="border w-6 h-8 border-indigo-600 rounded-md" />
            <span className="ml-1"> {data?.assetName.length>15 ?`${data?.assetName.slice(0, 15)}..`:data?.assetName} </span>
          </div>
        </Popover>
      </>
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
      align: "right",
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
      render: (data, { price }) => <p>{price}</p>
    },
    {
      title: "From",
      dataIndex: "from",
      key: "from",
      align: "center",
      width: '150px',
    },
    {
      title: "To",
      dataIndex: "to",
      key: "to",
      align: "center",
      width: '150px',
    },
    {
      title: "Hash",
      dataIndex: "hash",
      key: "hash",
      align: "left",
      width: '150px',
      render: (data, { address }) => <Tooltip placement="topRight" title={address}>
        <p className="text-[#13188A] hover:text-primaryHover cursor-pointer " >{`# ${address?.slice(0, 10)}..`}</p>
      </Tooltip>
    },
    {
      dataIndex: "date",
      key: "date",
      width: '150px',
      render: (text, { block_timestamp  }) => <p>{block_timestamp}</p>,
      title: (
        <div style={{ display: "flex" }}>
          <div className="mt-1.5">{"Date"}</div>
        </div>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: '150px',
      render: (text) => statusComponent(text),
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

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value)
  }

  const handleFilter = (val) =>{
    navigate(val ? `/transaction?type=${val}` : `/transaction`)  
  }

  return (
    <Row>
      {/* <Col span={4}></Col> */}
      <Col span={22} className="mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="hidden md:block"> My Transactions </h2>
          <div className="flex gap-2 items-center mb-5 mt-4">
            <Select className="block lg:block w-44 md:w-80 rounded-md" onChange={(val)=>{handleFilter(val)}} placeholder="Select Type" defaultValue={type || ''}>
              {TRANSACTION_FILTER.map(({label, value})=>
              <Select.Option value={value}> {label} </Select.Option>
               )}
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
          </div>
        </div>
        <div className="flex md:hidden order_responsive">
          <TransactionResponsive data={userTransactions} />
        </div>
        <div className="hidden md:block">
           < DataTableComponent
            columns={column}
            data={userTransactions}
            isLoading={isTransactionLoading}
            pagination={false}
            scrollX="100%"
          /> 
        </div>
      </Col>
    </Row>
  );
};

export default TransactionTable;
