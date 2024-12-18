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
} from 'antd';
import { useMatch, useNavigate, useLocation } from 'react-router-dom';
import TagManager from 'react-gtm-module';
//actions
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
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
import ProductItemDetails from './ProductItemDetails';
import PreviewMode from '../RichEditor/PreviewMode';
import ClickableCell from '../ClickableCell';
import LoginModal from './LoginModal';
import StakeModal from '../Inventory/StakeModal';
// other
import { setCookie } from '../../helpers/cookie';
import routes from '../../helpers/routes';
import './index.css';

import image_placeholder from '../../images/resources/image_placeholder.png';
import 'react-responsive-carousel/lib/styles/carousel.min.css'; // requires a loader

import { SEO } from '../../helpers/seoConstant';
import { USDST_CONVERSION } from '../../helpers/constants';
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

const VaultDetails = ({ user, users }) => {
  const [api, contextHolder] = notification.useNotification();
  const { Text, Paragraph, Title } = Typography;
  const { state, pathname } = useLocation();
  const navigate = useNavigate();

  const { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  // dispatch
  const dispatch = useInventoryDispatch();
  const orderDispatch = useOrderDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  // state
  const { categorys, iscategorysLoading } = useCategoryState();
  const {
    success,
    message,
    inventoryDetails,
    isInventoryDetailsLoading,
    reserve,
  } = useInventoryState();
  const { cartList, usdstAddress, assetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [timeFilter, setTimeFilter] = useState('1');
  const [itemData, setItemData] = useState({});
  const [Id, setId] = useState(undefined);
  const [qty, setQty] = useState(1);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [stakeType, setStakeType] = useState(null);
  const [availableQuantity, setAvailableQuantity] = useState(1);

  // Stakeable
  const isStaked =
    inventoryDetails?.escrow &&
    inventoryDetails?.escrow?.collateralQuantity > 0;
  const isStakeable =
    inventoryDetails?.root &&
    reserve &&
    inventoryDetails?.root === reserve[0]?.assetRootAddress;

  let isCalledFromInventory = false;
  if (state !== null && state !== undefined) {
    isCalledFromInventory = state.isCalledFromInventory;
  } else if (pathname.includes('inventories')) {
    isCalledFromInventory = true;
  }

  const routeMatch = useMatch({
    path: routes.VaultDetail.url,
    strict: true,
  });

  const ownerSameAsUser = () => {
    if (user?.commonName === inventoryDetails?.ownerCommonName) {
      return true;
    }
    return false;
  };

  useEffect(() => {
    setId(routeMatch?.params?.address);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      inventoryActions.getReserve(dispatch, Id);
    }
  }, [Id, dispatch]);

  useEffect(() => {
    if (Id !== undefined) {
      inventoryActions.fetchPriceHistory(dispatch, Id, 10, 0, timeFilter);
    }
  }, [Id, dispatch, timeFilter]);

  useEffect(() => {
    if (inventoryDetails) {
      inventoryActions.fetchInventoryOwnershipHistory(dispatch, {
        originAddress: inventoryDetails.originAddress,
        minItemNumber: inventoryDetails.itemNumber,
        maxItemNumber:
          inventoryDetails.itemNumber + inventoryDetails.quantity - 1,
      });
    }
  }, [inventoryDetails, dispatch]);

  useEffect(() => {
    marketPlaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const details = reserve  && reserve.asset;
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(details.originAddress);
  const isUsdst = details.originAddress === usdstAddress;
  let fileValues = [];
  let fileNames = [];
  if (reserve && Array.isArray(reserve.asset['BlockApps-Mercata-Asset-fileNames'])) {
    fileNames = reserve.asset['BlockApps-Mercata-Asset-fileNames'];
  }

  if (reserve && Array.isArray(reserve.asset['BlockApps-Mercata-Asset-files'])) {
    fileValues = reserve.asset['BlockApps-Mercata-Asset-files'].map((file, index) => {
      let name = fileNames[index]?.value
        ? fileNames[index]?.value
        : `Information-${index + 1}.pdf`;
      name = name.replace(/ /g, '-');
      return { url: file.value, name };
    });
  }

  useEffect(() => {
    if (categorys.length && details) {
      const detailsData = details.data;
      setItemData(detailsData);
      if (details.saleQuantity) {
        let saleQuantity = isUsdst ? details.saleQuantity / 100 : is18DecimalPlaces ? details.saleQuantity / Math.pow(10, 18) : details.saleQuantity;
        setAvailableQuantity(saleQuantity || 1);
      }
    }
  }, [categorys, details]);

  const showStakeModal = (type) => {
    setStakeModalOpen(true);
    setStakeType(type);
  };

  const handleStakeModalClose = () => {
    setStakeModalOpen(false);
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
    const value = Math.max(qty - 1, 1);
    setQty(value);
  };

  const add = () => {
    if (qty + 1 <= availableQuantity) {
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
                Vault Detail
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
                <div className=" lg:border-b lg:border-[#E9E9E9] pb-[6px]">
                  <Title
                    style={{ fontSize: '30px' }}
                    className="font-semibold text-base lg:text-3xl text-[#202020]"
                  >
                    {decodeURIComponent(details?.name)}
                  </Title>
                </div>
                <div className=" pt-4 lg:pt-[22px]">
                  <Paragraph
                    level={4}
                    id="price"
                    className=" text-[#13188A] text-xl font-bold lg:text-2xl lg:font-semibold"
                  >
                    {details?.price || isStaked
                      ? (() => {
                          const adjustedPrice = isUsdst ? details.price * 100 : is18DecimalPlaces ? details.price * Math.pow(10, 18) : details.price;
                          return (
                            <>
                              $
                              {isStaked
                                ? (details.escrow?.maxLoanAmount / 100).toFixed(4)
                                : adjustedPrice}
                              <span className="font-normal text-xs mr-2 text-primary">
                                <b>
                                  (
                                  {isStaked
                                    ? details.escrow?.maxLoanAmount
                                    : (
                                        adjustedPrice * USDST_CONVERSION
                                      ).toFixed(0)}{' '}
                                  {(isStaked
                                    ? details.escrow?.maxLoanAmount
                                    : (
                                        adjustedPrice * USDST_CONVERSION
                                      ).toFixed(0)) == 1
                                    ? 'USDST'
                                    : 'USDST'}
                                  )
                                </b>
                              </span>
                            </>
                          );
                        })()
                      : 'No Price Available'}
                  </Paragraph>
                  {isAvailableForSale && (
                    <Text type="danger" strong>
                      {' '}
                      Sold Out{' '}
                    </Text>
                  )}
                </div>

                {availableQuantity !== 0 ? (
                  <div
                    className="flex justify-between lg:justify-start  w-full gap-3 lg:gap-[15px] pt-6 lg:pt-[18px]"
                    id="quantity"
                  >
                    <div
                      onClick={subtract}
                      className={`h-9 w-11 md:h-10 md:w-12 lg:h-[46px] lg:w-[52px] rounded-lg flex justify-center items-center border border-[#00000029] text-center cursor-pointer ${
                        qty > 1 ? '' : 'cursor-not-allowed opacity-50'
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
                      value={`${qty}`}
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
                        qty < availableQuantity
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
                {availableQuantity !== 0 ? (
                  <div className="flex gap-4 justify-between lg:justify-start  pt-4 w-full">
                    <Button
                      type="primary"
                      className={`w-[100%]  h-9  ${
                        isAvailableForSale && !(isStakeable && !isStaked)
                          ? '!bg-[#808080]'
                          : '!bg-[#13188A]'
                      } !hover:bg-primaryHover !text-white`}
                      onClick={async () => {
                        if (isStakeable && ownerSameAsUser()) {
                          isStaked
                            ? showStakeModal('Unstake')
                            : showStakeModal('Stake');
                          return;
                        }

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
                      disabled={
                        ownerSameAsUser() &&
                        isAvailableForSale &&
                        !(isStakeable && !isStaked)
                      }
                      id="buyNow"
                    >
                      {isStakeable && ownerSameAsUser()
                        ? isStaked
                          ? 'Unstake'
                          : 'Stake'
                        : 'Buy Now'}
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
                  }
                ]}
              />
            </div>
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
        />
      )}
      {message && openToastInventory('bottom')}
    </>
  );
};

export default VaultDetails;
