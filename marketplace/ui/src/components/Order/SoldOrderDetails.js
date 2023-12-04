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
  Image,
} from "antd";
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import routes from "../../helpers/routes";
import classNames from "classnames";
import { EyeOutlined } from "@ant-design/icons";
import { getStringDate } from "../../helpers/utils";
import { useNavigate } from "react-router-dom";
import UploadSerialNumberModal from "./UploadSerialNumber";
import DataTableComponent from "../DataTableComponent";
import { getStatus, getStatusByValue } from "./constant";
import dayjs from "dayjs";
import ConfirmStatusModal from "./ConfirmStatusModal";
import { US_DATE_FORMAT } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";
import RestStatus from "http-status-codes";
import TagManager from "react-gtm-module";
import image_placeholder from "../../images/resources/image_placeholder.png";

const SoldOrderDetails = ({ user, users }) => {
  const [Id, setId] = useState(undefined);
  const [data, setdata] = useState([]);
  const dispatch = useOrderDispatch();
  const { Text } = Typography;
  const [selectedDate, setSelectedDate] = useState("");
  const [status, setStatus] = useState(getStatus(1));
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [paid, setPaid] = useState(false);
  const [isLoadingPaymentStatus, setisLoadingPaymentStatus] = useState(false)
  const [comment, setcomment] = useState("");
  const { TextArea } = Input;
  const [api, contextHolder] = notification.useNotification();
  const [isUploadSerialNumberModalOpen, setisUploadSerialNumberModalOpen] =
    useState(false);
  const [isConfirmStatusModalOpen, toggleConfirmStatusModal] = useState(false);
  const [selectedProd, setselectedProd] = useState(null);

  const openToast = (placement, isError, msg) => {
    if (isError) {
      api.error({
        message: msg,
        placement,
        key: 1,
      });
    } else {
      api.success({
        message: msg,
        placement,
        key: 1,
      });
    }
  };

  const {
    orderDetails,
    isorderDetailsLoading,
    ordersAudit,
    message,
    issellerDetailsUpdating,
    success,
    isCreateOrderLineItem,
  } = useOrderState();
  const routeMatch = useMatch({
    path: routes.SoldOrderDetails.url,
    strict: true,
  });

  useEffect(() => {
    if (orderDetails) {
      setStatus(getStatus(parseInt(orderDetails.order.status)));
      setcomment(orderDetails.order.comments);
      // Fulfillment date is sometimes coming in as 0. a unix of 0 sets the date to 1969. So we need to check for 0 and null, I added undefined just in case too. 
      if (orderDetails.order.fulfillmentDate === 0 || orderDetails.order.fulfillmentDate === null || orderDetails.order.fulfillmentDate === undefined) {
        setSelectedDate(null);
      } else {
        setSelectedDate(dayjs.unix(orderDetails.order.fulfillmentDate));
      }

      let items = [];
      orderDetails.assets.forEach((prod) => {
        items.push({
          address: prod.address,
          chainId: prod.chainId,
          key: prod.address,
          productImage: prod.images && prod.images.length > 0 ? prod.images[0] : image_placeholder,
          productName: prod,
          unitPrice: prod.price,
          quantity: prod.quantity,
          shippingCharges: prod.shippingCharges ? prod.shippingCharges : 0,
          amount: prod.amount,
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

  const onDateChange = (date) => {
    console.log("date", date)
    setSelectedDate(date);
  };

  // This is checking if we need to upload serial numbers. 
  // Used to disable the sae button if the serial numbers aren't uploaded.
  const allSerialNumbersUploaded = () => {
    let serialsUploaded = true;
    if (orderDetails === null) {
      return serialsUploaded;
    }
    // for (const orderLine of orderDetails.orderLines) {
    //   if (orderLine.containsSerialNumber === true) {
    //     if (orderLine.isSerialUploaded === false) {
    //       serialsUploaded = false;
    //     }
    //   }
    // }
    return serialsUploaded;
  };

  const handleUpdateComment = async () => {
    let body = {};
    let isDone=false;

    body = {
      saleOrderAddress: details.order.address,
      fulfillmentDate: dayjs(selectedDate).unix(),
      comments: comment,
    };

    isDone = await actions.executeSale(dispatch, body);
    if (isDone) {
      setStatus(getStatus(3));
      await actions.fetchOrderDetails(dispatch, Id);
    }
  };

  const handleChange = async () => {
    handleCancel();
    let body = {};
    if (selectedStatus === getStatus(4)) {
      if (comment === "") {
        openToast("bottom", true, "Comment is mandatory to cancel order");
        return;
      }
      body = {
        address: Id,

        updates: {
          status: parseInt(getStatusByValue(selectedStatus)),
          sellerComments: comment,
          // fulfillmentDate: dayjs(selectedDate).unix(),
        },
      };
    } else {
      body = {
        address: Id,

        updates: {
          status: parseInt(getStatusByValue(selectedStatus)),
        },
      };
    }

    const isDone = await actions.updateSellerDetails(dispatch, body);
    if (isDone) {
      setStatus(selectedStatus);
      await actions.fetchOrderDetails(dispatch, Id);
    }
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

  const navigate = useNavigate();

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
      // width: "192px",

      // This is checking the serial number. If a serial number was uploaded at inventory creation we need to provide one here
      // If the serial number is necessary provide the upload button / view button
      // If it is not necessary provide N/A. 

      render: (text) => {
        if (text.isSerialUploaded === true) {
          return (
            <div className="flex items-center justify-center">
              <EyeOutlined className="mr-2 hover:text-primaryHover cursor-pointer" />
              <p
                onClick={() => {
                  navigate(
                    `${routes.SoldOrderItemDetail.url.replace(":id", text.address)}`,
                    { state: { orderId: orderDetails.orderId, address: Id } }
                  );
                }}
                className="hover:text-primaryHover cursor-pointer"
              >
                View
              </p>
            </div>
          );
        } else {
          return (
            <Button
              id="upload-button"
              className="text-primary text-[17px]"
              type="link"
              disabled={orderDetails.status === 4}
              onClick={() => {
                setselectedProd(text);
                setisUploadSerialNumberModalOpen(true);
              }}
            >
              Upload
            </Button>
          );
        }
      }
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

  const handleCancel = () => {
    toggleConfirmStatusModal(false);
  };

  return (
    <div>
      {contextHolder}
      {details === null || isorderDetailsLoading || issellerDetailsUpdating || isLoadingPaymentStatus ? (
        <div className="h-screen flex justify-center items-center">
          <Spin
            spinning={isorderDetailsLoading || issellerDetailsUpdating || isLoadingPaymentStatus}
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
              <div onClick={() => { navigate(routes.Orders.url, { state: { defaultKey: "Sold" } }); }}>
                Orders (Sold)
              </div>
            </Breadcrumb.Item>
            <Breadcrumb.Item className="text-primary">
              {details.order.orderId}
            </Breadcrumb.Item>
          </Breadcrumb>

          <Card className="mx-14 mb-14">
            <div className="flex justify-between">
              <div className="flex flex-col">
                <div className="flex">
                  <Text className="font-semibold text-primaryB">Order Details</Text>
                  {
                    !paid ? <div /> : <div className={classNames("text-success  bg-[#EAFFEE]", "ml-4 w-20 text-center text-xs p-1 rounded")}>
                      <p>Paid</p>
                    </div>
                  }
                </div>
                <Text className="text-primaryB">Please upload serial number(s) (if any) and/or enter the fulfillment date to close the order</Text>
              </div>
              <Button
                id="save-button"
                type="primary"
                // Disable the button here if the serial numbers aren't uploaded. We don't want the user closing the order without providing the serial numbers.
                loading={issellerDetailsUpdating || isCreateOrderLineItem}
                disabled={status === getStatus(3) || allSerialNumbersUploaded() === false }
                onClick={() => {
                  handleUpdateComment()
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
                className="w-48 h-9 ml-6 mt-3 bg-primary !hover:bg-primaryHover"
              >
                Save
              </Button>
            </div>
            <Row className="my-6 justify-between">
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

              {
                status !== getStatus(1) || details.paymentSessionId !== "" ? <Col>
                  <Text className="block text-primaryC text-[13px] mb-2">
                    STATUS
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
                        onChange={(value) => {
                          if (value === getStatus(2)) {
                            return;
                          }
                          setSelectedStatus(value);
                          toggleConfirmStatusModal(true);
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
              <div className="text-xs">
                <Text className="block text-primaryC text-[13px] mb-2">
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

            <Row className="flex-nowrap items-center justify-between mb-6">
              <div className="w-full">
                <Text className="block text-primaryC text-[13px] mb-2">
                  COMMENTS
                </Text>
                <TextArea
                  rows={2}
                  placeholder="Enter Comments"
                  value={decodeURIComponent(comment)}
                  disabled={
                    details.order.status === "3" || details.order.status === "4"
                  }
                  onChange={(event) => {
                    setcomment(encodeURIComponent(event.target.value));
                  }}
                />
              </div>
            </Row>

            <DataTableComponent
              columns={column}
              data={data}
              scrollX="100%"
              isLoading={false}
            />
          </Card>
        </div>
      )}
      {isUploadSerialNumberModalOpen && (
        <UploadSerialNumberModal
          isUploadSerialNumberModalOpen={isUploadSerialNumberModalOpen}
          toggleUploadSerialNumberModal={setisUploadSerialNumberModalOpen}
          product={selectedProd}
          orderId={details.orderId}
          orderAddress={details.address}
          dispatch={dispatch}
          actions={actions}
          isLoading={isCreateOrderLineItem}
          Id={Id}
        />
      )}
      {isConfirmStatusModalOpen && (
        <ConfirmStatusModal
          isConfirmStatusModalOpen={isConfirmStatusModalOpen}
          handleCancel={handleCancel}
          handleYes={handleChange}
        />
      )}
      {message && openToastOrder("bottom")}
    </div>
  );
};

export default SoldOrderDetails;
