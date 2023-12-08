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
import { actions as eventActions } from "../../contexts/event/actions";
import {
  useEventDispatch,
  useEventState,
} from "../../contexts/event";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useNavigate, useLocation } from "react-router-dom";
//Items - ownership history
import { actions as itemsActions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { epochToDate } from "../../helpers/utils";
import DataTableComponent from "../DataTableComponent";
import useDebounce from "../UseDebounce";
import NestedComponent from "./NestedComponent";
import ClickableCell from "../ClickableCell";
import "./index.css";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";
import { setCookie } from "../../helpers/cookie";
import image_placeholder from "../../images/resources/image_placeholder.png";


const ProductDetails = ({ user, users }) => {
  const { state, pathname } = useLocation();

  let isCalledFromInventory = false;

  if (state !== null && state !== undefined) {
    isCalledFromInventory = state.isCalledFromInventory
  }
  else if (pathname.includes("inventories")) {
    isCalledFromInventory = true
  }

  const [eventList, setEventList] = useState([])
  const [eventDetailList, setEventDetailList] = useState([])
  const [Id, setId] = useState(undefined);
  const [isEventSelected, setIsEventSelected] = useState(false);
  const [isSerialNumberSelected, setIsSerialNumberSelected] = useState(false);
  const [serialNumber, setSerialNumber] = useState(false);
  const limit = 10, offset = 0;
  const debouncedSearchTerm = useDebounce("", 1000);
  const { inventoryEvents, isInventoryEventsLoading, eventDetails, iseventDetailsLoading } =
    useEventState();
  const eventDispatch = useEventDispatch();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  useEffect(() => {
    // TODO: Uncomment this when we have events working
    // if (user) {
    //   if (Id !== undefined) {
    //     eventActions.fetchEventOfInventory(eventDispatch, limit, offset, debouncedSearchTerm, Id);
    //   }
    // }
  }, [limit, offset, debouncedSearchTerm, eventDispatch, Id, user])


  useEffect(() => {
    let events = [];
    inventoryEvents.forEach(element => {
      events.push({ "key": element.eventTypeName, "eventName": element, "eventDesc": element.eventTypeDescription },)
    });
    setEventList(events);
  }, [inventoryEvents])

  const [isTransformationSelected, setIsTransformationSelected] =
    useState(false);
  const { Text, Paragraph, Title } = Typography;
  const [ itemData, setItemData ] = useState({});
  const [ availableQuantity, setAvailableQuantity ] = useState (1);
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
    ownershipHistory,
    isOwnershipHistoryLoading,
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
      // TODO: Uncomment this when we have serial numbers working
      // if (user) {
      //   itemsActions.fetchSerialNumbers(itemDispatch, Id);
      // }
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
      const detailsData = JSON.parse(details.data);
      setItemData(detailsData);
      if (detailsData.units) {
        setAvailableQuantity(detailsData.units);
      }
    }
  }, [categorys, details]);

  const subtract = () => {
    if (qty !== 1) {
      let value = qty - 1;
      setQty(value);
    }
  };

  const add = () => {
    if (qty < availableQuantity) {
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

  useEffect(() => {
    let temp = [];
    if (eventDetails != null) {
      temp = eventDetails.events.map(elem => {
        return {
          ...elem,
          key: elem.eventBatchId,
          date: epochToDate(elem['date']),
          summary: elem['summary'],
          certifier: elem['certifierName'],
          certifiedDate: elem['certifiedDate'] ? epochToDate(elem['certifiedDate']) : '',
        }
      });
    }
    setEventDetailList(temp);
  }, [eventDetails])

  const ownerSameAsUser = () => {

    if (user?.commonName === inventoryDetails?.ownerCommonName) {
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
          if (items[index].qty + qty <= availableQuantity) {
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

  const eventColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">NAME</Text>,
      dataIndex: "eventName",
      key: "eventName",
      render: (text) => (
        <Button
          type="link"
          className="text-primary text-[17px] whitespace-normal text-left"
          onClick={() => {
            if (isEventSelected) {
              if (text.eventTypeId === eventDetailList[0].eventTypeId) {
                setIsEventSelected(false);
                return;
              }
            }
            setIsEventSelected(true);
            eventActions.fetchEventDetails(eventDispatch, Id, text.eventTypeId)
          }}
        >
          {decodeURIComponent(text.eventTypeName)}
        </Button>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">DESCRIPTION</Text>,
      dataIndex: "eventDesc",
      key: "eventDesc",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
  ];

  const ownershipColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
      dataIndex: "serialNumber",
      // Fixes UI issue of children having the same key
      key: serialNumbers[0] === "" ? "itemNumber" : "serialNumber",
      align: "center",
      onCell: (record) => {
        return {
          onClick: (ev) => {
            setIsSerialNumberSelected(true);
            setSerialNumber(record.serialNumber);
            itemsActions.fetchItemOwnershipHistory(
              itemDispatch,
              record.address
            );
          },
        };
      },
      render: (serialNumber) => (
        <Button type="link" className="text-primary text-[17px]">
          {serialNumber}
        </Button>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">ITEM NUMBER</Text>,
      dataIndex: "itemNumber",
      key: "itemNumber",
      align: "center",
      onCell: (record, rowIndex) => {
        return {
          onClick: (ev) => {
            setIsSerialNumberSelected(true);
            if (isEventSelected) setIsEventSelected(false);
            setSerialNumber(record.serialNumber);
            itemsActions.fetchItemOwnershipHistory(
              itemDispatch,
              record.address
            );
          },
        };
      },
      render: (serialNumber) => (
        <Button type="link" className="text-primary text-[17px]">
          {serialNumber}
        </Button>
      ),
    },
  ];

  const eventDetailColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">DATE</Text>,
      dataIndex: "date",
      key: "date",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">SUMMARY</Text>,
      dataIndex: "summary",
      key: "summary",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">CERTIFIED BY</Text>,
      dataIndex: "certifier",
      key: "certifier",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">CERTIFIED DATE</Text>,
      dataIndex: "certifiedDate",
      key: "certifiedDate",
      render: (text) => <p>{text}</p>,
    },

    {
      title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
      dataIndex: "serialNo",
      key: "serialNo",
      render: (text) => (
        <div className="group flex items-center cursor-pointer" onClick={() => passSerialNumber(text, eventDetails.eventTypeName)}>
          <EyeOutlined className="mr-2 group-hover:text-primary" />
          <p className="group-hover:text-primary">View</p>
        </div>
      ),
    },
  ];

  const passSerialNumber = (serialNumbers, eventTypeName) => {
    navigate(routes.EventSerialNumberList.url,
      { state: { serialNumbers: serialNumbers, eventTypeName: eventTypeName } });
  }

  const ownershipDetailColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">SELLER</Text>,
      dataIndex: "seller",
      key: "seller",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">OWNER</Text>,
      dataIndex: "newOwner",
      key: "newOwner",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">
          OWNERSHIP START DATE
        </Text>
      ),
      dataIndex: "ownershipStartDate",
      key: "ownershipStartDate",
      align: "center",
      render: (epoch) => <p>{epochToDate(epoch)}</p>,
    },
  ];

  const DescTitle = ({ text }) => {
    return <Text className="text-primaryC text-[13px] whitespace-pre">{text}</Text>;
  };

  const getCategory = (data) => {
    const parts = data.contract_name.split('-');
    return parts[parts.length - 1];
  };

  const DescriptionComponent = () => {
    const categoryName = getCategory(details);

    switch (categoryName) {
      case "Art":
        return (
          <Space direction="vertical">
            <Space>
              <DescTitle text="Artist" />
              <DescTitle text="                      :" />
              <Text className="text-[13px]">{itemData?.artist}</Text>
            </Space>
          </Space>)
      case "Carbon":
        return (
          <Space direction="vertical">
            {/* <Space>
              <DescTitle text="Project Type" />
              <DescTitle text="                      :" />
              <Text className="text-[13px]">{itemData?.projectType}</Text>
            </Space> */}
            <Space>
              <DescTitle text="Units" />
              <DescTitle text="                      :" />
              <Text className="text-[13px]">{availableQuantity}</Text>
            </Space>
          </Space>)
      case "Clothing":
        return (
          <Space direction="vertical">
            <Space>
              <DescTitle text="Brand" />
              <DescTitle text="                      :" />
              <Text className="text-[13px]">{itemData?.brand}</Text>
            </Space>
          </Space>)
      case "Metals":
        return (
          <Space direction="vertical">
            <Space>
              <DescTitle text="Source" />
              <DescTitle text="                      :" />
              <Text className="text-[13px]">{itemData?.source}</Text>
            </Space>
          </Space>)
      default:
        break;
    }
  };

  const EventDetailsComponent = ({ title, value, id }) => {
    return (
      <Col id={id}>
        <Text className="block text-primaryC text-xs mb-2">{title}</Text>
        <Text className="block text-primaryB">{value}</Text>
      </Col>
    );
  };

  const onTabChange = (tab) => {
    if (tab === "1") {
      if (isEventSelected) setIsEventSelected(false)
      if (isSerialNumberSelected) setIsSerialNumberSelected(false)
      if (isTransformationSelected) setIsTransformationSelected(false)
    } else if (tab === "2") {
      if (isSerialNumberSelected) setIsSerialNumberSelected(false)
      if (isTransformationSelected) setIsTransformationSelected(false)
    } else if (tab === "3") {
      if (isEventSelected) setIsEventSelected(false)
      if (isTransformationSelected) setIsTransformationSelected(false)
    } else {
      if (isEventSelected) setIsEventSelected(false)
      if (isSerialNumberSelected) setIsSerialNumberSelected(false)
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
              <div className="h-[212px] lg:h-[417px] flex items-center justify-center border border-grayLight">
                <Image height={"100%"} width={"100%"} style={{ objectFit: "contain" }} src={details.images && details.images.length > 0 ? details.images[0] : image_placeholder} />
              </div>
              {availableQuantity !== 0 ?
                <Row className="justify-center my-7">
                  {ownerSameAsUser() ? <Button
                    className="group w-1/3 h-9 border border-primary"
                    disabled={true}
                    id="addToCart"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        setCookie("returnUrl", `/marketplace/productList/${details.address}`, 10);
                        window.location.href = loginUrl;
                      } else {
                        window.LOQ.push(['ready', async LO => {
                          // Track an event
                          await LO.$internal.ready('events')
                          LO.events.track('Add to Cart (from Product Details)', {
                            product: details.name,
                            category: details.category,
                            productId: details.productId
                          })
                        }])
                        TagManager.dataLayer({
                          dataLayer: {
                            event: 'add_to_cart_from_product_details',
                            product_name: details.name,
                            category: details.category,
                            productId: details.productId
                          },
                        });
                        addItemToCart();
                      }
                    }}
                  >
                    Add To Cart
                  </Button> : <Button
                    className="group w-1/3 h-9 border border-primary hover:bg-primary"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        setCookie("returnUrl", `/marketplace/productList/${details.address}`, 10);
                        window.location.href = loginUrl;
                      } else {
                        window.LOQ.push(['ready', async LO => {
                          // Track an event
                          await LO.$internal.ready('events')
                          LO.events.track('Add to Cart (from Product Details)', {
                            product: details.name,
                            category: details.category,
                            productId: details.productId
                          })
                        }])
                        TagManager.dataLayer({
                          dataLayer: {
                            event: 'add_to_cart_from_product_details',
                            product_name: details.name,
                            category: details.category,
                            productId: details.productId
                          },
                        });
                        addItemToCart();
                      }
                    }}
                  >
                    <div className="text-primary group-hover:text-white">
                      Add To Cart
                    </div>
                  </Button>}
                  <Button
                    type="primary"
                    className="w-1/3 h-9 ml-6 bg-primary !hover:bg-primaryHover"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        setCookie("returnUrl", `/marketplace/productList/${details.address}`, 10);
                        window.location.href = loginUrl;
                      } else {
                        window.LOQ.push(['ready', async LO => {
                          // Track an event
                          await LO.$internal.ready('events')
                          LO.events.track('Buy Now (from Product Details)', {
                            product: details.name,
                            category: details.category,
                            productId: details.productId
                          })
                        }])
                        TagManager.dataLayer({
                          dataLayer: {
                            event: 'buy_now_from_product_details',
                            product_name: details.name,
                            category: details.category,
                            productId: details.productId
                          },
                        });
                        addItemToCart();
                        navigate("/checkout");
                      }
                    }}
                    disabled={ownerSameAsUser()}
                    id="buyNow"
                  >
                    Buy Now
                  </Button>
                </Row>
                :
                <div className="flex justify-center">
                  <Button
                    type="primary"
                    className="w-40 h-9 m-3 mt-10 bg-primary !hover:bg-primaryHover"
                    href={`mailto:sales@blockapps.net`}
                    onClick={() => {
                      window.LOQ.push(['ready', async LO => {
                        await LO.$internal.ready('events')
                        LO.events.track('Contact Sales (from Product Details)', {
                          product: details.name,
                          category: details.category,
                          productId: details.productId
                        })
                      }])
                      TagManager.dataLayer({
                        dataLayer: {
                          event: 'contact_sales_from_product_details',
                          product_name: details.name,
                          category: details.category,
                          productId: details.productId
                        },
                      });
                    }}>
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
                  ({getCategory(details)})
                </Text>
              </Row>
              <Paragraph
                // ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
                className="text-primaryC text-[13px] mt-2"
              >
                {decodeURIComponent(details.description).split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line}
                    <br />
                  </React.Fragment>
                ))}
              </Paragraph>
              <Title level={4} className="!mt-0">
                {details.price ? <>$ {details.price}</> : "No Price Available"}
              </Title>
              {availableQuantity !== 0 ?
                <Space>
                  <Text className="text-primaryB text-base">Quantity</Text>
                  <div className="flex items-center my-2 ml-5" id="quantity">
                    <div
                      onClick={subtract}
                      className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer" style={{ borderColor: qty > 1 ? '#1777FF' : '#E3E3E3' }}>
                      <MinusOutlined className="text-xs text-secondryD" style={{ color: qty > 1 ? '#1777FF' : '#E3E3E3' }}/>
                    </div>
                    <InputNumber className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center" min={1} max={availableQuantity} value={qty} defaultValue={qty} controls={false}
                      onChange={e => {
                        if (e < availableQuantity) {
                          setQty(e)
                        } else {
                          openToast(
                            "bottom",
                            true,
                            "Cannot add more than available quantity"
                          );
                          setQty(availableQuantity)
                        }
                      }} />
                    <div
                      onClick={add}
                      className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer" style={{ borderColor: availableQuantity > qty ? '#1777FF' : '#E3E3E3' }}>
                      <PlusOutlined className="text-xs text-secondryC" style={{ color: availableQuantity > qty ? '#1777FF' : '#E3E3E3' }}/>
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
                    label: `Ownership History`,
                    key: "3",
                    children: (
                      <DataTableComponent
                        columns={ownershipColumn}
                        data={serialNumbers}
                        scrollX="100%"
                        isLoading={isSerialNumbersLoading}
                        pagination={{
                          defaultPageSize: 5,
                          showSizeChanger: false,
                          position: ["bottomCenter"],
                        }}
                        rowKey={(record) => record.serialNumber}
                      />
                    ),
                  },
                  ]}
              />
            </div>
          </div>

          {isEventSelected ?
            iseventDetailsLoading || eventDetails == null ?
              <div className="h-80 flex justify-center items-center">
                <Spin
                  spinning={iseventDetailsLoading}
                  size="large"
                />
              </div> :
              (
                <Card className="mb-12 mx-16">
                  <Text className="font-semibold text-lg">Event Details</Text>
                  <Row className="my-6">
                    <EventDetailsComponent title="NAME" value={decodeURIComponent(eventDetails.eventTypeName)} />
                    <Divider type="vertical" className="h-10 mx-6 bg-grayLight" />
                    <EventDetailsComponent
                      title="DESCRIPTION"
                      value={decodeURIComponent(eventDetails.eventTypeDescription)}
                    />
                  </Row>
                  <DataTableComponent
                    columns={eventDetailColumn}
                    data={eventDetailList}
                    isLoading={iseventDetailsLoading}
                    scrollX="100%"
                  />
                </Card>
              ) : null}

          {isSerialNumberSelected ? (
            <Card className="mb-12 mx-16">
              <Text className="font-semibold text-lg">Ownership History</Text>
              <Row className="my-6">
                <EventDetailsComponent
                  title="SERIAL NUMBER"
                  value={serialNumber}
                  id="ownership-serial"
                />
              </Row>
              <DataTableComponent
                columns={ownershipDetailColumn}
                scrollX="100%"
                data={ownershipHistory}
                isLoading={isOwnershipHistoryLoading}
                pagination={{
                  defaultPageSize: 10,
                  position: ["bottomCenter"],
                  showSizeChanger: false,
                }}
              />
            </Card>
          ) : null}

          {isTransformationSelected ? (
            <Card className="mb-12 mx-16" id="transformation">
              <Text className="font-semibold text-lg">Transformation</Text>
              <Row className="my-6">
                <EventDetailsComponent title="SERIAL NUMBER" value={serialNumber} id="trans-serial" />
              </Row>
              <Spin spinning={isRawMaterialsLoading} delay={500} size="large">
                <NestedComponent clickedSerialNumber={serialNumber} />
              </Spin>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
};

export default ProductDetails;