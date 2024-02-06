import {
  Breadcrumb,
  Typography,
  Row,
  notification,
  Spin,
  Button,
} from "antd";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { useOrderState, useOrderDispatch } from "../../contexts/order";
import { useAuthenticateState } from "../../contexts/authentication";
import { actions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
import {
  Form,
  Input,
} from "antd";
import { useState, useEffect, useMemo } from "react";
import { actions as inventoryAction } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import DataTableComponent from "../DataTableComponent";
import { useFormik } from "formik";
import * as yup from "yup";
import "./index.css";
import { PAYMENT_LIST } from "../../helpers/constants";
import ConfirmOrderModel from "./ConfirmOrderModel";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import AddressComponent from "./AddressComponent";
import { MinusCircleOutlined } from "@ant-design/icons";
import TagManager from "react-gtm-module";
import ResponsiveCart from "./ResponsiveCart";
import { Images } from "../../images";
import AddAddressModal from "./AddAddressModal";
import ResponsiveAddAddress from "./ResponsiveAddAddress";
const ShippingDetailsSchema = () => {
  return yup.object().shape({
    name: yup.string().required("Name is required"),
    zipcode: yup.string().max(15).required("Zipcode is required")
      .required("Zipcode is required"),
    addressLine1: yup.string().required("Address Line 1 is required"),
    addressLine2: yup.string().notRequired(),
    city: yup.string().required("City is required"),
    state: yup.string().required("State is required"),
    sameAddress: yup.boolean(),
    name_b: yup.string().when("sameAddress", {
      is: false,
      then: yup.string().required("Name is required"),
    }),
    zipcode_b: yup.number().when("sameAddress", {
      is: false,
      then: yup.string().max(15).required("Zipcode is required"),
    }),
    addressLine1_b: yup.string().when("sameAddress", {
      is: false,
      then: yup.string().required("Address Line 1 is required"),
    }),
    addressLine2_b: yup.string().notRequired(),
    city_b: yup.string().when("sameAddress", {
      is: false,
      then: yup.string().required("City is required"),
    }),
    state_b: yup.string().when("sameAddress", {
      is: false,
      then: yup.string().required("State is required"),
    }),
  });
};

const ConfirmOrder = () => {
  const { Text } = Typography;
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [selectedAddress, setSelectedAddress] = useState(0);
  const { confirmOrderList, isAddingShippingAddress, userAddresses, isLoadingUserAddresses } = useMarketplaceState();
  const { user } = useAuthenticateState();
  const userOrganization = user?.organization
  const { isCreateOrderSubmitting, message, success, isCreatePaymentSubmitting } = useOrderState();
  const [data, setData] = useState([]);
  const [tax, setTax] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [total, setTotal] = useState(0);
  const inventoryDispatch = useInventoryDispatch();
  const { isLoadingStripeStatus, stripeStatus } = useInventoryState();
  const { success: marketplaceSuccess, message: marketplaceMessage } = useMarketplaceState();
  const [modalAddress, setmodalAddress] = useState(false);
  const [responsiveAddress, setResponsiveAddress] = useState(false);
  const [showAddress, setshowAddress] = useState(false);


  const CloseAddressModel = () => {
    setmodalAddress(false);
    setshowAddress(false);
  }

  const closeResponsiveAddress = () => {
    setResponsiveAddress(false)
  }
  useEffect(() => {
    actions.fetchUserAddresses(marketplaceDispatch);
  }, [marketplaceDispatch])

  const storedData = useMemo(() => {
    return JSON.parse(window.localStorage.getItem("confirmOrderList") ?? []);
  }, []);

  useEffect(() => {
    actions.fetchConfirmOrderItems(marketplaceDispatch, storedData);
    let cartData = [];
    confirmOrderList.forEach((item) => {
      cartData.push(item);
    });

    setData(cartData);
    let t = 0;
    confirmOrderList.forEach((item) => {
      t += item.tax;
    });
    setTax(t);
    let s = 0;
    confirmOrderList.forEach((item) => {
      s += item.shippingCharges;
    });
    setShipping(s);
    let sum = 0;
    confirmOrderList.forEach((item) => {
      sum += item.amount;
    });
    setTotal(sum);
  }, [marketplaceDispatch, confirmOrderList, storedData]);

  const openToastOrder = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: orderActions.resetMessage(orderDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: orderActions.resetMessage(orderDispatch),
        placement,
        key: 2,
      });
    }
  };

  const openToastMarketplace = (placement) => {
    if (marketplaceSuccess) {
      api.success({
        message: marketplaceMessage,
        onClose: actions.resetMessage(marketplaceDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: marketplaceMessage,
        onClose: actions.resetMessage(marketplaceDispatch),
        placement,
        key: 2,
      });
    }
  };


  const formik = useFormik({
    initialValues: {
      sameAddress: true,
      state: "",
      name: "",
      zipcode: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state_b: "",
      name_b: "",
      zipcode_b: "",
      addressLine1_b: "",
      addressLine2_b: "",
      city_b: "",
    },
    validationSchema: ShippingDetailsSchema,
    onSubmit: function (values) {
      handleFormSubmit(values)
    },
  });

  const handleFormSubmit = async (values) => {
    setshowAddress(false);
    let billingAddr;
    if (values.sameAddress) {
      billingAddr = {
        billingName: encodeURIComponent(values.name),
        billingZipcode: values.zipcode,
        billingState: encodeURIComponent(values.state),
        billingCity: encodeURIComponent(values.city),
        billingAddressLine1: encodeURIComponent(values.addressLine1),
        billingAddressLine2: encodeURIComponent(values.addressLine2)
      }
    } else {
      billingAddr = {
        billingName: encodeURIComponent(values.name_b),
        billingZipcode: values.zipcode_b,
        billingState: encodeURIComponent(values.state_b),
        billingCity: encodeURIComponent(values.city_b),
        billingAddressLine1: encodeURIComponent(values.addressLine1_b),
        billingAddressLine2: encodeURIComponent(values.addressLine2_b)
      }
    }

    const body = {
      //shipping address
      shippingName: encodeURIComponent(values.name),
      shippingZipcode: values.zipcode,
      shippingState: encodeURIComponent(values.state),
      shippingCity: encodeURIComponent(values.city),
      shippingAddressLine1: encodeURIComponent(values.addressLine1),
      shippingAddressLine2: encodeURIComponent(values.addressLine2),

      //billing address
      ...billingAddr
    };

    window.LOQ.push(['ready', async LO => {
      // Track an event
      await LO.$internal.ready('events')
      LO.events.track('Add Shipping Address')
    }])
    TagManager.dataLayer({
      dataLayer: {
        event: 'add_shipping_address',
      },
    });
    let res = await actions.addShippingAddress(marketplaceDispatch, body);
    if (res != null) {
      await actions.fetchUserAddresses(marketplaceDispatch);
    }
  };



  const columns = [

    {
      title: <Text className="text-[#202020] text-base font-semibold px-6">Item</Text>,
      dataIndex: "item",

      render: (text) => {
        return (
          <div className="flex gap-3 items-center">
            <img className="w-14 h-14 object-contain rounded-[4px]" alt="" src={text.image} />
            <p className="text-primary text-sm font-semibold">{decodeURIComponent(text.name)}</p>
          </div>

        );
      },
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">Seller</Text>
      ),
      dataIndex: "sellersCommonName",
      align: "center",
      render: (text) => (
        <p className="text-center font-semibold">{text}</p>
      ),
      // width: "12%"
    },
    {
      title: <Text className="text-[#202020] text-base font-semibold">Unit Price($)</Text>,
      dataIndex: "unitPrice",
      align: "center",
      render: (text) => <p className=" text-sm text-[#202020]  font-sans font-semibold">{text}</p>,
    },
    {
      title: <Text className="text-[#202020] text-base font-semibold">Quantity</Text>,
      dataIndex: "qty",
      align: "center",
      render: (text) => <p className="text-sm text-[#202020]  font-sans font-semibold">{text}</p>,
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">Shipping Charges</Text>
      ),
      dataIndex: "shippingCharges",
      align: "center",
      render: (text) => <p className="text-sm  text-[#202020] font-semibold ">{text}</p>,
    },
    {
      title: <Text className="text-[#202020] text-base font-semibold">Tax($)</Text>,
      dataIndex: "tax",
      align: "center",
      render: (text) => <p className="text-sm  text-[#202020] font-semibold">{text}</p>,
    },
    {
      title: <Text className="text-[#202020] text-base font-semibold">Amount($)</Text>,
      dataIndex: "amount",
      align: "center",
      render: (text) => <p className="text-sm font-semibold text-[#202020]">{text}</p>
      ,

    },
  ];

  const handlePaymentConfirm = async () => {
    if (userAddresses.length === 0) {
      api.error({
        message: "Please enter an address",
        placement: "bottom",
      });
    } else {
      let orderList = [];
      confirmOrderList.forEach((item) => {
        orderList.push({
          quantity: item.qty,
          assetAddress: item.key,
        });
      });
      // These additional fields need to be sent to form the request after stripe. 
      let body = {
        paymentList: PAYMENT_LIST,
      buyerOrganization: userOrganization,
        orderList,
        orderTotal: total + tax + shipping,
        shippingAddressId: userAddresses[selectedAddress].address_id,
        tax: tax,
        user: user.commonName,
        email: user.email,
      };

      window.LOQ.push(['ready', async LO => {
        // Track an event
        await LO.$internal.ready('events')
        LO.events.track('Buy Now Button')
      }])
      TagManager.dataLayer({
        dataLayer: {
          event: 'pay_now_button',
        },
      });

      let data = await orderActions.createPayment(orderDispatch, body);
      if (data != null && data.url !== undefined) {
        window.location.replace(data.url);
      }
    }
  };

  useEffect(() => {
    if (data.length !== 0) {
      inventoryAction.sellerStripeStatus(inventoryDispatch, data[0]["sellersCommonName"]);
    }
  }, [inventoryDispatch, data]);

  return (
    <>
      {responsiveAddress ? <ResponsiveAddAddress back={closeResponsiveAddress} /> :
        <div className="h-screen md:mx-10 md:mt-5  mx-5 lg:mx-14   ">
          {contextHolder}
          {isCreateOrderSubmitting || isCreatePaymentSubmitting ? (
            <div className="h-screen flex justify-center items-center">
              <Spin spinning={isCreateOrderSubmitting || isCreatePaymentSubmitting} size="large" />
            </div>
          ) : (
            <div className="pb-[30px]">
              <Breadcrumb>
                <Breadcrumb.Item href="javascript:;">
                  <ClickableCell href={routes.Marketplace.url}>
                    <p className="text-sm text-[#13188A] font-semibold">
                      Home
                    </p>
                  </ClickableCell>
                </Breadcrumb.Item>
                <Breadcrumb.Item
                  href="javascript:;"
                >
                  <ClickableCell href={routes.Checkout.url}>
                    <p className="text-sm text-[#13188A] font-semibold">

                      Checkout
                    </p>
                  </ClickableCell>
                </Breadcrumb.Item>
                <Breadcrumb.Item>
                  <p className="text-sm text-[#202020] font-medium">
                    Confirm Order
                  </p>
                </Breadcrumb.Item>
              </Breadcrumb>
              <div className="flex justify-between items-center pt-6 md:pb-2">
                <Typography className="text-[#202020] text-base md:text-xl lg:text-2xl  font-bold lg:font-semibold">My Cart</Typography>
                {stripeStatus && <button id="pay-now-button" className={`p-1 md:p-3 h-max rounded-lg border ${stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled ? 'border-primary bg-primary hover:bg-primaryHover text-white' : 'cursor-not-allowed border-[#999999] rounded bg-[#cccccc] text-[#666666]'}`}
                  onClick={() => {
                    if (stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled) {
                      handlePaymentConfirm();
                    }
                  }}
                >
                  Review and Submit
                </button>}
              </div>
              <div className="pt-4 hidden lg:block border-top cart">
                <DataTableComponent
                  isLoading={false}
                  scrollX="100%"
                  columns={columns}
                  data={data}
                  pagination={false}
                />
              </div>
              <div className=" grid sm:place-items-center grid-cols-1 lg:hidden ">
                <ResponsiveCart data={data} key={data} confirm={true} />
              </div>

              <div className="bg-[#EEEFFA] rounded-b-md py-[15px] px-4  hidden lg:flex lg:justify-end ">
                <div className="w-[235px] flex flex-col gap-[10px]">
                  <Row className="justify-between ">
                    <p className="text-base text-[#6A6A6A]  ">Sub Total:</p>
                    <p className="text-xl text-[#202020]   text-right">${total}</p>
                  </Row>
                  <Row className="justify-between ">
                    <p className="text-base text-[#6A6A6A]  ">Tax:</p>
                    <p className="text-xl text-[#202020]   text-right">${tax}</p>
                  </Row>
                  <Row className="justify-between ">
                    <p className="text-base text-[#6A6A6A] ">Shipping Charges:</p>
                    <p className="text-xl text-[#202020]  text-right">${shipping}</p>
                  </Row>
                  <Row className="justify-between">
                    <p className="text-base text-[#6A6A6A] ">Total:</p>
                    <p className="text-xl text-[#202020]   text-right">
                      ${total + tax + shipping}
                    </p>
                  </Row>
                </div>
              </div>
              <Row align="middle pt-10 flex gap-3 items-center">
                <p className="text-base md:text-xl lg:text-2xl text-[#202020] font-semibold ">Address Details</p>
                {showAddress ?
                  <MinusCircleOutlined className="text-xl text-primary"
                    onClick={() => {
                      setshowAddress(false);
                    }}
                  />
                  :
                  <>
                    <div className=" hidden md:block"><Button type="link" icon={<img src={Images.AddBlack} className=" w-4 h-4 lg:w-6 lg:h-6 " alt="add" />}
                      onClick={() => {
                        setshowAddress(true);
                        setmodalAddress(true);
                      }}
                    /></div>
                    <div className="  md:hidden"><Button type="link" icon={<img src={Images.AddBlack} className=" w-4 h-4 lg:w-6 lg:h-6 " alt="add" />}
                      onClick={() => {
                        setResponsiveAddress(true);
                      }}
                    /></div>
                  </>
                }
              </Row>
              {modalAddress && <AddAddressModal open={modalAddress} close={CloseAddressModel} />}
              <div>
                <div className="mt-4">
                  {isAddingShippingAddress || isLoadingUserAddresses || isLoadingStripeStatus ?
                    <div className="h-80 flex justify-center items-center">
                      <Spin spinning={isAddingShippingAddress || isLoadingUserAddresses || isLoadingStripeStatus} size="large" />
                    </div>
                    :
                    userAddresses.length !== 0 ?
                      <div className="grid grid-rows-2 sm:grid-rows-1 grid-flow-col gap-4 lg:flex  lg:flex-wrap overflow-x-auto lg:overflow-y-auto hide-Scroll lg:gap-x-6 lg:gap-y-[20px] pt-4 h-[50%] lg:h-[44vh]">
                        {
                          userAddresses.map((add, index) =>
                            <div key={index}>
                              <div className={`w-[307px] h-[200px] overflow-x-auto hide-Scroll py-3 px-[14px] rounded-[4px] ${index !== selectedAddress ? " cursor-pointer border border-[#0000002E] " : " border border-primary cursor-pointer"}`} onClick={() => { setSelectedAddress(index) }}>
                                <AddressComponent userAddress={add} />
                              </div>
                            </div>
                          )
                        }
                      </div>
                      :
                      <div className="flex justify-center items-center h-48 ">
                        <p className="text-2xl font-semibold text-[#202020]">
                          Please Add Address
                        </p>
                      </div>
                  }
                </div>
              </div>
            </div>
          )}
          {marketplaceMessage && openToastMarketplace("Bottom")}
          {message && openToastOrder("bottom")}
        </div>}
    </>
  );
};


export default ConfirmOrder;