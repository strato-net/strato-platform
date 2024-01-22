import React, { useState, useEffect } from "react";
import {
  Card,
  Row,
  Col,
  Breadcrumb,
  Typography,
  Divider,
  DatePicker,
  Select,
  Input,
  Button,
  Spin,
  notification,
  Tabs,
} from "antd";
import { useLocation, useMatch } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import routes from "../../helpers/routes";
import classNames from "classnames";
import { getStringDate } from "../../helpers/utils";
import { useNavigate } from "react-router-dom";
import DataTableComponent from "../DataTableComponent";
import { getStatus, getStatusByName } from "./constant";
import dayjs from "dayjs";
import { US_DATE_FORMAT } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";
import RestStatus from "http-status-codes";
import TagManager from "react-gtm-module";
import image_placeholder from "../../images/resources/image_placeholder.png";
import BoughtOrdersTable from "./BoughtOrdersTable";
import TransfersTable from "./TransfersTable";
import { ResponsiveOrderDetailCard } from "./ResponsiveOrderDetailCard";
import { LeftArrow } from "../../images/SVGComponents";

const SoldOrderDetails = ({ user, users }) => {
  const [Id, setId] = useState(undefined);
  const [data, setdata] = useState([]);
  const dispatch = useOrderDispatch();
  const { Text } = Typography;
  const [selectedDate, setSelectedDate] = useState("");
  const [status, setStatus] = useState(getStatus(1));
  const [paid, setPaid] = useState("Processing");
  const [isLoadingPaymentStatus, setisLoadingPaymentStatus] = useState(false)
  const [comment, setComment] = useState("");
  const { TextArea } = Input;
  const [api, contextHolder] = notification.useNotification();
  const state = useLocation()

  const {
    orderDetails,
    isorderDetailsLoading,
    ordersAudit,
    message,
    success,
    isCreateOrderSubmitting,
    isUpdatingOrderComment
  } = useOrderState();
  const routeMatch = useMatch({
    path: routes.SoldOrderDetails.url,
    strict: true,
  });

  useEffect(() => {
    if (orderDetails) {
      setStatus(getStatus(parseInt(orderDetails.order.status)));
      setComment(orderDetails.order.comments);
      // Fulfillment date is sometimes coming in as 0. a unix of 0 sets the date to 1969. So we need to check for 0 and null, I added undefined just in case too. 
      if (orderDetails.order.fulfillmentDate === 0 || orderDetails.order.fulfillmentDate === null || orderDetails.order.fulfillmentDate === undefined) {
        setSelectedDate(null);
      } else {
        setSelectedDate(dayjs.unix(orderDetails.order.fulfillmentDate));
      }

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
          shippingCharges: prod.shippingCharges ? prod.shippingCharges : 0,
          amount: prod.price * parseInt(orderDetails.order.quantities[index]),
          serialNumber: prod,
          tax: prod.tax ? prod.tax : 0,
        });
      });
      setdata(items);
    }
  }, [orderDetails]);

  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      getData();
    }
  }, [Id, dispatch, status]);

  const getData = async () => {
    const data = await actions.fetchOrderDetails(dispatch, Id);
    if (data != null) {
      getPaymentStatus(data.order.paymentSessionId, data.order.sellersCommonName);
    }
  };

  const validatePayment = async (paymentSessionId) => {
    if (!paymentSessionId || !orderDetails) return;

    const currentStatus = getStatus(parseInt(orderDetails.order.status));
    const isPending = currentStatus === getStatusByName("Payment Pending")
    const isCanceled = currentStatus === getStatusByName("Canceled");

    if (isCanceled) {
      setPaid("Payment Failed");
      setComment(orderDetails.order.comments);
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
          setComment(`Stripe: ${orderDetails.order.comments}`);
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

  const NewOrderData = ({ title, value, className }) => {
    return (
      <div className={className}>
        <Text className="block text-[#6A6A6A] text-[12px] mb-1">{title}</Text>
        <Text className="block text-[#202020] text-[13px] font-semibold">{value}</Text>
      </div>
    );
  };

  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  const handleCloseOrder = async () => {
    let body = {};
    let isDone = false;

    body = {
      orderAddress: details.order.address,
      fulfillmentDate: dayjs(selectedDate).unix(),
      comments: comment,
    };

    isDone = await actions.executeSale(dispatch, body);
    if (isDone) {
      setStatus(getStatus(3));
    }
  };

  const handleUpdateComment = async () => {
    let body = {
      saleOrderAddress: orderDetails.order.address,
      comments: comment
    }

    await actions.updateOrderComment(dispatch, body)
  }

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
      <div className={classNames(textClass, "status_contain w-max text-center py-1 px-2 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1")}>
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
      <div className={classNames(textClass, "status_contain w-max h-max text-center py-1 px-2 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1")}>
        <div className={classNames(bgClass, "h-3 w-3 rounded-sm")}></div>
        <p className="!mb-0 text-[11px] md:text-sm">{status}</p>
      </div>
    );
  };


  const onChange = (key) => {
    navigate(routes.Orders.url.replace(':type', 'sold'))
  };

  const navigate = useNavigate();

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
          onClick={() => { navigate(`${routes.MarketplaceProductDetail.url.replace(":address", text.address)}`) }}
        >
          {decodeURIComponent(text.name)}
        </p>
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
      title: (
        <Text className="text-primaryC text-[13px]">Shipping Charges($)</Text>
      ),
      dataIndex: "shippingCharges",
      key: "shippingCharges",
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

  return (
    <div>
      {contextHolder}
      {details === null || isorderDetailsLoading || isLoadingPaymentStatus ? (
        <div className="h-screen flex justify-center items-center">
          <Spin
            spinning={isorderDetailsLoading || isLoadingPaymentStatus}
            size="large"
          />
        </div>
      ) : (
        <div>
          <Breadcrumb className="text-sm ml-4 md:ml-20  mt-0 md:mt-5 mb-2">
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-primary font-semibold">Home</p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <div onClick={() => { navigate(routes.Orders.url.replace(':type', 'sold')); }}>
                <p className="text-sm text-primary font-semibold">Orders (sold)</p>
              </div>
            </Breadcrumb.Item>
            <Breadcrumb.Item className="text-sm text-[#202020] font-medium">
              {details.order.orderId}
            </Breadcrumb.Item>
          </Breadcrumb>

          <Tabs
            className="mx-4 md:mx-20 mt-0 md:mt-5"
            defaultActiveKey={state == null ? "Sold" : state.defaultKey}
            onChange={onChange}
            items={[
              {
                label: <p id="sold-tab" className="font-semibold text-sm md:text-base">Orders (Sold)</p>,
                key: "Sold",
                children:
                  <div className="mb-10">
                    <Button type="ghost" onClick={() => onChange('Sold')} className="cursor-pointer px-2 flex md:hidden items-center gap-2 text-xs font-semibold"><LeftArrow /> Back</Button>
                    <Card className="md:p-2 mb-4 md:mb-14 md:shadow-card_shadow order_detail_card">
                      <div className="flex flex-col md:flex-row md:justify-between">
                        <div className="flex flex-col">
                          <div className="flex">
                            <Text className="bg-[#E9E9E9] md:bg-white py-2 px-3 md:w-2/5 w-full md:bg-none font-semibold text-sm md:text-lg text-primaryB flex gap-4 items-center">Order Details</Text>
                            <Text className="hidden md:flex mt-2">{statusComponentForPayment(paid)}</Text>
                          </div>
                          <Text className="text-[#6A6A6A] md:text-black px-3 my-2 text-xs md:text-sm md:font-semibold">Please enter the fulfillment date to close the order</Text>

                        </div>
                        <Button
                          id="save-button"
                          type="primary"
                          loading={isCreateOrderSubmitting || isUpdatingOrderComment}
                          disabled={status === getStatus(3) || status === getStatus(4) || (!comment && !selectedDate)}
                          onClick={() => {
                            if (!selectedDate && comment) {
                              handleUpdateComment();
                            }
                            else if (selectedDate) {
                              handleCloseOrder()
                            }
                            window.LOQ.push(['ready', async LO => {
                              await LO.$internal.ready('events')
                              LO.events.track('Order Details: Save Button')
                            }])
                            TagManager.dataLayer({
                              dataLayer: {
                                event: 'orderDetails_sold_save_click',
                              },
                            });
                          }}
                          className="min-w-max w-max h-9 px-[3%] ml-2 bg-primary !hover:bg-primaryHover"
                        >
                          Save
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

                        {
                          status !== getStatus(1) || details.paymentSessionId !== "" ? <Col>
                            <Text className="block text-primaryC text-[13px] mb-2">
                              Status
                            </Text>
                            {statusComponent(status)}
                          </Col> :
                            <div>
                              <Row className="items-center mb-2 gap-1">
                                <Select
                                  bordered={false}
                                  defaultValue=""
                                  value="STATUS"
                                  size="small"
                                  className="text-primaryC text-[13px]"
                                  style={{
                                    width: 120,
                                    color: "#4E4D4B",
                                  }}
                                  options={
                                    status === getStatus(1)
                                      ? [
                                        {
                                          text: getStatus(1),
                                          value: getStatus(1),
                                        },
                                        {
                                          text: getStatus(4),
                                          value: getStatus(4),
                                        },
                                      ]
                                      : status === getStatus(2)
                                        ? [
                                          {
                                            text: getStatus(2),
                                            value: getStatus(2),
                                          },
                                        ]
                                        : status === getStatus(4)
                                          ? [
                                            {
                                              text: getStatus(4),
                                              value: getStatus(4),
                                            },
                                          ]
                                          : [
                                            {
                                              text: getStatus(3),
                                              value: getStatus(3),
                                            },
                                          ]
                                  }
                                />
                              </Row>
                              {statusComponent(status)}
                            </div>
                        }
                        <Divider type="vertical" className="h-14 bg-secondryD" />
                        <div className="text-xs order_detail_date">
                          <Text className="block text-primaryC text-[13px]">
                            Order Close Date
                          </Text>
                          <DatePicker
                            value={
                              selectedDate
                            }
                            onChange={onDateChange}
                            disabled={status === getStatus(3) || status === getStatus(4)}
                          />
                        </div>
                      </Row>
                      <Row className="my-2 md:hidden flex-col gap-[6px] justify-between p-4 rounded">
                        <div className="flex gap-4">
                          <NewOrderData className="w-2/4" title="Order Number" value={'#' + details.order.orderId} />
                          <NewOrderData className="w-2/4" title="Buyer" value={details.order.purchasersCommonName} />
                        </div>
                        <div className="flex gap-4">
                          <NewOrderData className="w-2/4" title="Seller" value={details.order.sellersCommonName} />
                          <NewOrderData className="w-2/4" title="Total($)" value={'$' + details.order.totalPrice} />
                        </div>
                        <div className="flex justify-between mobile_order_detail_card">
                          <NewOrderData className="w-2/4" title="Date" value={getStringDate(details.order.createdDate, US_DATE_FORMAT)} />
                          <NewOrderData className="w-2/4" title="Order Close Date"
                            value={
                              <DatePicker
                                value={selectedDate}
                                onChange={onDateChange}
                                disabled={status === getStatus(3) || status === getStatus(4)}
                              />} />
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
                            disabled={
                              status === getStatus(3) || status === getStatus(4)
                            }
                            onChange={(event) => {
                              setComment(encodeURIComponent(event.target.value));
                            }}
                          />
                        </div>
                      </Row>
                      <div className="md:block hidden">
                        <DataTableComponent
                          columns={column}
                          data={data}
                          scrollX="100%"
                          isLoading={false}
                        />
                      </div>
                    </Card>
                    {data?.length > 0 && data?.map((item) => {
                      return (
                        <ResponsiveOrderDetailCard data={item} />)
                    })}
                  </div>
              },
              {
                label: <p id="bought-tab" className="font-semibold text-sm md:text-base">Orders (Bought)</p>,
                key: "Bought",
                children: <BoughtOrdersTable user={user} selectedDate={dayjs(selectedDate).startOf('day').unix()} />
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

export default SoldOrderDetails;
