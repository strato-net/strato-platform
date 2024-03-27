import {
  Breadcrumb,
  Typography,
  Row,
  notification,
  Spin,
  Button,
  Modal,
  List
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
  const { isLoadingStripeStatus, stripeStatus, isLoadingMetamaskStatus, metamaskStatus } = useInventoryState();
  const { success: marketplaceSuccess, message: marketplaceMessage } = useMarketplaceState();
  const [modalAddress, setmodalAddress] = useState(false);
  const [responsiveAddress, setResponsiveAddress] = useState(false);
  const [showAddress, setshowAddress] = useState(false);
  const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false);


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

  const openToastOrder = (placement, message) => {
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

  const handlePaymentConfirm = async (method) => {
    setIsPaymentModalVisible(false); // Close the payment modal
    if (userAddresses.length === 0) {
      api.error({
        message: "Please enter an address",
        placement: "bottom",
      });
      return;
    }
    
    const saleAddresses = data.map(item => item.saleAddress);
    const quantities = data.map(item => item.qty);
    const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, saleAddresses, quantities);
    
    if (checkQuantity !== true) {
      let insufficientQuantityMessage = "";
      let outOfStockMessage = "";

      checkQuantity.forEach(detail => {
        if (detail.availableQuantity === 0) {
          outOfStockMessage += `Product ${detail.assetName}\n`;
        } else {
          insufficientQuantityMessage += `Product ${detail.assetName}: ${detail.availableQuantity}\n`;
        }
      });

      let errorMessage = "";
      if (insufficientQuantityMessage) {
        errorMessage += `The following item(s) in your cart have limited quantity available and will need to be adjusted. Please reduce the quantity to proceed:\n${insufficientQuantityMessage}`;
      }
      if (outOfStockMessage) {
        if (errorMessage) errorMessage += "\n"; // Add a new line if there's already an error message
        errorMessage += `The following item(s) are temporarily out of stock and should be removed:\n${outOfStockMessage}`;
      }
      openToastOrder("bottom", errorMessage);
      return;
    }
    
    let orderList = [];
    confirmOrderList.forEach((item) => {
      orderList.push({
        quantity: item.qty,
        assetAddress: item.key,
        firstSale: item.firstSale,
        unitPrice: item.unitPrice
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
    if (method === "stripe") {
      let data = await orderActions.createOrder(orderDispatch, body);
      if (data != null && data.url !== undefined) {
        window.location.replace
          (data.url);
      } 
    } else if (method === "metamask") {
      if (!window.ethereum) {
        notification.error({
          message: "MetaMask is not installed",
          description: "Please install MetaMask to connect your wallet.",
          placement: "bottom",
        });
        return null;
      }
      try {
        // Request account access
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        if (accounts.length === 0) {
          notification.error({
            message: "MetaMask is locked",
            description: "Please unlock MetaMask to connect your wallet.",
            placement: "bottom",
          });
          return null;
        }
        
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x1" }],
        });
        
        const txParams = {
          from: accounts[0],
          to: process.env.REACT_APP_CONTRACT_ADDRESS,
          value: window.ethereum.utils.toHex(window.ethereum.utils.toWei("2", "ether")),
          chainId: "0x1",
        };
        
        const tx = await window.ethereum.request({
          method: "eth_sendTransaction",
          params: [txParams],
        });
        await tx.wait();
        console.log("Transaction tx:", tx);
        const transaction = await window.ethereum.request({
          method: 'eth_getTransactionByHash',
          params: [tx.Hash],
        });
        
        const transactionValueInEther = window.ethereum.utils.fromWei(transaction.value, "ether");
        
        if (transactionValueInEther === "2") {
          notification.success({
            message: "Transaction Successful",
            description: `Your payment of 2 ETH has been successfully processed. Transaction Hash: ${tx.Hash}`,
            placement: "bottom",
          });
        } else {
          console.error("Transaction value mismatch.");
          notification.error({
            message: "Transaction Error",
            description: "There was a mismatch in the transaction value.",
            placement: "bottom",
          });
        } 
        
        // Create order and redirect to order details page
        return;
      } catch (error) {
        // Log and notify on error
        console.error("Failed to connect to MetaMask:", error);
        notification.error({
          message: "MetaMask connection failed",
          description: error.message || "Please try again.",
          placement: "bottom",
        });
        return null;
      }
    }
  };

  useEffect(() => {
    if (data.length !== 0) {
      inventoryAction.sellerStripeStatus(inventoryDispatch, data[0]["sellersCommonName"]);
      inventoryAction.sellerMetamaskStatus(inventoryDispatch, data[0]["sellersCommonName"]);
    }
  }, [inventoryDispatch, data]);

  return (
    <>
      {responsiveAddress ? <ResponsiveAddAddress back={closeResponsiveAddress} /> :
        <>
          <div className="fixed-component shadow-header">
            <div className="fixed-component-child md:mx-10 mx-5 lg:mx-14">
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
                <button
                  id="pay-now-button"
                  className="p-1 md:p-3 h-max rounded-lg border border-primary bg-primary hover:bg-primaryHover text-white"
                  // Rest of the button props
                  onClick={() => setIsPaymentModalVisible(true)}
                >
                  Review and Submit
                </button>
              </div>
            </div>
          </div>
          <div className="h-screen md:mx-10 md:mt-5  mx-5 lg:mx-14   ">
            {contextHolder}
            {isCreateOrderSubmitting || isCreatePaymentSubmitting ? (
              <div className="h-screen flex justify-center items-center">
                <Spin spinning={isCreateOrderSubmitting || isCreatePaymentSubmitting} size="large" />
              </div>
            ) : (
              <div className="pb-[30px] confirm-order-body">
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
                  <ResponsiveCart data={data} key={data} confirm={true} openToastOrder={openToastOrder} />
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
                {isPaymentModalVisible && (
                  <Modal
                    title="Select Payment Method"
                    open={isPaymentModalVisible}
                    onCancel={() => setIsPaymentModalVisible(false)}
                    footer={null} // Remove default buttons
                  >
                    <List>
                      <List.Item>
                        <Button
                          disabled={!stripeStatus || !stripeStatus?.chargesEnabled || !stripeStatus?.detailsSubmitted || !stripeStatus?.payoutsEnabled}
                          onClick={() => handlePaymentConfirm('stripe')}
                        >
                          Pay with Stripe
                        </Button>
                      </List.Item>
                      <List.Item>
                        <Button
                          disabled={!metamaskStatus} // Adjust based on how metamaskStatus indicates availability
                          onClick={() => handlePaymentConfirm('metamask')}
                        >
                          Pay with MetaMask
                        </Button>
                      </List.Item>
                    </List>
                  </Modal>
                )}

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
            {message && openToastOrder("bottom", message)}
          </div>
        </>}
    </>
  );
};


export default ConfirmOrder;