import React, { useState, useEffect } from 'react';
import { Typography, Button, InputNumber, Tooltip } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { HeartFilled, HeartTwoTone } from '@ant-design/icons';
import TagManager from 'react-gtm-module';
import DOMPurify from 'dompurify';
// State
import { useAuthenticateState } from '../../contexts/authentication';
import { useMarketplaceState } from '../../contexts/marketplace';
import { useEthState } from '../../contexts/eth';
// Assets
import images_placeholder from '../../images/resources/image_placeholder.png';
import { Images } from '../../images';
// other
import { setCookie } from '../../helpers/cookie';
import { SEO } from '../../helpers/seoConstant';
import routes from '../../helpers/routes';
import LoginModal from './LoginModal';

const NewTrendingCard = ({
  topSellingProduct,
  addItemToCart,
  parent = '',
  api,
  contextHolder,
  isUserProfile = false,
  reserve,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { Text } = Typography;
  const { assetsWithEighteenDecimalPlaces } =
    useMarketplaceState();
  const { ethstAddress } = useEthState();
  const { hasChecked, isAuthenticated, loginUrl, user } =
    useAuthenticateState();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(false);

  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
    topSellingProduct.originAddress
  );
  const saleQuantity = is18DecimalPlaces
    ? topSellingProduct.saleQuantity / Math.pow(10, 18)
    : topSellingProduct.saleQuantity;
  const [quantity, setQuantity] = useState(1);

  const ownerSameAsUser = () => {
    if (user?.commonName === topSellingProduct?.ownerCommonName) {
      return true;
    }
    return false;
  };

  const naviroute = routes.MarketplaceProductDetail.url;
  const ethNaviroute = routes.EthstProductDetail.url;
  const isAvailableForSale = !topSellingProduct.price || saleQuantity === 0;
  const isDisabled =
    topSellingProduct.originAddress !== ethstAddress &&
    (isAvailableForSale || ownerSameAsUser());

  const queryParams = new URLSearchParams(location.search);
  const categoryQueryValue = queryParams.get('category');
  const categoryQueryValueArr = categoryQueryValue
    ? categoryQueryValue.split(',')
    : [];
  const imgMeta =
    categoryQueryValueArr.length === 1
      ? categoryQueryValueArr[0]
      : SEO.IMAGE_META;

  const sanitizedDescription = DOMPurify.sanitize(
    topSellingProduct?.description || 'N/A'
  );
  const customStyle = {
    color: '#989898',
    opacity: 0.4,
    maxHeight: '1.25rem',
    maxWidth: '30rem',
    overflow: 'hidden',
  };

  // This checks to see if an item is in the wishlist. This will help us render the correct icon
  useEffect(() => {
    const wishList = JSON.parse(localStorage.getItem('wishList')) || [];
    const productInWishlist = wishList.some(
      (product) => product.address === topSellingProduct?.address
    );
    setIsWishlisted(productInWishlist);
  }, [topSellingProduct]);

  const toggleWishlist = () => {
    if (!isAuthenticated || !user) {
      setIsModalVisible(true);
    } else {
      const wishList = JSON.parse(localStorage.getItem('wishList')) || [];
      if (isWishlisted) {
        // Remove product from wishlist
        const updatedWishList = wishList.filter(
          (product) => product.address !== topSellingProduct.address
        );
        localStorage.setItem('wishList', JSON.stringify(updatedWishList));
        setIsWishlisted(false);
      } else {
        // Add product to wishlist
        wishList.push(topSellingProduct);
        localStorage.setItem('wishList', JSON.stringify(wishList));
        setIsWishlisted(true);
      }
    }
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

  return (
    <>
      <div
        id="productCard"
        className={`relative trending_cards_container_card bg-white p-3 ${
          parent === 'Marketplace' ? 'min-w-[300px] w-auto' : 'min-w-[230px]'
        }  min-w-[320px] md:min-w-[300px] rounded-md flex flex-col gap-2 md:gap-3 shadow-card_shadow h-max`}
      >
        {contextHolder}
        {!ownerSameAsUser() && (
          <div
            onClick={toggleWishlist}
            className="absolute top-2 right-2 cursor-pointer hover:scale-110 transition-transform duration-200"
          >
            {isWishlisted ? (
              <HeartFilled style={{ fontSize: '20px', color: '#A15E49' }} />
            ) : (
              <HeartTwoTone
                style={{ fontSize: '20px' }}
                twoToneColor="#A15E49"
              />
            )}
          </div>
        )}
        <a
          href={`${naviroute
            .replace(':address', topSellingProduct.address)
            .replace(':name', topSellingProduct.name)}`}
          onClick={(e) => {
            // Check if Command (metaKey) or Ctrl (ctrlKey) is pressed
            if (e.metaKey || e.ctrlKey) {
              // Let the browser handle it natively to open in a new tab
            } else {
              e.preventDefault();
              if (topSellingProduct.originAddress === ethstAddress) {
                navigate(
                  `${ethNaviroute.replace(
                    ':address',
                    topSellingProduct.address
                  )}`,
                  { state: { isCalledFromInventory: false } }
                );
              } else {
                navigate(
                  `${naviroute
                    .replace(':address', topSellingProduct.address)
                    .replace(
                      ':name',
                      encodeURIComponent(topSellingProduct.name)
                    )}`,
                  { state: { isCalledFromInventory: false } }
                );
              }
              window.scrollTo(0, 0);
            }
          }}
        >
          <img
            className="md:h-[200px] md:w-[40vw] h-[150px] w-full object-contain rounded-md cursor-pointer mb-2"
            src={
              topSellingProduct['BlockApps-Mercata-Asset-images']?.length > 0
                ? topSellingProduct['BlockApps-Mercata-Asset-images'][0].value
                : images_placeholder
            }
            alt={imgMeta}
            title={imgMeta}
          />
          <div className="flex justify-between items-center">
            <Typography className="font-semibold overflow-hidden cursor-pointer w-[180px] md:w-[220px] whitespace-nowrap text-ellipsis">
              <Tooltip
                title={
                  topSellingProduct?.name?.length > 20
                    ? topSellingProduct?.name
                    : null
                }
              >
                <span
                  id={`asset-${topSellingProduct?.name}`}
                  className=" whitespace-nowrap max-w-[160px] inline-block"
                >
                  {topSellingProduct?.name?.length > 20
                    ? `${topSellingProduct?.name.slice(0, 20)}...`
                    : `${topSellingProduct?.name}`}
                </span>
              </Tooltip>
              {/* {topSellingProduct?.name || "N/A"} */}
            </Typography>
            <img
              alt={imgMeta}
              title={imgMeta}
              className="w-4 h-4"
              src={Images.Verified}
            />
          </div>
        </a>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {topSellingProduct?.price
            ? (() => {
                
                const adjustedPrice = is18DecimalPlaces
                  ? topSellingProduct.price * Math.pow(10, 18)
                  : topSellingProduct.price;

                return (
                  <Typography className="font-semibold">
                    {`$${adjustedPrice} `}{' '}
                    <span className="font-normal text-xs mr-2 text-primary">
                      <b>{`(${adjustedPrice?.toFixed(2)} ${'USDST'})`}</b>
                    </span>
                  </Typography>
                );
              })()
            : 'No Price Available'}
          {isDisabled && (
            <Text type="danger" strong>
              {' '}
              Sold Out{' '}
            </Text>
          )}
          {topSellingProduct?.contract_name
            .toLowerCase()
            .includes('clothing') && (
            <Typography className="font-normal text-black">
              Size:{' '}
              {topSellingProduct?.data?.size
                ? topSellingProduct?.data?.size
                : 'N/A'}
            </Typography>
          )}
        </div>
        {reserve && (
          <div className="flex justify-between">
            <p>Est. APY: {reserve?.cataAPYRate}%</p>
            <p>TVL: ${reserve?.tvl.toFixed(2)} </p>
          </div>
        )}
        <div style={customStyle} className="custom-typography">
          <div
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
            className="truncate-html-content"
          ></div>
        </div>
        <div className={`flex justify-between items-center bg-[#EEEFFA] p-2 rounded-[4px] ${topSellingProduct.originAddress === ethstAddress ? 'invisible' : ''}`}>
          <Typography>Quantity:</Typography>
          <div className="flex gap-3 p-1 bg-white">
            <Typography
              className={`px-2 bg-[#EEEFFA] rounded-sm ${
                quantity === 1
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              }`}
              onClick={() => {
                setQuantity(Math.max(quantity - 1, 1));
              }}
            >
              -
            </Typography>
            <InputNumber
              className="w-10"
              size="small"
              bordered={false}
              value={quantity}
              max={saleQuantity}
              min={1}
              onChange={(e) => {
                setQuantity(parseInt(e || 0));
              }}
              onPressEnter={(e) => {
                const newValue = parseInt(e.target.value, 10);
                if (newValue <= saleQuantity) {
                  setQuantity(newValue);
                } else {
                  api.error({
                    message: 'Cannot add more than available quantity',
                    placement: 'bottom',
                  });
                }
              }}
              controls={false}
            />
            <Typography
              className={`px-2 bg-[#EEEFFA] rounded-sm ${
                quantity >= Math.min(saleQuantity, topSellingProduct.quantity)
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              }`}
              onClick={() => {
                if (
                  quantity + 1 <= saleQuantity &&
                  quantity + 1 <= topSellingProduct.quantity
                ) {
                  setQuantity(quantity + 1);
                }
              }}
            >
              +
            </Typography>
          </div>
        </div>
        <div className={`flex gap-4 mt-1`}>
          <Button
            id={`${topSellingProduct?.name?.replace(/ /g, '_')}-buy-now`}
            disabled={isDisabled}
            type="primary"
            className={`flex-1 h-9 !text-white ${
              isDisabled
                ? '!bg-[#808080] cursor-not-allowed'
                : '!bg-[#13188A] cursor-pointer'
            }`}
            onClick={async () => {
              const dataLayerEventName = isUserProfile
                ? 'buy_now_from_user_profile'
                : 'buy_now_from_top_selling_product';
              window.LOQ.push([
                'ready',
                async (LO) => {
                  await LO.$internal.ready('events');
                  const eventName = isUserProfile
                    ? 'Buy Now (from User Profile)'
                    : 'Buy Now (from Top Selling Product)';
                  LO.events.track(eventName, {
                    product: topSellingProduct.name,
                    category: topSellingProduct.category,
                    productId: topSellingProduct.productId,
                  });
                },
              ]);
              TagManager.dataLayer({
                dataLayer: {
                  event: dataLayerEventName,
                  product_name: topSellingProduct.name,
                  category: topSellingProduct.category,
                  productId: topSellingProduct.productId,
                },
              });
              if (topSellingProduct.originAddress === ethstAddress) {
                navigate(
                  `${ethNaviroute.replace(
                    ':address',
                    topSellingProduct.address
                  )}`,
                  { state: { isCalledFromInventory: false } }
                );
              } else {
                if (
                  (await addItemToCart(topSellingProduct, quantity)) === true
                ) {
                  navigate('/checkout');
                  window.scrollTo(0, 0);
                }
              }
            }}
          >
            {topSellingProduct.originAddress === ethstAddress
              ? 'Bridge'
              : 'Buy Now'}
          </Button>
          {/* TODO:- Remove Comment to show the Add-to-Cart Button */}
          {/* <Button
                        className={`h-9 w-9 flex items-center justify-center ${isAvailableForSale ? '!bg-[#808080]' : '!bg-[#13188A]'} ${ownerSameAsUser() ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        disabled={isAvailableForSale || ownerSameAsUser()}
                        onClick={() => {
                            window.LOQ.push(['ready', async LO => {
                                await LO.$internal.ready('events')
                                LO.events.track('Add To Cart (from Top Selling Product)', {
                                    product: topSellingProduct.name,
                                    category: topSellingProduct.category,
                                    productId: topSellingProduct.productId
                                })
                            }])
                            TagManager.dataLayer({
                                dataLayer: {
                                    event: 'add_to_cart_from_top_selling_product',
                                    product_name: topSellingProduct.name,
                                    category: topSellingProduct.category,
                                    productId: topSellingProduct.productId
                                },
                            });
                            addItemToCart(topSellingProduct, quantity);
                        }}
                        type='primary'
                    >

                        <img alt={imgMeta} title={imgMeta} src={Images.Cart} width={18} height={18} className='max-w-[18px]' />
                    </Button> */}
        </div>
      </div>
      <LoginModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onLogin={handleLogin}
      />
    </>
  );
};

export default NewTrendingCard;
