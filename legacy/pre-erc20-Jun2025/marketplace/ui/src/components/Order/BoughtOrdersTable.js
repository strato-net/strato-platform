import React, { useEffect, useState } from 'react';
import classNames from 'classnames';
import {
  EyeOutlined,
  DownOutlined,
  UpOutlined,
  DownloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import routes from '../../helpers/routes';
import DataTableComponent from '../DataTableComponent';
import { getStatus } from './constant';
import { getStringDate } from '../../helpers/utils';
import { useNavigate, Link, useParams, useLocation } from 'react-router-dom';
import { actions } from '../../contexts/order/actions';
import { useOrderDispatch, useOrderState } from '../../contexts/order';
import useDebounce from '../UseDebounce';
import { US_DATE_FORMAT } from '../../helpers/constants';
import {
  Pagination,
  Button,
  Dropdown,
  Space,
  Typography,
  Input,
  DatePicker,
} from 'antd';
import TagManager from 'react-gtm-module';
import './ordersTable.css';
import { FilterIcon } from '../../images/SVGComponents';
import dayjs from 'dayjs';
import { ResponsiveBoughtOrderCard } from './ResponsiveBoughtOrdersCard';
import { Images } from '../../images';

const BoughtOrdersTable = ({
  user,
  selectedDate,
  onDateChange,
  download,
  isAllOrdersLoading,
}) => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const searchVal = searchParams.get('search');
  const pageVal = searchParams.get('page');
  const pageNo = pageVal ? parseInt(pageVal) : 1;
  const { type } = params;

  const dispatch = useOrderDispatch();
  const debouncedSearchTerm = useDebounce('', 1000);
  const limit = 10;
  const offset = (pageNo - 1) * limit;
  const [order, setOrder] = useState('createdDate.desc');
  const [filter, setFilter] = useState(0);
  const [selectedValue, setSelectedValue] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [mDropdownVisible, setMDropdownVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [shouldRefetch, setShouldRefetch] = useState(true);

  const { orders, isordersLoading, orderBoughtTotal } = useOrderState();

  useEffect(() => {
    if (user?.commonName && type === 'bought') {
      actions.fetchOrder(
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
  }, [
    dispatch,
    limit,
    offset,
    debouncedSearchTerm,
    user,
    order,
    selectedDate,
    filter,
    shouldRefetch,
    searchVal,
  ]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (search.length === 0) {
        navigate(`/order/${type}`);
      } else {
        navigate(`/order/${type}?search=${search}`);
      }
    }, 1000);
    return () => {
      clearTimeout(timeout);
    };
  }, [search]);

  const [data, setdata] = useState([]);

  useEffect(() => {
    const fetchDataBought = async () => {
      const updatedDataBought = orders.map((order) => {
        return {
          address: order.id ? order.transaction_hash : order.address,
          chainId: order.chainId,
          key: order.id ? order.transaction_hash : order.address,
          orderNumber: order,
          sellersCommonName: order.sellersCommonName,
          orderTotal: order.totalPrice,
          date: getStringDate(order.createdDate, US_DATE_FORMAT),
          status: getStatus(parseInt(order.status)),
          invoice: order.id ? order.transaction_hash : order.address,
          currency: order.currency ? order.currency : 'USD',
        };
      });
      setIsLoading(false);
      setdata(updatedDataBought);
    };

    fetchDataBought();
  }, [orders]);

  const handleSort = (data) => {
    setSelectedValue(data);
    setFilter(data);
    setDropdownVisible(false);
    setMDropdownVisible(false);
  };

  const Sorting = (classes) => {
    return (
      <div className={classes.className}>
        <Typography onClick={() => handleSort(0)}>All</Typography>
        <Typography onClick={() => handleSort(1)}>
          Awaiting Fulfillment
        </Typography>
        <Typography onClick={() => handleSort(2)}>Awaiting Shipment</Typography>
        <Typography onClick={() => handleSort(3)}>Closed</Typography>
        <Typography onClick={() => handleSort(4)}>Canceled</Typography>
        <Typography onClick={() => handleSort(5)}>Payment Pending</Typography>
      </div>
    );
  };

  const column = [
    {
      title: 'Order Number',
      dataIndex: 'orderNumber',
      key: 'orderNumber',
      render: (order) => (
        <p
          id={order.orderId}
          onClick={() => {
            navigate(
              `${routes.BoughtOrderDetails.url.replace(':id', order.id ? order.transaction_hash : order.address)}`
            );
          }}
          className="text-primary hover:text-primaryHover cursor-pointer"
        >
          {`#${`${order.orderId}`.substring(0, 6)}`}
        </p>
      ),
    },
    {
      title: 'Seller',
      dataIndex: 'sellersCommonName',
      key: 'sellersCommonName',
      // render: (text) => <p onClick={()=>{navigate(`${routes.MarketplaceUserProfile.url.replace(":commonName", text)}`, { state: { from: location.pathname } })}}>{text}</p>,
      render: (text) => (
        <a
          href={`${window.location.origin}/profile/${encodeURIComponent(text)}`}
          onClick={(e) => {
            e.preventDefault();
            const userProfileUrl = `/profile/${encodeURIComponent(text)}`;

            if (e.ctrlKey || e.metaKey) {
              // Open in a new tab if Ctrl/Cmd is pressed
              window.open(
                `${window.location.origin}${userProfileUrl}`,
                '_blank'
              );
            } else {
              // Use navigate for a normal click, without Ctrl/Cmd
              navigate(
                routes.MarketplaceUserProfile.url.replace(':commonName', text),
                { state: { from: location.pathname } }
              );
            }
          }}
          style={{
            textDecoration: 'underline',
            color: 'black',
            cursor: 'pointer',
          }}
        >
          {text}
        </a>
      ),
    },
    {
      title: 'Currency',
      dataIndex: 'currency',
      key: 'currency',
      align: 'center',
    },
    {
      title: 'Order Total',
      dataIndex: 'orderTotal',
      key: 'orderTotal',
      align: 'center',
    },
    {
      dataIndex: 'date',
      key: 'date',
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: 'flex' }}>
          <div className="mt-1.5">{'Date'}</div>
          <div>
            {order === 'createdDate.desc' ? (
              <UpOutlined
                className="icon-container icon-hover"
                onClick={() => setOrder('createdDate.asc')}
              />
            ) : (
              <DownOutlined
                className="icon-container icon-hover"
                onClick={() => setOrder('createdDate.desc')}
              />
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Invoice',
      dataIndex: 'invoice',
      key: 'invoice',
      render: (text) => (
        <button
          onClick={() => {
            window.LOQ.push([
              'ready',
              async (LO) => {
                await LO.$internal.ready('events');
                LO.events.track('Orders Bought: View Invoice');
              },
            ]);
            TagManager.dataLayer({
              dataLayer: {
                event: 'view_invoice_in_orders_bought',
              },
            });
          }}
        >
          <Link
            to={`${routes.Invoice.url.replace(':id', text)}`}
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
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (text) => statusComponent(text),
      filterDropdown: ({ confirm }) =>
        dropdownVisible && (
          <Sorting className="hidden md:flex flex-col gap-1 sort_conatiner py-1" />
        ),
      filterIcon: () => <FilterIcon />,
      onFilterDropdownOpenChange: (visible) => {
        setDropdownVisible(visible);
      },
      filterSearch: true,
      filterMultiple: false,
      filterResetToDefaultFilteredValue: true,
      width: '15%',
    },
  ];

  const statusComponent = (status) => {
    const statusClasses = {
      ['Awaiting Shipment']: {
        textClass: 'bg-[#EBF7FF]',
        bgClass: 'bg-[#13188A]',
      },
      ['Awaiting Fulfillment']: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      ['Payment Pending']: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      ['Closed']: {
        textClass: 'bg-[#119B2D33]',
        bgClass: 'bg-[#119B2D]',
      },
      ['Canceled']: {
        textClass: 'bg-[#FFF0F0]',
        bgClass: 'bg-[#FF0000]',
      },
    };

    const { textClass, bgClass } = statusClasses[status] || {
      textClass: 'bg-[#FFF6EC]',
      bgClass: 'bg-[#119B2D]',
    };

    return (
      <div
        id={status}
        className={classNames(
          textClass,
          'w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3'
        )}
      >
        <div className={classNames(bgClass, 'h-3 w-3 rounded-sm')}></div>
        <p>{status}</p>
      </div>
    );
  };

  const onPageChange = (page) => {
    const baseUrl = new URL(`/order/${type}`, window.location.origin);
    if (searchVal) {
      baseUrl.searchParams.set('search', searchVal);
    }

    baseUrl.searchParams.set('page', page);
    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { new: true });
  };

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value);
  };

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
    <div>
      <div className="flex gap-2 items-center mb-5">
        <Input
          className="text-base orders_searchbar md:p-3 rounded-full bg-[#F6F6F6]"
          key={searchVal}
          onChange={(e) => {
            handleChangeSearch(e);
          }}
          defaultValue={searchVal}
          prefix={<SearchOutlined />}
          placeholder="Search Bought Orders by Seller or Order #"
        />
        <Dropdown
          className="md:hidden customButton"
          menu={{ items: menuItems, onClick: (e) => download(e.key) }}
          disabled={isAllOrdersLoading}
          trigger={['click']}
        >
          <Button
            loading={isAllOrdersLoading}
            className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex md:hidden justify-center items-center"
          >
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
            suffixIcon={
              <img
                src={Images.calender}
                alt="calender"
                className="w-5 h-5"
                style={{ maxWidth: 'none' }}
              />
            }
          />
        </div>
        <div className="relative">
          <div
            onClick={() => setMDropdownVisible(!mDropdownVisible)}
            className="h-[32px] w-[33px] rounded-md border border-[#6A6A6A] flex md:hidden justify-center items-center"
          >
            <FilterIcon />
          </div>
          {mDropdownVisible && (
            <Sorting className="md:hidden flex flex-col gap-1 absolute right-0 top-10 w-max shadow-card_shadow z-[99999] bg-white sort_conatiner py-1" />
          )}
        </div>
      </div>
      <div className="flex md:hidden order_responsive">
        <ResponsiveBoughtOrderCard
          data={data}
          isLoading={isordersLoading || isLoading}
        />
      </div>
      <div className="hidden md:block">
        <DataTableComponent
          columns={column}
          data={data}
          isLoading={isordersLoading || isLoading}
          pagination={false}
          scrollX="100%"
        />
      </div>
      <Pagination
        current={pageNo}
        onChange={onPageChange}
        total={orderBoughtTotal}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default BoughtOrdersTable;
