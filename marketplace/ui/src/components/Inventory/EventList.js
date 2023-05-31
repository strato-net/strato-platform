import React,{useEffect,useState} from "react";
import { Breadcrumb, Input } from "antd";
import ClickableCell from "../ClickableCell";
import DataTableComponent from "../DataTableComponent";
import {  useMatch,useNavigate } from "react-router-dom";
import {
  useEventDispatch,
  useEventState,
} from "../../contexts/event";
import { actions } from "../../contexts/event/actions";
import useDebounce from "../UseDebounce";
import routes from "../../helpers/routes";

const { Search } = Input;

const EventList = () => {
  const [data, setdata] = useState([])
  const [Id, setId] = useState(undefined);
  const dispatch = useEventDispatch();
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const { inventoryEvents,isInventoryEventsLoading } =
  useEventState();
  const navigate = useNavigate();


  const routeMatch = useMatch({
    path: routes.EventList.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined ){
      actions.fetchEventOfInventory(dispatch,limit,offset,debouncedSearchTerm,Id);
    }
  }, [limit,offset,Id,debouncedSearchTerm,dispatch])
  

  useEffect(() => {
   let events=[];
    inventoryEvents.forEach(element => {
    events.push(  { "key": element.eventTypeName, "name": element, "description": element.eventTypeDescription },)
   });
   setdata(events);
  }, [inventoryEvents])
  

  const column = [
    {
      title: "Name".toUpperCase(),
      dataIndex: "name",
      key: "name",
      render: (text) => (
        <div className="cursor-pointer" onClick={()=> navigate(routes.InventoryEventDetail.url.replace(":inventoryId",Id).replace(":eventTypeId",text.eventTypeId))}>
          <p className="text-primary underline">{decodeURIComponent(text.eventTypeName)}</p>
        </div>
      ),
      align: "center",
    },
    {
      title: "Description".toUpperCase(),
      dataIndex: "description",
      key: "description",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
      align: "center",
    },
  ];

  return (
    <div className="mx-16 mt-14">
      <div className="flex justify-between">
        <Breadcrumb>
          <Breadcrumb.Item className="cursor-pointer" href="javascript:;">
            <ClickableCell href={routes.Marketplace.url}>Home</ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="cursor-pointer" href="javascript:;">
            <ClickableCell href={routes.Inventories.url}>Inventory</ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="text-primary">
             Events
          </Breadcrumb.Item>
        </Breadcrumb>
        <Search placeholder="Search by Event Name" className="w-80 mr-6" />
      </div>
      <div className="my-4">
        <DataTableComponent
          columns={column}
          pagination={{ position: ["bottomCenter"] }}
          data={data}
          isLoading={isInventoryEventsLoading}
          scrollX="100%"
        />
      </div>
    </div>
  );
};

export default EventList;
