import React, { useState, useEffect, useMemo } from "react";
import { Table, Typography, Breadcrumb, Input } from "antd";
import { useMatch, useLocation } from "react-router-dom";
import { actions } from "../../contexts/event/actions";
import { useEventDispatch, useEventState } from "../../contexts/event";
import routes from "../../helpers/routes";
import {SearchOutlined} from '@ant-design/icons';

function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

const EventDetails = ({ user, users }) => {
  const [Id, setId] = useState(undefined);
  const [chainId, setChainId] = useState(undefined);

  const dispatch = useEventDispatch();
  const {Text} = Typography;

  const {
    eventDetails,
    iseventDetailsLoading,
    eventsAudit
  } = useEventState();

  const routeMatch = useMatch({
    path: routes.EventDetail.url,
    strict: true,
  });

  const query = useQuery();

  useEffect(() => {
    setId(routeMatch?.params?.id);
    setChainId(query.get("chainId"));
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined && chainId !== undefined) {
      actions.fetchEventDetails(dispatch, Id, chainId);
      actions.fetchEventAudit(dispatch, Id, chainId);
    }
  }, [Id, dispatch]);

  const details = eventDetails;
  const audits = eventsAudit;
  if (audits && audits.length) {
    audits.map((val) => {
      if (users && users.length) {
        const sender = users.find(
          (data) => val["transaction_sender"] === data.userAdress
        );
        audits["sender"] = sender;
      }
    });
  }
  // const columns = [
  //   {
  //     title: "Date",
  //     dataIndex: "block_timestamp",
  //   },
  //   {
  //     title: "Sender",
  //     dataIndex: "sender",
  //   },
  //   {
  //     title: "eventTypeId",
  //     dataIndex: "eventTypeId",
  //   },
  //   {
  //     title: "itemSerialNumber",
  //     dataIndex: "itemSerialNumber",
  //   },
  //   {
  //     title: "itemNFTAddress",
  //     dataIndex: "itemNFTAddress",
  //   },
  //   {
  //     title: "date",
  //     dataIndex: "date",
  //   },
  //   {
  //     title: "inventoryId",
  //     dataIndex: "inventoryId",
  //   },
  //   {
  //     title: "productId",
  //     dataIndex: "productId",
  //   },
  //   {
  //     title: "summary",
  //     dataIndex: "summary",
  //   },
  //   {
  //     title: "certifiedBy",
  //     dataIndex: "certifiedBy",
  //   },
  //   {
  //     title: "certifiedDate",
  //     dataIndex: "certifiedDate",
  //   },
  //   {
  //     title: "createdAt",
  //     dataIndex: "createdAt",
  //   },
  //   {
  //     title: "Organization",
  //     dataIndex: "ownerOrganization",
  //   },
  //   {
  //     title: "Organizational Unit",
  //     dataIndex: "ownerOrganizationalUnit",
  //   },
  //   {
  //     title: "Common Name",
  //     dataIndex: "ownerCommonName",
  //   },
  // ];
  if (Id !== undefined && !iseventDetailsLoading && details !== null) {
    if (details["ownerOrganizationalUnit"] === "") {
      details["ownerOrganizationalUnit"] = "N/A";
    }
  }

  const serialNumberColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
      dataIndex: "serialNumber",
      key: "serialNumber",
      align: "center",
      render: (text) => (
        // <Button type="link" className="text-primary text-[17px]">
         <p>{text}</p> 
        // </Button>
      ),
    },
  ];

  const serialNumberData = [
    {
      key: "1",
      serialNumber: "8145759754261230",
    },
    {
      key: "2",
      serialNumber: "8145759754261230",
    },
    {
      key: "3",
      serialNumber: "8145759754261230",
    },
    {
      key: "4",
      serialNumber: "8145759754261230",
    },
    {
      key: "5",
      serialNumber: "8145759754261230",
    },
  ];

  return (
    <div className="mx-14">
      <div className="flex justify-between items-center mt-14">
        <Breadcrumb className="text-xs mb-6">
          <Breadcrumb.Item>
            <a
              href={routes.Marketplace.url}
              className="text-primaryB hover:bg-transparent"
            >
              Home
            </a>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <a
              // href={routes.Orders.url}
              className="text-primaryB hover:bg-transparent"
            >
              Events
            </a>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <a
              // href={routes.Orders.url}
              className="text-primaryB hover:bg-transparent"
            >
              Event A
            </a>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="text-primary">Serial Number</Breadcrumb.Item>
        </Breadcrumb>
        <Input
          placeholder="Search by Serial Number"
          prefix={<SearchOutlined />}
          size="middle"
          className="w-80"
        />
      </div>

      <Table
            columns={serialNumberColumn}
            pagination={{ position: ["bottomCenter"] }}
            dataSource={serialNumberData}
            size="middle"
            rowClassName={(record, index) =>
              index % 2 === 0 ? "bg-white" : "bg-secondry"
            }/>
    </div>
  );
};

export default EventDetails;
