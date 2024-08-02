import React, { useState } from "react";
import { Button, Row, Col, Table, Tag, Space } from "antd";
import classNames from "classnames";
import { dummyData } from "./constant";
import { Images } from "../../images";
import "./ordersTable.css";

const TransactionResponsive = () => {
  const typeColor = {
    Order: "#2A53FF",
    Transfer: "#FF0000",
    Redemption: "#001C76",
  };

  const StratsIcon = <img src={Images.logo} alt="" className="mx-1 w-3 h-3" />;

  const [expandedRows, setExpandedRows] = useState({});

  const handleMore = (assetName) => {
    setExpandedRows((prevExpandedRows) => ({
      ...prevExpandedRows,
      [assetName]: !prevExpandedRows[assetName], // Toggle expansion state
    }));
  };

  const statusComponent = (status) => {
    const statusClasses = {
      1: {
        textClass: "bg-[#EBF7FF]",
        bgClass: "bg-[#13188A]"
      },
      2: {
        textClass: "bg-[#FF8C0033]",
        bgClass: "bg-[#FF8C00]"
      },
      3: {
        textClass: "bg-[#FF8C0033]",
        bgClass: "bg-[#FF8C00]"
      },
      4: {
        textClass: "bg-[#119B2D33]",
        bgClass: "bg-[#119B2D]"
      },
      5: {
        textClass: "bg-[#FFF0F0]",
        bgClass: "bg-[#FF0000]"
      },
    };

    const statusName = {
      1: 'payment Pending',
      2: 'closed',
      3: 'cancelled',
      4: 'awaiting',
      5: 'awaiting shipment'
    }

    const { textClass, bgClass } = statusClasses[status] || { textClass: "bg-[#FFF6EC]", bgClass: "bg-[#119B2D]" };
    return (
      <div className={classNames(textClass, "w-max text-center py-1 rounded-xl flex justify-start items-center gap-1 p-3")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p>{statusName[status].slice(0, 12)}</p>
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
    },
    {
      title: 'Status',
      key: 'status',
      dataIndex: 'status',
      render: (_, { status }) => statusComponent(status),
    }
  ];

  const data = [
    {
      key: '1',
      from: 'Tanuj Soni',
      to: 'Hadi',
      hash: '45353434',
      status: 1,
    },
    {
      key: '2',
      from: 'Hadi',
      to: 'Tanuj Soni',
      hash: '45353434',
      status: 2,
    },
    {
      key: '3',
      from: 'Maya',
      to: 'Hadi',
      hash: '45353434',
      status: 3,
    },
  ];

  return (
    <div className="flex flex-col gap-y-10 w-full ">
      {dummyData.map(({ imageURL, assetName, qty, reference, type, totalPrice }) => {
        const isExpanded = expandedRows[assetName];

        return (
          <Row
            key={assetName} // Use assetName as unique key
            className={`bg-red-300 w-full min-h-32 rounded-xl px-4 py-2 shadow-2xl border-2 `}
          >
            <Col span={6} className="flex justify-center bg-grey-400">
              <img
                src={imageURL[0]}
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
                className="font-semibold"
                onClick={() => handleMore(assetName)}
              >
                {isExpanded ? "(Less -)" : "(More +)"}
              </span>
            </Col>
            <Col span={10} className="flex flex-col justify-between">
              <Button
                className="block ml-auto text-white"
                size="middle"
                style={{ backgroundColor: `${typeColor[type]}` }}
              >
                {type}
              </Button>
              <p className="text-right flex justify-end items-center">
                $ {totalPrice} ({totalPrice * 100} {StratsIcon})
              </p>
              <p className="text-right">Qty: {qty}</p>
              <p className="text-right">10/12/2024</p>
            </Col>
            {isExpanded && <Col span={24}>
            <Table className="mt-6" columns={columns} dataSource={data} />
            </Col>}
          </Row>
        );
      })}
    </div>
  );
};

export default TransactionResponsive;
