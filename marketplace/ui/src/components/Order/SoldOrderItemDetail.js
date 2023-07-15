import React, { useState, useEffect } from "react";
import {
  Card,
  Row,
  Col,
  Breadcrumb,
  Typography,
  Input,
  Spin,
} from "antd";
import { useMatch, useLocation, useNavigate } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import routes from "../../helpers/routes";
import { EyeOutlined, SearchOutlined } from "@ant-design/icons";
import DataTableComponent from "../DataTableComponent";
import ClickableCell from "../ClickableCell";


const SoldOrderItemDetail = ({ user, users }) => {
  const [Id, setId] = useState(undefined);
 
  const [data, setdata] = useState([]);
  const { state } = useLocation();

  const dispatch = useOrderDispatch();
  const { Text } = Typography;

  const {
    orderLineDetails,
    isorderDetailsLoading,
    ordersAudit,
    isOrderLineDetailsLoading,
  } = useOrderState();

  const routeMatch = useMatch({
    path: routes.SoldOrderItemDetail.url,
    strict: true,
  });

  useEffect(() => {
   
    if (orderLineDetails) {
      if (orderLineDetails.items) {
        let items = [];
        orderLineDetails.items.forEach((item) => {
          items.push({
            address: item.address,
            chainId: item.chainId,
            key: item.address,
            itemId: item.address,
            serialNumber: item.itemSerialNumber ? item.itemSerialNumber : item.address,
            event: item,
          });
        });
        setdata(items);
      }
    }
  }, [orderLineDetails]);

  useEffect(() => {
    setId(routeMatch?.params?.id);
 
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchOrderLineItemDetails(dispatch, Id);
    }
  }, [Id, dispatch]);

  const details = orderLineDetails;
  const audits = ordersAudit;
  if (audits && audits.length) {
    audits.forEach((val) => {
      if (users && users.length) {
        const sender = users.find(
          (data) => val["transaction_sender"] === data.userAdress
        );
        audits["sender"] = sender;
      }
    });
  }

  if (Id !== undefined && !isorderDetailsLoading && details !== null) {
    if (details["ownerOrganizationalUnit"] === "") {
      details["ownerOrganizationalUnit"] = "N/A";
    }
  }

  const OrderDataComponent = ({ title, value }) => {
    return (
      <Col>
        <Text className="block text-primaryC text-[13px] mb-2">{title}</Text>
        <Text className="block text-primaryC text-[17px]">{value}</Text>
      </Col>
    );
  };

  const column = [
    // {
    //   title: <Text className="text-primaryC text-[13px]">ITEM ID</Text>,
    //   dataIndex: "itemId",
    //   key: "itemId",
    //   render: (text) => <p className="text-primary">{text}</p>,
    // },
    {
      title: (
        <Text className="text-primaryC text-center text-[13px]">
          SERIAL NUMBER
        </Text>
      ),
      dataIndex: "serialNumber",
      key: "serialNumber",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">EVENT</Text>,
      dataIndex: "event",
      key: "event",
      render: (text) => (
        <div className="flex items-center justify-start" onClick={() => navigate(`${routes.OrderItemEventsList.url.replace(":itemId", text.itemId)}`, { state: { name: details.name, orderId: state.orderId, orderAddress: state.address, seller: true } })}>
          <EyeOutlined className="mr-2 hover:text-primaryHover cursor-pointer" />
          <p
            className="hover:text-primaryHover cursor-pointer"
          >
            View
          </p>
        </div>
      ),
    },
  ];

  const navigate = useNavigate();

  return details === null || isOrderLineDetailsLoading ? (
    <div className="h-screen flex justify-center items-center">
      <Spin spinning={isOrderLineDetailsLoading} size="large" />
    </div>
  ) : (
    <div>
      <div className="flex justify-between items-center mx-14  mt-14">
        <Breadcrumb className="text-xs mb-6">
          <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              Home
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
            <div onClick={() => { navigate(routes.Orders.url, { state: { defaultKey: "Sold" } }); }}>
              Orders (Sold)
            </div>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
            <ClickableCell href={`${routes.SoldOrderDetails.url.replace(":id", state.address)}`}>
              {state.orderId}
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="text-primary">
            {decodeURIComponent(details.name)}
          </Breadcrumb.Item>
        </Breadcrumb>
        <Input
          placeholder="Search by Serial Number"
          prefix={<SearchOutlined />}
          size="middle"
          className="w-80"
        />
      </div>
      <Card className="mx-14 mb-14">
        <Text className="font-semibold text-primaryB">
          {decodeURIComponent(details.name)}
        </Text>
        <Row className="my-6 justify-between">
          <OrderDataComponent
            title="MANUFACTURER"
            value={decodeURIComponent(details.manufacturer)}
          />
        </Row>
        <DataTableComponent
          columns={column}
          data={data}
          isLoading={false}
          scrollX="100%"
        />
      </Card>
    </div>
  );
};

export default SoldOrderItemDetail;
