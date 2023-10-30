import React,{useState,useEffect} from "react";
import { Breadcrumb, Input,Spin } from "antd";
import ClickableCell from "../ClickableCell";
import { Card } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { Divider } from "antd";
import DataTableComponent from "../DataTableComponent";
import routes from "../../helpers/routes";
import {useMatch,useNavigate } from "react-router-dom";
import { epochToDate } from "../../helpers/utils";
import { actions } from "../../contexts/event/actions";
import {
  useEventDispatch,
  useEventState,
} from "../../contexts/event";

const { Search } = Input;

const InventoryEventDetails = () => {
  const [inventoryId, setinventoryId] = useState(undefined);
  const [eventTypeId, seteventTypeId] = useState(undefined);
  const dispatch = useEventDispatch();
  const [data, setdata] = useState([])
  const { eventDetails,iseventDetailsLoading } =
  useEventState();
  const navigate = useNavigate();

  const routeMatch = useMatch({
    path: routes.InventoryEventDetail.url,
    strict: true,
  });

  useEffect(() => {
    setinventoryId(routeMatch?.params?.inventoryId);
    seteventTypeId(routeMatch?.params?.eventTypeId);
  }, [routeMatch]);

  useEffect(() => {
    if (inventoryId !== undefined && eventTypeId !== undefined){
      actions.fetchEventDetails(dispatch,inventoryId,eventTypeId);
    }
  }, [dispatch,inventoryId,eventTypeId])
  

  useEffect(() => {
    let temp = [];
    if(eventDetails!=null){
      temp = eventDetails.events.map(elem => {
        return {
          ...elem,
          key: elem.eventBatchId,
          date:  epochToDate(elem['date']),
          summary: elem['summary'],
          certifier: elem['certifierName'],
          certifiedDate: elem['certifiedDate'] ? epochToDate(elem['certifiedDate']) : '',
        }
      });
    }
    setdata(temp);
   }, [eventDetails])


  const column = [
    {
      title: "Date".toUpperCase(),
      dataIndex: "date",
      key: "date",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "summary".toUpperCase(),
      dataIndex: "summary",
      key: "summary",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: "Certifier".toUpperCase(),
      dataIndex: "certifier",
      key: "certifier",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "certified Date".toUpperCase(),
      dataIndex: "certifiedDate",
      key: "certifiedDate",
      render: (text) => <p>{text}</p>,
    },
    {
      title: "serial number".toUpperCase(),
      dataIndex: "serialNo",
      key: "serialNo",
      render: (text) => (
        <div className="group flex items-center cursor-pointer"   onClick={() => passSerialNumber(text, eventDetails.eventTypeName)}>
          <EyeOutlined className="mr-2 group-hover:text-primary" />
          <p className="group-hover:text-primary">View</p>
        </div>
      ),
    },
  ];

  const passSerialNumber = (serialNumbers, eventTypeName) => {
    navigate(routes.InventoryEventSerialNumberList.url,
      { state: { serialNumbers: serialNumbers, eventTypeName: eventTypeName, tab: "Inventory", inventoryId: inventoryId, eventTypeId: eventTypeId } });
  }


  return (
    <div className="mx-16 mt-14">
       { eventDetails === null || iseventDetailsLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin
            spinning={iseventDetailsLoading}
            size="large"
          />
        </div>
      ) :
      <div>
      <div className="flex justify-between">
        <Breadcrumb>
          <Breadcrumb.Item className="cursor-pointer" href="javascript:;">
            <ClickableCell href={routes.Marketplace.url}>Home</ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="cursor-pointer" href="javascript:;">
            <ClickableCell href={routes.Inventories.url}>Inventory</ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="cursor-pointer" href="javascript:;">
            <ClickableCell href={routes.EventList.url.replace(":id",inventoryId)}>Events</ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="text-primary">
            {decodeURIComponent(eventDetails.eventTypeName)}
          </Breadcrumb.Item>
        </Breadcrumb>
        <Search placeholder="Search by Event Name" className="w-80 mr-6" />
      </div>
      <div className="my-4">
        <Card
          title={
            <div>
              <h1>Event Details</h1>
              <div className="flex mt-4 items-c enter">
                <div>
                  <p className="text-sm font-medium text-primaryC">Name</p>
                  <p className="text-base text-primaryB">{decodeURIComponent(eventDetails.eventTypeName)}</p>
                </div>
                <Divider type="vertical" className="ml-12 h-10 bg-secondryD" />
                <div className="ml-12">
                  <p className="text-sm font-medium text-primaryC">
                    Description
                  </p>
                  <p className="text-base text-primaryB">
                  {decodeURIComponent(eventDetails.eventTypeDescription)}
                  </p>
                </div>
              </div>
            </div>
          }
          bordered={false}
        >
          <DataTableComponent
            columns={column}
            pagination={{ position: ["bottomCenter"] }}
            data={data}
            isLoading={iseventDetailsLoading}
            scrollX="100%"
          />
        </Card>
      </div>
      </div>
}
    </div>
  );
};

export default InventoryEventDetails;
