import React, { useState, useEffect } from "react";
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


const MembershipDetails = ({ user, users, inventoryId }) => {
  const { state, pathname } = useLocation();

  let isCalledFromMembership = false;

  if (state !== null && state !== undefined) {
    isCalledFromMembership = state.isCalledFromMembership
  }
  else if (pathname.includes("memberships")) {
    isCalledFromMembership = true
  }

  const [serviceList, setServiceList] = useState([])
  const [savingsList, setSavingsList] = useState([])
  const [totalSavings, setTotalSavings] = useState(0)
  const [Id, setId] = useState(undefined);
  const [isServiceSelected, setIsServiceSelected] = useState(false);
  const [membershipDetails, setMembershipDetails] = useState(undefined);
  const [allProductFiles, setAllProductFiles] = useState(undefined);
  const limit = 10, offset = 0;
  const debouncedSearchTerm = useDebounce("", 1000);
  const { membershipServices, membership, isMembershipLoading, productFiles} =
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
    membershipServices.forEach(element => {
      services.push({ "key": element.serviceName, "serviceName": element.serviceName, "serviceDesc": element.serviceDescription, "memberPrice": element.membershipPrice, "nonMemberPrice": element.servicePrice, "uses": element.maxQuantity},)
      savings.push({ "key": element.serviceName, "serviceName": element.serviceName, "serviceCost": element.savings},)
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
  
  

  const { Text, Paragraph, Title } = Typography;
  const [qty, setQty] = useState(1);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { inventoryDetails, inventories, isInventoryDetailsLoading } = useInventoryState();
  const productDispatch = useProductDispatch();
  const {productDetails} = useProductState();
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
    if (Id !== undefined && inventoryId) {
      actions.fetchInventoryDetail(dispatch, inventoryId);
    }
    else if (Id !== undefined && membershipDetails) {
      productActions.fetchProductDetails(productDispatch, membershipDetails?.productId, null);
    }
  }, [Id, dispatch, productDispatch, user, membershipDetails, inventoryId]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  let details = undefined;
  if(inventoryId && inventoryDetails){
    details = inventoryDetails;
  }
  else if(!inventoryId && productDetails) {
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

  const ownerSameAsUser = () => {

    if (user && user.organization !== inventories?.ownerOrganization) {
      return true;
    }

    return false;
  }

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
      title: <Text className="text-primaryC text-[13px]">EFFECTIVE COST SAVING FROM MEMBERMSHIP </Text>,
      dataIndex: "serviceCost",
      key: "serviceCost",
      render: (text) => <p style={{ textAlign: 'center'}}>${decodeURIComponent(text)}</p>,
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
      render: (text) => <p style={{ textAlign: 'center'}}>${decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">NON-MEMBER PRICE</Text>,
      dataIndex: "nonMemberPrice",
      key: "nonMemberPrice",
      render: (text) => <p style={{ textAlign: 'center'}}>${decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">USES</Text>,
      dataIndex: "uses",
      key: "uses",
      render: (text) => <p style={{ textAlign: 'center'}}>{decodeURIComponent(text)}</p>,
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
          <Text className="text-[13px]">{details?.ownerCommonName}</Text>
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

  return (
    <>
      {contextHolder}
      {details === null ||
        isInventoryDetailsLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isInventoryDetailsLoading} size="large" />
        </div>
      ) : (
        <div>
          <Row>
            <Breadcrumb className="text-xs mt-14 mb-8 ml-16">
              <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                <ClickableCell href={routes.Marketplace.url}>
                  <p
                    className="text-primaryB hover:bg-transparent"
                  >
                    Home
                  </p>
                </ClickableCell>
              </Breadcrumb.Item>
              {
                isCalledFromMembership ?
                  <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                    <ClickableCell href={routes.Inventories.url}>
                      <p
                        className="text-primaryB hover:bg-transparent"
                      >
                        Inventory
                      </p>
                    </ClickableCell>
                  </Breadcrumb.Item> : null
              }
              <Breadcrumb.Item className="text-primary">
                {decodeURIComponent(details?.name)}
              </Breadcrumb.Item>
            </Breadcrumb>
          </Row>

          <div className="flex mx-16">
            <div className="w-1/2">
              <div className="h-96 flex items-center justify-center border border-grayLight">
                {/* TODO: figure out how to show multiple images */}
                {/* {allProductFiles && allProductFiles.length > 0 ? (
                <Carousel>
                  {allProductFiles.map((file, index) => (
                      <Image
                        key={index}
                        height={"100%"}
                        width={"100%"}
                        style={{ objectFit: "contain" }}
                        src={file.imageUrl}
                      />
                  ))}
                </Carousel>
                ) : (
                  <Image
                        height={"100%"}
                        width={"100%"}
                        style={{ objectFit: "contain" }}
                        src={null}
                      />
                )} */}
                
                <Image height={"100%"} width={"100%"} style={{ objectFit: "contain" }} src={allProductFiles !== undefined ? (allProductFiles[0] ? allProductFiles[0].imageUrl : null) : null} />
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
                        addItemToCart();
                        navigate("/checkout");
                      }
                    }}
                    disabled={ownerSameAsUser()}
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
                {details?.pricePerUnit ? `$ ${details.pricePerUnit}` : "not listed"}
              </Title>
              <Title level={4} className="!mt-0">
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
                <Paragraph style={{color:'red', fontSize:14}} className="!mt-0" id="prod-price">
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
          </div>
        </div>
      )}
    </>
  );
};

export default MembershipDetails;