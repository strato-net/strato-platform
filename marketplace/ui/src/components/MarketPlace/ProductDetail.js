import React, { useState, useEffect } from "react";
import {
  Row,
  Card,
  Breadcrumb,
  Image,
  Button,
  Typography,
  Tabs,
  Space,
  Divider,
  Col,
  Spin,
  notification,
  InputNumber,
} from "antd";
import { MinusOutlined, PlusOutlined, EyeOutlined } from "@ant-design/icons";
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import routes from "../../helpers/routes";
import { UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
//categories
import { actions as categoryActions } from "../../contexts/category/actions";
import { actions as marketPlaceActions } from "../../contexts/marketplace/actions";
import { actions as serviceActions } from "../../contexts/service/actions";
import {
  useServiceDispatch,
  useServiceState,
} from "../../contexts/service";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useNavigate, useLocation } from "react-router-dom";
import { actions as itemsActions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { epochToDate } from "../../helpers/utils";
import DataTableComponent from "../DataTableComponent";
import useDebounce from "../UseDebounce";
import NestedComponent from "./NestedComponent";
import ClickableCell from "../ClickableCell";
import "./index.css";
import { useAuthenticateState } from "../../contexts/authentication";


const ProductDetails = ({ user, users }) => {
  const { state, pathname } = useLocation();

  let isCalledFromInventory = false;

  if (state !== null && state !== undefined) {
    isCalledFromInventory = state.isCalledFromInventory
  }
  else if (pathname.includes("inventories")) {
    isCalledFromInventory = true
  }

  const [serviceList, setServiceList] = useState([])
  const [Id, setId] = useState(undefined);
  const [isServiceSelected, setIsServiceSelected] = useState(false);
  const limit = 10, offset = 0;
  const debouncedSearchTerm = useDebounce("", 1000);
  const { inventoryServices, isInventoryServicesLoading } =
  useServiceState();
const serviceDispatch = useServiceDispatch();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  
  useEffect(() => {
    if (user) {
      if (Id !== undefined) {
        serviceActions.fetchServiceOfInventory(serviceDispatch, limit, offset, debouncedSearchTerm, Id);
      }
    }
  }, [limit, offset, debouncedSearchTerm, serviceDispatch, Id, user])
  
  useEffect(() => {
    let services = [];
    inventoryServices.forEach(element => {
      services.push({ "key": element.name, "serviceName": element, "serviceDesc": element.description, "memberPrice": element.memberPrice, "nonMemberPrice": element.nonMemberPrice, "uses": element.uses},)
    });
    setServiceList(services);
  }, [inventoryServices])

  const { Text, Paragraph, Title } = Typography;
  const [qty, setQty] = useState(1);
  const dispatch = useInventoryDispatch();
  const itemDispatch = useItemDispatch();
  const categoryDispatch = useCategoryDispatch();
  const [categoryName, setCategoryName] = useState("");
  const [api, contextHolder] = notification.useNotification();
  const { categorys, iscategorysLoading } = useCategoryState();
  const { inventoryDetails, isInventoryDetailsLoading } = useInventoryState();
  const marketplaceDispatch = useMarketplaceDispatch();
  const { cartList } = useMarketplaceState();
  const navigate = useNavigate();
  const {
    serialNumbers,
    isSerialNumbersLoading,
    isRawMaterialsLoading
  } = useItemState();

  const routeMatch = useMatch({
    path: routes.MarketplaceProductDetail.url,
    strict: true,
  });

  const routeMatch1 = useMatch({
    path: routes.InventoryDetail.url,
    strict: true,
  });

  useEffect(() => {
    if (isCalledFromInventory) setId(routeMatch1?.params?.id);
    else setId(routeMatch?.params?.address);
  }, [routeMatch, routeMatch1]);

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchInventoryDetail(dispatch, Id);
      if (user) {
        itemsActions.fetchSerialNumbers(itemDispatch, Id);
      }
    }
  }, [Id, dispatch, itemDispatch, user]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const details = inventoryDetails;

  useEffect(() => {
    if (categorys.length && details) {
      const prodCategory = categorys.find(
        (c) => c.name === details.category
      );
      setCategoryName(prodCategory?.name);
    }
  }, [categorys, details]);

  const subtract = () => {
    if (qty !== 1) {
      let value = qty - 1;
      setQty(value);
    }
  };

  const add = () => {
    if (qty < details.availableQuantity) {
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

    if (user && user.organization !== inventoryDetails?.ownerOrganization) {
      return true;
    }

    return false;
  }

  const addItemToCart = () => {
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === details.address) {
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
        if (element.product.address === details.address) {
          if (items[index].qty + qty <= details.availableQuantity) {
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
      title: <Text className="text-primaryC text-[13px]">NAME</Text>,
      dataIndex: "serviceName",
      key: "name",
      render: (text) => <p>{decodeURIComponent(text.name)}</p>
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
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">NON-MEMBER PRICE</Text>,
      dataIndex: "nonMemberPrice",
      key: "nonMemberPrice",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">USES</Text>,
      dataIndex: "uses",
      key: "uses",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
  ];

  const DescTitle = ({ text }) => {
    return <Text className="text-primaryC text-[13px] whitespace-pre">{text}</Text>;
  };

  const DescriptionComponent = () => {
    return (
      <Space direction="vertical">
        <Space>
          <DescTitle text="Product Id" />
          <DescTitle text="                      :" />
          <Text className="text-[13px]">{details.uniqueProductCode}</Text>
        </Space>

        <Space>
          <DescTitle text="Unique Product Code" />
          <DescTitle text=" :" />
          <Text className="text-[13px]">{details.userUniqueProductCode ? details.userUniqueProductCode : " "}</Text>
        </Space>
        <Space>
          <DescTitle text="Manufacturer" />
          <DescTitle text="                :" />
          <Text className="text-[13px]">{decodeURIComponent(details.manufacturer)}</Text>
        </Space>

        <Space>
          <DescTitle text="Unit of Measurement" />
          <DescTitle text=" :" />
          <Text className="text-[13px]">
            {UNIT_OF_MEASUREMENTS[details.unitOfMeasurement]}
          </Text>
        </Space>

        <Space>
          <DescTitle text="Least Sellable Unit" />
          <DescTitle text="       :" />
          <Text className="text-[13px]">{details.leastSellableUnit}</Text>
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
        isInventoryDetailsLoading ||
        iscategorysLoading ||
        isSerialNumbersLoading ? (
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
                isCalledFromInventory ?
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
                {decodeURIComponent(details.name)}
              </Breadcrumb.Item>
            </Breadcrumb>
          </Row>

          <div className="flex mx-16">
            <div className="w-1/2">
              <div className="h-96 flex items-center justify-center border border-grayLight">
                <Image height={"100%"} width={"100%"} style={{ objectFit: "contain" }} src={details.imageUrl} />
              </div>
              {details.availableQuantity !== 0 ?
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
                  {decodeURIComponent(details.name)}&nbsp;
                </Text>
                <Text className="font-medium text-sm text-secondryB ">
                  ({categoryName})
                </Text>
              </Row>
              <Paragraph
                // ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
                className="text-primaryC text-[13px] mt-2"
              >
                {decodeURIComponent(details.description).replace(/%0A/g, "\n").split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line}
                    <br />
                  </React.Fragment>
                ))}
              </Paragraph>
              <Title level={4} className="!mt-0">
                $ {details.pricePerUnit}
              </Title>
              {details.availableQuantity !== 0 ?
                <Space>
                  <Text className="text-primaryB text-base">Quantity</Text>
                  <div className="flex items-center my-2 ml-5" id="quantity">
                    <div
                      onClick={subtract}
                      className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                      <MinusOutlined className="text-xs text-secondryD" />
                    </div>
                    <InputNumber className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center" min={1} max={details.availableQuantity} value={qty} defaultValue={qty} controls={false}
                      onChange={e => {
                        if (e < details.availableQuantity) {
                          setQty(e)
                        } else {
                          openToast(
                            "bottom",
                            true,
                            "Cannot add more than available quantity"
                          );
                          setQty(details.availableQuantity)
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
                      <DataTableComponent
                        columns={serviceColumn}
                        data={serviceList}
                        scrollX="100%"
                        isLoading={isInventoryServicesLoading}
                      />
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

export default ProductDetails;