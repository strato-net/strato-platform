import {
  Breadcrumb,
  Typography,
  Row,
  Divider,
  notification,
  Spin,
  Card,
} from "antd";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { useNavigate } from "react-router-dom";
import { useOrderState, useOrderDispatch } from "../../contexts/order";
import { useAuthenticateState } from "../../contexts/authentication";
import { actions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
import {
  Form,
  Input,
} from "antd";
import { useState, useEffect, useMemo} from "react";
import { actions as inventoryAction } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import DataTableComponent from "../DataTableComponent";
import { useFormik } from "formik";
import * as yup from "yup";
import "./index.css";
import { UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import ConfirmOrderModel from "./ConfirmOrderModel";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import AddressComponent from "./AddressComponent";
import { PlusCircleOutlined, MinusCircleOutlined } from "@ant-design/icons";
import TagManager from "react-gtm-module";

const { TextArea } = Input;

const ShippingDetailsSchema = () => {
  return yup.object().shape({
    name: yup.string().required("Name is required"),
    zipcode: yup.string().matches(/^\d+$/, "Must contain only numbers").length(5, "Must be exactly 5 digits")
      .required("Zipcode is required"),
    addressLine1: yup.string().required("Address Line 1 is required"),
    addressLine2: yup.string().notRequired(),
    city: yup.string().required("City is required"),
    state: yup.string().required("State is required"),
    sameAddress: yup.boolean(),
    name_b: yup.string().when("sameAddress", {
      is: false,
      then: yup.string().required("Billing Name is required"),
    }),
    zipcode_b: yup.number().when("sameAddress", {
      is: false,
      then: yup.number().required("Zipcode is required")
        .test('len', 'Must be exactly 5 digits', val => val && val.toString().length === 5),
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
  const [open, setOpen] = useState(false);
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [selectedAddress, setSelectedAddress] = useState(0);
  const { cartList, confirmOrderList, isAddingShippingAddress, userAddresses, isLoadingUserAddresses } = useMarketplaceState();
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


  const [showAddress, setshowAddress] = useState(false);

  const handleCancel = () => {
    setOpen(false);
  };
  
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
      t += parseFloat(item.tax);
    });
    setTax(t);
    let s = 0;
    confirmOrderList.forEach((item) => {
      s += parseFloat(item.shippingCharges);
    });
    setShipping(s);
    let sum = 0;
    confirmOrderList.forEach((item) => {
      sum += parseFloat(item.amount);
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
      title: <Text className="text-primaryC text-[13px]"></Text>,
      dataIndex: "item",
      render: (text) => {
        return (
          <img className="w-16 h-16 object-cover" alt="" src={text.image} />
        );
      },
    },
    {
      title: <Text className="text-primaryC text-[13px]">ITEM</Text>,
      dataIndex: "item",
      render: (text) => {
        return (
          <p className="text-primary text-[17px]">{text.name}</p>
        );
      },
      
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">SELLER ORGANIZATION</Text>
      ),
      dataIndex: "sellerOrganization",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
      width:"12%"
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">UNIT OF MEASUREMENT</Text>
      ),
      dataIndex: "unitOfMeasure",
      align: "center",
      render: (text) => <p className="text-center">{UNIT_OF_MEASUREMENTS[text]}</p>,
      width:"12%"
    },
    {
      title: <Text className="text-primaryC text-[13px]">UNIT PRICE($)</Text>,
      dataIndex: "unitPrice",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">QUANTITY</Text>,
      dataIndex: "qty",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">TAX($)</Text>,
      dataIndex: "tax",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">SHIPPING CHARGES($)</Text>
      ),
      dataIndex: "shippingCharges",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">AMOUNT($)</Text>,
      dataIndex: "amount",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
  ];

  const navigate = useNavigate();
  
  const handleOrderConfirm = async () => {
    let concatenatedOrderString = "";
    let firstSellerOrg;
    for (let i = 0; i < confirmOrderList.length; i++) {
      if (i === 0) {
        firstSellerOrg = confirmOrderList[i].sellerOrganization;
      }
      let orderItem = confirmOrderList[i];
      let itemName = orderItem.item.name;
      let itemPrice = orderItem.unitPrice;
      let itemQty = orderItem.qty;
      concatenatedOrderString += `\u2022 ${itemName}: ${itemPrice} x ${itemQty} <br>`;
      if (i === (confirmOrderList.length - 1)) {
        concatenatedOrderString += `<hr style="border-top: 1px dotted #0A1B71; min-width: 80%; max-width: 80%; margin-left: 15px;">`;
        concatenatedOrderString += `\u2022 Sales Tax: $${tax}.00 <br>`;
        concatenatedOrderString += `\u2022 Shipping Fee: <i><strong>Free</strong></i><br><br>`;
        concatenatedOrderString += `Order Total: $${total}.00 <br>`;
      }
    }

    let selectedShippingAddr = userAddresses[selectedAddress];
    let shippingName = selectedShippingAddr.shippingName.replace(/%20/g, ' ');
    let shippingAddrLine1 = selectedShippingAddr.shippingAddressLine1.replace(/%20/g, ' ');
    let shippingAddrLine2 = selectedShippingAddr.shippingAddressLine2.replace(/%20/g, ' ');
    let shippingCity = selectedShippingAddr.shippingCity.replace(/%20/g, ' ');
    let shippingState = selectedShippingAddr.shippingState.replace(/%20/g, ' ');
    let shippingZipcode = selectedShippingAddr.shippingZipcode.replace(/%20/g, ' ');
    let shippingAddr = `<strong>Ship to:</strong> <br> ${shippingName} <br> ${shippingAddrLine1} <br> ${shippingAddrLine2} <br> ${shippingCity}, ${shippingState} ${shippingZipcode} <br>`;
    let customerFirstName = user.commonName.split(' ')[0];

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; margin-top: 20px; padding: 20px; background-color: #ffffff; border-radius: 10px; border: 1px solid #0A1B71; max-width: 600px; margin-left: 20px; margin-right: 0;">
        <h2>Hi, <strong>${customerFirstName}</strong></h2>
        <p>You just successfully placed an order on the BlockApps Marketplace for:</p>
        <ul style="list-style-type: none; max-width: 90%; margin: auto;">${concatenatedOrderString}</ul>
        <p>Thank you for shopping with us...</p>
        <p style="text-align: left;">${shippingAddr}</p>
        <p style="text-align: left;">Yours,</p>
        <div style="display: flex; align-items: center;"><img style="margin-right: 10px; width: 60px; height: 60px;" src="https://blockapps.net/wp-content/uploads/2022/08/blockapps-avatar.jpg" alt="Logo" />
          <h3 style="color: #000; font-weight: 100; text-align: left;"><strong>${firstSellerOrg}</strong> <em><span style="text-decoration: underline;">powered by</span> the BlockApps Marketplace on </em><strong>Mercata&#8482;</strong><em><br /></em></h3>
        </div>
        <p style="font-size: 10px; margin-top: 20px;">This email was sent from a notification only address that cannot accept incoming email. Please do not reply to this message.</p>
      </div>
    `
    try {
      await orderActions.sendGridSendEmail(user.preferred_username, "New Membership Order", htmlContent);
    } catch (error) {
      console.error('Failed to send email:', error);
    }
  
    handleCancel();
    let orderList = [];
    let orderItemAddress = [];
    confirmOrderList.forEach((item) => {
      orderList.push({ inventoryId: item.key, quantity: item.qty });
      orderItemAddress.push(item.key);
    });
    const body = {
      buyerOrganization: userOrganization,
      orderList,
      orderTotal: total + tax + shipping,
      shippingAddress: userAddresses[selectedAddress].address,
    };

    TagManager.dataLayer({
      dataLayer: {
        event: 'pay_later_button',
      },
    });
    let isDone = await orderActions.createOrder(orderDispatch, body);
    if (isDone) {
      let updatedCart = [];
      cartList.forEach(cart => {
        if (!orderItemAddress.includes(cart.product.address)) {
          updatedCart.push(cart);
        }
      });
      actions.addItemToCart(marketplaceDispatch, updatedCart);
      setTimeout(function () {
        navigate(`/orders`, { state: { defaultKey: "Bought" } });
      }, 2000);
    }
  };

  const handlePaymentConfirm = async () => {
    handleCancel();
    let orderList = [];
    confirmOrderList.forEach((item) => {
      orderList.push({ inventoryId: item.key, quantity: item.qty });
    });
    const body = {
      buyerOrganization: userOrganization,
      orderList,
      orderTotal: total + tax + shipping,
      shippingAddress: userAddresses[selectedAddress].address,
    };
    TagManager.dataLayer({
      dataLayer: {
        event: 'pay_now_button',
      },
    });
    let data = await orderActions.createPayment(orderDispatch, body);
   
    if (data != null && data.url !== undefined) {
      window.location.replace(data.url);
    }
  };


  useEffect(() => {
    if (data.length !== 0) {
      inventoryAction.sellerStripeStatus(inventoryDispatch, data[0]["sellerOrganization"]);
    }
  }, [inventoryDispatch, data]);

  const activeButtonClass = "cursor-pointer justify-center flex items-center w-44 h-9  border border-primary rounded bg-primary hover:bg-primaryHover text-white mr-4";
  const disabledButtonClass = "cursor-not-allowed justify-center flex items-center w-44 h-9  border border-[#999999] rounded bg-[#cccccc] text-[#666666] mr-4";

  return (
    <div className="h-screen mx-14  mt-14">
      {contextHolder}
      {isCreateOrderSubmitting || isCreatePaymentSubmitting ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isCreateOrderSubmitting || isCreatePaymentSubmitting} size="large" />
        </div>
      ) : (
        <div className="pb-20">
          <Breadcrumb>
            {/* eslint-disable-next-line no-script-url */}
            <Breadcrumb.Item href="javascript:;">
              <ClickableCell href={routes.Marketplace.url}>
                Home
              </ClickableCell>
            </Breadcrumb.Item>
            {/* eslint-disable-next-line no-script-url */}
            <Breadcrumb.Item href="javascript:;">
              <ClickableCell href={routes.Checkout.url}>
                Checkout
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <p className="hover:text-primaryHover text-primary font-medium cursor-pointer">
                Confirm Order
              </p>
            </Breadcrumb.Item>
          </Breadcrumb>
          <div className="mt-4">
            <DataTableComponent
              isLoading={false}
              // rowSelection={{
              //   type: "checkbox",
              //   ...rowSelection,
              // }}
              scrollX="100%"
              columns={columns}
              data={data}
              pagination={false}
            />
          </div>

          <Row className="justify-end mt-4">
            <p className="text-sm w-36 mr-2">Item Total</p>
            <p className="text-sm">-</p>
            <p className="text-sm ml-2 w-20 text-right">${total}</p>
          </Row>
          <Row className="justify-end mt-0.5">
            <p className="text-sm w-36 mr-2">Tax</p>
            <p className="text-sm">-</p>
            <p className="text-sm ml-2 w-20 text-right">${tax}</p>
          </Row>
          <Row className="justify-end mt-0.5">
            <p className="text-sm w-36 mr-2">Shipping Charges</p>
            <p className="text-sm">-</p>
            <p className="text-sm ml-2 w-20 text-right">${shipping}</p>
          </Row>
          <Divider />
          <Row className="justify-end">
            <p className="text-lg font-semibold w-36 mr-2">Total</p>
            <p className="text-lg font-semibold">-</p>
            <p className="text-lg font-semibold ml-2 w-20 text-right">
              ${total + tax + shipping}
            </p>
          </Row>
          <Row align="middle">
            <p className="text-lg font-semibold mr-4">Shipping address</p>
            {
              userAddresses.length === 0 ? <div /> : showAddress ? <MinusCircleOutlined className="text-xl text-primary"
                onClick={() => {
                  setshowAddress(false);
                }}
              /> : <PlusCircleOutlined className="text-xl text-primary"
                onClick={() => {
                  setshowAddress(true);
                }}
              />
            }
          </Row>
          <p className="mt-2 text-sm text-primaryC">{userAddresses.length !== 0 ? "Select a shipping address" : "Create a new shipping address"}</p>
          {
            showAddress ? <Card className="w-3/5 mt-4">
              <Form layout="vertical" className="mt-5">
                <div>
                  <div className="flex justify-between mb-4">
                    <Form.Item label="Name" name="name" className="w-72">
                      <Input
                        label="name"
                        name="name"
                        placeholder="Enter Name"
                        value={formik.values.name}
                        onChange={formik.handleChange}
                      />
                      {formik.touched.name && formik.errors.name && (
                        <span className="text-error text-xs">
                          {formik.errors.name}
                        </span>
                      )}
                    </Form.Item>

                    <Form.Item label="Zipcode" name="zipcode" className="w-72">
                      <Input
                        label="zipcode"
                        name="zipcode"
                        placeholder="Enter Zipcode"
                        value={formik.values.zipcode}
                        onChange={formik.handleChange}
                      />
                      {formik.touched.zipcode && formik.errors.zipcode && (
                        <span className="text-error text-xs">
                          {formik.errors.zipcode}
                        </span>
                      )}
                    </Form.Item>
                  </div>

                  <div className="flex justify-between mb-4">
                    <Form.Item label="State" name="state" className="w-72">
                      <Input
                        label="state"
                        name="state"
                        placeholder="Enter State"
                        value={formik.values.state}
                        onChange={formik.handleChange}
                      />
                      {formik.touched.state && formik.errors.state && (
                        <span className="text-error text-xs">
                          {formik.errors.state}
                        </span>
                      )}
                    </Form.Item>

                    <Form.Item label="City" name="city" className="w-72">
                      <Input
                        label="city"
                        name="city"
                        placeholder="Enter City"
                        value={formik.values.city}
                        onChange={formik.handleChange}
                      />
                      {formik.touched.city && formik.errors.city && (
                        <span className="text-error text-xs">
                          {formik.errors.city}
                        </span>
                      )}
                    </Form.Item>
                  </div>

                  <div className="flex justify-between items-start mb-4">
                    <Form.Item
                      label="Address Line 1"
                      name="addressLine1"
                      className="w-72"
                    >
                      <TextArea
                        rows={3}
                        name="addressLine1"
                        placeholder="Enter Address Line 1"
                        value={formik.values.addressLine1}
                        onChange={formik.handleChange}
                      />
                      {formik.touched.addressLine1 && formik.errors.addressLine1 && (
                        <span className="text-error text-xs">
                          {formik.errors.addressLine1}
                        </span>
                      )}
                    </Form.Item>

                    <Form.Item
                      label="Address Line 2"
                      name="addressLine2"
                      className="w-72"
                    >
                      <TextArea
                        rows={3}
                        name="addressLine2"
                        placeholder="Enter Address Line 2"
                        value={formik.values.addressLine2}
                        onChange={formik.handleChange}
                      />
                      {formik.touched.addressLine2 && formik.errors.addressLine2 && (
                        <span className="text-error text-xs">
                          {formik.errors.addressLine2}
                        </span>
                      )}
                    </Form.Item>

                  </div>

                </div>
                <div className="flex justify-end mt-8" id="add-address-button">
                  <div className="cursor-pointer justify-center flex items-center w-44 h-9  border border-primary rounded bg-primary hover:bg-primaryHover text-white"
                    onClick={formik.handleSubmit}>
                    Add address
                  </div>
                </div>
              </Form>
            </Card> : <div />
          }
          <div>
            <div className="mt-4">
              {
                isAddingShippingAddress || isLoadingUserAddresses || isLoadingStripeStatus ?
                  <div className="h-80 flex justify-center items-center">
                    <Spin spinning={isAddingShippingAddress || isLoadingUserAddresses || isLoadingStripeStatus} size="large" />
                  </div> :
                  userAddresses.length !== 0 ?
                    <div className="flex flex-nowrap overflow-x-auto space-x-4">
                      {
                        userAddresses.map((add, index) =>
                          <div key={index}>
                            <Card className={index !== selectedAddress ? "w-96 cursor-pointer" : "w-96 border border-primary cursor-pointer"} onClick={() => { setSelectedAddress(index) }}>
                              <AddressComponent userAddress={add} />
                            </Card>
                          </div>
                        )
                      }
                    </div>
                    :
                    <Card className="w-3/5 mt-4">
                      <Form layout="vertical" className="mt-5">
                        <div>
                          <div className="flex justify-between mb-4">
                            <Form.Item label="Name" name="name" className="w-72">
                              <Input
                                label="name"
                                name="name"
                                placeholder="Enter Name"
                                value={formik.values.name}
                                onChange={formik.handleChange}
                              />
                              {formik.touched.name && formik.errors.name && (
                                <span className="text-error text-xs">
                                  {formik.errors.name}
                                </span>
                              )}
                            </Form.Item>

                            <Form.Item label="Zipcode" name="zipcode" className="w-72">
                              <Input
                                label="zipcode"
                                name="zipcode"
                                placeholder="Enter Zipcode"
                                value={formik.values.zipcode}
                                onChange={formik.handleChange}
                              />
                              {formik.touched.zipcode && formik.errors.zipcode && (
                                <span className="text-error text-xs">
                                  {formik.errors.zipcode}
                                </span>
                              )}
                            </Form.Item>
                          </div>

                          <div className="flex justify-between mb-4">
                            <Form.Item label="State" name="state" className="w-72">
                              <Input
                                label="state"
                                name="state"
                                placeholder="Enter State"
                                value={formik.values.state}
                                onChange={formik.handleChange}
                              />
                              {formik.touched.state && formik.errors.state && (
                                <span className="text-error text-xs">
                                  {formik.errors.state}
                                </span>
                              )}
                            </Form.Item>

                            <Form.Item label="City" name="city" className="w-72">
                              <Input
                                label="city"
                                name="city"
                                placeholder="Enter City"
                                value={formik.values.city}
                                onChange={formik.handleChange}
                              />
                              {formik.touched.city && formik.errors.city && (
                                <span className="text-error text-xs">
                                  {formik.errors.city}
                                </span>
                              )}
                            </Form.Item>
                          </div>

                          <div className="flex justify-between items-start mb-4">
                            <Form.Item
                              label="Address Line 1"
                              name="addressLine1"
                              className="w-72"
                            >
                              <TextArea
                                rows={3}
                                name="addressLine1"
                                placeholder="Enter Address Line 1"
                                value={formik.values.addressLine1}
                                onChange={formik.handleChange}
                              />
                              {formik.touched.addressLine1 && formik.errors.addressLine1 && (
                                <span className="text-error text-xs">
                                  {formik.errors.addressLine1}
                                </span>
                              )}
                            </Form.Item>

                            <Form.Item
                              label="Address Line 2"
                              name="addressLine2"
                              className="w-72"
                            >
                              <TextArea
                                rows={3}
                                name="addressLine2"
                                placeholder="Enter Address Line 2"
                                value={formik.values.addressLine2}
                                onChange={formik.handleChange}
                              />
                              {formik.touched.addressLine2 && formik.errors.addressLine2 && (
                                <span className="text-error text-xs">
                                  {formik.errors.addressLine2}
                                </span>
                              )}
                            </Form.Item>

                          </div>

                        </div>
                        <div className="flex justify-end mt-8">
                          <div id="add-address-button" className="cursor-pointer justify-center flex items-center w-44 h-9  border border-primary rounded bg-primary hover:bg-primaryHover text-white"
                            onClick={formik.handleSubmit}>
                            Add address
                          </div>
                        </div>
                      </Form>
                    </Card>
              }
            </div>
            {stripeStatus == null || userAddresses.length === 0 ? <div></div> : <Row className="justify-center mt-12">
              {/* <div id="pay-later-button" className="cursor-pointer justify-center flex items-center w-44 h-9 bg-white text-primary border border-primary rounded hover:bg-primary hover:text-white mr-4"
                onClick={() => {
                  setOpen(true);
                }}>
                Pay later
              </div> */}
              <div id="pay-now-button" className={stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled ? activeButtonClass : disabledButtonClass}
                onClick={() => {
                  if (stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled) {
                    handlePaymentConfirm();
                  }
                }}
              >
                Pay now
              </div>
            </Row>}
          </div>
        </div>
      )}
      <ConfirmOrderModel
        open={open}
        handleCancel={handleCancel}
        handleConfirm={handleOrderConfirm}
      />
      {marketplaceMessage && openToastMarketplace("Bottom")}
      {message && openToastOrder("bottom")}
    </div>
  );
};

export default ConfirmOrder;