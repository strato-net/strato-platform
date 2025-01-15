import React, { useEffect, useState } from 'react';
import { Button, Row, Col, Table, Tag, Space } from 'antd';
import classNames from 'classnames';
import { Images } from '../../images';
import './ordersTable.css';
import {
  REDEMPTION_STATUS,
  REDEMPTION_STATUS_CLASSES,
  TRANSACTION_STATUS,
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_COLOR,
  TRANSACTION_STATUS_TEXT,
} from '../../helpers/constants';
import routes from '../../helpers/routes';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { useEthState } from '../../contexts/eth';

const TransactionResponsive = ({
  data,
  user,
  stratAddress,
  assetsWithEighteenDecimalPlaces,
}) => {
  const USDSTIcon = <img src={Images.USDST} alt="" className="w-5 h-5 ml-1" />;
  const navigate = useNavigate();
  const [expandedRows, setExpandedRows] = useState({});
  const { ethstAddress } = useEthState();

  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  const handleMore = (index) => {
    setExpandedRows((prevExpandedRows) => ({
      ...prevExpandedRows,
      [index]: !prevExpandedRows[index], // Toggle expansion state
    }));
  };

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
          'w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3'
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
    {
      title: 'Hash',
      dataIndex: 'hash',
      key: 'hash',
      render: (text) => (
        <p className="text-[#13188A]">
          {text ? `${text.slice(0, 15)}..` : '--'}
        </p>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      dataIndex: 'status',
      render: (text, data) => statusComponent(text, data),
    },
  ];

  return (
    <div className="flex flex-col gap-y-10 w-full">
      {data.map(
        (
          {
            reference,
            address,
            assetImage,
            assetName,
            assetAddress,
            assetDescription,
            quantity,
            from,
            to,
            status,
            transaction_hash,
            type,
            price,
            redemptionService,
            block_timestamp,
            assetOriginAddress,
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
          if (assetOriginAddress === stratAddress) {
            quantity = (quantity / 100).toLocaleString('en-US', {
              maximumFractionDigits: 4,
              minimumFractionDigits: 0,
            });
            price = (price * 100).toFixed(2);
          } else if (
            assetsWithEighteenDecimalPlaces.includes(assetOriginAddress)
          ) {
            quantity = (quantity / Math.pow(10, 18)).toLocaleString('en-US', {
              maximumFractionDigits: 4,
              minimumFractionDigits: 0,
            });
            price = (price * Math.pow(10, 18)).toFixed(2);
          }

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
            const isEthst = assetOriginAddress === ethstAddress;
            if (isEthst) {
              const url = routes.EthstProductDetail.url;
              navigate(`${url.replace(':address', assetAddress)}`, {
                state: { isCalledFromInventory: false },
              });
            } else {
              const url = routes.MarketplaceProductDetail.url
                .replace(':address', assetAddress)
                .replace(':name', assetName);
              navigate(url);
            }
          };

          return (
            <Row
              key={index}
              className={`w-full ${
                isExpanded ? '' : 'h-36'
              } rounded-xl px-2 py-2 shadow-2xl border-2 `}
            >
              <Col span={6} className="flex justify-center">
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
                    type === 'Transfer' ||
                    type === 'Stake' ||
                    type === 'Unstake'
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
                    color: `${TRANSACTION_STATUS_TEXT[type]}`,
                  }}
                >
                  {type}
                </Button>
                {price ? (
                  <p className={`text-right flex justify-end items-center`}>
                    ${formattedNum(price)} ({formattedNum(price)} {USDSTIcon})
                  </p>
                ) : (
                  <p className="text-right text-[#13188A] font-bold text-sm">
                    No Price Available
                  </p>
                )}
                <p className="text-right">Qty: {quantity}</p>
                <p className="text-right">
                  {moment(block_timestamp.replace(/-/g, '/')).format('lll')}
                </p>
              </Col>
              {isExpanded && (
                <Col span={24}>
                  <Table
                    className="mt-6 w-[90vw]"
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
  );
};

export default TransactionResponsive;
