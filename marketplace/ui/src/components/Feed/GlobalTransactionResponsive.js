import React, { useEffect, useState } from 'react';
import { Button, Row, Col, Table, Tag, Space, Spin } from 'antd';
import classNames from 'classnames';
import { Images } from '../../images';
import './../Order/ordersTable.css';
import {
  REDEMPTION_STATUS,
  REDEMPTION_STATUS_CLASSES,
  TRANSACTION_STATUS,
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_COLOR,
} from '../../helpers/constants';
import routes from '../../helpers/routes';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import InfiniteScroll from 'react-infinite-scroll-component';

const GlobalTransactionResponsive = ({
  data,
  user,
  isTransactionLoading,
  fetchData,
}) => {
  const StratsIcon = (
    <img src={Images.strats} alt="STRATs" className="mx-1 w-4 h-4" />
  );
  const navigate = useNavigate();
  const [expandedRows, setExpandedRows] = useState({});

  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  const handleMore = (index) => {
    setExpandedRows((prevExpandedRows) => ({
      ...prevExpandedRows,
      [index]: !prevExpandedRows[index], // Toggle expansion state
    }));
  };

  const columns = [
    {
      title: 'Buyer/Sender',
      dataIndex: 'from',
      key: 'from',
      render: (text) => <p>{text}</p>,
    },
    {
      title: 'Seller/Recipient',
      dataIndex: 'to',
      key: 'to',
    },
  ];

  return (
    <div className="w-full">
      <InfiniteScroll
        dataLength={data.length}
        next={fetchData}
        hasMore={true}
        // scrollThreshold={0.8}
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
        <div className="flex flex-col gap-y-10 w-full">
          {data?.map(
            (
              {
                reference,
                address,
                assetImage,
                totalAmount,
                assetName,
                assetAddress,
                assetDescription,
                quantity,
                from,
                to,
                status,
                transaction_hash,
                quantityIsDecimal,
                type,
                price,
                redemptionService,
                block_timestamp,
              },
              index
            ) => {
              block_timestamp =
                type === 'Redemption'
                  ? moment(block_timestamp)
                      .utc()
                      .format('YYYY-MM-DD HH:mm:ss [UTC]')
                  : block_timestamp;
              const isExpanded = expandedRows[index];
              const tableData = [
                {
                  key: index,
                  from,
                  to,
                  hash: transaction_hash,
                  status,
                  type,
                },
              ];

              const handleDetailRedirection = () => {
                let route;
                if (type === 'Order' && from === user.commonName) {
                  route = `${routes.SoldOrderDetails.url.replace(
                    ':id',
                    address ? transaction_hash : address
                  )}`;
                } else if (type === 'Order' && from !== user.commonName) {
                  route = `${routes.BoughtOrderDetails.url.replace(
                    ':id',
                    address ? transaction_hash : address
                  )}`;
                } else if (type === 'Transfer') {
                } else if (type === 'Redemption' && to === user.commonName) {
                  route = `${routes.RedemptionsIncomingDetails.url
                    .replace(':id', reference)
                    .replace(':redemptionService', redemptionService)}`;
                } else if (type === 'Redemption' && from === user.commonName) {
                  route = `${routes.RedemptionsOutgoingDetails.url
                    .replace(':id', reference)
                    .replace(':redemptionService', redemptionService)}`;
                } else {
                }
                route && navigate(route);
              };

              const handleAssetRedirection = () => {
                const url = routes.MarketplaceProductDetail.url
                  .replace(':address', assetAddress)
                  .replace(':name', assetName);
                navigate(url);
              };

              return (
                <Row
                  key={reference}
                  className={`bg-red-300 w-full ${
                    isExpanded ? '' : 'h-36'
                  } rounded-xl px-2 py-2 shadow-2xl border-2 `}
                >
                  <Col span={6} className="flex justify-center bg-grey-400">
                    <img
                      src={assetImage}
                      alt=""
                      className="rounded-xl max-h-32 shadow-2xl border-0 object-contain"
                    />
                  </Col>
                  <Col
                    span={8}
                    offset={1}
                    className="flex flex-col justify-between"
                  >
                    <p
                      className="text-base font-bold text-truncate-single-line cursor-pointer"
                      onClick={() => {
                        handleAssetRedirection();
                      }}
                    >
                      {' '}
                      {assetName}{' '}
                    </p>
                    <p
                      style={{ color: '#13188A' }}
                      className={`font-semibold ${
                        type === 'Transfer'
                          ? 'cursor-default'
                          : 'cursor-pointer'
                      }`}
                      onClick={() => {
                        handleDetailRedirection();
                      }}
                    >
                      #{reference}
                    </p>
                    <p
                      style={{ color: '#827474' }}
                      className="font-medium text-truncate"
                    >
                      {assetDescription.replace(/<\/?[^>]+(>|$)/g, '')}
                    </p>
                    <span
                      style={{ color: '#13188A' }}
                      className="font-semibold cursor-pointer"
                      onClick={() => handleMore(index)}
                    >
                      {isExpanded ? '(Less -)' : '(More +)'}
                    </span>
                  </Col>
                  <Col span={9} className="flex flex-col justify-between">
                    <Button
                      className="block ml-auto text-white"
                      size="middle"
                      style={{
                        backgroundColor: `${TRANSACTION_STATUS_COLOR[type]}`,
                      }}
                    >
                      {type}
                    </Button>
                    {price ? (
                      <p className={`text-right flex justify-end items-center`}>
                        ${' '}
                        {formattedNum(
                          quantityIsDecimal && quantityIsDecimal === 'True'
                            ? price * 100
                            : price
                        )}{' '}
                        (
                        {formattedNum(
                          quantityIsDecimal && quantityIsDecimal === 'True'
                            ? price * 10000
                            : price
                        )}{' '}
                        {StratsIcon})
                      </p>
                    ) : (
                      <p className="text-right text-[#13188A] font-bold text-sm">
                        No Price Available
                      </p>
                    )}
                    <p className="text-right">
                      Qty:{' '}
                      {formattedNum(
                        quantityIsDecimal && quantityIsDecimal === 'True'
                          ? quantity / 100
                          : quantity
                      )}
                    </p>
                    <p className="text-right">
                      {moment(block_timestamp.replace(/-/g, '/')).format('lll')}
                    </p>
                  </Col>
                  {isExpanded && (
                    <Col span={24}>
                      <Table
                        className="mt-6"
                        columns={columns}
                        dataSource={tableData}
                        pagination={false}
                      />
                    </Col>
                  )}
                </Row>
              );
            }
          )}
        </div>
      </InfiniteScroll>
    </div>
  );
};

export default GlobalTransactionResponsive;
