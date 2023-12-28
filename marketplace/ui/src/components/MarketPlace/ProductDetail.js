import React, { useState, useEffect } from "react";
import {
  Row,
  Card,
  Breadcrumb,
  Button,
  Typography,
  Tabs,
  Space,
  Divider,
  Col,
  Spin,
  notification,
  InputNumber,
  List,
} from "antd";
import {EyeOutlined } from "@ant-design/icons";
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import routes from "../../helpers/routes";
import { UNIT_OF_MEASUREMENTS, getUnitNameByIndex } from "../../helpers/constants";
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
import "react-responsive-carousel/lib/styles/carousel.min.css"; // requires a loader
import {Carousel} from "react-responsive-carousel"
import { Images } from "../../images";

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
  const {
    inventoryDetails, 
    isInventoryDetailsLoading,
    isInventoryOwnershipHistoryLoading,
    inventoryOwnershipHistory
  } = useInventoryState();
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
      // TODO: Uncomment this when we have serial numbers working
      // if (user) {
      //   itemsActions.fetchSerialNumbers(itemDispatch, Id);
      // }
    }
  }, [Id, dispatch, user]);

  useEffect(() => {
    if (inventoryDetails) {
      actions.fetchInventoryOwnershipHistory(
        dispatch,
        { originAddress: inventoryDetails.originAddress,
          minItemNumber: inventoryDetails.itemNumber,
          maxItemNumber: inventoryDetails.itemNumber + inventoryDetails.quantity - 1
        }
      );
    }
  }, [inventoryDetails, dispatch]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const details = inventoryDetails;
  console.log("details: ", details)

  useEffect(() => {
    if (categorys.length && details) {
      const prodCategory = categorys.find(
        (c) => c.name === details.category
      );
      setCategoryName(prodCategory?.name);
      const detailsData = JSON.parse(details.data);
      setItemData(detailsData);
      if (details.saleQuantity) {
        setAvailableQuantity(details.saleQuantity || 1);
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

  const ownershipColumns = [
    {
      title: <Text className="text-primaryC text-[13px]">ITEM NUMBER</Text>,
      dataIndex: "itemNumber",
      // Fixes UI issue of children having the same key
      key: "itemNumber", // ?
      align: "center",
      onCell: (record) => {
        return {
          onClick: (ev) => {
            actions.fetchInventoryOwnershipHistory(
              dispatch,
              { originAddress: record.originAddress,
                minItemNumber: record.itemNumber,
                maxItemNumber: record.itemNumber + record.quantity - 1
              }
            );
          },
        };
      },
      render: (itemNumber) => (
        <Button type="link" className="text-primary text-[17px]">
          {itemNumber}
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
      title: <Text className="text-primaryC text-[13px]">Seller</Text>,
      dataIndex: "sellerCommonName",
      key: "sellerCommonName",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">Owner</Text>,
      dataIndex: "purchaserCommonName",
      key: "purchaserCommonName",
      align: "center",
      render: (text) => <p>{text}</p>,
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">
          Ownership Start Date
        </Text>
      ),
      dataIndex: "block_timestamp",
      key: "block_timestamp",
      align: "center",
      render: (epoch) => <p>{epoch.split(' ')[0]}</p>,
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
          <Space direction="vertical" className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md">
            <Space className="flex justify-between">
              <DescTitle text="Artist" />
              <Text className="text-[13px] text-[#202020] font-medium">{itemData?.artist}</Text>
            </Space>
          </Space>)
      case "CarbonOffset":
        return (
          <Space direction="vertical" className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md">
            {/* <Space>
              <DescTitle text="Project Type" />
              <DescTitle text="                      :" />
              <Text className="text-[13px]">{itemData?.projectType}</Text>
            </Space> */}
            <Space className="flex justify-between">
              <DescTitle text="Quantity" />
              <Text className="text-[13px] text-[#202020] font-medium">{availableQuantity}</Text>
            </Space>
          </Space>)
      case "Clothing":
        return (
          <Space direction="vertical" className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md">
            <Space className="flex justify-between">
              <DescTitle text="Brand" />
              <Text className="text-[13px] text-[#202020] font-medium">{itemData?.brand}</Text>
            </Space>
          </Space>)
      case "Metals":
        return (
          <>
          <Space direction="vertical" className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md">
            <Space className="flex justify-between">
              <DescTitle text="Source" />
              <Text className="text-[13px] text-[#202020] font-medium">{itemData?.source}</Text>
            </Space>
          
            {
              // TODO
            /* <Space>
              <DescTitle text="Quantity Remaining" />
              <DescTitle text=":" />
              <Text className="text-[13px]">
                
              {parseInt(itemData?.quantity) > 1
                ? parseInt(itemData?.quantity)+` ${getUnitNameByIndex(itemData?.unitOfMeasurement)}S`
                : parseInt(itemData?.quantity)+` ${getUnitNameByIndex(itemData?.unitOfMeasurement)}`
              
              }
            </Text>
            </Space> */}

            <Space className="flex justify-between">
              <DescTitle text="Purity" />
              <Text className="text-[13px] text-[#202020] font-medium">{itemData?.purity}</Text>
            </Space>
          </Space>
          </>)
      case "Membership":
        return (
          <Space direction="vertical" className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md">
           <Space className="flex justify-between">
              <DescTitle text="Units" />
              <Text className="text-[13px] text-[#202020] font-medium">{availableQuantity}</Text>
            </Space>
          </Space>)
      case "CarbonDAO":
        return (
          <Space direction="vertical" className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md">
            <Space className="flex justify-between">
              <DescTitle text="Units" />
              <Text className="text-[13px] text-[#202020] font-medium">{availableQuantity}</Text>
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
            <Breadcrumb className="text-xs  mt-4 mb-4 md:mt-6 lg:mt-[42px] md:mb-6 lg:mb-[44px] ml-4 lg:ml-16">
              <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                <ClickableCell href={routes.Marketplace.url}>
                  <p
                    className="text-[#13188A]  text-sm font-semibold "
                  >
                    Home
                  </p>
                </ClickableCell>
              </Breadcrumb.Item> <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                <ClickableCell href={routes.Marketplace.url}>
                  <p
                    className="text-[#13188A]  text-sm font-semibold "
                  >
                    Marketplace
                  </p>
                </ClickableCell>
              </Breadcrumb.Item>
              {
                isCalledFromInventory ?
                  <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                    <ClickableCell href={routes.MyStore.url}>
                      <p
                        className="text-[#13188A]  text-sm font-semibold "
                      >
                        My Store
                      </p>
                    </ClickableCell>
                  </Breadcrumb.Item> : null
              }
              <Breadcrumb.Item className="text-[#202020]  text-sm font-semibold ">
                {decodeURIComponent(details.name)}
              </Breadcrumb.Item>
            </Breadcrumb>
          </Row>
          <div className="flex w-full flex-col  px-4 sm:px-8 md:px-0  items-center lg:items-start  md:w-[750px] lg:w-[835px] xl:w-[858px]  md:mx-auto ">
          <div className="flex md:justify-center gap-[15px] lg:gap-6 flex-col lg:flex-row   ">
            <Carousel  className="product_detail w-full  sm:w-[417px]   lg:h-[348px] md:w-[343px] lg:w-[417px]" showStatus={false} showArrows swipeable emulateTouch infiniteLoop >
             { details.images.length > 0  ? details.images.map((element,  index)=>{
                  return ( <><div key={index} className="sm:w-[343px ] h-[212px] lg:h-[348px]   md:h-[250px] lg:w-[417px] w-full rounded-md ">
                  <img  width={"100%"}  className="  rounded-md h-full " src={element ? element : image_placeholder} />
               </div></>)
             })  : <><div  className="sm:w-[343px ] sm:h-[212px] lg:h-[348px]   md:h-[250px] lg:w-[417px] w-full rounded-md ">
             <img  width={"100%"}  className="  rounded-md h-full " src={ image_placeholder} />
          </div></> }
              </Carousel>
            <div className=" w-full lg:w-1/2 ">
              <div className=" lg:border-b lg:border-[#E9E9E9] pb-[6px]">
                <Text className="font-semibold text-base lg:text-3xl text-[#202020]">
                  
                  {decodeURIComponent(details?.name)}
                </Text>
                <div className="flex pt-[6px] ">
                <Text  className="text-[#202020] text-xs  font-medium">Owned By: {details?.ownerCommonName}</Text>
                 <Text className="text-[#202020] text-xs  font-medium" >{details?.ownerOrganization}</Text>
                </div>
              </div>
            <div className=" pt-4 lg:pt-[22px]">
             
              <Text level={4} className=" text-[#13188A] text-xl font-bold lg:text-2xl lg:font-semibold">
                {details?.price ? <>${details?.price}</> : "No Price Available"}
              </Text>
              </div> 
              <div className=" pt-6 lg:pt-[18px] lg:block hidden">
                <Typography  className="text-xl font-semibold text-[#202020]">Description</Typography>
              </div>
              <div className="pt-[7px]">
              <Paragraph
                className="text-[#202020] text-sm  h-[60px] overflow-auto"
              >
                {decodeURIComponent(details.description).split('\n').map((line, index) => (
                  <React.Fragment key={index}>
                    {line}
                    <br />
                  </React.Fragment>
                ))}
             
              </Paragraph>
              </div>

              {availableQuantity !== 0 ?
                  <div className="flex justify-between lg:justify-start  w-full gap-3 lg:gap-[15px]" id="quantity">
                    <div
                      onClick={subtract}
                      className="h-9 w-11 md:h-10 md:w-12 lg:h-[46px] lg:w-[52px] rounded-lg flex justify-center items-center border border-[#00000029] text-center cursor-pointer" style={{ borderColor: qty > 1 ? '#1777FF' : '#E3E3E3' }}>
 <p className=" text-2xl md:text-3xl lg:text-4xl font-semibold lg:text-[#202020] text-[#989898]">
                       -
                        </p> 
                    </div>
                    <InputNumber className="w-full md:w-[295px] h-9 md:h-10 lg:h-[46px] border text-[#6A6A6A] border-[#00000029] text-center flex flex-col justify-center font-semibold" min={1} max={availableQuantity} value={`${qty}`} defaultValue={`${qty}`} controls={false}
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
                      className="ml-0.5 h-9 w-11 md:h-10 md:w-12 lg:h-[46px] lg:w-[52px] rounded-lg  flex justify-center items-center border border-[#00000029] text-center cursor-pointer" style={{ borderColor: availableQuantity > qty ? '#1777FF' : '#E3E3E3' }}>
                       <p className="text-2xl md:text-3xl lg:text-4xl font-semibold lg:text-[#202020] text-[#989898]">
                       +
                        </p> 
                    </div>
                  </div>
              
                :
                <Paragraph style={{color:'red', fontSize:14}} className="!mt-0" id="prod-price">
                If you are interested in purchasing this item, please contact our sales team at sales@blockapps.net
              </Paragraph>
              }
{availableQuantity !== 0 ?
                <div className="flex gap-4 justify-between lg:justify-start  pt-4 w-full">
                  <Button
                    type="primary"
                    className="w-[90%] md:w-[365px] h-9  !bg-[#13188A] !hover:bg-primaryHover"
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

                  {ownerSameAsUser() ? <Button
                    icon={
                    <img src={Images.Cart} alt="cart"   className=" w-[18px] h-[18px]"></img>
                    }
                    className=" !w-9 h-9 border border-primary  !bg-[#13188A] rounded-md"
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
                            product_name: details?.name,
                            category: details?.category,
                            productId: details?.productId
                          },
                        });
                        addItemToCart();
                      }
                    }}
                  >
                  
                  </Button> : <Button
                  icon={<div className="flex justify-center items-center">
                    <img src={Images.Cart} alt="cart"  width={18} height={18} className="object-contain"/>
                    </div>}
                    className=" !w-9 h-9 rounded-md  !bg-[#13188A]"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        setCookie("returnUrl", `/marketplace/productList/${details.address}`, 10);
                        window.location.href = loginUrl;
                      } else {
                        window.LOQ.push(['ready', async LO => {
                          // Track an event
                          await LO.$internal.ready('events')
                          LO.events.track('Add to Cart (from Product Details)', {
                            product: details?.name,
                            category: details?.category,
                            productId: details?.productId
                          })
                        }])
                        TagManager.dataLayer({
                          dataLayer: {
                            event: 'add_to_cart_from_product_details',
                            product_name: details?.name,
                            category: details?.category,
                            productId: details?.productId
                          },
                        });
                        addItemToCart();
                      }
                    }}
                  >
                    
                  </Button>}
                </div>
                :
                <div className="flex ">
                  <Button
                    type="primary"
                    className="w-[80%] md:w-[365px] h-9 m-3 mt-10 !bg-primary !hover:bg-primaryHover"
                    href={`mailto:sales@blockapps.net`}
                    onClick={() => {
                    
                      window.LOQ.push(['ready', async LO => {
                        await LO.$internal.ready('events')
                        LO.events.track('Contact Sales (from Product Details)', {
                          product: details?.name,
                          category: details?.category,
                          productId: details?.productId
                        })
                      }])
                      TagManager.dataLayer({
                        dataLayer: {
                          event: 'contact_sales_from_product_details',
                          product_name: details?.name,
                          category: details?.category,
                          productId: details?.productId
                        },
                      });
                    }}>
                    Contact to Buy
                  </Button>
                </div>
           
          }
            </div>
          </div>
          <div className=" mt-9 lg:mt-10 w-full md:w-[750px] sm:px-[10%] md:px-[15%] lg:px-0 pb-5 lg:w-[835px]  ">
          <Tabs
          className="product_detail"
                defaultActiveKey="1"
                onChange={onTabChange}
                items={!user ?
                  [{
                    label: <span className="text-sm md:text-base">Description</span>,
                    key: "1",
                    children: <DescriptionComponent />,
                  }]
                  :
                  [{
                    label: <span className="text-sm md:text-base">Description</span>,
                    key: "1",
                    children: <DescriptionComponent />,
                  },
                  {
                    label: <span className="text-sm md:text-base">Ownership History</span>,
                    key: "3",
                    children: (
                      <div>
                        <DataTableComponent
                          columns={ownershipDetailColumn}
                          scrollX="100%"
                          data={inventoryOwnershipHistory}
                          isLoading={isInventoryOwnershipHistoryLoading}
                          pagination={{
                            defaultPageSize: 10,
                            position: ["bottomCenter"],
                            showSizeChanger: false,
                          }}
                        />
                      </div>
                    ),
                  },
                  {
                    label: <span className="text-sm md:text-base">Additional Information</span>,
                    key: "4",
                    children: (
                      <div>
                        <List 
                          size="small"
                          boardered
                          dataSource={!details.files ? [] : details.files}
                          renderItem={(item) => 
                          <List.Item>
                            <a href={item} rel="noreferrer" target="_blank" className="hover:underline break-all text-[#1e40af]">
                              {item}
                            </a>
                          </List.Item>}
                        />
                      </div>
                    )
                  }
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
                data={inventoryOwnershipHistory}
                isLoading={isInventoryOwnershipHistoryLoading}
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