import { Pagination, Table, Typography } from "antd";
import React, { useEffect, useState } from "react";
import { useEventTypeState } from "../../contexts/eventType";

import DataTableComponent from "../DataTableComponent";
import { epochToDate } from "../../helpers/utils";

const { Text } = Typography;

const EventTypeList = ({ onPageChange, page, total }) => {
  const [parsedEventTypes, setParsedEventTypes] = useState([]);

  const {
    isEventTypesLoading,
    eventTypes
  } = useEventTypeState();

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
      title: <Text className="text-primaryC text-[13px]">CREATED DATE</Text>,
      dataIndex: "createdDate",
      key: "createdDate",
      render: (text) => <p className="text-base">{text}</p>,
    },
  ];

  useEffect(() => {
    let temp = [];
    temp = eventTypes.map(elem => {
      return {
        ...elem,
        key: elem.address,
        createdDate: epochToDate(elem['createdDate'])
      }
    });
    setParsedEventTypes(temp);
  }, [eventTypes]);

  return (
    <>
      <DataTableComponent
        columns={column}
        data={parsedEventTypes}
        isLoading={isEventTypesLoading}
        scrollX="100%"
        pagination={false}
      />
      <Pagination
        current={page}
        onChange={onPageChange}
        total={total}
        className="flex justify-center my-5 "
      />
    </>
  );
};

export default EventTypeList;
