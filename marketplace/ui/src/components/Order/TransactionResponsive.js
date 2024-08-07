import React, { useEffect, useState } from "react";
import { Button, Row, Col, Table, Tag, Space } from "antd";
import classNames from "classnames";
import { dummyData } from "./constant";
import { Images } from "../../images";
import "./ordersTable.css";
import { actions as transactionAction } from "../../contexts/transaction/actions";
import { useTransactionDispatch, useTransactionState } from "../../contexts/transaction";
import { TRANSACTION_STATUS, TRANSACTION_STATUS_CLASSES, TRANSACTION_STATUS_COLOR } from "../../helpers/constants";

const TransactionResponsive = ({data}) => {
  const StratsIcon = <img src={Images.logo} alt="" className="mx-1 w-3 h-3" />;

  const [expandedRows, setExpandedRows] = useState({});

  const handleMore = (assetName) => {
    setExpandedRows((prevExpandedRows) => ({
      ...prevExpandedRows,
      [assetName]: !prevExpandedRows[assetName], // Toggle expansion state
    }));
  };


  const statusComponent = (status) => {

    const { textClass, bgClass } = TRANSACTION_STATUS_CLASSES[status] || { textClass: "bg-[#FFF6EC]", bgClass: "bg-[#119B2D]" };
    return (
      <div className={classNames(textClass, "w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p>{TRANSACTION_STATUS[status]}</p>
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
      render: (text) => <p className="text-[#13188A]">{text}</p>
    },
    {
      title: 'Status',
      key: 'status',
      dataIndex: 'status',
      render: (_, { status }) => statusComponent(status),
    }
  ];

  return (
    <div className="flex flex-col gap-y-10 w-full ">
      {data.map(({ imageURL, assetName, quantity,from, to, status, reference, type, price }, index) => {
        const isExpanded = expandedRows[assetName];
        const tableData = [{
          key: index,
          from,
          to,
          hash: '#45353434',
          status: 2,
        }]

        return (
          <Row
            key={assetName} // Use assetName as unique key
            className={`bg-red-300 w-full min-h-32 rounded-xl px-4 py-2 shadow-2xl border-2 `}
          >
            <Col span={6} className="flex justify-center bg-grey-400">
              <img
                src={imageURL?.length >= 0 ? imageURL[0] : ""}
                alt=""
                className="rounded-xl shadow-2xl border-0"
              />
            </Col>
            <Col span={7} offset={1} className="flex flex-col justify-between">
              <p className="text-base font-bold"> {assetName} </p>
              <p style={{ color: "#13188A" }} className="font-semibold">
                {reference}
              </p>
              <p style={{ color: "#827474" }} className="font-medium">
                Token Description....
              </p>
              <span
                style={{ color: "#13188A" }}
                className="font-semibold cursor-pointer"
                onClick={() => handleMore(assetName)}
              >
                {isExpanded ? "(Less -)" : "(More +)"}
              </span>
            </Col>
            <Col span={10} className="flex flex-col justify-between">
              <Button
                className="block ml-auto text-white"
                size="middle"
                style={{ backgroundColor: `${TRANSACTION_STATUS_COLOR[type]}` }}
              >
                {type}
              </Button>
              <p className="text-right flex justify-end items-center">
                $ {price} ({price * 100} {StratsIcon})
              </p>
              <p className="text-right">Qty: {quantity}</p>
              <p className="text-right">10/12/2024</p>
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
