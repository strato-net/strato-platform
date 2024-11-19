import React, { useEffect, useState } from 'react';
import DataTableComponent from '../DataTableComponent';
import { actions } from '../../contexts/redemption/actions';
import { REDEMPTION_STATUS } from '../../helpers/constants';
import { Input, Pagination, Dropdown, Button, Space } from 'antd';
import './ordersTable.css';
import {
  DownOutlined,
  SearchOutlined,
  UpOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { ResponsiveRedemptionsCard } from './ResponsiveRedemptionsCard';
import {
  useRedemptionDispatch,
  useRedemptionState,
} from '../../contexts/redemption';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import routes from '../../helpers/routes';
import classNames from 'classnames';

const RedemptionsOutgoingTable = ({ user, download, isAllOrdersLoading }) => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const searchVal = searchParams.get('search');
  const pageVal = searchParams.get('page');
  const pageNo = pageVal ? parseInt(pageVal) : 1;
  const { type } = params;

  const dispatch = useRedemptionDispatch();
  const limit = 10;
  const offset = (pageNo - 1) * limit;
  const { outgoingRedemptions, isFetchingOutgoingRedemptions } =
    useRedemptionState();
  const [order, setOrder] = useState('DESC');
  const [search, setSearch] = useState('');
  const [data, setData] = useState([]);
  const [dataMap, setDataMap] = useState({});

  useEffect(() => {
    if (user?.commonName) {
      // add type in conditional
      actions.fetchOutgoingRedemptionRequests(dispatch, order, search);
    }
  }, [dispatch, user, order, search]);

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

  useEffect(() => {
    let items = [];
    let itemMap = {};
    if (outgoingRedemptions) {
      outgoingRedemptions.forEach((redemption) => {
        const item = {
          key: redemption.redemption_id,
          assetAddress: redemption.asset,
          assetName: redemption.assetName,
          requestor: redemption.ownerCommonName,
          issuer: redemption.issuerCommonName,
          quantity: redemption.quantity,
          redemptionDate: redemption.createdDate,
          redemptionNumber: redemption.redemption_id,
          status: redemption.status,
          redemptionService: redemption.redemptionService,
        };
        items.push(item);
        itemMap[redemption.redemption_id] = item;
      });
    }
    setData(items);
    setDataMap(itemMap);
  }, [outgoingRedemptions]);

  const statusComponent = (status) => {
    const statusClasses = {
      [REDEMPTION_STATUS.PENDING]: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      [REDEMPTION_STATUS.REJECTED]: {
        textClass: 'bg-[#FFF0F0]',
        bgClass: 'bg-[#FF0000]',
      },
      [REDEMPTION_STATUS.FULFILLED]: {
        textClass: 'bg-[#119B2D33]',
        bgClass: 'bg-[#119B2D]',
      },
    };

    const { textClass, bgClass } = statusClasses[status] || {};
    return (
      <div className="flex justify-center">
        <div
          className={classNames(
            textClass,
            'w-max py-1 rounded-xl flex items-center gap-1 p-3'
          )}
        >
          <div
            className={classNames(
              bgClass,
              'flex justify-center h-3 w-3 rounded-sm'
            )}
          ></div>
          <p>{REDEMPTION_STATUS[status]}</p>
        </div>
      </div>
    );
  };

  const column = [
    {
      title: 'Redemption Number',
      dataIndex: 'redemptionNumber',
      key: 'redemptionNumber',
      render: (record) => (
        <p
          id={record}
          onClick={() => {
            navigate(
              `${routes.RedemptionsOutgoingDetails.url
                .replace(':id', record)
                .replace(
                  ':redemptionService',
                  dataMap[record].redemptionService
                )}`
            );
          }}
          className="text-[#13188A] hover:text-primaryHover cursor-pointer"
        >
          {`#${record}`}
        </p>
      ),
    },
    {
      title: 'Issuer',
      key: 'issuer',
      render: (record) => (
        <a
          href={`${window.location.origin}/profile/${encodeURIComponent(record.issuer)}`}
          onClick={(e) => {
            e.preventDefault();
            const userProfileUrl = `/profile/${encodeURIComponent(record.issuer)}`;

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
                  record.issuer
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
          {record.issuer}
        </a>
      ),
    },
    {
      dataIndex: 'redemptionDate',
      key: 'redemptionDate',
      render: (text) => <p>{text}</p>,
      title: (
        <div style={{ display: 'flex' }}>
          <div className="mt-1.5">{'Date'}</div>
          <div>
            {order === 'DESC' ? (
              <UpOutlined
                className="icon-container icon-hover"
                onClick={() => setOrder('ASC')}
              />
            ) : (
              <DownOutlined
                className="icon-container icon-hover"
                onClick={() => setOrder('DESC')}
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
      align: 'center',
      render: (text) => <p className="text-center">{text}</p>,
      width: '10%',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      align: 'center',
      render: (text) => statusComponent(text),
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
    if (order === 'DESC') {
      setOrder('ASC');
    } else {
      setOrder('DESC');
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
          placeholder="Search Redemptions by Redemption #"
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
        <ResponsiveRedemptionsCard
          data={data}
          isLoading={isFetchingOutgoingRedemptions}
          category={'outgoing'}
        />
      </div>
      <div className="hidden md:block mt-5">
        <DataTableComponent
          columns={column}
          data={data}
          isLoading={isFetchingOutgoingRedemptions}
          pagination={false}
          scrollX="100%"
          rowKey={(record) => record.redemptionId}
          onChange={onChange}
        />
      </div>
      <Pagination
        current={pageNo}
        onChange={onPageChange}
        total={outgoingRedemptions ? outgoingRedemptions.length : 0}
        showSizeChanger={false}
        className="flex justify-center my-5 "
      />
    </div>
  );
};

export default RedemptionsOutgoingTable;
