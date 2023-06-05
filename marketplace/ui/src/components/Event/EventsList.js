import { Typography, Pagination } from "antd";
import routes from "../../helpers/routes";
import { EyeOutlined } from "@ant-design/icons";
import DataTableComponent from "../DataTableComponent";
import { useEventState } from "../../contexts/event";
import { epochToDate } from "../../helpers/utils";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const { Text } = Typography;

const EventsList = () => {
  const navigate = useNavigate();
  const [parsedEvents, setParsedEvents] = useState([]);

  const {
    isEventsLoading,
    events
  } = useEventState();

  const column = [
    {
      title: <Text className="text-primaryC text-[13px]">NAME</Text>,
      dataIndex: "name",
      key: "name",
      render: (text) => <p className="text-base">{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">DESCRIPTION</Text>,
      dataIndex: "description",
      key: "description",
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
      render: (text) => <p className="text-base">{text===null||text===undefined?"":text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">CERTIFIED DATE</Text>,
      dataIndex: "certifiedDate",
      key: "certifiedDate",
      render: (text) => <p className="text-base">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
      dataIndex: "serialNo",
      key: "serialNo",
      render: (text, row) => (
        <div className="flex items-center cursor-pointer hover:text-primaryHover"
          onClick={() => passSerialNumber(text, row.name)}>
          <EyeOutlined className="mr-1" />
          <p>View</p>
        </div>
      ),
    },
  ];

  const passSerialNumber = (serialNumbers, eventTypeName) => {
    navigate(routes.EventSerialNumberList.url,
      { state: { serialNumbers: serialNumbers, eventTypeName: eventTypeName, tab: "Events" } });
  }

  useEffect(() => {
    let temp = [];
    temp = events.map(elem => {
      return {
        ...elem,
        key: elem.address,
        name: elem['eventTypename'],
        description: elem['eventTypeDescription'],
        date: epochToDate(elem['date']),
        certifier: elem['certifierName'],
        certifiedDate: elem['certifiedDate'] ? epochToDate(elem['certifiedDate']) : '',
      }
    });
    setParsedEvents(temp);
  }, [events]);

  return (
    <div>
      <DataTableComponent
        columns={column}
        data={parsedEvents}
        isLoading={isEventsLoading}
        scrollX="100%"
      />
    </div>
  );
};

export default EventsList;
