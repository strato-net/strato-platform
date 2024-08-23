import React, { useEffect, useState } from "react";
import { Button, Row, Col, Table, Tag, Space } from "antd";
import classNames from "classnames";
import { Images } from "../../images";
import "./ordersTable.css";
import { REDEMPTION_STATUS, REDEMPTION_STATUS_CLASSES, TRANSACTION_STATUS, TRANSACTION_STATUS_CLASSES, TRANSACTION_STATUS_COLOR } from "../../helpers/constants";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";

const TransactionResponsive = ({ data , user}) => {
  const StratsIcon = <img src={Images.logo} alt="" className="mx-1 w-3 h-3" />;
  const navigate = useNavigate();
  const [expandedRows, setExpandedRows] = useState({});

  const handleMore = (index) => {
    setExpandedRows((prevExpandedRows) => ({
      ...prevExpandedRows,
      [index]: !prevExpandedRows[index], // Toggle expansion state
    }));
  };

  const statusComponent = (status, data) => {
    status = data.type === "Transfer" ? 3 : status
    const { textClass, bgClass } = data.type === "Redemption" ? REDEMPTION_STATUS_CLASSES[status] : TRANSACTION_STATUS_CLASSES[status] || { textClass: "bg-[#FFF6EC]", bgClass: "bg-[#119B2D]" };
    return (
      <div className={classNames(textClass, "w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p>{data.type === 'Redemption' ? REDEMPTION_STATUS[status] : TRANSACTION_STATUS[status]}</p>
      </div>
    );
  };

  const columns = [
    {
      title: 'From',
      dataIndex: 'from',
      key: 'from',
      render: (text) => <p>{text}</p>,
    },
    {
      title: 'To',
      dataIndex: 'to',
      key: 'to',
    },
    {
      title: 'Hash',
      dataIndex: 'hash',
      key: 'hash',
      render: (text) => <p className="text-[#13188A]">{`${text.slice(0, 15)}..`}</p>
    },
    {
      title: 'Status',
      key: 'status',
      dataIndex: 'status',
      render: (text, data) => statusComponent(text, data),
    }
  ];

  return (
    <div className="flex flex-col gap-y-10 w-full">
      {data.map(({ reference ,address, assetImage,totalAmount, assetName, assetDescription, quantity, from, to, status,transaction_hash, type, price, redemptionService, block_timestamp }, index) => {
        const isExpanded = expandedRows[index];
        const tableData = [{
          key: index,
          from,
          to,
          hash: address || redemptionService || '--',
          status,
          type
        }]

        const handleDetailRedirection = () => {
          let route;
          if (type === 'Order' && from === user.commonName) {
            route = `${routes.SoldOrderDetails.url.replace(":id", address ? transaction_hash : address)}`
          }
          else if (type === 'Order' && from !== user.commonName) {
            route = `${routes.BoughtOrderDetails.url.replace(":id", address ? transaction_hash : address)}`
          }
          else if (type === 'Transfer') { }
          else if (type === 'Redemption' && from !== user.commonName) {
            route = `${routes.RedemptionsIncomingDetails.url.replace(":id", reference)
              .replace(":redemptionService", redemptionService)}`
          } else if (type === 'Redemption' && from === user.commonName) {
            route = `${routes.RedemptionsOutgoingDetails.url.replace(":id", reference)
              .replace(":redemptionService", redemptionService)}`
          } else { }
          route && navigate(route)
        }

        return (
          <Row
            key={index} // Use assetName as unique key
            className={`bg-red-300 w-full ${isExpanded ? '' : 'h-36'} rounded-xl px-2 py-2 shadow-2xl border-2 `}
          >
            <Col span={6} className="flex justify-center bg-grey-400">
              <img
                src={assetImage}
                alt=""
                className="rounded-xl max-h-32 shadow-2xl border-0 object-contain"
              />
            </Col>
            <Col span={8} offset={1} className="flex flex-col justify-between">
              <p className="text-base font-bold"> {assetName.length > 10 ? `${assetName.slice(0, 10)}..` : assetName} </p>
              <p style={{ color: "#13188A" }} className="font-semibold" onClick={() => {
                handleDetailRedirection()
              }}>
                #{reference}
              </p>
              <p style={{ color: "#827474" }} className="font-medium">
                {assetDescription.length > 25 ? `${assetDescription.replace(/<\/?[^>]+(>|$)/g, "")?.slice(0, 25)}..` : assetDescription.replace(/<\/?[^>]+(>|$)/g, "")}
              </p>
              <span
                style={{ color: "#13188A" }}
                className="font-semibold cursor-pointer"
                onClick={() => handleMore(index)}
              >
                {isExpanded ? "(Less -)" : "(More +)"}
              </span>
            </Col>
            <Col span={9} className="flex flex-col justify-between">
              <Button
                className="block ml-auto text-white"
                size="middle"
                style={{ backgroundColor: `${TRANSACTION_STATUS_COLOR[type]}` }}
              >
                {type}
              </Button>
              {price ? <p className={`text-right flex justify-end items-center`}>
                $ {price} ({price * 100} {StratsIcon})
              </p>
                : <p className="text-right text-[#13188A] font-bold text-sm"> No Price Available  </p>}
              <p className="text-right">Qty: {quantity}</p>
              <p className="text-right">{block_timestamp}</p>
            </Col>
            {isExpanded && <Col span={24}>
              <Table className="mt-6" columns={columns} dataSource={tableData} pagination={false} />
            </Col>}
          </Row>
        );
      })}
    </div>
  );
};

export default TransactionResponsive;
