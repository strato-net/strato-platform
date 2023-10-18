import React, { useState, useEffect } from "react";
import { useFormik, getIn } from "formik";
import {
  Row,
  Breadcrumb,
  Image,
  Button,
  Typography,
  Tabs,
  Space,
  Spin,
  notification,
  InputNumber,
  // Carousel,
  Col,
  Card,
  Table,
} from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import noPreview from "../../images/resources/noPreview.jpg";
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/inventory/actions";
import { actions as productActions } from "../../contexts/product/actions";
import { Carousel } from 'react-responsive-carousel';
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import {
  useProductDispatch,
  useProductState,
} from "../../contexts/product";
import routes from "../../helpers/routes";
import { actions as marketPlaceActions } from "../../contexts/marketplace/actions";
import { actions as membershipActions } from "../../contexts/membership/actions";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useNavigate, useLocation } from "react-router-dom";
import DataTableComponent from "../DataTableComponent";
import useDebounce from "../UseDebounce";
import ClickableCell from "../ClickableCell";
import "./index.css";
import { useAuthenticateState } from "../../contexts/authentication";
import ListNowModal from "../Membership/ListNowModal";
import * as yup from "yup";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { minusIcon, plusIcon, watchIcon } from "../../images/SVGComponents";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";

const MembershipDetails = ({ user, users }) => {

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
  const [serviceList, setServiceList] = useState([])
  const [savingsList, setSavingsList] = useState([])
  const [totalSavings, setTotalSavings] = useState(0)
  const [ownerSameAsUser, setOwnerSameAsUser] = useState(true)
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

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  useEffect(() => {
    if (user) {
      if (Id !== undefined) {
        membershipActions.fetchMembershipFromDetails(serviceDispatch, limit, offset, debouncedSearchTerm, Id);
      }
    }
  }, [limit, offset, debouncedSearchTerm, serviceDispatch, Id, user])

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
  }, [Id, dispatch, productDispatch, user, membershipDetails, inventoryId]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  let details = undefined;
  if (inventoryId && inventoryDetails) {
    details = inventoryDetails;
  }
  else if (!inventoryId && productDetails) {
    details = productDetails;
  }

  const subtract = () => {
    if (qty !== 1) {
      let value = qty - 1;
      setQty(value);
    }
  };

  const add = () => {
    if (qty < details?.availableQuantity) {
      let value = qty + 1;
      setQty(value);
    } else {
      openToast("bottom", true, "Cannot add more than available quantity");
    }
  };

  const isLoading = isMembershipLoading || isInventoriesLoading || isProductDetailsLoading;

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


  useEffect(() => {
    if (user && user.organization && (inventoryDetails === null || inventoryDetails === undefined)) {
      setOwnerSameAsUser(false);
    }
    else {
      setOwnerSameAsUser(true);
    }
  }, [inventoryDetails, details])

  const addItemToCart = () => {
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === details?.address) {
        found = true;
        break;
      }
    }
    let items = [];
    if (!found) {
      items = [...cartList, { product: details, qty }];

      marketPlaceActions.addItemToCart(marketplaceDispatch, items);
      setQty(1);
      openToast("bottom", false, "Item added to cart");
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === details?.address) {
          if (items[index].qty + qty <= details?.availableQuantity) {
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

  const savingsColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">NAME</Text>,
      dataIndex: "serviceName",
      key: "name",
      render: (text) => <p>{decodeURIComponent(text)}</p>
    },
    {
      title: <Text className="text-primaryC text-[13px]">EFFECTIVE COST SAVINGS FROM MEMBERSHIP </Text>,
      dataIndex: "serviceCost",
      key: "serviceCost",
      render: (text) => <p style={{ textAlign: 'center' }}>${decodeURIComponent(text)}</p>,
    },
  ];

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

  const DescTitle = ({ text }) => {
    return <Text className="text-primaryC text-[13px] whitespace-pre">{text}</Text>;
  };

  const onTabChange = (tab) => {
    if (tab === "1") {
      if (isServiceSelected) setIsServiceSelected(false)
    }
  }

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
          const inventoryBody = {
            productAddress: membershipDetails.productId,
            quantity: formik.values.quantity,
            pricePerUnit: formik.values.price,
            // Generate random code for now
            batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
            // Status should always be published if we use List Now
            status: INVENTORY_STATUS.PUBLISHED,
            serialNumber: [],
          };
          const resalePayload = {
            // itemAddress: id,
            productAddress: membershipDetails.productId,
            inventory: inventoryId,
            updates: {
              pricePerUnit: formik.values.price,
              status: INVENTORY_STATUS.PUBLISHED,
              quantity: formik.values.quantity
            }
          }
          const createInventory = await actions.createInventory(
            dispatch,
            inventoryBody
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

  const StatusValue = {
    1: "Listed",
    2: "Not Listed"
  }

  const DetailTabCard = () => {
    return (
      <>
        <Text className="leading-6 text-lg block font-semibold pb-3"> Information </Text>
        <Col xl={{ span: 14 }} className="border-grey shadow-lg leading-2 w-full rounded-md p-4 " style={{ height: 'auto', display: 'inline-block' }}>
          <Paragraph >
            <Text disabled className="font-bold font-poppin" >Seller</Text>
            <Text strong className="float-right">{details?.ownerOrganization ?? "--"}</Text>
          </Paragraph>
          <Paragraph >
            <Text disabled className="font-bold font-poppin" >Sub-Category</Text>
            <Text strong className="float-right">{details?.subCategory ?? "--"}</Text>
          </Paragraph>
          <Paragraph >
            <Text disabled className="font-bold font-poppin" >Time in Months</Text>
            <Text strong className="float-right">{membershipDetails?.timePeriodInMonths ?? "--"} &nbsp; Month(s)</Text>
          </Paragraph>
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
            {serviceList.map(({ serviceName, serviceCost }, index) => {
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
      {details === null || (true &&
        isLoading) ? (
        <div className="h-screen flex justify-center mx-auto items-center">
          <Spin spinning={isLoading} size="large" />
        </div>
      ) : (
        <div>
          <BreadCrumbComponent name={details?.name} />

          {/* style={{border:"1px solid blue"}} */}
          <Row justify={'space-betweem'} className="max-w-4xl mx-auto mt-10 h-92" >
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
                <Text className="text-2xl leading-8 font-semibold font-poppin"> {decodeURIComponent(details?.name ?? "--")} </Text>
                <Row className="mb-1"> {watchIcon()} <Text className="ml-2 font-medium text-dark-grey font-poppin text-sm"> {membershipDetails?.timePeriodInMonths ?? ""} -month duration </Text> </Row>
                <Row className="flex justify-between h-20 mt-8">
                  <Col span={11} className="border border-grayLight rounded-md p-2 h-full">
                    <Text className="block text-center text-grey text-base font-poppin font-normal" > Status </Text>
                    <Text className="block text-center text-xl font-bold mt-2" > {StatusValue[details?.status] ?? "--"} </Text>
                  </Col>
                  <Col span={11} className="border border-grayLight rounded-md p-2 h-full">
                    <Text className="block text-center text-grey text-base font-poppin font-normal" > Total Savings </Text>
                    <Text className="block text-center text-xl font-bold mt-2 leading-6" style={{ color: "green" }} > $ {totalSavings}  </Text>
                  </Col>
                </Row>
                <Row>
                  <Row className="w-full absolute mr-5 left-0 mt-6" style={{ borderBottom: "1px solid #d3d3d3" }}></Row>
                  <Col span={24} className="border-t-1 h-20 mt-8">
                    {details?.availableQuantity != 0
                      ? <Row className="flex justify-between h-10 mt-5">
                        <Col span={4} className="rounded-md h-14" >  <Button className="h-full text-center p-6 add-sub-btn " onClick={subtract}>
                          {minusIcon()}
                        </Button> </Col>
                        <Col span={16} className="border border-grayLight rounded-md align-middle text-center h-14 py-2" >
                          <Text className="font-poppin font-normal text-base text-grey">Quantity </Text> &nbsp; <Text className="text-2xl font-bold leading-8 pt-2">{qty}</Text>
                        </Col>
                        <Col span={4} className="rounded-md h-14" > <Button className="h-full text-center p-6 float-right add-sub-btn" onClick={add}> {plusIcon()} </Button>  </Col>
                      </Row>
                      : <Paragraph style={{ color: 'red' }} className="mt-5 text-sm decoration-red-700" id="prod-price">
                        If you are interested in purchasing this item, please contact our sales team at sales@blockapps.net
                      </Paragraph>}
                  </Col>
                </Row>
              </Card>
              <Row className="h-14 mt-4">
                {details?.availableQuantity == 0 ?
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
                  <Button
                    type={ownerSameAsUser ? "default" : "primary"}
                    block={true} size="large" className=" h-full py-4 h-px-56"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        window.location.href = loginUrl;
                      } else {
                        formik.setFieldValue("name", details?.name);
                        openListNowModal();
                      }
                    }}
                    disabled={ownerSameAsUser}
                  > <Text className={`text-lg font-poppin ${ownerSameAsUser ? "font-bold" : "text-white"}`}>Sale </Text>
                  </Button>}
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
                {decodeURIComponent(details?.description).replace(/%0A/g, "\n").split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line ?? "--"}
                    <br />
                  </React.Fragment>
                ))}
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






















          {/* <div className="flex mx-16 mt-100">
            <div className="w-1/2">

              <div className="items-center justify-center border border-grayLight">
                {allProductFiles && allProductFiles.length > 0 ? (
                  <Carousel>
                    {allProductFiles.map((file, index) =>
                      <div key={index} className="h-96">
                        <Image
                          height={"100%"}
                          width={"100%"}
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
                    style={{ objectFit: "contain" }}
                    src={null}
                  />
                )}
              </div>
              {details?.availableQuantity !== 0 ?
                <Row className="justify-center my-7">
                  <Button
                    type="primary"
                    className="w-1/3 h-9 ml-6 bg-primary !hover:bg-primaryHover"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        window.location.href = loginUrl;
                      } else {
                        formik.setFieldValue("name", details?.name);
                        openListNowModal();
                      }
                    }}
                    disabled={ownerSameAsUser}
                    id="buyNow"
                  >
                    Sell
                  </Button>
                </Row>
                :
                <div className="flex justify-center">
                  <Button
                    type="primary"
                    className="w-40 h-9 m-3 mt-10 bg-primary !hover:bg-primaryHover"
                    href={`mailto:sales@blockapps.net`}>
                    Contact to Buy
                  </Button>
                </div>
              }
            </div>

            <div className="w-1/2 ml-8  mb-6" id="details">
              <Row className="items-center">
                <Text className="font-semibold text-xl text-primaryB">
                  {decodeURIComponent(details?.name)}&nbsp;
                </Text>
                <Text className="font-medium text-sm text-secondryB ">
                  ({membershipDetails?.timePeriodInMonths ?? ""})-month Duration
                </Text>
              </Row>
              <Paragraph
                // ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
                className="text-primaryC text-[13px] mt-2"
              >
                {decodeURIComponent(details?.description ?? "").replace(/%0A/g, "\n").split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line}
                    <br />
                  </React.Fragment>
                ))}
              </Paragraph>
              <Title level={4} className="!mt-0">
                {details?.pricePerUnit ? `$ ${details.pricePerUnit}` : "Not Listed"}
              </Title>
              <Title level={4} className="!mt-0" style={{ color: 'green' }}>
                {`Total Savings: $ ${totalSavings}`}
              </Title>
              {details?.availableQuantity !== 0 ?
                <Space>
                  <Text className="text-primaryB text-base">Quantity</Text>
                  <div className="flex items-center my-2 ml-5" id="quantity">
                    <div
                      onClick={subtract}
                      className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                      <MinusOutlined className="text-xs text-secondryD" />
                    </div>
                    <InputNumber className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center" min={1} max={details?.availableQuantity} value={qty} defaultValue={qty} controls={false}
                      onChange={e => {
                        if (e < details?.availableQuantity) {
                          setQty(e)
                        } else {
                          openToast(
                            "bottom",
                            true,
                            "Cannot add more than available quantity"
                          );
                          setQty(details?.availableQuantity)
                        }
                      }} />
                    <div
                      onClick={add}
                      className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                      <PlusOutlined className="text-xs text-secondryC" />
                    </div>
                  </div>
                </Space>
                :
                <Paragraph style={{ color: 'red', fontSize: 14 }} className="!mt-0" id="prod-price">
                  If you are interested in purchasing this item, please contact our sales team at sales@blockapps.net
                </Paragraph>
              }
              <Tabs
                defaultActiveKey="1"
                onChange={onTabChange}
                items={!user ?
                  [{
                    label: `Description`,
                    key: "1",
                    children: <DescriptionComponent />,
                  }]
                  :
                  [{
                    label: `Description`,
                    key: "1",
                    children: <DescriptionComponent />,
                  },
                  {
                    label: `Services`,
                    key: "2",
                    children: (
                      <div>
                        <h1 className="text-primaryB text-base" style={{ marginBottom: '10px' }}>Services</h1>
                        <DataTableComponent
                          columns={serviceColumn}
                          data={serviceList}
                          scrollX="100%"
                          isLoading={isMembershipLoading}
                        />
                        <h1 className="text-primaryB text-base" style={{ marginBottom: '10px' }}>Savings</h1>
                        <DataTableComponent
                          columns={savingsColumn}
                          data={savingsList}
                          scrollX="100%"
                          isLoading={isMembershipLoading}
                        />
                      </div>
                    ),
                  }
                  ]}
              />
            </div>
          </div> */}
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
          type="Sale"
          id={Id}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}
    </>
  );
};

export default MembershipDetails;