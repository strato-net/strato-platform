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
  Carousel,
  Col,
  Card,
  Table,
} from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/inventory/actions";
import { actions as productActions } from "../../contexts/product/actions";
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
import { watchIcon } from "../../images/SVGComponents";

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
    quantity: ""
  };
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
  const { inventoryDetails, inventories, isInventoryDetailsLoading,isInventoriesLoading, inventory, isCreateInventorySubmitting } = useInventoryState();
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
      title: <Text className="text-primaryC text-[13px]">NAME</Text>,
      dataIndex: "serviceName",
      key: "name",
      render: (text) => <p>{decodeURIComponent(text)}</p>
    },
    {
      title: <Text className="text-primaryC text-[13px]">DESCRIPTION</Text>,
      dataIndex: "serviceDesc",
      key: "serviceDesc",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">MEMBER PRICE</Text>,
      dataIndex: "memberPrice",
      key: "memberPrice",
      render: (text) => <p style={{ textAlign: 'center' }}>${decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">NON-MEMBER PRICE</Text>,
      dataIndex: "nonMemberPrice",
      key: "nonMemberPrice",
      render: (text) => <p style={{ textAlign: 'center' }}>${decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">USES</Text>,
      dataIndex: "uses",
      key: "uses",
      render: (text) => <p style={{ textAlign: 'center' }}>{decodeURIComponent(text)}</p>,
    },
  ];

  const DescTitle = ({ text }) => {
    return <Text className="text-primaryC text-[13px] whitespace-pre">{text}</Text>;
  };

  const DescriptionComponent = () => {
    return (
      <Space direction="vertical">
        <Space>
          <DescTitle text="Seller" />
          <DescTitle text="                                :" />
          <Text className="text-[13px]">{details?.ownerOrganization}</Text>
        </Space>

        <Space>
          <DescTitle text="Sub-Category" />
          <DescTitle text="                :" />
          <Text className="text-[13px]">{details?.subCategory}</Text>
        </Space>
        <Space>
          <DescTitle text="Time in Months" />
          <DescTitle text="            :" />
          <Text className="text-[13px]">{membershipDetails?.timePeriodInMonths ?? ""}</Text>
        </Space>

        <Space>
          <DescTitle text="Additional Info" />
          <DescTitle text="              :" />
          <Text className="text-[13px]">
            {membershipDetails?.additionalInfo ?? ""}
          </Text>
        </Space>
      </Space>
    );
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

  const DetailTabCard = () => {
    return (
      <Col sm={12} lg={{ span: 12 }} xl={{ span: 14, offset: 1 }} xxl={{ span: 17 }} className="border-grey shadow-lg leading-2 min-h-min rounded p-2 ">

        <Paragraph >
          <Text disabled className="font-bold" >Seller</Text>
          <Text strong className="float-right">{details?.ownerOrganization}</Text>
        </Paragraph>
        <Paragraph >
          <Text disabled className="font-bold" >Sub-Category</Text>
          <Text strong className="float-right">{details?.subCategory}</Text>
        </Paragraph>
        <Paragraph >
          <Text disabled className="font-bold" >Time in Months</Text>
          <Text strong className="float-right">{membershipDetails?.timePeriodInMonths ?? "--"} &nbsp; Month(s)</Text>
        </Paragraph>
        <Paragraph >
          <Text disabled className="font-bold" >Additional Info</Text>
          <Text strong type="success" className="float-right">{membershipDetails?.additionalInfo ?? "--"}</Text>
        </Paragraph>
        {/* {true && <Paragraph>
          <Text disabled className="font-bold" >Membership ID</Text>
          <Text strong className="float-right">membershipId</Text>
        </Paragraph>} */}
      </Col>
    )
  }

  const ServiceTabCard = () => {
    return (
      <Row>
        <Title level={4} className="mt-5">Services</Title>
        <Col span={24}>
          <DataTableComponent
            columns={serviceColumn}
            data={serviceList}
            scrollX="100%"
            isLoading={isMembershipLoading}
            pagination={false}
          />
        </Col>
        <Title level={4} className="mt-10">Savings</Title>
        <hr style={{ color: "grey" }} />
        <Col span={24} className="mt-10">
          <Col span={8} className="">
            <Card className="shadow-md">
              <Row className="mt-2">
                <Col span={24}><Text className="block text-grey">Name</Text></Col>
                <Col span={24}><Text className="block" strong>Name</Text></Col>
              </Row>
              <Row className="mt-2">
                <Col span={24}><Text className="block text-grey">Effective Cost Saving</Text></Col>
                <Col span={24}><Text className="block" style={{ color: 'green' }} strong>Name</Text></Col>
              </Row>
            </Card>
          </Col>
        </Col>
      </Row>

    )
  }


  return (
    <>
      {contextHolder}
      {details === null ||
        isLoading ? (
        <div className="h-screen flex justify-center mx-auto items-center">
          <Spin spinning={isLoading} size="large" />
        </div>
      ) : (
        <div>
          <Row className="mx-16 h-20">
            <Col span={24} className="mt-10" >
              <Breadcrumb>
                <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                  <ClickableCell href={routes.Marketplace.url}>
                    <Text className="text-primary text-md font-bold" underline>
                      Home
                    </Text>
                  </ClickableCell>
                </Breadcrumb.Item>
                {isCalledFromMembership &&
                  <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                    <ClickableCell href={routes.Inventories.url}>
                      <Text className="text-primary text-md text-grey font-bold" underline>
                        Inventory
                      </Text>
                    </ClickableCell>
                  </Breadcrumb.Item>}
                <Breadcrumb.Item className="text-grey">
                  {decodeURIComponent(details?.name)}
                </Breadcrumb.Item>
              </Breadcrumb>
            </Col>
          </Row>

          {/* style={{border:"1px solid blue"}} */}
          <Row className="max-w-4xl mx-auto mt-10">
            <Col span={10} className="rounded-md" style={{ border: "1px solid #181EAC" }}>
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
            </Col>


            <Col span={14} className="px-2 h-full bg-red">
              <Card className="h-80">
                <Title level={3}> {decodeURIComponent(details?.name)} </Title>
                <Row className="mb-1"> {watchIcon()} <Text className="ml-2"> {membershipDetails?.timePeriodInMonths ?? ""} -month duration </Text> </Row>
                <Row className="flex justify-between h-20 mt-8">
                  <Col span={11} className="border border-grayLight rounded-md p-2 h-full">
                    <Text className="block text-center text-grey font-medium" > Status </Text>
                    <Text className="block text-center text-xl font-bold mt-2" > Not Listed </Text>
                  </Col>
                  <Col span={11} className="border border-grayLight rounded-md p-2 h-full">
                    <Text className="block text-center text-grey font-medium" > Total Savings </Text>
                    <Text className="block text-center text-xl font-bold mt-2" style={{ color: "green" }} > ${totalSavings}  </Text>
                  </Col>
                </Row>
                <Row>
                  <Row className="w-full absolute mr-5 left-0 mt-6" style={{ borderBottom: "1px solid #d3d3d3" }}></Row>
                  <Col span={24} className="border-t-1  h-20 mt-8">
                    <Row className="flex justify-between h-10 mt-5">
                      <Col span={4} className="rounded-md " >  <Button className="h-full text-center text-black" onClick={subtract}> <MinusOutlined /></Button> </Col>
                      <Col span={16} className="border border-grayLight rounded-md text-center h-10 pt-2" > Quantity &nbsp; <Text style={{ fontWeight: 900 }}>{qty}</Text> </Col>
                      <Col span={4} className="rounded-md " > <Button className="h-full text-center float-right" onClick={add}> <PlusOutlined /> </Button>  </Col>
                    </Row>
                  </Col>
                </Row>
              </Card>
              <Row className="h-14 mt-4">
                <Button type={ownerSameAsUser ? "default" : "primary"} block={true} size="large" className="font-black h-full"
                  onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      formik.setFieldValue("name", details?.name);
                      openListNowModal();
                    }
                  }}
                  disabled={ownerSameAsUser}
                > Sale </Button>
              </Row>
            </Col>

          </Row>

          <Row className="max-w-4xl mx-auto mt-10">
            <Card className="w-full">
              <Title level={3}> Description  </Title>
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
            </Card>
          </Row>

          <Row className="max-w-4xl mx-auto mt-10">
            <Card className="w-full card-shadow-2">
              <Tabs defaultActiveKey="1" items={[{
                key: '1',
                label: 'Details',
                children: DetailTabCard(),
              },
              {
                key: '2',
                label: 'Services',
                children: ServiceTabCard(),
              },]} />
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
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}
    </>
  );
};

export default MembershipDetails;