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
import { getStatus, getStatusByName } from "./constant";
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
import RedemptionsOutgoingTable from "./RedemptionsOutgoingTable";
import RedemptionsIncomingTable from "./RedemptionsIncomingTable";
import { ResponsiveOrderDetailCard } from "./ResponsiveOrderDetailCard";
import { LeftArrow } from "../../images/SVGComponents";


const BoughtOrderDetails = ({ user, users }) => {
  const [comment, setcomment] = useState("");
  const [Id, setId] = useState(undefined);
  const [data, setdata] = useState([]);
  const dispatch = useOrderDispatch();
  const { Text } = Typography;
  const [api, contextHolder] = notification.useNotification();
  const [status, setStatus] = useState(getStatus(0));
  const { TextArea } = Input;
  const [paid, setPaid] = useState("Processing");
  const [isLoadingPaymentStatus, setisLoadingPaymentStatus] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [shouldCheckPaymentStatus, setShouldCheckPaymentStatus] = useState(false);
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
      setShouldCheckPaymentStatus(true);
    }
  };

  useEffect(() => {
    if (shouldCheckPaymentStatus && orderDetails) {
      getPaymentStatus(orderDetails.order.paymentSessionId, orderDetails.order.sellersCommonName);
      setShouldCheckPaymentStatus(false);
    }
  }, [shouldCheckPaymentStatus, orderDetails]);


  const validatePayment = async (paymentSessionId) => {
    if (!paymentSessionId || !orderDetails) return;

    const currentStatus = getStatus(parseInt(orderDetails.order.status));
    const isPending = currentStatus === getStatusByName("Payment Pending");
    const isCanceled = currentStatus === getStatusByName("Canceled");

    if (isCanceled) {
      setPaid("Payment Failed");
      setcomment(orderDetails.order.comments);
    }

    if (isPending) {
      try {
        const response = await fetch(
          `${apiUrl}/order/payment/intent/${paymentSessionId}/${orderDetails.order.sellersCommonName}`,
          { method: HTTP_METHODS.GET }
        );
        const intentBody = await response.json();
        const paymentErrorAndRequiresMethod = intentBody.data.last_payment_error?.message && intentBody.data.status === 'requires_payment_method';

        if (paymentErrorAndRequiresMethod && !isCanceled) {
          setisLoadingPaymentStatus(true)
          const body = {
            saleOrderAddress: orderDetails.order.address,
            comments: encodeURIComponent('Stripe: ' + intentBody.data.last_payment_error.message),
          };
          //Update Order Details and change the Order Status to 'Canceled' from 'Payment Pending'
          let isDone = await actions.cancelSale(dispatch, body);
          setcomment(`Stripe: ${orderDetails.order.comments}`);
          if (isDone) {
            setStatus("Canceled");
            setPaid("Payment Failed");
            await actions.fetchOrderDetails(dispatch, Id);
            setisLoadingPaymentStatus(false);
          }
        }

      } catch (err) {
        console.error(`Error: ${err}`);
      }
    }
  };

  const getPaymentStatus = async (paymentSessionId, sellersCommonName) => {
    if (!paymentSessionId) return;

    setisLoadingPaymentStatus(true);
    try {
      const response = await fetch(
        `${apiUrl}/order/payment/session/${paymentSessionId}/${sellersCommonName}`,
        { method: HTTP_METHODS.GET }
      );

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        if (body.data["payment_status"] === "paid") {
          setPaid("Paid");
        } else {
          await validatePayment(paymentSessionId);
        }
      }
    } catch (err) {
      console.error(`Error: ${err}`);
    } finally {
      setisLoadingPaymentStatus(false);
    }
  };



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
          name: prod.name,
          unitPrice: prod.price,
          quantity: parseInt(orderDetails.order.quantities[index]),
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
    } else if (status === "Awaiting Fulfillment") {
      textClass = "bg-[#FF8C0033]"
    } else if (status === "Payment Pending") {
      textClass = "bg-[#FF8C0033]"
    } else if (status === "Closed") {
      textClass = "bg-[#119B2D33]";
    } else if (status === "Canceled") {
      textClass = "bg-[#FFF0F0]";
    }
    let bgClass = "bg-[#119B2D]";
    if (status === "Awaiting Shipment") {
      bgClass = "bg-[#13188A]";
    } else if (status === "Payment Pending") {
      bgClass = "bg-[#FF8C00]"
    } else if (status === "Awaiting Fulfillment") {
      bgClass = "bg-[#FF8C00]"
    } else if (status === "Closed") {
      bgClass = "bg-[#119B2D]";
    } else if (status === "Canceled") {
      bgClass = "bg-[#FF0000]";
    }
    return (
      <div className={classNames(textClass, "status_contain w-max h-max text-center py-1 px-3 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p className="!mb-0 text-[11px] md:text-sm">{status}</p>
      </div>
    );
  };

  const statusComponentForPayment = (status) => {
    let textClass = "bg-[#FFF6EC]";
    if (status === "Processing") {
      textClass = "bg-[#FF8C0033]"
    } else if (status === "Paid") {
      textClass = "bg-[#119B2D33]";
    } else if (status === "Payment Failed") {
      textClass = "bg-[#FFF0F0]";
    }
    let bgClass = "bg-[#119B2D]";
    if (status === "Processing") {
      bgClass = "bg-[#FF8C00]"
    } else if (status === "Paid") {
      bgClass = "bg-[#119B2D]";
    } else if (status === "Payment Failed") {
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
    navigate(routes.Orders.url.replace(':type', key))
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
      title: <Text className="text-primaryC text-[13px]">Product Name</Text>,
      dataIndex: "productName",
      key: "productName",
      render: (text) => (
        <p
          // href={routes.BoughtOrderDetails.url}
          className="text-primary text-[17px] cursor-pointer"
          onClick={() => { navigate(`${routes.MarketplaceProductDetail.url.replace(":address", text.address).replace(":name", text.name)}`) }}
        >
          {decodeURIComponent(text.name)}
        </p>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Serial Number</Text>,
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
      title: <Text className="text-primaryC text-[13px]">Unit Price($)</Text>,
      dataIndex: "unitPrice",
      key: "unitPrice",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">Quantity</Text>,
      dataIndex: "quantity",
      key: "quantity",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">Tax($)</Text>,
      dataIndex: "tax",
      key: "tax",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">Amount($)</Text>,
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
          <Breadcrumb className="text-sm ml-4 md:ml-20 mt-4 md:mt-5 mb-2">
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-[#13188A] font-semibold">

                  Home
                </p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <div onClick={() => { navigate(routes.Orders.url.replace(':type', 'bought')); }}>
                <p className="text-sm text-[#13188A] font-semibold">

                  Orders (bought)
                </p>
              </div>
            </Breadcrumb.Item>
            <Breadcrumb.Item className="text-sm font-medium text-[#202020]">
              {details.order.orderId}
            </Breadcrumb.Item>
          </Breadcrumb>

          <Tabs
            className="mx-4 md:mx-20 mt-5"
            onChange={onChange}
            defaultActiveKey={"bought"}
            items={[
              {
                label: <p id="sold-tab" className="font-semibold text-sm md:text-base">Orders (Sold)</p>,
                key: "sold",
                children: <SoldOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />

              },
              {
                label: <p id="bought-tab" className="font-semibold text-sm md:text-base">Orders (Bought)</p>,
                key: "bought",
                children:
                  <div className="mb-10">
                    <Button type="ghost" onClick={() => onChange('Bought')} className="cursor-pointer mb-1 px-2 flex md:hidden items-center gap-2 text-sm font-semibold"><LeftArrow /> Back</Button>
                    <Card className="md:p-2 mb-4 md:mb-14 md:shadow-card_shadow order_detail_card">
                      <div className="flex flex-col md:flex-row md:justify-between">
                        <div className="flex flex-col">
                          <div className="flex">
                            <Text className="bg-[#E9E9E9] md:bg-white py-2 px-3 w-full md:w-2/5 md:bg-none font-semibold text-sm md:text-lg text-primaryB flex gap-4 items-center">Order Details</Text>
                            <Text className="hidden md:flex mt-2">{statusComponentForPayment(paid)}</Text>
                          </div>
                          <Text className="text-[#6A6A6A] md:text-black px-3 my-2 text-xs md:text-sm md:font-semibold">Please enter the fulfillment date to close the order</Text>
                        </div>
                        <Button
                          id="cancel-order-button"
                          type="primary"
                          className="min-w-max w-max h-9 px-[2%] ml-2 bg-primary !hover:bg-primaryHover"
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
                        <OrderData title="Order Number" value={`#${details.order.orderId}`} />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData
                          title="Buyer"
                          value={details.order.purchasersCommonName}
                        />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData
                          title="Seller"
                          value={details.order.sellersCommonName}
                        />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData title="Total($)" value={details.order.totalPrice} />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <OrderData
                          title="Date"
                          value={getStringDate(details.order.createdDate, US_DATE_FORMAT)}
                        />
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <Col>
                          <Text className="block text-primaryC text-[13px] mb-2">
                            Status
                          </Text>
                          {statusComponent(status)}
                        </Col>
                      </Row>
                      <Row className="my-2 md:hidden flex-col gap-[6px] justify-between p-4 pb-0 rounded">
                        <div className="flex gap-4">
                          <NewOrderData className="w-2/4" title="Order Number" value={'#' + details.order.orderId} />
                          <NewOrderData className="w-2/4" title="Buyer" value={details.order.purchasersCommonName} />
                        </div>
                        <div className="flex gap-4">
                          <NewOrderData className="w-2/4" title="Seller" value={details.order.sellersCommonName} />
                          <NewOrderData className="w-2/4" title="Total($)" value={'$' + details.order.totalPrice} />
                        </div>
                        <div className="flex justify-between">
                          <NewOrderData className="w-2/4" title="Status" value={statusComponent(status)} />
                          <NewOrderData className="w-2/4" title="Payment Status" value={statusComponentForPayment(paid)} />
                        </div>
                      </Row>
                      <Row className="flex-nowrap items-center justify-between mb-2 md:mb-6 p-2">
                        <div className="w-full">
                          <Text className="block text-primaryC text-[13px] mb-2">
                            Comments
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
                key: "transfers",
                children: <TransfersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />
              },
              {
                label: <p id="redemptions-outgoing-tab" className="font-semibold text-sm md:text-base">Redemptions (Outgoing)</p>,
                key: "redemptions-outgoing",
                children: <RedemptionsOutgoingTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />
              },
              {
                label: <p id="redemptions-incoming-tab" className="font-semibold text-sm md:text-base">Redemptions (Incoming)</p>,
                key: "redemptions-incoming",
                children: <RedemptionsIncomingTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />
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
