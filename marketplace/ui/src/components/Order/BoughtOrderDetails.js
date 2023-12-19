import React, { useState, useEffect } from "react";
import {
  Card,
  Row,
  Col,
  Breadcrumb,
  Typography,
  Divider,
  notification,
  Input,
  Button,
  Spin,
  Image,
  Tabs,
  DatePicker,
} from "antd";
import { useLocation, useMatch } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import routes from "../../helpers/routes";
import classNames from "classnames";
import { EyeOutlined } from "@ant-design/icons";
import DataTableComponent from "../DataTableComponent";
import { getStringDate } from "../../helpers/utils";
import { getStatus } from "./constant";
import { useNavigate } from "react-router-dom";
import { US_DATE_FORMAT } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";
import RestStatus from "http-status-codes";
import TagManager from "react-gtm-module";
import image_placeholder from "../../images/resources/image_placeholder.png";
import dayjs from "dayjs";
import TransfersTable from "./TransfersTable";
import SoldOrdersTable from "./SoldOrdersTable";
import { ResponsiveOrderDetailCard } from "./ResponsiveOrderDetailCard";

const BoughtOrderDetails = ({ user, users }) => {
  const [comment, setcomment] = useState("");
  const [Id, setId] = useState(undefined);
  const [data, setdata] = useState([]);
  const dispatch = useOrderDispatch();
  const { Text } = Typography;
  const [api, contextHolder] = notification.useNotification();
  const [status, setStatus] = useState(getStatus(0));
  const { TextArea } = Input;
  const [paid, setPaid] = useState(false)
  const [isLoadingPaymentStatus, setisLoadingPaymentStatus] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const { state } = useLocation()

  const navigate = useNavigate();

  const openToastOrder = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  const {
    orderDetails,
    isorderDetailsLoading,
    ordersAudit,
    isbuyerDetailsUpdating,
    success,
    message,
    // paymentStatus,
    // isLoadingPaymentStatus,
  } = useOrderState();

  const routeMatch = useMatch({
    path: routes.BoughtOrderDetails.url,
    strict: true,
  });


  useEffect(() => {
    setId(routeMatch?.params?.id);

  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      getData();
    }
  }, [Id, dispatch]);

  const getData = async () => {
    const data = await actions.fetchOrderDetails(dispatch, Id);
    if (data != null) {
      getPaymentStatus(data.order.paymentSessionId);
    }
  }

  const getPaymentStatus = async (paymentSessionId) => {
    if (paymentSessionId !== "") {
      try {
        setisLoadingPaymentStatus(true);
        const response = await fetch(
          `${apiUrl}/order/payment/session/${paymentSessionId}`,
          {
            method: HTTP_METHODS.GET,
          }
        );

        const body = await response.json();
        setisLoadingPaymentStatus(false);
        if (response.status === RestStatus.OK) {

          if (body.data["payment_status"] === "paid") {
            setPaid(true);
          }

        }

      } catch (err) {
      }
    }

  }



  useEffect(() => {
    if (orderDetails) {
      setStatus(getStatus(parseInt(orderDetails.order.status)));
      setcomment(orderDetails.order.comments);

      let items = [];
      orderDetails.assets.forEach((prod, index) => {
        items.push({
          address: prod.address,
          chainId: prod.chainId,
          key: prod.address,
          productImage: prod.images && prod.images.length > 0 ? prod.images[0] : image_placeholder,
          productName: prod,
          unitPrice: prod.price,
          quantity: parseInt(orderDetails.order.quantities[index]),
          shippingCharges: prod.shippingCharges ? prod.shippingCharges : 0,
          amount: prod.price * parseInt(orderDetails.order.quantities[index]),
          serialNumber: prod,
          tax: prod.tax ? prod.tax : 0,
        });
      });
      setdata(items);
    }
  }, [orderDetails]);

  const details = orderDetails;
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

  const OrderData = ({ title, value }) => {
    return (
      <Col>
        <Text className="block text-[#6A6A6A] text-[13px] mb-2">{title}</Text>
        <Text className="block text-[#202020] text-[17px] font-semibold">{value}</Text>
      </Col>
    );
  };

  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  const statusComponent = (status) => {
    let textClass = "bg-[#FFF6EC]";
    if (status === "Awaiting Shipment") {
      textClass = "bg-[#EBF7FF]";
    } else if (status === "Awaiting Fulfillment"){
      textClass = "bg-[#FF8C0033]"
    } else if (status === "Closed") {
      textClass = "bg-[#119B2D33]";
    } else if (status === "Canceled") {
      textClass = "bg-[#FFF0F0]";
    }
    let bgClass = "bg-[#119B2D]";
    if (status === "Awaiting Shipment") {
      bgClass = "bg-[#13188A]";
    } else if (status === "Awaiting Fulfillment"){
      bgClass = "bg-[#FF8C00]"
    } else if (status === "Closed") {
      bgClass = "bg-[#119B2D]";
    } else if (status === "Canceled") {
      bgClass = "bg-[#FF0000]";
    }
    return (
      <div className={classNames(textClass, "status_contain w-max h-max text-center py-1 px-3 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p className="!mb-0 text-xs md:text-sm">{status}</p>
      </div>
    );
  };

  const onChange = (key) => {
    navigate(routes.Orders.url, { state: { defaultKey: key } })
  };

  const NewOrderData = ({ title, value, className }) => {
    return (
      <div className={className}>
        <Text className="block text-[#6A6A6A] text-[12px] mb-1">{title}</Text>
        <Text className="block text-[#202020] text-[13px] font-semibold">{value}</Text>
      </div>
    );
  };

  let column = [
    {
      title: "",
      dataIndex: "productImage",
      key: "productImage",
      render: (text) => <img className="w-[75px] h-[60px] object-contain" alt="" src={text} />,
    },
    {
      title: <Text className="text-primaryC text-[13px]">PRODUCT NAME</Text>,
      dataIndex: "productName",
      key: "productName",
      render: (text) => (
        <p
          // href={routes.BoughtOrderDetails.url}
          className="text-primary text-[17px] cursor-pointer"
          onClick={() => {navigate(`${routes.MarketplaceProductDetail.url.replace(":address", text.address)}`) }}
        >
          {decodeURIComponent(text.name)}
        </p>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
      dataIndex: "serialNumber",
      key: "serialNumber",
      align: "center",
      render: (text) => (
        <div className="flex items-center justify-center">
          <EyeOutlined className="mr-2 hover:text-primaryHover cursor-pointer" />
          <p
            onClick={() => {
              navigate(
                `${routes.BoughtOrderItemDetail.url
                  .replace(":id", text.address)}`,
                // .replace(":chainId", text.chainId)}`,
                { state: { orderId: details.orderId, address: Id } }
              );
            }}
            className="hover:text-primaryHover cursor-pointer"
          >
            View
          </p>
        </div>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">UNIT PRICE($)</Text>,
      dataIndex: "unitPrice",
      key: "unitPrice",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">QUANTITY</Text>,
      dataIndex: "quantity",
      key: "quantity",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">SHIPPING CHARGES($)</Text>
      ),
      dataIndex: "shippingCharges",
      key: "shippingCharges",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">TAX($)</Text>,
      dataIndex: "tax",
      key: "tax",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">AMOUNT($)</Text>,
      dataIndex: "amount",
      key: "amount",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
  ];

  if (data[0] && !data[0].serialNumber.containsSerialNumber) {
    column = column.filter(col => col.dataIndex !== "serialNumber")
  }

  const handleCancelOrder = async () => {
    const body = {
      saleOrderAddress: details.order.address,
      comments: comment,
    };
    let isDone = await actions.cancelSale(dispatch, body);
    if (isDone) {
      setStatus("Canceled");
    }
  };

  return (
    <div>
      {contextHolder}
      {details === null || isorderDetailsLoading || isbuyerDetailsUpdating || isLoadingPaymentStatus ? (
        <div className="h-screen flex justify-center items-center">
          <Spin
            spinning={isorderDetailsLoading || isbuyerDetailsUpdating || isLoadingPaymentStatus}
            size="large"
          />
        </div>
      ) : (
        <div>
          <Breadcrumb className="text-sm ml-4 md:ml-20 mt-4 md:mt-14 mb-8">
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                Home
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <div onClick={() => { navigate(routes.Orders.url, { state: { defaultKey: "Bought" } }); }}>
                Orders (Bought)
              </div>
            </Breadcrumb.Item>
            <Breadcrumb.Item className="text-primary">
              {details.order.orderId}
            </Breadcrumb.Item>
          </Breadcrumb>

          <Tabs
            className="mx-4 md:mx-20 mt-0"
            onChange={onChange}
            defaultActiveKey={state == null ? "Bought" : state.defaultKey}
            items={[
              {
                label: <p id="sold-tab" className="font-semibold text-sm md:text-base">Orders (Sold)</p>,
                key: "Sold",
                children: <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />

              },
              {
                label: <p id="bought-tab" className="font-semibold text-sm md:text-base">Orders (Bought)</p>,
                key: "Bought",
                children:
                  <div className="mb-10">
                    <Card className="md:p-2 mb-4 md:mb-14 md:shadow-card_shadow order_detail_card">
                      <div className="flex flex-col md:flex-row md:justify-between">
                        <div className="flex flex-col">
                          <div className="flex">
                            <Text className="bg-[#E9E9E9] md:bg-white py-2 px-3 w-full md:w-1/4 md:bg-none font-semibold text-sm md:text-lg text-primaryB flex gap-4 items-center">Order Details</Text>
                            <Text className="hidden md:flex mt-2">{statusComponent(status)}</Text>
                            {
                              !paid ? <div /> : <div className={classNames("text-success  bg-[#EAFFEE]", "ml-4 w-20 text-center text-xs p-1 rounded")}>
                                <p>Paid</p>
                              </div>
                            }
                          </div>
                          <Text className="text-[#6A6A6A] md:text-black px-3 my-2 text-xs md:text-sm md:font-semibold">Please upload serial number(s) (if any) and/or enter the fulfillment date to close the order</Text>
                        </div>
                        <Button
                        id="cancel-order-button"
                        type="primary"
                        className="md:flex w-1/3 md:w-48 h-9 ml-2 md:ml-6 md:mr-2 md:mt-3 bg-primary !hover:bg-primaryHover"
                        disabled={status !== getStatus(1) || comment === "" || details.order.paymentSessionId !== ""}
                        onClick={() => {
                          handleCancelOrder()
                          window.LOQ.push(['ready', async LO => {
                            await LO.$internal.ready('events')
                            LO.events.track('Order Details: Cancel Order')
                          }])
                          TagManager.dataLayer({
                            dataLayer: {
                              event: 'orderDetails_bought_cancel_click',
                            },
                          });
                        }}
                      >
                        Cancel Order
                      </Button>
                      </div>
                      <Row className="hidden md:flex my-6 justify-between bg-[#F6F6F6] p-4 pb-2 rounded">
                        <OrderData title="NUMBER" value={`#${details.order.orderId}`} />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData
                          title="BUYER"
                          value={details.order.purchasersCommonName}
                        />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData
                          title="SELLER"
                          value={details.order.sellersCommonName}
                        />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData title="TOTAL ($)" value={details.order.totalPrice} />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData
                          title="DATE"
                          value={getStringDate(details.order.createdDate, US_DATE_FORMAT)}
                        />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <Col>
                          <Text className="block text-primaryC text-[13px] mb-2">
                            STATUS
                          </Text>
                          {statusComponent(status)}
                        </Col>
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <div className="text-xs order_detail_date">
                          <Text className="block text-primaryC text-[13px] mb-0">
                            ORDER CLOSE DATE
                          </Text>
                          <DatePicker
                            value={
                              selectedDate
                            }
                            disabledDate={(current) => {
                              return current && current < dayjs().endOf('day');
                            }}
                            onChange={onDateChange}
                            disabled={details.order.status === "3" || details.order.status === "4"}
                          />
                        </div>
                      </Row>
                      <Row className="my-2 md:hidden flex-col gap-2 justify-between p-4 pb-2 rounded">
                        <div className="flex gap-4">
                          <NewOrderData className="w-2/4" title="ORDER NUMBER" value={`#${details.order.orderId}`} />
                          <NewOrderData className="w-2/4" title="BUYER" value={details.order.purchasersCommonName} />
                        </div>
                        <div className="flex gap-4">
                          <NewOrderData className="w-2/4" title="SELLER" value={details.order.sellersCommonName} />
                          <NewOrderData className="w-2/4" title="TOTAL ($)" value={details.order.totalPrice} />
                        </div>
                        <div className="flex justify-between">
                          <NewOrderData className="w-2/4" title="DATE" value={getStringDate(details.order.createdDate, US_DATE_FORMAT)} />
                          <NewOrderData className="w-2/4" title="ORDER CLOSE DATE"
                            value={
                              <DatePicker
                                value={selectedDate}
                                disabledDate={(current) => { return current && current < dayjs().endOf('day'); }}
                                onChange={onDateChange}
                                disabled={details.order.status === "3" || details.order.status === "4"}
                              />} />
                        </div>
                        <div className="flex justify-between">
                          <NewOrderData className="w-2/4" title={"Invoice"} value={
                            <div className="flex items-center">
                              <EyeOutlined className="mr-1 -mt-3 hover:text-primaryHover cursor-pointer" />
                              <p
                                // onClick={() => {
                                //   navigate(
                                //     `${routes.SoldOrderItemDetail.url.replace(":id", data?.address)}`,
                                //     { state: { orderId: orderDetails.orderId, address: Id } }
                                //   );
                                // }}
                                className="hover:text-primaryHover"
                              >
                                View
                              </p>
                            </div>} />
                          <NewOrderData className="w-2/4" title="STATUS" value={statusComponent(status)} />
                        </div>
                        <div className="flex justify-between">
                          <NewOrderData className="w-2/4" title="PAYMENT STATUS" value={statusComponent(status)} />
                        </div>
                      </Row>
                      <Row className="flex-nowrap items-center justify-between mb-2 md:mb-6 p-2">
                        <div className="w-full">
                          <Text className="block text-primaryC text-[13px] mb-2">
                            COMMENTS
                          </Text>
                          <TextArea
                            rows={2}
                            placeholder="Enter Comments"
                            value={decodeURIComponent(comment)}
                            disabled={status !== getStatus(1) || details.order.paymentSessionId !== ""}
                            onChange={(event) => {
                              setcomment(event.target.value);
                            }}
                          />
                        </div>
                      </Row>

                      <div className="hidden md:block">
                        <DataTableComponent
                          columns={column}
                          data={data}
                          isLoading={false}
                          scrollX="100%"
                        /></div>
                    </Card>
                    {data?.length > 0 && data?.map((item) => {
                      return (
                        <ResponsiveOrderDetailCard data={item} />)
                    })}
                  </div>
              },
              {
                label: <p id="transfers-tab" className="font-semibold text-sm md:text-base">Transfers</p>,
                key: "Transfers",
                children: <TransfersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />
              }
            ]}
          />
        </div>
      )}

      {message && openToastOrder("bottom")}
    </div>
  );
};

export default BoughtOrderDetails;
