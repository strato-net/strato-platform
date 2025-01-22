import React, { useEffect, useState } from 'react';
import {
  Button,
  Row,
  Col,
  Popover,
  Card,
  Tooltip,
  Spin,
  Typography,
} from 'antd';
import { CloseOutlined, FilterOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
// Components
import DataTableComponent from '../DataTableComponent';
import InfiniteScroll from 'react-infinite-scroll-component';
import './../Order/ordersTable.css';
import routes from '../../helpers/routes';
import dayjs from 'dayjs';
import { Images } from '../../images';
// Actions
import { actions as transactionAction } from '../../contexts/transaction/actions';
// Dispatch & States
import {
  useTransactionDispatch,
  useTransactionState,
} from '../../contexts/transaction';
// Utils & Constants
import {
  TRANSACTION_STATUS_COLOR,
  DATE_TIME_FORMAT,
  TRANSACTION_STATUS_TEXT,
} from '../../helpers/constants';
import { SEO } from '../../helpers/seoConstant';
import { getStringDate } from '../../helpers/utils';
import { TRANSACTION_FILTER } from '../Order/constant';
import GlobalTransactionResponsive from './GlobalTransactionResponsive';

const { Title } = Typography;

const GlobalTransaction = ({
  user,
  USDSTAddress,
  assetsWithEighteenDecimalPlaces,
  ethstAddress,
}) => {
  const USDSTIcon = (
    <img src={Images.USDST} alt="USDST" className="mx-1 w-4 h-4" />
  );
  // Dispatch
  const transactionDispatch = useTransactionDispatch();
  // States
  const { globalTransactions, isTransactionLoading, count } =
    useTransactionState();

  const navigate = useNavigate();

  const [limit, setLimit] = useState(200);
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState([]);
  const [transactions, setTransactions] = useState(globalTransactions);
  const [selectedFilters, setSelectedFilters] = useState([
    'Order',
    'Transfer',
    'Redemption',
    'Stake',
    'Unstake',
  ]);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  const getWeekRange = (offset) => {
    const now = dayjs();
    const startDate = now
      .subtract((offset + 1) * 7, 'day')
      .startOf('day')
      .unix();
    const endDate = now
      .subtract(offset * 7, 'day')
      .endOf('day')
      .unix();
    return [startDate, endDate];
  };

  useEffect(() => {
    transactionAction.fetchGlobalTransaction(
      transactionDispatch,
      limit,
      offset,
      selectedFilters,
      getWeekRange(offset)
    );
  }, [offset, selectedFilters]);

  useEffect(() => {
    let filteredData = globalTransactions;
    setList((prev) => [...prev, ...globalTransactions]);
    setTransactions(filteredData);
  }, [globalTransactions]);

  const Content = ({ data }) => {
    const price = data?.assetPrice || data?.price;
    const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
      data.assetOriginAddress
    );

    return (
      <div className="min-h-44 h-full" style={{ width: '460px' }}>
        <Card>
          <Row>
            <Col span={6}>
              <img
                src={data?.assetImage}
                alt={data?.assetName}
                className="border w-88 h-88 border-indigo-600 rounded-md"
              />
            </Col>
            <Col span={8} offset={1}>
              <p
                className="text-base font-bold text-truncate cursor-pointer"
                onClick={() => {
                  handleAssetRedirection(data);
                }}
              >
                {data?.assetName}
              </p>
              <p
                style={{ color: '#827474' }}
                className="font-medium mt-2 min-h-20 cursor-default text-truncate"
              >
                <Tooltip
                  placement="top"
                  title={data.assetDescription.replace(/<\/?[^>]+(>|$)/g, '')}
                >
                  {data?.assetDescription.replace(/<\/?[^>]+(>|$)/g, '')}
                </Tooltip>
              </p>
            </Col>
            <Col span={8} offset={1}>
              {price ? (
                <p className="text-right flex justify-end items-center">
                  <b>
                    $
                    {is18DecimalPlaces
                      ? (price * Math.pow(10, 18)).toFixed(2)
                      : price}
                  </b>
                  &nbsp;(
                  <span className="text-[#13188A] font-bold">
                    {is18DecimalPlaces
                      ? (price * Math.pow(10, 18)).toFixed(2)
                      : price}
                  </span>
                  {USDSTIcon})
                </p>
              ) : (
                <p className="text-right text-[#13188A] font-bold text-sm">
                  No Price Available
                </p>
              )}
            </Col>
          </Row>
        </Card>
      </div>
    );
  };

  const handleAssetRedirection = (data) => {
    const isEthst = data?.assetOriginAddress === ethstAddress;
    if (isEthst) {
      const url = routes.EthstProductDetail.url;
      navigate(`${url.replace(':address', data.assetAddress)}`, {
        state: { isCalledFromInventory: false },
      });
    } else {
      const url = routes.MarketplaceProductDetail.url
        .replace(':address', data.assetAddress)
        .replace(':name', data.assetName);
      navigate(url);
    }
  };

  const column = [
    {
      title: <p className="text-center font-bold">Type</p>,
      dataIndex: 'type',
      key: 'type',
      width: '150px',
      render: (text) => (
        <p
          style={{
            background: TRANSACTION_STATUS_COLOR[text],
            color: TRANSACTION_STATUS_TEXT[text],
          }}
          className={`
        bg-${TRANSACTION_STATUS_COLOR[text]} 
        min-w-[80px] text-center cursor-default px-2 py-2 rounded-lg text-white`}
        >
          {text}
        </p>
      ),
    },
    {
      title: 'Asset',
      dataIndex: 'Item',
      key: 'Item',
      align: 'left',
      width: '150px',
      render: (asset, data) => (
        <Popover
          className="flex"
          content={<Content data={data} />}
          trigger="hover"
        >
          <div className="flex items-center cursor-default">
            <img
              src={data?.assetImage}
              alt={data?.assetName}
              width={24}
              height={30}
              className="border w-9 h-9 border-indigo-600 rounded-md object-contain"
            />
            <span className="ml-1 text-truncate">{data?.assetName}</span>
          </div>
        </Popover>
      ),
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right',
      width: '100px',
      render: (data, { quantity, assetOriginAddress }) => {
        let formattedQuantity = '--';

        if (quantity) {
          const value = assetsWithEighteenDecimalPlaces.includes(
            assetOriginAddress
          )
            ? quantity / Math.pow(10, 18)
            : quantity;

          formattedQuantity = value.toLocaleString('en-US', {
            maximumFractionDigits: 4,
            minimumFractionDigits: 0,
          });
        }

        return <span>{formattedQuantity}</span>;
      },
    },
    {
      title: 'Price',
      dataIndex: 'price',
      key: 'price',
      align: 'right',
      width: '100px',
      render: (data, { price, assetOriginAddress }) => (
        <>
          <p className="text-base flex justify-end items-center">
            {price
              ? formattedNum(
                  assetsWithEighteenDecimalPlaces.includes(assetOriginAddress)
                    ? (price * Math.pow(10, 18)).toFixed(2)
                    : price
                )
              : '--'}
            <span>{price && USDSTIcon}</span>
          </p>
          <p className="text-xs">
            {price
              ? `$ ${formattedNum(
                  assetsWithEighteenDecimalPlaces.includes(assetOriginAddress)
                    ? (price * Math.pow(10, 18)).toFixed(2)
                    : price
                )}`
              : '--'}
          </p>
        </>
      ),
    },
    {
      title: 'Buyer/Sender',
      dataIndex: 'from',
      key: 'from',
      align: 'center',
      width: '150px',
    },
    {
      title: 'Seller/Recipient',
      dataIndex: 'to',
      key: 'to',
      align: 'center',
      width: '150px',
    },
    {
      dataIndex: 'date',
      key: 'date',
      width: '150px',
      render: (text, { createdDate }) => (
        <p>{getStringDate(createdDate, DATE_TIME_FORMAT)}</p>
      ),
      title: (
        <div style={{ display: 'flex' }}>
          <div>{'Date'}</div>
        </div>
      ),
    },
  ];

  const metaImg = SEO.IMAGE_META;

  const handleFilter = (value) => {
    setList([]);
    setOffset(0);
    setSelectedFilters((prev) => {
      if (prev.includes(value)) {
        const arr = prev.filter((item) => item !== value);
        return arr;
      } else {
        const arr = [...prev, value];
        return arr;
      }
    });
  };

  const bgColor = (item) => {
    return selectedFilters.includes(item) ? 'bg-[#8388D2]' : 'bg-[#F6F6F6]';
  };

  const handleFilterActive = () => {
    setIsFilterActive((prev) => !prev);
  };

  const FilterComponent = () => {
    return (
      <Card>
        <Title level={5} className="mt-2">
          Transaction Types
        </Title>
        <div className="flex flex-wrap">
          {TRANSACTION_FILTER.slice(1, 6)?.map(({ label }) => {
            return (
              <span
                onClick={() => {
                  handleFilter(label);
                }}
                className={`border-lg p-2 m-2 rounded-lg ${bgColor(
                  label
                )} cursor-pointer`}
                key={label}
              >
                {label}
              </span>
            );
          })}
        </div>
      </Card>
    );
  };

  const handleClearFilter = () => {
    setSelectedFilters([]);
    setOffset(0);
    setList([]);
  };

  const SelectedFilter = () => {
    return (
      selectedFilters?.length !== 0 && (
        <div className="h-auto w-full p-2 flex flex-wrap">
          {selectedFilters?.map((item) => (
            <span
              onClick={() => {
                handleFilter(item);
              }}
              className="p-2 m-2 rounded-lg bg-[#F6F6F6] cursor-pointer"
              key={item}
            >
              {item}
              <span className="font-semibold">
                <CloseOutlined />
              </span>
            </span>
          ))}
          <span
            onClick={handleClearFilter}
            className="p-2 m-2 rounded-lg bg-[#13188A] cursor-pointer text-white"
          >
            Clear All
          </span>
        </div>
      )
    );
  };

  const fetchData = () => {
    setOffset(offset + 1);
  };

  return (
    <Row>
      <Col
        span={24}
        className="w-full xs:max-h-[60px] py-4 px-4 md:min-h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row lg:px-14 justify-between items-center mt-6 lg:mt-8"
      >
        <Row className="w-full flex justify-between items-center">
          <Col xs={24} lg={4} className="flex justify-between w-full">
            <Button
              className="!px-1 md:!px-0 md:ml-5 lg:ml-0  flex items-center flex-row-reverse gap-[6px] text-lg md:text-2xl font-semibold !text-[#13188A] "
              type="link"
              icon={
                <img
                  src={Images.ForwardIcon}
                  alt={metaImg}
                  title={metaImg}
                  className="hidden md:block w-6 h-6"
                />
              }
            >
              Activity Feed
            </Button>
          </Col>
        </Row>
      </Col>
      <Col span={22} className="mx-auto mt-5 ">
        <div className="w-full flex md:hidden order_responsive">
          <Row className="w-full">
            <Col>
              <SelectedFilter />
            </Col>
            <Col span={24}>
              <div className="w-full flex justify-between items-center">
                <Title level={3} className="mt-2">
                  Filter
                </Title>
                <Button
                  type="primary"
                  shape="round"
                  onClick={handleFilterActive}
                  icon={isFilterActive ? <CloseOutlined /> : <FilterOutlined />}
                  size={'large'}
                />
              </div>
              {isFilterActive && <FilterComponent />}
            </Col>
            <GlobalTransactionResponsive
              data={list}
              user={user}
              isTransactionLoading={isTransactionLoading}
              assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
              ethstAddress={ethstAddress}
            />
          </Row>
        </div>
        <div className="hidden md:block">
          <Row>
            <Col span={5}>
              <Title level={3} className="mt-2">
                Filter
              </Title>
              <FilterComponent />
            </Col>
            <Col span={18} offset={1}>
              <SelectedFilter />
              <div id="scrollableDiv">
                <InfiniteScroll
                  dataLength={list.length}
                  next={fetchData}
                  hasMore={true}
                  loader={
                    isTransactionLoading && (
                      <h3 className="text-center">
                        <Spin />
                      </h3>
                    )
                  }
                  endMessage={
                    <p style={{ textAlign: 'center' }}>
                      <b>Yay! You have seen it all</b>
                    </p>
                  }
                >
                  <DataTableComponent
                    columns={column}
                    data={list}
                    isLoading={false}
                    pagination={false}
                    scrollX="100%"
                  />
                </InfiniteScroll>
              </div>
            </Col>
          </Row>
        </div>
      </Col>
    </Row>
  );
};

export default GlobalTransaction;
