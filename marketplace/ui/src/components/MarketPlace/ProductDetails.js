import React, { useState, useEffect } from 'react';
import {
  Row,
  Breadcrumb,
  Button,
  Typography,
  Tabs,
  Spin,
  notification,
  InputNumber,
  List,
} from 'antd';
import {
  HeartTwoTone,
  HeartFilled,
  FilePdfOutlined,
  LogoutOutlined,
  BankOutlined,
  SolutionOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { useMatch, useNavigate, useLocation } from 'react-router-dom';
import TagManager from 'react-gtm-module';
//actions
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as categoryActions } from '../../contexts/category/actions';
import { actions as marketPlaceActions } from '../../contexts/marketplace/actions';
import { actions as orderActions } from '../../contexts/order/actions';
// dispatch & state
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useOrderDispatch } from '../../contexts/order';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import { useAuthenticateState } from '../../contexts/authentication';
// components
import HelmetComponent from '../Helmet/HelmetComponent';
import DataTableComponent from '../DataTableComponent';
import ProductItemDetails from './ProductItemDetails';
import PriceChartAndStats from './PriceChartAndStats';
import PreviewMode from '../RichEditor/PreviewMode';
import ClickableCell from '../ClickableCell';
import TimeRangeTabs from './TimeRangeTabs';
import Statistics from './Statistics';
import LoginModal from './LoginModal';
import StakeModal from '../Inventory/StakeModal';
import BorrowModal from '../Inventory/BorrowModal';
import RepayModal from '../Inventory/RepayModal';
// other
import { setCookie } from '../../helpers/cookie';
import routes from '../../helpers/routes';
import './index.css';
import BigNumber from 'bignumber.js';

import image_placeholder from '../../images/resources/image_placeholder.png';
import 'react-responsive-carousel/lib/styles/carousel.min.css'; // requires a loader

import { SEO } from '../../helpers/seoConstant';
import { ASSET_STATUS } from '../../helpers/constants';
import { TOAST_MSG } from '../../helpers/msgConstants';

import { Swiper, SwiperSlide } from 'swiper/react';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/effect-fade';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'swiper/css/autoplay';

// import required modules
import { EffectFade, Navigation, Pagination, Autoplay } from 'swiper/modules';

const ProductDetails = ({ user, users }) => {
  const [api, contextHolder] = notification.useNotification();
  const { Text, Paragraph, Title } = Typography;
  const { state, pathname } = useLocation();
  const navigate = useNavigate();

  const { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  // dispatch
  const dispatch = useInventoryDispatch();
  const categoryDispatch = useCategoryDispatch();
  const orderDispatch = useOrderDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  // state
  const { categorys, iscategorysLoading } = useCategoryState();
  const {
    success,
    message,
    inventoryDetails,
    isInventoryDetailsLoading,
    isInventoryOwnershipHistoryLoading,
    inventoryOwnershipHistory,
    priceHistory,
    isFetchingPriceHistory,
    reserves,
  } = useInventoryState();
  const { cartList, assetsWithEighteenDecimalPlaces } = useMarketplaceState();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [timeFilter, setTimeFilter] = useState('1');
  const [itemData, setItemData] = useState({});
  const [Id, setId] = useState(undefined);
  const [qty, setQty] = useState(1);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [stakeType, setStakeType] = useState(null);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);
  // For Wishlist Icon Rendering
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [availableQuantity, setAvailableQuantity] = useState(1);

  // Stakeable
  const isStaked =
    inventoryDetails?.escrow &&
    inventoryDetails?.escrow?.collateralQuantity > 0;
  const isStakeable =
    inventoryDetails?.root &&
    reserves &&
    reserves.length > 0 &&
    reserves.some(
      (reserve) => inventoryDetails?.root === reserve.assetRootAddress
    );

  const matchingReserve = isStakeable
    ? reserves?.find(
        (reserve) => reserve.assetRootAddress === inventoryDetails?.root
      )
    : {};

  let isCalledFromInventory = false;
  if (state !== null && state !== undefined) {
    isCalledFromInventory = state.isCalledFromInventory;
  } else if (pathname.includes('inventories')) {
    isCalledFromInventory = true;
  }

  const routeMatch = useMatch({
    path: routes.MarketplaceProductDetail.url,
    strict: true,
  });

  const routeMatch1 = useMatch({
    path: routes.InventoryDetail.url,
    strict: true,
  });

  const ownerSameAsUser = () => {
    if (user?.commonName === inventoryDetails?.ownerCommonName) {
      return true;
    }
    return false;
  };

  function isActive() {
    if (
      inventoryDetails.status == ASSET_STATUS.PENDING_REDEMPTION ||
      inventoryDetails.status == ASSET_STATUS.RETIRED
    ) {
      return false;
    } else {
      return true;
    }
  }

  useEffect(() => {
    if (isCalledFromInventory) setId(routeMatch1?.params?.id);
    else setId(routeMatch?.params?.address);
  }, [routeMatch, routeMatch1]);

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    if (Id !== undefined) {
      inventoryActions.fetchInventoryDetail(dispatch, Id);
      inventoryActions.getAllReserve(dispatch);
    }
  }, [Id, dispatch]);

  useEffect(() => {
    if (Id !== undefined) {
      inventoryActions.fetchPriceHistory(dispatch, Id, 10, 0, timeFilter);
    }
  }, [Id, dispatch, timeFilter]);

  const handleTimeFilterChange = (key) => {
    setTimeFilter(key);
  };

  useEffect(() => {
    if (inventoryDetails) {
      const minItemNumber = new BigNumber(
        inventoryDetails.itemNumber
      ).toFixed();
      const maxItemNumber = new BigNumber(inventoryDetails.itemNumber)
        .plus(inventoryDetails.quantity)
        .minus(1)
        .toFixed();

      inventoryActions.fetchInventoryOwnershipHistory(dispatch, {
        originAddress: inventoryDetails.originAddress,
        minItemNumber: minItemNumber,
        maxItemNumber: maxItemNumber,
      });
    }
  }, [inventoryDetails, dispatch]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const details = inventoryDetails;

  let fileValues = [];
  let fileNames = [];

  if (details && Array.isArray(details['BlockApps-Mercata-Asset-fileNames'])) {
    fileNames = details['BlockApps-Mercata-Asset-fileNames'];
  }

  if (details && Array.isArray(details['BlockApps-Mercata-Asset-files'])) {
    fileValues = details['BlockApps-Mercata-Asset-files'].map((file, index) => {
      let name = fileNames[index]?.value
        ? fileNames[index]?.value
        : `Information-${index + 1}.pdf`;
      name = name.replace(/ /g, '-');
      return { url: file.value, name };
    });
  }

  useEffect(() => {
    if (categorys.length && details) {
      const prodCategory = categorys.find((c) => c.name === details.category);
      const detailsData = details.data;
      setItemData(detailsData);
      if (details.saleQuantity) {
        let saleQuantity = details.saleQuantity;
        setAvailableQuantity(saleQuantity || 1);
      }
    }
  }, [categorys, details]);

  // This checks to see if an item is in the wishlist. This will help us render the correct icon
  useEffect(() => {
    const wishList = JSON.parse(localStorage.getItem('wishList')) || [];
    const productInWishlist = wishList.some(
      (product) => product.address === details?.address
    );
    setIsWishlisted(productInWishlist);
  }, [details]);

  const toggleWishlist = () => {
    if (!isAuthenticated || !user) {
      setIsModalVisible(true);
    } else {
      const wishList = JSON.parse(localStorage.getItem('wishList')) || [];
      if (isWishlisted) {
        // Remove product from wishlist
        const updatedWishList = wishList.filter(
          (product) => product.address !== details.address
        );
        localStorage.setItem('wishList', JSON.stringify(updatedWishList));
        setIsWishlisted(false);
      } else {
        // Add product to wishlist
        wishList.push(details);
        localStorage.setItem('wishList', JSON.stringify(wishList));
        setIsWishlisted(true);
      }
    }
  };

  const showStakeModal = (type) => {
    setStakeModalOpen(true);
    setStakeType(type);
  };

  const handleStakeModalClose = () => {
    setStakeModalOpen(false);
  };

  const showBorrowModal = () => {
    setBorrowModalOpen(true);
  };

  const handleBorrowModalClose = () => {
    setBorrowModalOpen(false);
  };

  const showRepayModal = () => {
    setRepayModalOpen(true);
  };

  const handleRepayModalClose = () => {
    setRepayModalOpen(false);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
  };

  const handleLogin = () => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      setCookie('returnUrl', window.location.pathname, 10);
      window.location.href = loginUrl;
    }
    setIsModalVisible(false);
  };

  const subtract = () => {
    if (!isStakeable || !ownerSameAsUser()) {
      const value = Math.max(qty - 1, 1);
      setQty(value);
    }
  };

  const add = () => {
    if (qty + 1 <= availableQuantity && (!isStakeable || !ownerSameAsUser())) {
      let value = qty + 1;
      setQty(value);
    } else {
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

  const openToastInventory = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: inventoryActions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: inventoryActions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  const addItemToCart = async () => {
    const items = [{ product: details, qty }];
    marketPlaceActions.addItemToCart(marketplaceDispatch, items);
    navigate('/checkout');
    window.scrollTo(0, 0);
  };

  const ownershipDetailColumn = [
    {
      title: <Text className="text-primaryC text-[13px]">Seller</Text>,
      dataIndex: 'sellerCommonName',
      key: 'sellerCommonName',
      align: 'center',
      render: (text) => (
        <a
          href={`${window.location.origin}/profile/${encodeURIComponent(text)}`}
          onClick={(e) => {
            e.preventDefault();
            const userProfileUrl = `/profile/${encodeURIComponent(text)}`;

            if (e.ctrlKey || e.metaKey) {
              // Open in a new tab if Ctrl/Cmd is pressed
              window.open(
                `${window.location.origin}${userProfileUrl}`,
                '_blank'
              );
            } else {
              // Use navigate for a normal click, without Ctrl/Cmd
              navigate(
                routes.MarketplaceUserProfile.url.replace(':commonName', text),
                { state: { from: pathname } }
              );
            }
          }}
          style={{
            textDecoration: 'underline',
            color: 'black',
            cursor: 'pointer',
          }}
        >
          {text}
        </a>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Owner</Text>,
      dataIndex: 'purchaserCommonName',
      key: 'purchaserCommonName',
      align: 'center',
      render: (text) => (
        <a
          href={`${window.location.origin}/profile/${encodeURIComponent(text)}`}
          onClick={(e) => {
            e.preventDefault();
            const userProfileUrl = `/profile/${encodeURIComponent(text)}`;

            if (e.ctrlKey || e.metaKey) {
              // Open in a new tab if Ctrl/Cmd is pressed
              window.open(
                `${window.location.origin}${userProfileUrl}`,
                '_blank'
              );
            } else {
              // Use navigate for a normal click, without Ctrl/Cmd
              navigate(
                routes.MarketplaceUserProfile.url.replace(':commonName', text),
                { state: { from: pathname } }
              );
            }
          }}
          style={{
            textDecoration: 'underline',
            color: 'black',
            cursor: 'pointer',
          }}
        >
          {text}
        </a>
      ),
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">Ownership Start Date</Text>
      ),
      dataIndex: 'block_timestamp',
      key: 'block_timestamp',
      align: 'center',
      render: (epoch) => <p>{epoch.split(' ')[0]}</p>,
    },
  ];

  const getCategory = (data) => {
    const parts = data.contract_name.split('-');
    return parts[parts.length - 1];
  };

  const isAvailableForSale =
    !details?.saleQuantity || details?.saleQuantity == 0;
  function getCategoryName(str) {
    const lastIndex = str.lastIndexOf('-');
    if (lastIndex !== -1) {
      return str.substring(lastIndex + 1);
    } else {
      return str;
    }
  }

  const assetName = decodeURIComponent(details?.name);
  const contractName = getCategoryName(
    decodeURIComponent(details?.contract_name)
  );
  const linkUrl = window.location.href;

  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
    details?.originAddress
  );

  return (
    <>
      {contextHolder}
      {details === null || isInventoryDetailsLoading || iscategorysLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isInventoryDetailsLoading} size="large" />
        </div>
      ) : (
        <div>
          <HelmetComponent
            title={`${assetName} | ${contractName} | ${SEO.TITLE_META}`}
            description={details?.description}
            link={linkUrl}
          />
          <Row>
            <Breadcrumb className="text-xs   mb-4 md:mt-5  md:mb-6 lg:mb-[44px] ml-4 lg:ml-16">
              <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                <ClickableCell href={routes.Marketplace.url}>
                  <p className="text-[#13188A]  text-sm font-semibold ">Home</p>
                </ClickableCell>
              </Breadcrumb.Item>
              {isCalledFromInventory ? (
                <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                  <ClickableCell href={routes.MyWallet.url}>
                    <p className="text-[#13188A]  text-sm font-semibold ">
                      My Wallet
                    </p>
                  </ClickableCell>
                </Breadcrumb.Item>
              ) : null}
              <Breadcrumb.Item className="text-[#202020]  text-sm font-semibold ">
                Product Detail
              </Breadcrumb.Item>
              <Breadcrumb.Item className="text-[#202020]  text-sm font-semibold ">
                {decodeURIComponent(details.name)}
              </Breadcrumb.Item>
            </Breadcrumb>
          </Row>
          <div className="flex w-full flex-col lg:leading-12 px-4 sm:px-8 md:px-0  items-center lg:items-start  md:w-[750px] lg:w-[835px] xl:w-[858px]  md:mx-auto ">
            <div className="flex md:justify-center gap-[15px] lg:gap-6 flex-col lg:flex-row   ">
              {details['BlockApps-Mercata-Asset-images'].length > 0 ? (
                <Swiper
                  spaceBetween={30}
                  effect={'fade'}
                  navigation={true}
                  centeredSlides={true}
                  pagination={{
                    clickable: true,
                  }}
                  modules={[Autoplay, EffectFade, Navigation, Pagination]}
                  className="product-detail-swiper"
                >
                  {details['BlockApps-Mercata-Asset-images'].length > 0 &&
                    details['BlockApps-Mercata-Asset-images'].map(
                      (element, index) => {
                        return (
                          <SwiperSlide>
                            <div
                              key={index}
                              className="mx-auto sm:w-[343px ] h-[212px] lg:h-[348px]  md:h-[250px] lg:w-[417px] w-full rounded-md "
                            >
                              <img
                                width={'100%'}
                                alt={`${assetName} | Image ${index}`}
                                title={`${assetName} | Image ${index}`}
                                className="object-contain rounded-md h-full"
                                src={
                                  element.value
                                    ? element.value
                                    : image_placeholder
                                }
                              />
                            </div>
                          </SwiperSlide>
                        );
                      }
                    )}
                </Swiper>
              ) : (
                <div className="sm:w-[343px ] sm:h-[212px] lg:h-[348px]   md:h-[250px] lg:w-[417px] w-full rounded-md ">
                  <img
                    width={'100%'}
                    alt={`${assetName} | Image`}
                    title={`${assetName} | Image`}
                    className="object-contain rounded-md h-full "
                    src={image_placeholder}
                  />
                </div>
              )}
              <div className=" w-full lg:w-1/2">
                {!ownerSameAsUser() && (
                  <div className="flex justify-end">
                    {isWishlisted ? (
                      <HeartFilled
                        className="cursor-pointer"
                        onClick={toggleWishlist}
                        style={{ fontSize: '20px', color: '#A15E49' }}
                      />
                    ) : (
                      <HeartTwoTone
                        className="cursor-pointer"
                        onClick={toggleWishlist}
                        style={{ fontSize: '20px' }}
                        twoToneColor="#A15E49"
                      />
                    )}
                  </div>
                )}
                <div className=" lg:border-b lg:border-[#E9E9E9] pb-[6px]">
                  <Title
                    style={{ fontSize: '30px' }}
                    className="font-semibold text-base lg:text-3xl text-[#202020]"
                  >
                    {decodeURIComponent(details?.name)}
                  </Title>
                  <div className="flex pt-[6px] ">
                    <span className="text-xs  self-center">
                      Owned By:&nbsp;
                    </span>
                    <div
                      style={{
                        cursor:
                          details?.ownerCommonName &&
                          details.ownerCommonName !== 'N/A'
                            ? 'pointer'
                            : 'default',
                        color: 'black',
                        textDecoration:
                          details?.ownerCommonName &&
                          details.ownerCommonName !== 'N/A'
                            ? 'underline'
                            : 'none',
                      }}
                      onClick={(e) => {
                        if (
                          details?.ownerCommonName &&
                          details.ownerCommonName !== 'N/A'
                        ) {
                          e.preventDefault();
                          const userProfileUrl = `/profile/${encodeURIComponent(
                            details.ownerCommonName
                          )}`;
                          const fullUrl = `${window.location.origin}${userProfileUrl}`;

                          if (e.ctrlKey || e.metaKey) {
                            // Open in a new tab if Ctrl/Cmd is pressed
                            window.open(fullUrl, '_blank');
                          } else {
                            // Use navigate for a normal click, without Ctrl/Cmd
                            navigate(
                              routes.MarketplaceUserProfile.url.replace(
                                ':commonName',
                                details?.ownerCommonName
                              ),
                              { state: { from: pathname } }
                            );
                          }
                        }
                      }}
                    >
                      <Text className="text-[#202020] text-xs font-medium  self-center">
                        {details?.ownerCommonName || 'N/A'}
                      </Text>
                    </div>

                    <Text className="text-[#202020] text-xs  font-medium">
                      {details?.ownerOrganization}
                    </Text>
                  </div>
                </div>
                {(!isStakeable || !ownerSameAsUser()) && (
                  <div className=" pt-4 lg:pt-[22px]">
                    <Paragraph
                      level={4}
                      id="price"
                      className=" text-[#13188A] text-xl font-bold lg:text-2xl lg:font-semibold"
                    >
                      {details?.price || isStaked
                        ? (() => {
                            const adjustedPrice = details.price;
                            return (
                              <>
                                $
                                {isStaked
                                  ? (details.escrow?.maxLoanAmount).toFixed(2)
                                  : is18DecimalPlaces
                                  ? adjustedPrice * Math.pow(10, 18)
                                  : adjustedPrice.toFixed(2)}{' '}
                                <span className="font-normal text-xs mr-2 text-primary">
                                  <b>
                                    (
                                    {isStaked
                                      ? details.escrow?.maxLoanAmount
                                      : is18DecimalPlaces
                                      ? adjustedPrice * Math.pow(10, 18)
                                      : adjustedPrice.toFixed(2)}{' '}
                                    USDST)
                                  </b>
                                </span>
                                {isStakeable && (
                                  <>
                                    <div className="text-lg">
                                      Est. APY: {matchingReserve?.cataAPYRate}%
                                    </div>
                                    <div className="text-lg">
                                      TVL: ${matchingReserve?.tvl.toFixed(2)}
                                    </div>
                                  </>
                                )}
                              </>
                            );
                          })()
                        : 'No Price Available'}
                    </Paragraph>
                    {isAvailableForSale && (
                      <Text type="danger" strong>
                        Sold Out
                      </Text>
                    )}
                  </div>
                )}
                {availableQuantity !== 0 ? (
                  <div
                    className="flex justify-between lg:justify-start  w-full gap-3 lg:gap-[15px] pt-6 lg:pt-[18px]"
                    id="quantity"
                  >
                    <div
                      onClick={subtract}
                      className={`h-9 w-11 md:h-10 md:w-12 lg:h-[46px] lg:w-[52px] rounded-lg flex justify-center items-center border border-[#00000029] text-center cursor-pointer ${
                        qty > 1 && (!isStakeable || !ownerSameAsUser())
                          ? ''
                          : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <p className=" text-2xl md:text-3xl lg:text-4xl font-semibold lg:text-[#202020] text-[#989898]">
                        -
                      </p>
                    </div>
                    <InputNumber
                      className="w-full md:w-[280px] h-9 md:h-10 lg:h-[46px] border text-[#6A6A6A] border-[#00000029] text-center flex flex-col justify-center font-semibold !rounded-lg"
                      min={1}
                      max={availableQuantity}
                      disabled={isStakeable && ownerSameAsUser()}
                      value={
                        !isStakeable || !ownerSameAsUser()
                          ? `${qty}`
                          : assetsWithEighteenDecimalPlaces.includes(
                              inventoryDetails.root
                            )
                          ? inventoryDetails.quantity / 1e18
                          : inventoryDetails.quantity
                      }
                      defaultValue={`${qty}`}
                      controls={false}
                      onChange={(e) => {
                        if (e < availableQuantity) {
                          setQty(parseInt(e || 0));
                        } else {
                          setQty(availableQuantity);
                        }
                      }}
                    />
                    <div
                      onClick={add}
                      className={`h-9 w-11 md:h-10 md:w-12 lg:h-[46px] lg:w-[52px] rounded-lg flex justify-center items-center border border-[#00000029] text-center cursor-pointer ${
                        qty < availableQuantity &&
                        (!isStakeable || !ownerSameAsUser())
                          ? ''
                          : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <p className="text-2xl md:text-3xl lg:text-4xl font-semibold lg:text-[#202020] text-[#989898]">
                        +
                      </p>
                    </div>
                  </div>
                ) : (
                  <Paragraph
                    style={{ color: 'red', fontSize: 14 }}
                    className="!mt-0"
                    id="prod-price"
                  >
                    If you are interested in purchasing this item, please
                    contact our sales team at sales@blockapps.net
                  </Paragraph>
                )}

                {(!isStakeable || !ownerSameAsUser()) && (
                  <div>
                    {availableQuantity !== 0 ? (
                      <div className="flex gap-4 justify-between lg:justify-start  pt-4 w-full">
                        <Button
                          type="primary"
                          className={`w-[100%]  h-9  ${
                            isAvailableForSale
                              ? '!bg-[#808080]'
                              : '!bg-[#13188A]'
                          } !hover:bg-primaryHover !text-white`}
                          onClick={async () => {
                            window.LOQ.push([
                              'ready',
                              async (LO) => {
                                // Track an event
                                await LO.$internal.ready('events');
                                LO.events.track(
                                  'Buy Now (from Product Details)',
                                  {
                                    product: details.name,
                                    category: details.category,
                                    productId: details.productId,
                                  }
                                );
                              },
                            ]);
                            TagManager.dataLayer({
                              dataLayer: {
                                event: 'buy_now_from_product_details',
                                product_name: details.name,
                                category: details.category,
                                productId: details.productId,
                              },
                            });

                            const checkQuantity =
                              await orderActions.fetchSaleQuantity(
                                orderDispatch,
                                [details.saleAddress],
                                [qty]
                              );
                            if (checkQuantity === true) {
                              addItemToCart();
                            } else {
                              if (checkQuantity[0].availableQuantity === 0) {
                                openToast(
                                  'bottom',
                                  true,
                                  TOAST_MSG.OUT_OF_STOCK(details)
                                );
                              } else {
                                // Case 2: We are trying to add too much quantity
                                openToast(
                                  'bottom',
                                  true,
                                  TOAST_MSG.TOO_MUCH_QUANTITY(
                                    checkQuantity,
                                    details
                                  )
                                );
                              }
                            }
                          }}
                          disabled={ownerSameAsUser() || isAvailableForSale}
                          id="buyNow"
                        >
                          Buy Now
                        </Button>
                      </div>
                    ) : (
                      <div className="flex ">
                        <Button
                          type="primary"
                          className="w-[80%] md:w-[365px] h-9 m-3 mt-10 !bg-primary !hover:bg-primaryHover"
                          href={`mailto:sales@blockapps.net`}
                          onClick={() => {
                            window.LOQ.push([
                              'ready',
                              async (LO) => {
                                await LO.$internal.ready('events');
                                LO.events.track(
                                  'Contact Sales (from Product Details)',
                                  {
                                    product: details?.name,
                                    category: details?.category,
                                    productId: details?.productId,
                                  }
                                );
                              },
                            ]);
                            TagManager.dataLayer({
                              dataLayer: {
                                event: 'contact_sales_from_product_details',
                                product_name: details?.name,
                                category: details?.category,
                                productId: details?.productId,
                              },
                            });
                          }}
                        >
                          Contact to Buy
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {isStakeable && ownerSameAsUser() && (
                  <>
                    <div className="flex gap-4 justify-between lg:justify-start  pt-4 w-full">
                      <Button
                        className={`bg-[#13188A] text-white w-[100%] h-9`}
                        onClick={async () => {
                          if (isStakeable && ownerSameAsUser()) {
                            isStaked
                              ? showStakeModal('Unstake')
                              : showStakeModal('Stake');
                            return;
                          }
                        }}
                        disabled={
                          !ownerSameAsUser() ||
                          (!isStaked &&
                            (inventoryDetails.price || !isActive())) ||
                          (isStaked &&
                            inventoryDetails?.escrow &&
                            inventoryDetails?.escrow?.borrowedAmount > 0)
                        }
                      >
                        {isStaked ? (
                          <div>
                            <LogoutOutlined /> Unstake
                          </div>
                        ) : (
                          <div>
                            <RiseOutlined /> Stake
                          </div>
                        )}
                      </Button>
                    </div>
                    {isStaked && (
                      <div className="flex justify-between mt-4">
                        <Button
                          className="bg-[#13188A] text-white w-48 h-10"
                          onClick={() => showBorrowModal()}
                          disabled={
                            inventoryDetails?.escrow &&
                            inventoryDetails?.escrow?.borrowedAmount > 0
                          }
                        >
                          <BankOutlined />
                          Borrow
                        </Button>
                        <Button
                          className="bg-[#13188A] text-white w-48 h-10"
                          onClick={() => showRepayModal()}
                          disabled={
                            inventoryDetails?.escrow &&
                            inventoryDetails?.escrow?.borrowedAmount <= 0
                          }
                        >
                          <SolutionOutlined />
                          Repay
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className=" mt-9 lg:mt-10 w-full md:w-[750px] sm:px-[10%] md:px-[15%] lg:px-0 pb-5 lg:w-[835px]  ">
              <Tabs
                className="product_detail"
                defaultActiveKey="0"
                items={[
                  {
                    label: (
                      <span className="text-sm md:text-base">Description</span>
                    ),
                    key: '0',
                    children: <PreviewMode content={details?.description} />,
                  },
                  {
                    label: (
                      <span className="text-sm md:text-base">Details</span>
                    ),
                    key: '1',
                    children: (
                      <div>
                        <ProductItemDetails
                          categoryName={getCategory(details)}
                          itemData={itemData}
                        />
                      </div>
                    ),
                  },
                  {
                    label: (
                      <span className="text-sm md:text-base">
                        Ownership History
                      </span>
                    ),
                    key: '2',
                    children: user ? (
                      <div>
                        <DataTableComponent
                          columns={ownershipDetailColumn}
                          scrollX="100%"
                          data={inventoryOwnershipHistory}
                          isLoading={isInventoryOwnershipHistoryLoading}
                          pagination={{
                            defaultPageSize: 10,
                            position: ['bottomCenter'],
                            showSizeChanger: false,
                          }}
                        />
                      </div>
                    ) : (
                      <div className="text-center p-4">
                        <p>
                          Please
                          <span
                            className="text-blue hover:text-blue cursor-pointer hover:underline"
                            onClick={() => {
                              setCookie(
                                'returnUrl',
                                window.location.pathname,
                                10
                              );
                              window.location.href = loginUrl;
                            }}
                          >
                            login
                          </span>
                          to view ownership history.
                        </p>
                      </div>
                    ),
                  },
                  {
                    label: (
                      <span className="text-sm md:text-base">
                        Additional Information
                      </span>
                    ),
                    key: '3',
                    children: (
                      <div>
                        <List
                          size="small"
                          boardered
                          dataSource={fileValues?.length > 0 ? fileValues : []}
                          renderItem={(item) => (
                            <List.Item>
                              <a
                                href={item.url}
                                rel="noreferrer"
                                target="_blank"
                                className="hover:underline break-all text-[#1e40af]"
                              >
                                <Button
                                  className="!text-blue border-blue"
                                  icon={<FilePdfOutlined />}
                                >
                                  {item.name}
                                </Button>
                              </a>
                            </List.Item>
                          )}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            {isFetchingPriceHistory ? (
              <div className="flex justify-center items-center h-full w-full">
                <Spin spinning={true} size="large" />
              </div>
            ) : (
              <>
                {priceHistory?.originRecords?.length !== 0 &&
                  priceHistory?.records && (
                    <div className="w-full h-full">
                      <h2 className="w-full text-center font-bold text-2xl">
                        Price History
                      </h2>
                      <TimeRangeTabs
                        onChange={handleTimeFilterChange}
                        activeKey={timeFilter}
                      />
                      <PriceChartAndStats priceHistory={priceHistory} />
                    </div>
                  )}
                <div>
                  {priceHistory?.originRecords?.length !== 0 && (
                    <>
                      <h2 className="w-full text-center font-bold text-2xl">
                        12-Month Historical Data
                      </h2>
                      <Statistics
                        priceHistory={priceHistory}
                        is18DecimalPlaces={is18DecimalPlaces}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <LoginModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onLogin={handleLogin}
      />
      {stakeModalOpen && (
        <StakeModal
          open={stakeModalOpen}
          type={stakeType}
          handleCancel={handleStakeModalClose}
          productDetailPage={Id}
          inventory={inventoryDetails}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {borrowModalOpen && (
        <BorrowModal
          open={borrowModalOpen}
          handleCancel={handleBorrowModalClose}
          productDetailPage={Id}
          inventory={inventoryDetails}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {repayModalOpen && (
        <RepayModal
          open={repayModalOpen}
          handleCancel={handleRepayModalClose}
          productDetailPage={Id}
          inventory={inventoryDetails}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {message && openToastInventory('bottom')}
    </>
  );
};

export default ProductDetails;
