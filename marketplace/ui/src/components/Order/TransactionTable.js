import React, { useEffect, useState } from 'react';
import {
  Button,
  Dropdown,
  Space,
  Input,
  Row,
  Col,
  Popover,
  Card,
  Tooltip,
  Select,
  DatePicker,
  Spin,
  Pagination,
} from 'antd';
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import dayjs from 'dayjs';
// Components
import DataTableComponent from '../DataTableComponent';
import { TRANSACTION_FILTER } from './constant';

import './ordersTable.css';
import routes from '../../helpers/routes';
import { Images } from '../../images';
import TransactionResponsive from './TransactionResponsive';
// Actions
import { actions as transactionAction } from '../../contexts/transaction/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
// Dispatch & States
import {
  useTransactionDispatch,
  useTransactionState,
} from '../../contexts/transaction';
import { useEthState } from '../../contexts/eth';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
// Utils & Constants
import {
  TRANSACTION_STATUS,
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_COLOR,
  DOWNLOAD_OPTIONS,
  REDEMPTION_STATUS,
  REDEMPTION_STATUS_CLASSES,
  DATE_TIME_FORMAT,
  TRANSACTION_STATUS_TEXT,
} from '../../helpers/constants';
import { SEO } from '../../helpers/seoConstant';
import { getStringDate } from '../../helpers/utils';

const TransactionTable = ({
  user,
  download,
  stratAddress,
  assetsWithEighteenDecimalPlaces,
}) => {
  const USDSTIcon = (
    <img src={Images.USDST} alt="USDST" className="mx-1 w-4 h-4" />
  );
  // Dispatch
  const transactionDispatch = useTransactionDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  // States
  const { userTransactions, isTransactionLoading } = useTransactionState();

  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const urlType = searchParams.get('type');
  const urlDate = searchParams.get('date');

  const limit = 200;
  const pageSize = 10;
  const [offset, setOffset] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [type, setType] = useState(urlDate ? '' : undefined);
  const [filterSelected, setFilterSelected] = useState(false);
  const [dateQuery, setDateQuery] = useState(urlDate || '');
  const [transactions, setTransactions] = useState(userTransactions);
  const [originAddress, setOriginAddress] = useState('');
  const [search, setSearch] = useState('');
  const { ethstAddress } = useEthState();

  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);
  const defaultDate = dateQuery
    ? dayjs.unix(dayjs(dateQuery, 'MMMM YYYY').startOf('month').unix())
    : '';

  useEffect(() => {
    async function fetchUSDSTAddress() {
      const USDSTAddress = await marketplaceActions.fetchUSDSTAddress(
        marketplaceDispatch
      );
      await marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
      setOriginAddress(USDSTAddress);
    }
    fetchUSDSTAddress();
  }, [marketplaceDispatch]);

  useEffect(() => {
    if (user?.commonName && user?.userAddress && dateQuery) {
      transactionAction.fetchUserTransaction(
        transactionDispatch,
        limit,
        offset,
        user?.commonName,
        user?.userAddress,
        dateReturn(dateQuery)
      );
    }
    if (user?.commonName && !dateQuery) {
      transactionAction.fetchUserTransaction(
        transactionDispatch,
        limit,
        offset,
        user?.commonName,
        user?.userAddress
      );
    }
  }, [user, dateQuery, offset]);

  useEffect(() => {
    // Update state based on URL params, but skip empty values
    setType(urlType ? urlType : filterSelected ? '' : urlDate ? '' : undefined);
    setDateQuery(urlDate || '');
  }, [location.search]);

  useEffect(() => {
    let filteredData = userTransactions;
    // Type filter
    if (type) {
      if (type === 'USDST') {
        filteredData = filteredData.filter(
          (item) => item.assetOriginAddress === originAddress
        );
      } else {
        filteredData = filteredData.filter((item) => item.type === type);
      }
    }

    // Search filter
    if (search) {
      const searchString = String(search).toLowerCase();
      filteredData = filteredData.filter((item) =>
        String(item.assetName).toLowerCase().includes(searchString)
      );
    }

    // Apply the date filter (month and year comparison)
    if (dateQuery) {
      // Format `dateQuery` (e.g., "August 2024") into a dayjs object
      const selectedMonthYear = dayjs(dateQuery, 'MMMM YYYY');

      filteredData = filteredData.filter((item) => {
        let blockTimestamp = item.block_timestamp;
        if (blockTimestamp.includes('UTC')) {
          blockTimestamp = blockTimestamp.replace(' UTC', 'Z');
        }
        const itemDate = dayjs(blockTimestamp);

        // Compare both month and year
        return (
          itemDate.isSame(selectedMonthYear, 'month') &&
          itemDate.isSame(selectedMonthYear, 'year')
        );
      });
    }
    setCurrentPage(1);
    setTransactions(filteredData);
  }, [userTransactions, type, search, dateQuery]);

  // Handle the date change event. Update the URL and state
  const onDateChange = (date) => {
    const unixTimestamp = dayjs(date).unix();
    const formattedDate = dayjs.unix(unixTimestamp).format('MMMM YYYY');
    const currentType = type || ''; // Use the current type value or empty if not set
    navigate(`/transactions?type=${currentType}&date=${formattedDate}`);
    setDateQuery(formattedDate); // Update the date state
    setType('');
  };

  const dateReturn = (date) => {
    const parsedDate = dayjs(date, 'MMMM YYYY').startOf('month');
    const startDate = parsedDate.unix();
    const endDate = parsedDate.endOf('month').unix();
    return [startDate, endDate];
  };

  const Content = ({ data }) => {
    const price = data?.assetPrice || data?.price;
    const isStrat = data?.assetOriginAddress === stratAddress;
    const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
      data?.assetOriginAddress
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
                  {' '}
                  {data?.assetDescription.replace(/<\/?[^>]+(>|$)/g, '')}{' '}
                </Tooltip>
              </p>
            </Col>
            <Col span={8} offset={1}>
              {price ? (
                <p className="text-right flex justify-end items-center">
                  {' '}
                  <b>
                    ${' '}
                    {isStrat
                      ? (price * 100).toFixed(2)
                      : is18DecimalPlaces
                      ? (price * Math.pow(10, 18)).toFixed(2)
                      : price}{' '}
                  </b>{' '}
                  &nbsp;(
                  <span className="text-[#13188A] font-bold">
                    {' '}
                    {isStrat
                      ? (price * 100).toFixed(2)
                      : is18DecimalPlaces
                      ? (price * Math.pow(10, 18)).toFixed(2)
                      : price}{' '}
                  </span>
                  {USDSTIcon}){' '}
                </p>
              ) : (
                <p className="text-right text-[#13188A] font-bold text-sm">
                  {' '}
                  No Price Available{' '}
                </p>
              )}
            </Col>
          </Row>
        </Card>
      </div>
    );
  };

  const handleDetailRedirection = (data) => {
    let route;
    if (data.type === 'Order' && data.sellersCommonName === user.commonName) {
      route = `${routes.SoldOrderDetails.url.replace(
        ':id',
        data.address ? data.transaction_hash : data.address
      )}`;
    } else if (
      data.type === 'Order' &&
      data.sellersCommonName !== user.commonName
    ) {
      route = `${routes.BoughtOrderDetails.url.replace(
        ':id',
        data.address ? data.transaction_hash : data.address
      )}`;
    } else if (data.type === 'Transfer') {
    } else if (data.type === 'Redemption' && data.to === user.commonName) {
      route = `${routes.RedemptionsIncomingDetails.url
        .replace(':id', data.redemption_id)
        .replace(':redemptionService', data.redemptionService)}`;
    } else if (data.type === 'Redemption' && data.from === user.commonName) {
      route = `${routes.RedemptionsOutgoingDetails.url
        .replace(':id', data.redemption_id)
        .replace(':redemptionService', data.redemptionService)}`;
    } else {
    }
    route && navigate(route);
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
      title: '#',
      dataIndex: 'reference',
      key: 'reference',
      width: '80px',
      render: (reference, data) => (
        <p
          id={reference}
          onClick={() => {
            handleDetailRedirection(data);
          }}
          className={`text-[#13188A] hover:text-primaryHover ${
            data.type === 'Transfer' ? 'cursor-default' : 'cursor-pointer'
          }`}
        >
          {`#${`${reference}`.substring(0, 6)}`}
        </p>
      ),
    },
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
          className={`bg-${TRANSACTION_STATUS_COLOR[text]} min-w-[80px] text-center cursor-default px-2 py-2 rounded-lg text-white`}
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
      render: (data, { quantity, assetOriginAddress }) => (
        <span>
          {quantity
            ? (assetOriginAddress === stratAddress
                ? quantity / 100
                : assetsWithEighteenDecimalPlaces.includes(assetOriginAddress)
                ? quantity / Math.pow(10, 18)
                : quantity
              ).toLocaleString('en-US', {
                maximumFractionDigits: 4,
                minimumFractionDigits: 0,
              })
            : '--'}
        </span>
      ),
    },
    {
      title: 'Price ($)',
      dataIndex: 'price',
      key: 'price',
      align: 'right',
      width: '100px',
      render: (data, { price, assetOriginAddress }) => (
        <p>
          {price
            ? formattedNum(
                assetOriginAddress === stratAddress
                  ? (price * 100).toFixed(2)
                  : assetsWithEighteenDecimalPlaces.includes(assetOriginAddress)
                  ? (price * Math.pow(10, 18)).toFixed(2)
                  : price
              )
            : '--'}
        </p>
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
      width: '160px',
    },
    {
      title: 'Hash',
      dataIndex: 'hash',
      key: 'hash',
      align: 'left',
      width: '150px',
      render: (data, { transaction_hash }) => {
        return (
          <Tooltip placement="top" title={transaction_hash || ''}>
            <p className="text-[#13188A] hover:text-primaryHover cursor-pointer text-truncate-single-line">
              {transaction_hash ? `# ${transaction_hash}` : '--'}
            </p>
          </Tooltip>
        );
      },
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
          <div className="mt-1.5">{'Date'}</div>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: '150px',
      render: (text, data) => statusComponent(text, data),
    },
  ];

  const statusComponent = (status, data) => {
    status = data.type === 'Transfer' ? 3 : status;
    const { textClass, bgClass } =
      data.type === 'Redemption'
        ? REDEMPTION_STATUS_CLASSES[status]
        : data.type === 'Stake' || data.type === 'Unstake'
        ? TRANSACTION_STATUS_CLASSES[3]
        : TRANSACTION_STATUS_CLASSES[status] || {
            textClass: 'bg-[#FFF6EC]',
            bgClass: 'bg-[#119B2D]',
          };
    return (
      <div
        className={classNames(
          textClass,
          'w-max text-center py-1 cursor-default rounded-xl flex justify-start items-center gap-1 p-3'
        )}
      >
        <div className={classNames(bgClass, 'h-3 w-3 rounded-sm')}></div>
        <p>
          {data.type === 'Redemption'
            ? REDEMPTION_STATUS[status]
            : data.type === 'Stake' || data.type === 'Unstake'
            ? TRANSACTION_STATUS[3]
            : TRANSACTION_STATUS[status]}
        </p>
      </div>
    );
  };

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value);
  };

  // Handle the Type change event. Update the URL and state
  const handleFilter = (val) => {
    const currentDateQuery = dateQuery || ''; // Use the current date or empty string if not set

    // If "All" is selected, remove `type` from query params
    const queryParams = new URLSearchParams();
    if (val && val !== 'all') {
      queryParams.set('type', val);
      setFilterSelected(true);
    }
    if (currentDateQuery) {
      queryParams.set('date', currentDateQuery);
    }

    navigate(`/transactions?${queryParams.toString()}`);
    setType(
      val === '' ? (filterSelected ? '' : urlDate ? '' : undefined) : val
    ); // Set empty type for "All"
  };

  const metaImg = SEO.IMAGE_META;

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const paginatedTransactions = transactions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <Row>
      <Col
        span={24}
        className="w-full min-h-[160px] py-4 px-4 md:min-h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row lg:px-14 justify-between items-center mt-6 lg:mt-8 sticky top-14 z-10 shadow-header"
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
              {' '}
              My Transactions
            </Button>
          </Col>
          <Col
            xs={24}
            lg={16}
            xl={12}
            className="flex flex-col md:flex-row gap-3 items-center my-2 md:my-0"
          >
            <Row className="w-full flex items-center justify-between">
              <Col xs={24} xl={24}>
                <Row className="w-full md:w-auto md:flex md:justify-between items-center mb-5 mt-4">
                  <Col
                    xs={24}
                    md={7}
                    className="flex justify-center mt-2 md:mt-0"
                  >
                    <Select
                      className="block lg:block w-full md:w-4/5 rounded-md mx-auto"
                      onChange={(val) => {
                        handleFilter(val);
                      }}
                      placeholder="Select Type"
                      value={type}
                      defaultValue={type}
                    >
                      {TRANSACTION_FILTER.map(({ label, value }) => (
                        <Select.Option value={value}> {label} </Select.Option>
                      ))}
                    </Select>
                  </Col>
                  <Col
                    xs={24}
                    md={8}
                    className="flex justify-center mt-2 md:mt-0"
                  >
                    <Input
                      className="text-base w-full md:max-w-[400px] h-10 orders_searchbar mx-auto md:mr-3 rounded-md bg-[#F6F6F6]"
                      onChange={(e) => {
                        handleChangeSearch(e);
                      }}
                      value={search}
                      prefix={<SearchOutlined />}
                      placeholder="Search Asset"
                    />
                  </Col>
                  <Col
                    xs={21}
                    sm={22}
                    md={6}
                    xl={7}
                    className="mt-2 md:mt-0 flex justify-center"
                  >
                    <div className="border border-slate-300 w-full rounded-lg">
                      <DatePicker
                        onChange={onDateChange}
                        className="w-full"
                        defaultValue={defaultDate}
                        value={defaultDate}
                        picker="month"
                        disabledDate={(current) => {
                          return current && current > dayjs().endOf('month');
                        }}
                        format={(value) => dayjs(value).format('MMMM YYYY')}
                        allowClear={false}
                      />
                    </div>
                  </Col>
                  <Col
                    xs={1}
                    md={2}
                    className="ml-4 sm:ml-6 md:ml-0 flex justify-center mt-2 md:mt-0"
                  >
                    <Dropdown
                      className="customButton"
                      menu={{
                        items: DOWNLOAD_OPTIONS,
                        onClick: (e) => download(e.key),
                      }}
                      disabled={isTransactionLoading}
                      trigger={['click']}
                    >
                      <Button className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex justify-center items-center">
                        <Space>
                          <DownloadOutlined />
                        </Space>
                      </Button>
                    </Dropdown>
                  </Col>
                </Row>
              </Col>
            </Row>
          </Col>
        </Row>
      </Col>
      <Col span={22} className="mx-auto mt-5">
        <div className="w-full flex md:hidden order_responsive">
          <Row className="w-full">
            {isTransactionLoading ? (
              <Spin className="mx-auto" />
            ) : (
              <div className="">
                <TransactionResponsive
                  data={paginatedTransactions}
                  user={user}
                  stratAddress={stratAddress}
                  assetsWithEighteenDecimalPlaces={
                    assetsWithEighteenDecimalPlaces
                  }
                />
                <Pagination
                  className="mx-auto mt-5"
                  total={transactions.length}
                  current={currentPage}
                  pageSize={pageSize}
                  onChange={handlePageChange}
                  showSizeChanger={false}
                />
              </div>
            )}
          </Row>
        </div>
        <div className="hidden md:flex md:flex-col mx:auto">
          <DataTableComponent
            columns={column}
            data={paginatedTransactions}
            isLoading={isTransactionLoading}
            pagination={false}
            scrollX="100%"
          />
          <div className="flex justify-between">
            {' '}
            <Pagination
              className="mx-auto w-88 mt-5"
              total={transactions.length}
              current={currentPage}
              pageSize={pageSize}
              onChange={handlePageChange}
              showSizeChanger={false}
            />
          </div>
        </div>
      </Col>
    </Row>
  );
};

export default TransactionTable;
