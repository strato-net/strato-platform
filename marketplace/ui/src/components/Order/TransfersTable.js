import React, { useEffect, useState } from 'react';
import DataTableComponent from '../DataTableComponent';
import { getStringDate } from '../../helpers/utils';
import { actions } from '../../contexts/inventory/actions';
import { US_DATE_FORMAT } from '../../helpers/constants';
import { Input, Pagination, Dropdown, Button, Space } from 'antd';
import './ordersTable.css';
import {
  DownOutlined,
  SearchOutlined,
  UpOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { ResponsiveOrderCard } from './ResponsiveOrdersCard';
import { ResponsiveTransferOrderCard } from './ResponsiveTransferOrdersCard';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import routes from '../../helpers/routes';

const TransfersTable = ({
  user,
  selectedDate,
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

  const dispatch = useInventoryDispatch();
  const limit = 10;
  const offset = (pageNo - 1) * limit;
  const { itemTransfers, totalItemsTransfered, isFetchingItemTransfers } =
    useInventoryState();
  const [order, setOrder] = useState('desc');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (user?.commonName && type === 'transfers') {
      actions.fetchItemTransfers(
        dispatch,
        limit,
        offset,
        user?.commonName,
        order,
        selectedDate,
        searchVal
      );
    }
  }, [dispatch, limit, offset, user, order, selectedDate, searchVal]);

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
    let items = [];
    if (itemTransfers) {
      itemTransfers.forEach((transfer) => {
        items.push({
          address: transfer.address,
          key: transfer.address,
          assetAddress: transfer.assetAddress,
          assetName: decodeURIComponent(transfer.assetName),
          newOwner: transfer.newOwner,
          newOwnerCommonName: transfer.newOwnerCommonName,
          oldOwner: transfer.oldOwner,
          oldOwnerCommonName: transfer.oldOwnerCommonName,
          quantity: transfer.quantity,
          transferDate: getStringDate(transfer.transferDate, US_DATE_FORMAT),
          transferNumber: transfer.transferNumber,
          price: transfer?.price,
        });
      });
    }
    setdata(items);
  }, [itemTransfers]);

  const column = [
    {
      title: 'Transfer Number',
      dataIndex: 'transferNumber',
      key: 'transferNumber',
      render: (text) => <p>#{text}</p>,
    },
    {
      title: 'From',
      key: 'oldOwnerCommonName',
      render: (text, record) => (
        <a
          href={`${window.location.origin}/profile/${encodeURIComponent(record.oldOwnerCommonName)}`}
          onClick={(e) => {
            e.preventDefault();
            const userProfileUrl = `/profile/${encodeURIComponent(record.oldOwnerCommonName)}`;

            if (e.ctrlKey || e.metaKey) {
              // Open in a new tab if Ctrl/Cmd is pressed
              window.open(
                `${window.location.origin}${userProfileUrl}`,
                '_blank'
              );
            } else {
              // Use navigate for a normal click, without Ctrl/Cmd
              navigate(
                routes.MarketplaceUserProfile.url.replace(
                  ':commonName',
                  record.oldOwnerCommonName
                ),
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
          {record.oldOwnerCommonName}
        </a>
      ),
    },
    {
      title: 'To',
      key: 'newOwnerCommonName',
      render: (text, record) => (
        <a
          href={`${window.location.origin}/profile/${encodeURIComponent(record.newOwnerCommonName)}`}
          onClick={(e) => {
            e.preventDefault();
            const userProfileUrl = `/profile/${encodeURIComponent(record.newOwnerCommonName)}`;

            if (e.ctrlKey || e.metaKey) {
              // Open in a new tab if Ctrl/Cmd is pressed
              window.open(
                `${window.location.origin}${userProfileUrl}`,
                '_blank'
              );
            } else {
              // Use navigate for a normal click, without Ctrl/Cmd
              navigate(
                routes.MarketplaceUserProfile.url.replace(
                  ':commonName',
                  record.newOwnerCommonName
                ),
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
          {record.newOwnerCommonName}
        </a>
      ),
    },
    {
      dataIndex: 'transferDate',
      key: 'transferDate',
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: 'flex' }}>
          <div className="mt-1.5">{'Date'}</div>
          <div>
            {order === 'desc' ? (
              <UpOutlined
                className="icon-container icon-hover"
                onClick={() => setOrder('asc')}
              />
            ) : (
              <DownOutlined
                className="icon-container icon-hover"
                onClick={() => setOrder('desc')}
              />
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Asset Name',
      dataIndex: 'assetName',
      key: 'assetName',
      render: (text) => <p>{text}</p>,
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right',
      render: (text) => <p className="text-right">{text}</p>,
      width: '10%',
    },
    {
      title: 'Price',
      dataIndex: 'price',
      key: 'price',
      align: 'right',
      render: (text) => (
        <p className="text-right">{text ? `$ ${text}` : '--'}</p>
      ),
      width: '10%',
    },
  ];

  const onPageChange = (page) => {
    const baseUrl = new URL(`/order/${type}`, window.location.origin);
    if (searchVal) {
      baseUrl.searchParams.set('search', searchVal);
    }

    baseUrl.searchParams.set('page', page);
    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { new: true });
  };

  const onChange = (pagination, filters, sorter) => {
    if (order === 'desc') {
      setOrder('asc');
    } else {
      setOrder('desc');
    }
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
          placeholder="Search Transfers by Buyer or Transfer #"
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
      </div>
      <div className="flex md:hidden order_responsive">
        <ResponsiveTransferOrderCard
          data={data}
          isLoading={isFetchingItemTransfers}
        />
      </div>
      <div className="hidden md:block mt-5">
        <DataTableComponent
          columns={column}
          data={data}
          isLoading={isFetchingItemTransfers}
          pagination={false}
          scrollX="100%"
          rowKey={(record) => record.transferNumber}
          onChange={onChange}
        />
      </div>
      <Pagination
        current={pageNo}
        onChange={onPageChange}
        total={totalItemsTransfered}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default TransfersTable;
