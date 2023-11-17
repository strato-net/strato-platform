import React, { useState, useEffect } from "react";
import { useMatch, useParams, useNavigate, useLocation } from "react-router-dom";
import { Carousel } from "react-responsive-carousel";
import TagManager from "react-gtm-module";
import { useFormik, getIn } from "formik";
import * as yup from "yup";
import dayjs from "dayjs";
import {
  Row,
  Image,
  Button,
  Typography,
  Tabs,
  notification,
  Col,
  Card,
} from "antd";

//Components
import InformationCard from "../Membership/components/InformationCard";
import ServiceTabCard from "../Membership/components/ServiceTabCard";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
import ParagraphEllipsis from "../Ellipsis/ParagraphEllipsis";
// import ToastComponent from "../ToastComponent/ToastComponent";
import LoaderComponent from "../Loader/LoaderComponent";
import ListNowModal from "../Membership/ListNowModal";
//Actions
import { actions as marketPlaceActions } from "../../contexts/marketplace/actions";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as productActions } from "../../contexts/product/actions";
// Dispatch and States
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useProductDispatch, useProductState } from "../../contexts/product";
import { useAuthenticateState } from "../../contexts/authentication";
// Icons, images, config, routes, utils, constants, css.
import { minusIcon, plusIcon, watchIcon } from "../../images/SVGComponents";
import noPreview from "../../images/resources/noPreview.jpg";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { listNowConfig } from "./listNowConfig";
import routes from "../../helpers/routes";
import useDebounce from "../UseDebounce";
import "./index.css";


const { Text, Paragraph, Title } = Typography;
const StatusValue = {
  1: "Listed",
  2: "Not Listed",
};
const initialValues = {
  name: "",
  price: "",
  quantity: 1,
};

const MembershipDetails = ({ user }) => {
  const { type } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { state, pathname } = useLocation();

  const queryParams = new URLSearchParams(location.search);
  const inventoryId = queryParams.get("inventoryId");

  const isIssued = type === "issued";
  const isPurchased = type === "purchased";
  const isMarket = type === "all";
  const isMarketPlace = !isIssued && !isPurchased;

  let isCalledFromMembership = false;

  if (pathname.includes("memberships")) {
    isCalledFromMembership = true;
  } else if (state !== null && state !== undefined) {
    isCalledFromMembership = state.isCalledFromMembership;
  }

  const [activeTab, setActiveTab] = useState("details");
  const [serviceList, setServiceList] = useState([]);
  const [savingsList, setSavingsList] = useState([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [Id, setId] = useState(undefined);
  const [membershipDetails, setMembershipDetails] = useState(undefined);
  const [allProductFiles, setAllProductFiles] = useState(undefined);
  const [visible, setVisible] = useState(false);
  const [qty, setQty] = useState(1);
  const limit = 10,
    offset = 0;
  const debouncedSearchTerm = useDebounce("", 1000);

  // Dispatch
  const productDispatch = useProductDispatch();
  const serviceDispatch = useMembershipDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const membershipDispatch = useMembershipDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  // States
  const { membershipServices, membership, isInitialLoadMembershipDetail, productFiles } = useMembershipState();
  const { inventoryDetails, isCreateInventorySubmitting, isInitialLoadInventoryDetails } = useInventoryState();
  const { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { productDetails, isInitialLoadProductDetails } = useProductState();
  const { cartList } = useMarketplaceState();
  // 

  useEffect(() => {
    if (Id !== undefined) {
      membershipActions.fetchMembershipFromDetails(
        serviceDispatch,
        limit,
        offset,
        debouncedSearchTerm,
        Id
      );
    }
  }, [Id]);

  useEffect(() => {
    let services = [];
    let savings = [];
    membershipServices?.forEach((element) => {
      services.push({
        key: element.serviceName,
        serviceName: element.serviceName,
        serviceDesc: element.serviceDescription,
        memberPrice: element.membershipPrice,
        nonMemberPrice: element.servicePrice,
        uses: element.maxQuantity,
      });
      savings.push({
        key: element.serviceName,
        serviceName: element.serviceName,
        serviceCost: element.savings,
      });
    });
    let total = 0;
    savings.forEach((element) => {
      total += element.serviceCost;
    });
    setTotalSavings(total);
    setServiceList(services);
    setSavingsList(savings);
  }, [membershipServices]);

  useEffect(() => {
    setMembershipDetails(membership);
  }, [membership]);

  useEffect(() => {
    setAllProductFiles(productFiles);
  }, [productFiles]);

  const getSchema = (isListNowModalOpen) => {
    return yup.object().shape({
      name: yup.string().required("Membership name is required"),
      price: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Price is required"),
      }),
      quantity: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Quantity is required"),
      }),
    });
  };

  const isDuration =
    membershipDetails?.expiryDate === 0 || !membershipDetails?.expiryDate;

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: getSchema(visible),
    setFieldValue: (field, value) => {
      formik.setFieldValue(field, value);
    },
    onSubmit: function (values) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  const [api, contextHolder] = notification.useNotification();

  const routeMatch = useMatch({
    path: routes.MarketplaceProductDetail.url,
    strict: true,
  });

  const routeMatch1 = useMatch({
    path: routes.MembershipDetail.url,
    strict: true,
  });

  useEffect(() => {
    if (isCalledFromMembership) setId(routeMatch1?.params?.id);
    else setId(routeMatch?.params?.address);
  }, [routeMatch, routeMatch1]);

  useEffect(() => {
    if (Id !== undefined && inventoryId && !membershipDetails) {
      inventoryActions.fetchInventoryDetail(inventoryDispatch, inventoryId);
    } else if (Id !== undefined && membershipDetails && !inventoryId) {
      productActions.fetchProductDetails(
        productDispatch,
        membershipDetails?.productId,
        null
      );
    }
  }, [membershipDetails, inventoryId]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const subtract = () => {
    if (qty !== 1) {
      let value = qty - 1;
      setQty(value);
    }
  };

  const add = () => {
    const availableQty = inventoryDetails?.availableQuantity;
    if (qty < availableQty) {
      let value = qty + 1;
      setQty(value);
    } else {
      openToast(
        "bottom",
        true,
        `Cannot add more than available quantity (${availableQty})`
      );
    }
  };

  useEffect(() => {
    if (
      (!isInitialLoadMembershipDetail && !isInitialLoadProductDetails) ||
      (!isInitialLoadMembershipDetail && !isInitialLoadInventoryDetails)
    ) {
      setIsLoading(false); // All booleans are false, set isLoading to false
    } else {
      setIsLoading(true); // At least one boolean is true, set isLoading to true
    }
  }, [
    isInitialLoadMembershipDetail,
    isInitialLoadProductDetails,
    isInitialLoadInventoryDetails,
  ]);

  // const openToast = (placement, isError, msg) => {
  //   return (<ToastComponent
  //     message={msg}
  //     success={!isError}
  //     placement={placement}
  //   />)
  // };

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

  const expiryDateVal = dayjs(membershipDetails?.expiryDate).format(
    "MM-DD-YYYY"
  );

  const addItemToCart = () => {
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === inventoryDetails?.address) {
        found = true;
        break;
      }
    }
    let items = [];
    let productFileImg =
      allProductFiles?.length > 0 && allProductFiles[0]?.imageUrl;
    let inventoryDetailCpy = {
      ...inventoryDetails,
      taxes:
        inventoryDetails.taxPercentageAmount === 0
          ? inventoryDetails.taxDollarAmount
          : inventoryDetails.taxPercentageAmount / 10000,
      isTaxPercentage: inventoryDetails.taxDollarAmount === 0,
      productImageLocation: [productFileImg],
    };
    if (!found) {
      items = [...cartList, { product: inventoryDetailCpy, qty }];
      marketPlaceActions.addItemToCart(marketplaceDispatch, items);
      setQty(1);
      openToast("bottom", false, "Item added to cart");
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === inventoryDetailCpy?.address) {
          if (items[index].qty + qty <= inventoryDetailCpy?.availableQuantity) {
            items[index].qty += qty;
            marketPlaceActions.addItemToCart(marketplaceDispatch, items);
            setQty(1);
            openToast("bottom", false, "Item updated in cart");
          } else {
            openToast(
              "bottom",
              true,
              "Cannot add more than available quantity"
            );
            return;
          }
        }
      });
    }
  };

  const serviceColumn = [
    {
      title: <Text className="text-primaryC font-semibold text-base">Name</Text>,
      dataIndex: "serviceName",
      key: "name",
      render: (text) => <p>{decodeURIComponent(text)}</p>
    },
    {
      title: <Text className="text-primaryC font-semibold text-base">Description</Text>,
      dataIndex: "serviceDesc",
      key: "serviceDesc",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC font-semibold text-base">Membership Price</Text>,
      dataIndex: "memberPrice",
      key: "memberPrice",
      render: (text) => <p className="text-left">${decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC font-semibold text-base">Non-Membership Price</Text>,
      dataIndex: "nonMemberPrice",
      key: "nonMemberPrice",
      render: (text) => <p className="text-left">${decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC font-semibold text-base">Uses</Text>,
      dataIndex: "uses",
      key: "uses",
      render: (text) => <p className="text-left">{decodeURIComponent(text)}</p>,
    },
  ];

  const closeListNowModal = () => {
    setVisible(false);
  };

  const openListNowModal = () => {
    setVisible(true);
  };

  const handleCreateFormSubmit = async (values) => {
    if (user) {
      if (Id !== undefined) {
        if (formik.values.price !== "" && formik.values.quantity !== "") {
          const resalePayload = {
            itemAddress: inventoryDetails.itemId,
            productAddress: membershipDetails.productId,
            inventory: inventoryId,
            updates: {
              pricePerUnit: formik.values.price,
              status: INVENTORY_STATUS.PUBLISHED,
              quantity: formik.values.quantity,
              taxPercentageAmount: formik.values.taxPercentageAmount,
              taxDollarAmount: formik.values.taxDollarAmount,
            },
          };
          const resaleMembership = await membershipActions.resaleMembership(
            membershipDispatch,
            resalePayload
          );
          if (resaleMembership) {
            formik.resetForm();
          }
          setVisible(false);
        }
      }
    }
  };

  const detailTabSchema = [
    {
      label: "Seller",
      value: inventoryDetails?.ownerOrganization
        ? inventoryDetails?.ownerOrganization
        : productDetails?.ownerOrganization,
      type: "Text"
    },
    {
      label: "Sub-Category",
      value: inventoryDetails?.subCategory
        ? inventoryDetails?.subCategory
        : productDetails?.subCategory,
      type: "Text"
    },
    {
      label: `${isDuration ? "Time in Months" : "Expiry Date"}`,
      value: isDuration ? membershipDetails?.timePeriodInMonths : expiryDateVal,
      type: "Text"
    },
    { label: "Additional Info", value: membershipDetails?.additionalInfo, type: "Paragraph" }
  ];

  const description = inventoryDetails?.description
    ? inventoryDetails?.description
    : productDetails?.description;

  const membershipName = inventoryDetails?.name
    ? inventoryDetails?.name
    : productDetails?.name;

  const TabItems = [
    { key: "details", label: "", children: <InformationCard detailTabSchema={detailTabSchema} additionalInfo={membershipDetails?.additionalInfo} /> },
    { key: "services", label: "", children: <ServiceTabCard serviceList={serviceList} savingsList={savingsList} /> }
  ]

  const isUnAuthenticated = hasChecked && !isAuthenticated && loginUrl !== undefined;

  const handleListNowModal = () => {
    let taxVal =
      inventoryDetails.taxPercentageAmount === 0
        ? inventoryDetails.taxDollarAmount
        : inventoryDetails.taxPercentageAmount;
    let isTaxPercentage =
      inventoryDetails.taxPercentageAmount === 0 ? false : true

    formik.setFieldValue("name", inventoryDetails?.name);
    formik.setFieldValue("inventoryStatus", inventoryDetails?.status);
    formik.setFieldValue("price", inventoryDetails?.pricePerUnit);
    formik.setFieldValue("taxPercentage", taxVal);
    formik.setFieldValue("isTaxPercentage", isTaxPercentage);
    formik.setFieldValue("quantity", 1);
    formik.setFieldValue("taxPercentageAmount", inventoryDetails.taxPercentageAmount);
    formik.setFieldValue("taxDollarAmount", inventoryDetails.taxDollarAmount);
    openListNowModal();
  }

  return (
    <>
      {contextHolder}
      {isLoading ? (
        <LoaderComponent />
      ) : (
        <div>
          <BreadCrumbComponent
            name={inventoryDetails?.name || productDetails?.name}
          />
          <Row className="max-w-4xl mx-auto mt-10 h-92">
            <Col span={10} className="rounded-md border-1-primary h-px-390">
              {allProductFiles && allProductFiles.length > 0 ? (
                <Carousel showThumbs={false}>
                  {allProductFiles.map((file, index) => (
                    <div key={index} className="h-96">
                      <Image
                        height={"100%"}
                        width={"100%"}
                        fallback={noPreview}
                        preview={false}
                        style={{ objectFit: "contain" }}
                        src={file.imageUrl}
                      />
                    </div>
                  ))}
                </Carousel>
              ) : (
                <Image
                  height={"100%"}
                  width={"100%"}
                  fallback={noPreview}
                  preview={false}
                  style={{ objectFit: "contain" }}
                  src={null}
                />
              )}
            </Col>

            <Col span={13} className="ml-3 px-2 h-96 w-px-455">
              <Card className="h-80 shadow-md">
                <Paragraph className="text-2xl !mb-0 leading-8 font-semibold font-poppin" ellipsis={{ rows: 1, tooltip: membershipName }} >
                  {membershipName}
                </Paragraph>
                <Row className="mb-1">
                  {isDuration && watchIcon()}
                  <Text className="ml-1 font-medium text-dark-grey font-poppin text-sm">
                    {isDuration
                      ? `${membershipDetails?.timePeriodInMonths ?? ""} -month duration`
                      : `Expiry Date:- ${membershipDetails?.expiryDate ? expiryDateVal : "--"}`}
                  </Text>
                </Row>
                <Row className="flex justify-between h-20 mt-8">
                  <Col
                    span={11}
                    className="border border-grayLight rounded-md p-2 h-full"
                  >
                    <Text className="block text-center text-grey text-base font-poppin font-normal">
                      {isMarketPlace ? "Price" : "Status"}
                    </Text>
                    <Text className="block text-center text-xl font-bold mt-2">
                      {isMarketPlace
                        ? `$ ${inventoryDetails?.pricePerUnit}`
                        : (inventoryId
                          ? StatusValue[inventoryDetails?.status]
                          : "Not Listed") ?? "--"}
                    </Text>
                  </Col>
                  <Col
                    span={11}
                    className="border border-grayLight rounded-md p-2 h-full"
                  >
                    <Text className="block text-center text-grey text-base font-poppin font-normal">
                      Total Savings
                    </Text>
                    <Text
                      className="block text-center text-xl font-bold mt-2 leading-6"
                      style={{ color: "green" }}
                    >
                      $ {totalSavings}
                    </Text>
                  </Col>
                </Row>
                {(isIssued || isMarket) && (
                  <Row>
                    <Row
                      className="w-full absolute mr-5 left-0 mt-6"
                      style={{ borderBottom: "1px solid #d3d3d3" }}
                    ></Row>
                    <Col span={24} className="border-t-1 h-20 mt-8">
                      {inventoryDetails?.availableQuantity !== 0 ? (
                        <Row className="flex justify-between h-10 mt-5">
                          <Col span={4} className="rounded-md h-14">
                            <Button
                              className="h-full text-center p-6 add-sub-btn "
                              disabled={isIssued}
                              onClick={subtract}
                            >
                              {minusIcon()}
                            </Button>
                          </Col>
                          <Col
                            span={16}
                            className="border border-grayLight rounded-md align-middle text-center h-14 py-2"
                          >
                            <Text className="font-poppin font-normal text-base text-grey">
                              Quantity
                            </Text>
                            &nbsp;
                            <Text className="text-2xl font-bold leading-8 pt-2">
                              {qty}
                            </Text>
                          </Col>
                          <Col span={4} className="rounded-md h-14">
                            <Button
                              className="h-full text-center p-6 float-right add-sub-btn"
                              disabled={isIssued}
                              onClick={add}
                            >
                              {plusIcon()}
                            </Button>
                          </Col>
                        </Row>
                      ) : (
                        <Paragraph
                          style={{ color: "red" }}
                          className="mt-5 text-sm decoration-red-700"
                          id="prod-price"
                        >
                          If you are interested in purchasing this item, please
                          contact our sales team at sales@blockapps.net
                        </Paragraph>
                      )}
                    </Col>
                  </Row>
                )}
              </Card>
              <Row className="h-14 mt-4">
                {inventoryDetails?.availableQuantity === 0 ? (
                  <Button
                    block={true}
                    type="primary"
                    size="large"
                    className="h-full !pt-4 h-px-56 bg-primary !hover:bg-primaryHover"
                    href={`mailto:sales@blockapps.net`}
                  // onClick={() => {
                  //   TagManager.dataLayer({
                  //     dataLayer: {
                  //       event: 'contact_sales_from_category_card',
                  //       product_name: product.name,
                  //       category: product.category,
                  //       productId: product.productId
                  //     },
                  //   });
                  // }}
                  >
                    Contact to Buy
                  </Button>
                ) : !isMarketPlace ? (
                  <>
                    {!isIssued && (
                      <Button
                        type="primary"
                        block={true}
                        size="large"
                        className=" h-full py-4 h-px-56"
                        onClick={() => {
                          if (isUnAuthenticated) {
                            window.location.href = loginUrl;
                          } else {
                            handleListNowModal()

                          }
                        }}
                        disabled={isIssued}
                      >
                        <Text className={`text-lg font-poppin text-white`} >
                          List for Sale
                        </Text>
                      </Button>
                    )}
                  </>
                ) : (
                  <Row className="w-full mx-auto" gutter={[12]}>
                    <Col span={12} className="mx-auto flex justify-center">
                      <Button
                        block
                        size="large"
                        disabled={isIssued}
                        className="group border !h-14 border-primary hover:bg-primary"
                        onClick={() => {
                          if (isUnAuthenticated) {
                            window.location.href = loginUrl;
                          } else {
                            TagManager.dataLayer({
                              dataLayer: {
                                event: "add_to_cart_from_product_details",
                                product_name: inventoryDetails.name,
                                category: inventoryDetails.category,
                                productId: inventoryDetails.productId,
                              },
                            });
                            addItemToCart();
                          }
                        }}
                      >
                        {/* <div className="text-primary group-hover:text-white"> */}
                        Add To Cart
                        {/* </div> */}
                      </Button>
                    </Col>
                    <Col span={12}>
                      <Button
                        block
                        disabled={isIssued}
                        size="large"
                        type="primary"
                        className="bg-primary !h-14 !hover:bg-primaryHover"
                        onClick={() => {
                          if (isUnAuthenticated) {
                            window.location.href = loginUrl;
                          } else {
                            TagManager.dataLayer({
                              dataLayer: {
                                event: "buy_now_from_product_details",
                                product_name: inventoryDetails.name,
                                category: inventoryDetails.category,
                                productId: inventoryDetails.productId,
                              },
                            });
                            addItemToCart();
                            navigate("/checkout");
                          }
                        }}
                        id="buyNow"
                      >
                        Buy Now
                      </Button>
                    </Col>
                  </Row>
                )}
              </Row>
            </Col>
          </Row>

          <Row className="max-w-4xl mx-auto mt-10">
            <Card className="w-full shadow-md">
              <Title level={3}> Description </Title>
              <ParagraphEllipsis description={description} />
            </Card>
          </Row>

          <Row className="max-w-4xl mx-auto mt-10 mb-20">
            <Card className="w-full card-shadow-2">
              <Tabs
                defaultActiveKey="details"
                items={TabItems.map((item, index) => {
                  return {
                    ...item, label: <Text
                      className="text-xl font-bold leading-6 capitalize"
                      style={{
                        color:
                          activeTab === item.key
                            ? "#181EAC"
                            : "rgba(0, 0, 0, 0.4)",
                      }}
                    >
                      {item.key}
                    </Text>
                  }
                })
                }
                onChange={(label) => { setActiveTab(label) }}
              />
            </Card>
          </Row>
        </div>
      )}
      {visible && (
        <ListNowModal
          config={listNowConfig("resaleMembership")}
          open={visible}
          user={{ user }}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          getIn={getIn}
          id={Id}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}
    </>
  );
};

export default MembershipDetails;
