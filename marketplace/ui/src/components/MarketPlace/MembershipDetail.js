import React, { useState, useEffect } from "react";
import { useFormik, getIn } from "formik";
import {
  Row,
  Image,
  Button,
  Typography,
  Tabs,
  Spin,
  notification,
  InputNumber,
  Col,
  Card,
  Table,
} from "antd";
import noPreview from "../../images/resources/noPreview.jpg";
import { useMatch, useParams } from "react-router-dom";
import { actions } from "../../contexts/inventory/actions";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as productActions } from "../../contexts/product/actions";
import { Carousel } from 'react-responsive-carousel';
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { actions as itemActions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { useProductDispatch, useProductState } from "../../contexts/product";
import routes from "../../helpers/routes";
import { actions as marketPlaceActions } from "../../contexts/marketplace/actions";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useNavigate, useLocation } from "react-router-dom";
import DataTableComponent from "../DataTableComponent";
import useDebounce from "../UseDebounce";
import "./index.css";
import { useAuthenticateState } from "../../contexts/authentication";
import ListNowModal from "../Membership/ListNowModal";
import * as yup from "yup";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { minusIcon, plusIcon, watchIcon } from "../../images/SVGComponents";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
import TagManager from "react-gtm-module";
import dayjs from "dayjs";

const StatusValue = {
  1: "Listed",
  2: "Not Listed"
}

const MembershipDetails = ({ user, users }) => {
  const { type } = useParams()
  const isIssued = type === 'issued';
  const isPurchased = type === 'purchased';
  const isMarketPlace = (!isIssued && !isPurchased);

  const { state, pathname } = useLocation();

  const [inventoryId, setInventoryId] = useState(state?.inventoryId);

  let isCalledFromMembership = false;

  if (state !== null && state !== undefined) {
    isCalledFromMembership = state.isCalledFromMembership
  }
  else if (pathname.includes("memberships")) {
    isCalledFromMembership = true
  }
  const initialValues = {
    name: "",
    price: "",
    quantity: 1
  };

  const [activeTab, setActiveTab] = useState("Details");
  const [serviceList, setServiceList] = useState([]);
  const [savingsList, setSavingsList] = useState([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [ownerSameAsUser, setOwnerSameAsUser] = useState(true);
  const [Id, setId] = useState(undefined);
  const [isServiceSelected, setIsServiceSelected] = useState(false);
  const [membershipDetails, setMembershipDetails] = useState(undefined);
  const [allProductFiles, setAllProductFiles] = useState(undefined);
  const [visible, setVisible] = useState(false);
  const limit = 10, offset = 0;
  const debouncedSearchTerm = useDebounce("", 1000);
  const { membershipServices, membership, isMembershipLoading, productFiles } =
    useMembershipState();
  const serviceDispatch = useMembershipDispatch();
  const itemDispatch = useItemDispatch();
  const { items } = useItemState();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  useEffect(() => {
    if (user) {
      if (Id !== undefined) {
        membershipActions.fetchMembershipFromDetails(serviceDispatch, limit, offset, debouncedSearchTerm, Id);
      }
    }
  }, [limit, offset, debouncedSearchTerm, serviceDispatch, Id, user]);

  useEffect(() => {
    let services = [];
    let savings = [];
    membershipServices?.forEach(element => {
      services.push({ "key": element.serviceName, "serviceName": element.serviceName, "serviceDesc": element.serviceDescription, "memberPrice": element.membershipPrice, "nonMemberPrice": element.servicePrice, "uses": element.maxQuantity },)
      savings.push({ "key": element.serviceName, "serviceName": element.serviceName, "serviceCost": element.savings },)
    });
    let total = 0;
    savings.forEach(element => {
      total += element.serviceCost;
    });
    setTotalSavings(total);
    setServiceList(services);
    setSavingsList(savings);
  }, [membershipServices])

  useEffect(() => {
    setMembershipDetails(membership)
  }, [membership])

  useEffect(() => {
    setAllProductFiles(productFiles)
  }, [productFiles])

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

  const { Text, Paragraph, Title } = Typography;
  const [qty, setQty] = useState(1);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { inventoryDetails, inventories, isInventoryDetailsLoading, isInventoriesLoading, inventory, isCreateInventorySubmitting } = useInventoryState();
  const productDispatch = useProductDispatch();
  const { productDetails, isProductDetailsLoading } = useProductState();
  const marketplaceDispatch = useMarketplaceDispatch();
  const { cartList } = useMarketplaceState();
  const navigate = useNavigate();

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
    let inventoryAddress;
    if (type !== "issued" && type !== "purchased") {
      inventoryAddress = inventoryDetails?.address
    } else {
      inventoryAddress = inventories[0]?.address
    }
    if (inventoryAddress) {
      itemActions.fetchItem(itemDispatch, '', 0, inventoryAddress);
    }
  }, [inventories])

  useEffect(() => {
    if (inventory !== null && inventory !== undefined) {
      setInventoryId(inventory[1]);
    }
  }, [inventory])

  useEffect(() => {
    if (Id !== undefined && inventoryId) {
      actions.fetchInventoryDetail(dispatch, inventoryId);
    }
    else if (Id !== undefined && membershipDetails) {

      const inventoryResult = Promise.resolve(actions.fetchInventory(dispatch, 10, 0, membershipDetails?.productId));

      inventoryResult.then((value) => {
        if (inventories.length > 0) {
          setInventoryId(inventories[0].address);
        }
        else {
          productActions.fetchProductDetails(productDispatch, membershipDetails?.productId, null);
        }
      }).catch(err => {
        productActions.fetchProductDetails(productDispatch, membershipDetails?.productId, null);
      });
    }
  }, [membershipDetails, inventories]);

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
    const availableQty = inventoryDetails?.availableQuantity
    if (qty < availableQty) {
      let value = qty + 1;
      setQty(value);
    } else {
      openToast("bottom", true, `Cannot add more than available quantity (${availableQty})`);
    }
  };

  const isLoading = isMembershipLoading || isInventoriesLoading || isProductDetailsLoading || isInventoryDetailsLoading;
  const isOwner = inventoryDetails?.ownerOrganization === user?.organization;
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


  const addItemToCart = () => {
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === inventoryDetails?.address) {
        found = true;
        break;
      }
    }
    let items = [];
    if (!found) {
      items = [...cartList, { product: inventoryDetails, qty }];

      marketPlaceActions.addItemToCart(marketplaceDispatch, items);
      setQty(1);
      openToast("bottom", false, "Item added to cart");
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === inventoryDetails?.address) {
          if (items[index].qty + qty <= inventoryDetails?.availableQuantity) {
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
      title: <Text className="text-primaryC font-semibold text-base">Non-Memberhsip Price</Text>,
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
            itemAddress: items[0].address,
            productAddress: membershipDetails.productId,
            inventory: inventoryId,
            updates: {
              pricePerUnit: formik.values.price,
              status: INVENTORY_STATUS.PUBLISHED,
              quantity: formik.values.quantity
            }
          }
          const createInventory = await membershipActions.resaleMembership(
            dispatch,
            resalePayload
          );

          if (createInventory) {
            formik.resetForm();
          }
          setVisible(false);

        }
      }
    }
  };

  const handleTabChange = (label) => {
    setActiveTab(label)
  }

  const detailTabSchema = [
    { label: "Seller", value: inventoryDetails?.ownerOrganization },
    { label: "Sub-Category", value: inventoryDetails?.subCategory },
    { label: "Time in Months", value: membershipDetails?.timePeriodInMonths },
    // { label: "Additional Info", value: membershipDetails?.additionalInfo }
  ]

  const DetailTabCard = () => {
    return (
      <>
        <Text className="leading-6 text-lg block font-semibold pb-3"> Information </Text>
        <Col xl={{ span: 14 }} className="border-grey shadow-lg leading-2 w-full rounded-md p-4 " style={{ height: 'auto', display: 'inline-block' }}>
          {detailTabSchema.map((item, index) => {
            return <Paragraph >
              <Text disabled className="font-bold font-poppin" >{item.label}</Text>
              <Text strong className="float-right">{item.value ?? "--"}</Text>
            </Paragraph>
          })}
          <Paragraph >
            <Text disabled className="font-bold font-poppin" >Additional Info</Text>
            <Paragraph ellipsis={{ rows: 2, expandable: true, symbol: <Text strong>more</Text> }} className="float-right text-md font-regular h-auto">
              {membershipDetails?.additionalInfo ?? "--"}
            </Paragraph>
          </Paragraph>
          {/* {true && <Paragraph>
          <Text disabled className="font-bold" >Membership ID</Text>
          <Text strong className="float-right">membershipId</Text>
        </Paragraph>} */}
        </Col>
      </>
    )
  }

  const ServiceTabCard = () => {
    return (
      <Row>
        <Text className="leading-6 text-lg block font-semibold pb-3">Services</Text>
        <Col span={24} >
          <Table className="inventory-table" columns={serviceColumn} dataSource={serviceList}
            pagination={false}
            scroll={{ y: 300 }}
          />
        </Col>
        <Text className="leading-6 text-lg block font-semibold pb-3 mt-4">Savings</Text>
        <hr style={{ color: "grey" }} />
        <Col span={24} className="max-h-96 overflow-y-auto">
          <Row className="">
            {savingsList.map(({ serviceName, serviceCost }, index) => {
              return <Col span={8} className="">
                <Card className="shadow-md m-2">
                  <Row className="mt-2">
                    <Col span={24}><Text className="block text-base text-grey font-medium">Name</Text></Col>
                    <Col span={24}><Text className="block text-lg ">{serviceName}</Text></Col>
                  </Row>
                  <Row className="mt-2">
                    <Col span={24}><Text className="block text-base text-grey font-medium">Effective Cost Saving</Text></Col>
                    <Col span={24}><Text className="block text-lg font-bold" style={{ color: 'green' }}>$ {serviceCost ?? "--"}</Text></Col>
                  </Row>
                </Card>
              </Col>
            })}
          </Row>
        </Col>
      </Row>

    )
  }

  return (
    <>
      {contextHolder}
      {isLoading
        ? (<div className="h-screen flex justify-center mx-auto items-center">
          <Spin spinning={isLoading} size="large" />
        </div>)
        : (<div>
          <BreadCrumbComponent name={inventoryDetails?.name} />
          <Row className="max-w-4xl mx-auto mt-10 h-92" >
            <Col span={10} className="rounded-md border-1-primary h-px-390">
              {allProductFiles && allProductFiles.length > 0 ? (
                <Carousel>
                  {allProductFiles.map((file, index) =>
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
                  )}
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
                <Text className="text-2xl leading-8 font-semibold font-poppin"> {inventoryDetails?.name ?? "--"} </Text>
                {(isIssued || type === "all")
                  ? <Row className="mb-1"> {watchIcon()} <Text className="ml-2 font-medium text-dark-grey font-poppin text-sm"> {membershipDetails?.timePeriodInMonths ?? ""} -month duration </Text> </Row>
                  : <Row className="mb-1"> <Text className="ml-1 font-medium text-dark-grey font-poppin text-sm"> Expiry Date:- &nbsp;{dayjs(membershipDetails?.expiryDate).format('MM-DD-YYYY') ?? ""}  </Text> </Row>}
                <Row className="flex justify-between h-20 mt-8">
                  <Col span={11} className="border border-grayLight rounded-md p-2 h-full">
                    <Text className="block text-center text-grey text-base font-poppin font-normal" >{isMarketPlace ? "Price" : "Status"} </Text>
                    <Text className="block text-center text-xl font-bold mt-2" >{isMarketPlace ? (`$ ${inventoryDetails?.pricePerUnit}`) : (StatusValue[inventoryDetails?.status] ?? "--")} </Text>
                  </Col>
                  <Col span={11} className="border border-grayLight rounded-md p-2 h-full">
                    <Text className="block text-center text-grey text-base font-poppin font-normal" > Total Savings </Text>
                    <Text className="block text-center text-xl font-bold mt-2 leading-6" style={{ color: "green" }} > $ {totalSavings}  </Text>
                  </Col>
                </Row>
                {isMarketPlace && <Row>
                  <Row className="w-full absolute mr-5 left-0 mt-6" style={{ borderBottom: "1px solid #d3d3d3" }}></Row>
                  <Col span={24} className="border-t-1 h-20 mt-8">
                    {inventoryDetails?.availableQuantity != 0
                      ? <Row className="flex justify-between h-10 mt-5">
                        <Col span={4} className="rounded-md h-14" >  <Button className="h-full text-center p-6 add-sub-btn "
                          disabled={isIssued}
                          onClick={subtract}>
                          {minusIcon()}
                        </Button> </Col>
                        <Col span={16} className="border border-grayLight rounded-md align-middle text-center h-14 py-2" >
                          <Text className="font-poppin font-normal text-base text-grey">Quantity </Text> &nbsp; <Text className="text-2xl font-bold leading-8 pt-2">{qty}</Text>
                        </Col>
                        <Col span={4} className="rounded-md h-14" > <Button className="h-full text-center p-6 float-right add-sub-btn"
                          disabled={isIssued}
                          onClick={add}> {plusIcon()} </Button>
                        </Col>
                      </Row>
                      : <Paragraph style={{ color: 'red' }} className="mt-5 text-sm decoration-red-700" id="prod-price">
                        If you are interested in purchasing this item, please contact our sales team at sales@blockapps.net
                      </Paragraph>}
                  </Col>
                </Row>}

                {isPurchased && <Row>
                  <Row className="w-full absolute mr-5 left-0 mt-6" style={{ borderBottom: "1px solid #d3d3d3" }}></Row>
                  <Col span={16} className="border border-grayLight rounded-md align-middle text-center mx-auto mt-12 h-14 py-2" >
                    <Text className="font-poppin font-normal text-base text-grey">Quantity </Text> &nbsp; <Text className="text-2xl font-bold leading-8 pt-2">{inventoryDetails?.availableQuantity}</Text>
                  </Col>
                </Row>}

              </Card>
              <Row className="h-14 mt-4">
                {(inventoryDetails?.availableQuantity == 0) ?
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
                  </Button> :

                  (!isMarketPlace
                    ? <Button
                      // type={ownerSameAsUser ? "default" : "primary"}
                      type="primary"
                      block={true} size="large" className=" h-full py-4 h-px-56"
                      onClick={() => {
                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                          window.location.href = loginUrl;
                        } else {
                          formik.setFieldValue("name", inventoryDetails?.name);
                          openListNowModal();
                        }
                      }}
                    // disabled={ownerSameAsUser}
                    > <Text className={`text-lg font-poppin text-white 
                    `}>List for Sale </Text>
                      {/* ${ownerSameAsUser ? "font-bold" : "text-white"} */}
                    </Button>
                    : <Row className="w-full mx-auto" gutter={[12]}>
                      <Col span={12} className="mx-auto flex justify-center">
                        <Button
                          block
                          size="large"
                          disabled={isIssued}
                          className="group border !h-14 border-primary hover:bg-primary"
                          onClick={() => {
                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                              window.location.href = loginUrl;
                            } else {
                              TagManager.dataLayer({
                                dataLayer: {
                                  event: 'add_to_cart_from_product_details',
                                  product_name: inventoryDetails.name,
                                  category: inventoryDetails.category,
                                  productId: inventoryDetails.productId
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
                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                              window.location.href = loginUrl;
                            } else {
                              TagManager.dataLayer({
                                dataLayer: {
                                  event: 'buy_now_from_product_details',
                                  product_name: inventoryDetails.name,
                                  category: inventoryDetails.category,
                                  productId: inventoryDetails.productId
                                },
                              });
                              addItemToCart();
                              navigate("/checkout");
                            }
                          }}
                          // disabled={ownerSameAsUser()}
                          id="buyNow"
                        >
                          Buy Now
                        </Button>
                      </Col>
                    </Row>)
                }
              </Row>
            </Col>
          </Row>

          <Row className="max-w-4xl mx-auto mt-10">
            <Card className="w-full shadow-md">
              <Title level={3}> Description  </Title>
              <Paragraph
                ellipsis={{ rows: 2, expandable: true, symbol: <Text strong>Show more</Text> }}
                className="text-primaryC text-[13px] mt-2"
              >
                {/* {decodeURIComponent(inventoryDetails?.description).replace(/%0A/g, "\n").split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line ?? "--"}
                    <br />
                  </React.Fragment>
                ))} */}
                {inventoryDetails?.description}
              </Paragraph>
            </Card>
          </Row>

          <Row className="max-w-4xl mx-auto mt-10 mb-20">
            <Card className="w-full card-shadow-2">
              <Tabs defaultActiveKey="1" items={[{
                key: 'Details',
                label: <Text className="text-xl font-bold leading-6" style={{ color: activeTab === "Details" ? "#181EAC" : "rgba(0, 0, 0, 0.4)" }}>Details</Text>,
                children: DetailTabCard(),
              },
              {
                key: 'Services',
                label: <Text className="text-xl font-bold leading-6" style={{ color: activeTab === "Services" ? "#181EAC" : "rgba(0, 0, 0, 0.4)" }}>Services</Text>,
                children: ServiceTabCard(),
              },]}
                onChange={handleTabChange}
              />
            </Card>
          </Row>

        </div>
        )}
      {visible && (
        <ListNowModal
          open={visible}
          user={{ user }}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          getIn={getIn}
          listType="Sale"
          id={Id}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}
    </>
  );
};

export default MembershipDetails;
