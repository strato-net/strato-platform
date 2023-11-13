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
} from "antd";
import { useMatch } from "react-router-dom";
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

const BoughtOrderDetails = ({ user, users }) => {
  const [comment, setcomment] = useState("");
  const [Id, setId] = useState(undefined);
  const [data, setdata] = useState([]);
  const dispatch = useOrderDispatch();
  const { Text } = Typography;
  const [api, contextHolder] = notification.useNotification();
  const [status, setStatus] = useState(getStatus(0));
  const { TextArea } = Input;
  const [achStatus,setAchStatus] = useState(false);
  const [paid, setPaid] = useState(false)
  const [isLoadingPaymentStatus, setisLoadingPaymentStatus] = useState(false);

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
      getPaymentStatus(data.paymentSessionId);
    }
  }

  const validatePayment = async(paymentSessionId) => {
    //if payment session exists and status = Payment Pending
    // OR if payment session exists and comment is not set and status = Cancelled
    if((paymentSessionId !== "" && getStatus(parseInt(orderDetails.status)) === getStatus(5)) || (comment==="" && paymentSessionId!=="" && (getStatus(parseInt(orderDetails.status)) === getStatus(4)))) {
      try{
        const intentResponse = await fetch(
          `${apiUrl}/order/payment/intent/sessions/${paymentSessionId}`,
          {
            method: HTTP_METHODS.GET,
          }
        );

        
        const intentBody = await intentResponse.json();
        //Set the Comment with Status Message 
        if(intentBody.data.last_payment_error.message) setcomment('Stripe:'+intentBody.data.last_payment_error.message);

        //If any payment failure exists, and STATUS != Cancelled 
        if(intentBody.data.status==='requires_payment_method' && getStatus(parseInt(orderDetails.status)) !== getStatus(4))
          { 
          setcomment('Stripe:'+intentBody.data.last_payment_error.message);

          const body = {
            address: Id,
            updates: {
              buyerComments: encodeURIComponent('Stripe:' + intentBody.data.last_payment_error.message),
              status: 4,
            },
          };
          //Update Buyer Details and change the Order Status to 'Cancelled' from 'Payment Pending'
          let isDone = await actions.updateBuyerDetails(dispatch, body);
          if (isDone) {
            setStatus(getStatus(4));
            await actions.fetchOrderDetails(dispatch, Id);
            }
        }

      }catch(err){console.log(`Error:`+err)}
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
          if (body.data["payment_method_options"].hasOwnProperty("us_bank_account")) {
            setAchStatus(true);
            await validatePayment(paymentSessionId);
          }

        }

      } catch (err) {
      }
    }

  }



  useEffect(() => {
    if (orderDetails) {
      setStatus(getStatus(parseInt(orderDetails.status)));
      setcomment(orderDetails.buyerComments);

      let items = [];
      orderDetails.orderLines.forEach((prod) => {
        items.push({
          address: prod.address,
          chainId: prod.chainId,
          key: prod.address,
          productImage: prod.imageUrl,
          productName: prod.productName,
          manufacturer: prod.manufacturer,
          unitPrice: prod.pricePerUnit,
          quantity: prod.quantity,
          shippingCharges: prod.shippingCharges,
          amount: prod.amount,
          serialNumber: prod,
          tax: prod.tax,
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
        <Text className="block text-primaryC text-[13px] mb-2">{title}</Text>
        <Text className="block text-primaryC text-[17px]">{value}</Text>
      </Col>
    );
  };

  const statusComponent = (status) => {
    let textClass = "text-orange bg-[#FFF6EC]";
    if (status === getStatus(2)) {
      textClass = "text-blue  bg-[#EBF7FF]";
    } else if (status === getStatus(3)) {
      textClass = "text-success  bg-[#EAFFEE]";
    } else if (status === getStatus(4)) {
      textClass = "text-error  bg-[#FFF0F0]";
    }

    return (
      <div className={classNames(textClass, "text-center text-xs p-1 rounded")}>
        <p>{status}</p>
      </div>
    );
  };

  let column = [
    {
      title: "",
      dataIndex: "productImage",
      key: "productImage",
      render: (text) => <Image width={75} height={60} src={text} />,
    },
    {
      title: <Text className="text-primaryC text-[13px]">PRODUCT NAME</Text>,
      dataIndex: "productName",
      key: "productName",
      render: (text) => (
        <p
          // href={routes.BoughtOrderDetails.url}
          className="text-primary text-[17px]"
        >
          {decodeURIComponent(text)}
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
      title: <Text className="text-primaryC text-[13px]">MANUFACTURER</Text>,
      dataIndex: "manufacturer",
      key: "manufacturer",
      align: "center",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
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
      address: Id,
      updates: {
        buyerComments: encodeURIComponent(comment),
        status: 4,
      },
    };
    let isDone = await actions.updateBuyerDetails(dispatch, body);
    if (isDone) {
      setStatus(getStatus(4));
      await actions.fetchOrderDetails(dispatch, Id);
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
          <Breadcrumb className="text-xs ml-14 mt-14 mb-8">
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
              {details.orderId}
            </Breadcrumb.Item>
          </Breadcrumb>

          <Card className="mx-12 mb-14">
          <div className="flex">
              <Text className="font-semibold text-primaryB">Order Details</Text>
              {
              status === getStatus(4) ? (
                <div className="flex">
                  <div className={classNames("text-error bg-[#FFF0F0]", "ml-4 w-30 text-center text-xs p-1 rounded")}>
                    <p>Payment Failed</p>
                  </div>
                  <div className={classNames("text-primaryB bg-[#EAFFEE]", "ml-2 w-20 text-center text-xs p-1 rounded")}>
                    <p><b>ACH</b></p>
                  </div>
                </div>
              ) : (
                !paid ? (
                  achStatus && (
                    <div className="flex">
                      <div className={classNames("text-warning bg-[#FFC300]", "ml-4 w-20 text-center text-xs p-1 rounded")}>
                        <p>Processing</p>
                      </div>
                      <div className={classNames("text-primaryB bg-[#EAFFEE]", "ml-2 w-20 text-center text-xs p-1 rounded")}>
                        <p><b>ACH</b></p>
                      </div>
                    </div>
                  )
                ) : (achStatus ? (
                  <div className="flex">
                    <div className={classNames("text-success bg-[#EAFFEE]", "ml-4 w-20 text-center text-xs p-1 rounded")}>
                      <p>Paid</p>
                    </div>
                    <div className={classNames("text-primaryB bg-[#EAFFEE]", "ml-2 w-20 text-center text-xs p-1 rounded")}>
                      <p><b>ACH</b></p>
                    </div>
                  </div>
                ) : (
                  <div className={classNames("text-success bg-[#EAFFEE]", "ml-4 w-20 text-center text-xs p-1 rounded")}>
                    <p>Paid</p>
                  </div>
                ))
              )
            }

            </div>
            <Row className="my-6 justify-between">
              <OrderData title="NUMBER" value={`#${details.orderId}`} />
              <Divider type="vertical" className="h-14 bg-secondryD" />
              <OrderData
                title="BUYER"
                value={details.buyerOrganization}
              />
              <Divider type="vertical" className="h-14 bg-secondryD" />
              <OrderData
                title="SELLER"
                value={details.sellerOrganization}
              />
              <Divider type="vertical" className="h-14 bg-secondryD" />
              <OrderData title="TOTAL ($)" value={details.orderTotal} />
              <Divider type="vertical" className="h-14 bg-secondryD" />
              <OrderData
                title="DATE"
                value={getStringDate(details.orderDate, US_DATE_FORMAT)}
              />
              <Divider type="vertical" className="h-14 bg-secondryD" />
              <Col>
                <Text className="block text-primaryC text-[13px] mb-2">
                  STATUS
                </Text>
                {statusComponent(status)}
              </Col>
            </Row>

            <Row className="flex-nowrap items-center justify-between mb-6">
              <div className="w-full">
                <Text className="block text-primaryC text-[13px] mb-2">
                  COMMENTS
                </Text>
                <TextArea
                  rows={2}
                  placeholder="Enter Comments"
                  value={decodeURIComponent(comment)}
                  disabled={status !== getStatus(1)}
                  onChange={(event) => {
                    setcomment(event.target.value);
                  }}
                />
              </div>
              <Button
                id="cancel-order-button"
                type="primary"
                className="w-48 h-9 ml-6 mt-3 bg-primary !hover:bg-primaryHover"
                disabled={status !== getStatus(1) || comment === "" || details.paymentSessionId !== ""}
                onClick={() => {
                  handleCancelOrder()
                  TagManager.dataLayer({
                    dataLayer: {
                      event: 'orderDetails_bought_cancel_click',
                    },
                  });
                }}
              >
                Cancel Order
              </Button>
            </Row>

            <DataTableComponent
              columns={column}
              data={data}
              isLoading={false}
              scrollX="100%"
            />
          </Card>
        </div>
      )}

      {message && openToastOrder("bottom")}
    </div>
  );
};

export default BoughtOrderDetails;
