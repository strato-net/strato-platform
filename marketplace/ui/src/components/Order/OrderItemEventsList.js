import {
  Breadcrumb,
  Typography,
  Input,
} from "antd";
import routes from "../../helpers/routes";
import { useEffect, useState } from "react";
import { SearchOutlined } from "@ant-design/icons";
import DataTableComponent from "../DataTableComponent";
import { useNavigate, useMatch, useLocation } from "react-router-dom";
import { EyeOutlined } from "@ant-design/icons";
import { actions } from "../../contexts/event/actions";
import { useEventDispatch, useEventState } from "../../contexts/event";
import useDebounce from "../UseDebounce";
import { epochToDate } from "../../helpers/utils";
import ClickableCell from "../ClickableCell";


const OrderItemEventsList = () => {
  const [Id, setId] = useState(undefined);
  const [data, setData] = useState([]);
  const { Text } = Typography;
  const navigate = useNavigate();
  const dispatch = useEventDispatch();
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const {
    isItemEventsLoading,
    itemEvents
  } = useEventState();

  const routeMatch = useMatch({
    path: routes.OrderItemEventsList.url,
    strict: true,
  });

  const { state } = useLocation();


  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchEventOfItem(dispatch, limit, offset, debouncedSearchTerm, Id)
    }
  }, [dispatch, limit, offset, debouncedSearchTerm, Id])

  useEffect(() => {
    setId(routeMatch?.params?.itemId);
  }, [routeMatch]);

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
      render: (text) => <p className="text-base">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">CERTIFIED DATE</Text>,
      dataIndex: "certifiedDate",
      key: "certifiedDate",
      render: (text) => <p className="text-base">{text}</p>,
    },
    // {
    //   title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
    //   dataIndex: "serialNo",
    //   key: "serialNo",
    //   render: (text, row) => (
    //     <div className="flex items-center cursor-pointer hover:text-primaryHover"
    //       onClick={() => passSerialNumber(text, row.name)}>
    //       <EyeOutlined className="mr-1" />
    //       <p>View</p>
    //     </div>
    //   ),
    // },
  ];

  // const passSerialNumber = (serialNumbers, eventTypeName) => {
  //   navigate(routes.EventSerialNumberList.url,
  //     { state: { serialNumbers: serialNumbers, eventTypeName: eventTypeName } });
  // }


  useEffect(() => {
    let temp = [];
    temp = itemEvents.map(elem => {
      return {
        ...elem,
        key: elem.address,
        name: elem['eventTypename'],
        description: elem['eventTypeDescription'],
        date: epochToDate(elem['date']),
        certifier:elem["certifierName"],
        certifiedDate: elem['certifiedDate'] ? epochToDate(elem['certifiedDate']) : '',
      }
    });
    setData(temp);
  }, [itemEvents]);


  return (
    <div className="h-screen mx-14">
      <div className="flex justify-between items-center mt-14">
        <Breadcrumb className="text-xs mb-6">
          <Breadcrumb.Item href="javascript:;">
            <ClickableCell href={routes.Marketplace.url}>
              Home
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="javascript:;">
            <ClickableCell href={routes.Orders.url}>
              Orders
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="javascript:;">
            {
              state == null ? <div>
              </div> : <ClickableCell href={state.seller === true ? `${routes.SoldOrderDetails.url.replace(":id", state.orderAddress)}` : `${routes.BoughtOrderDetails.url.replace(":id", state.orderAddress)}`}>
                {state.orderId}
              </ClickableCell>
            }
          </Breadcrumb.Item>
          <Breadcrumb.Item className="text-primary">Events</Breadcrumb.Item>
        </Breadcrumb>
        <Input
          placeholder="Search by Event Name"
          prefix={<SearchOutlined />}
          className="w-80"
        />
      </div>
      <DataTableComponent
        columns={column}
        data={data}
        isLoading={isItemEventsLoading}
        scrollX="100%"
      />
    </div>
  );
};

export default OrderItemEventsList;
