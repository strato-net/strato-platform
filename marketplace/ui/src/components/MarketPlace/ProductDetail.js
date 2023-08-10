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
    if (user) {
      if (Id !== undefined) {
        eventActions.fetchEventOfInventory(eventDispatch, limit, offset, debouncedSearchTerm, Id);
      }
    }
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

    if (user && user.organization === inventoryDetails?.ownerOrganization) {
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
    // {
    //   title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
    //   dataIndex: "serialNumber",
    //   // Fixes UI issue of children having the same key
    //   key: serialNumbers[0] === "" ? "itemNumber" : "serialNumber",
    //   align: "center",
    //   onCell: (record) => {
    //     return {
    //       onClick: (ev) => {
    //         setIsSerialNumberSelected(true);
    //         setSerialNumber(record.serialNumber);
    //         itemsActions.fetchItemOwnershipHistory(
    //           itemDispatch,
    //           record.address
    //         );
    //       },
    //     };
    //   },
    //   render: (serialNumber) => (
    //     <Button type="link" className="text-primary text-[17px]">
    //       {serialNumber}
    //     </Button>
    //   ),
    // },
    // {
    //   title: <Text className="text-primaryC text-[13px]">ITEM NUMBER</Text>,
    //   dataIndex: "itemNumber",
    //   key: "itemNumber",
    //   align: "center",
    //   onCell: (record, rowIndex) => {
    //     return {
    //       onClick: (ev) => {
    //         setIsSerialNumberSelected(true);
    //         if (isEventSelected) setIsEventSelected(false);
    //         setSerialNumber(record.serialNumber);
    //         itemsActions.fetchItemOwnershipHistory(
    //           itemDispatch,
    //           record.address
    //         );
    //       },
    //     };
    //   },
    //   render: (serialNumber) => (
    //     <Button type="link" className="text-primary text-[17px]">
    //       {serialNumber}
    //     </Button>
    //   ),
    // },
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

  const transformationColumn = [
    // {
    //   title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
    //   dataIndex: "serialNumber",
    //   key: "serialNumber",
    //   align: "center",
    //   onCell: (record) => {
    //     return {
    //       onClick: (ev) => {
    //         setIsTransformationSelected(true);
    //         setSerialNumber(record.serialNumber);
    //         itemsActions.fetchItemRawMaterials(
    //           itemDispatch,
    //           details.uniqueProductCode,
    //           record.serialNumber
    //         );
    //       }
    //     };
    //   },
    //   render: (text) => (
    //     <Button
    //       type="link"
    //       className="text-primary text-[17px]"
    //     >
    //       {text}
    //     </Button>
    //   ),
    // },
    // {
    //   title: <Text className="text-primaryC text-[13px]">ITEM NUMBER</Text>,
    //   dataIndex: "itemNumber",
    //   key: "itemNumber",
    //   align: "center",
    //   onCell: (record, rowIndex) => {
    //     return {
    //       onClick: (ev) => {
    //         if (isEventSelected) setIsEventSelected(false);
    //         if (isSerialNumberSelected) setIsSerialNumberSelected(false);
    //         setIsTransformationSelected(true);
    //         setSerialNumber(record.serialNumber);
    //         itemsActions.fetchItemRawMaterials(
    //           itemDispatch,
    //           details.uniqueProductCode,
    //           record.serialNumber
    //         );
    //       }
    //     };
    //   },
    //   render: (text) => (
    //     <Button
    //       type="link"
    //       className="text-primary text-[17px]"
    //       onClick={() => {

    //       }}
    //     >
    //       {text}
    //     </Button>
    //   ),
    // },
  ];


  const DescTitle = ({ text }) => {
    return <Text className="text-primaryC text-[13px] whitespace-pre">{text}</Text>;
  };

  const DescriptionComponent = () => {
    return (
      <Space direction="vertical">

      </Space>
    );
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
              <div className="h-96 flex items-center justify-center border border-grayLight">
                <Image height={"100%"} width={"100%"} style={{ objectFit: "contain" }} src={details.imageUrl} />
              </div>
              {details.availableQuantity !== 0 ?
                <Row className="justify-center my-7">
                  {ownerSameAsUser() ? <Button
                    className="group w-1/3 h-9 border border-primary"
                    disabled={true}
                    id="addToCart"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        window.location.href = loginUrl;
                      } else {
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
                        window.location.href = loginUrl;
                      } else {
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
                        window.location.href = loginUrl;
                      } else {
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
                    label: `Events`,
                    key: "2",
                    children: (
                      <DataTableComponent
                        columns={eventColumn}
                        data={eventList}
                        scrollX="100%"
                        isLoading={isInventoryEventsLoading}
                      />
                    ),
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
                  {
                    label: `Transformation`,
                    key: "4",
                    children: (
                      <DataTableComponent
                        columns={transformationColumn}
                        data={serialNumbers}
                        isLoading={false}
                        scrollX="100%"
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