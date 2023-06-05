import { Typography } from "antd";
import routes from "../../helpers/routes";
import { EyeOutlined } from "@ant-design/icons";
import React, { useState, useEffect } from "react";
import DataTableComponent from "../DataTableComponent";
import { Info } from "../../images/SVGComponents";
import { useEventState } from "../../contexts/event";
import { epochToDate } from "../../helpers/utils";
import { useNavigate } from "react-router-dom";

const { Text, Paragraph } = Typography;

const CertifyEventsList = ({ selectedObj, setSelectedObj }) => {
  const [parsedCertifyEvents, setParsedCertifyEvents] = useState([]);
  const navigate = useNavigate();

  const {
    isCertifyEventsLoading,
    certifyEvents
  } = useEventState();

  const column = [
    {
      title: <Text className="text-primaryC text-[13px]">NAME</Text>,
      dataIndex: "eventTypename",
      key: "eventTypename",
      render: (text) => <p className="text-base">{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">DESCRIPTION</Text>,
      dataIndex: "eventTypeDescription",
      key: "eventTypeDescription",
      render: (text) => <p className="text-base">{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">DATE</Text>,
      dataIndex: "date",
      key: "date",
      render: (text) => <p className="text-base">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">SUMMARY</Text>,
      dataIndex: "summary",
      key: "summary",
      render: (text) => <p className="text-base">{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">CERTIFIER</Text>,
      dataIndex: "certifier",
      key: "certifier",
      render: (text) => <p className="text-base">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">CERTIFIED DATE</Text>,
      dataIndex: "certifiedDate",
      key: "certifiedDate",
      render: (text) => <p className="text-base">{text}</p>,
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">CERTIFIER COMMENTS</Text>
      ),
      dataIndex: "certifierComment",
      key: "certifierComment",
      width: "200px",
      render: (text) => (
        text && <div className="flex items-center">
          <Paragraph
            ellipsis={{ rows: 1 }}
            className="text-base w-40 !mb-0"
          >
            {text}
          </Paragraph>
          <Info />
        </div>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
      dataIndex: "serialNo",
      key: "serialNo",
      render: (text, row) => (
        <div className="flex items-center cursor-pointer hover:text-primaryHover"
          onClick={() => passSerialNumber(text, row.eventTypename)}>
          <EyeOutlined className="mr-1" />
          <p>View</p>
        </div>
      ),
    },
  ];

  const passSerialNumber = (serialNumbers, eventTypeName) => {
    navigate(routes.EventSerialNumberList.url,
      { state: { serialNumbers: serialNumbers, eventTypeName: eventTypeName, tab: "CertifyEvents" } });
  }

  useEffect(() => {
    let temp = [];
    temp = certifyEvents.map(elem => {
      return {
        ...elem,
        key: elem.address,
        date: epochToDate(elem['date']),
        certifier: elem['certifierName'],
        certifiedDate: elem['certifiedDate'] ? epochToDate(elem['certifiedDate']) : '',
      }
    });
    setParsedCertifyEvents(temp);
  }, [certifyEvents]);

  const onSelectChange = (newSelectedRowKeys) => {
    setSelectedObj(newSelectedRowKeys);
  };

  const rowSelection = {
    selectedRowKeys: selectedObj,
    onChange: onSelectChange,
    getCheckboxProps: (record) => ({
      disabled: record['certifiedDate'],
    }),
  };

  return (
    <div>
      <DataTableComponent
        columns={column}
        data={parsedCertifyEvents}
        isLoading={isCertifyEventsLoading}
        pagination={false}
        rowSelection={rowSelection}
        rowKey={record => record.eventBatchId}
      />
      {/* <Pagination
        current={page}
        onChange={onPageChange}
        total={total}
        className="flex justify-center my-5 "
      /> */}
    </div>
  );
};

export default CertifyEventsList;
