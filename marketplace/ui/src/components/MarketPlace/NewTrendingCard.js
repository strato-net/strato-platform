import React, { useState, useEffect } from 'react';
import { Typography, Button, InputNumber, Tooltip } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { HeartFilled, HeartTwoTone } from '@ant-design/icons';
import TagManager from 'react-gtm-module';
import DOMPurify from 'dompurify';
import BigNumber from 'bignumber.js';
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
  const { assetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const { ethstAddress, wbtcstAddress } = useEthState();
  const { hasChecked, isAuthenticated, loginUrl, user } =
    useAuthenticateState();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isWishlisted, setIsWishlisted] = useState(false);

  const decimals = assetsWithEighteenDecimalPlaces.includes(
    topSellingProduct.originAddress
  )
    ? 18
    : topSellingProduct.decimals || 0;
  const isWbtcst = topSellingProduct.originAddress === wbtcstAddress;
  const isEthst = topSellingProduct.originAddress === ethstAddress;
  const saleQuantity = topSellingProduct.saleQuantity / Math.pow(10, decimals);
  const step = isWbtcst ? 0.0001 : isEthst ? 0.01 : decimals ? 0.01 : 1;
  const [quantity, setQuantity] = useState(step > saleQuantity ? saleQuantity : step);
  const minValue = new BigNumber(1).dividedBy(new BigNumber(10).pow(decimals));

  // state to control tooltip visibility
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const ownerSameAsUser = () => {
    if (user?.commonName === topSellingProduct?.ownerCommonName) {
      return true;
    }
    return false;
  };

  // Helper function to check if the value exceeds the allowed decimal precision
  const hasExceedPrecision = (value) => {
    if (value === undefined || value === null) return false;
    const stringValue = String(value);
    if (stringValue.includes('.')) {
      const decimalPart = stringValue.split('.')[1];
      // Use the actual decimals value to determine max precision
      const maxPrecision = decimals;
      return decimalPart && decimalPart.length > maxPrecision;
    }
    return false;
  };

  // Helper function to check if the value is below the minimum allowed value
  const isBelowMinValue = (value) => {
    if (value === undefined || value === null) return true;
    return new BigNumber(value).isLessThan(minValue);
  };

  // Helper function to check if the value exceeds maximum available quantity
  const hasExceededMaxQuantity = (value) => {
    if (value === undefined || value === null) return false;
    return new BigNumber(value).isGreaterThan(new BigNumber(saleQuantity));
  };

  // Helper function to round a value to a safe precision
  const roundToSafePrecision = (value) => {
    if (value === undefined || value === null) return value;

    // For non-decimal assets, return an integer
    if (!decimals) {
      return Math.round(value);
    }

    // Calculate precision based on step value
    let precision = 0;
    if (step < 1) {
      const stepStr = step.toString();
      // Find position after decimal point
      const decimalPos = stepStr.indexOf('.');
      if (decimalPos !== -1) {
        // Count digits after decimal point
        precision = stepStr.length - decimalPos - 1;
      }
    }

    // Use precision derived from step for rounding
    const multiplier = Math.pow(10, precision);
    return Math.round(value * multiplier) / multiplier;
  };

  // useEffect to close tooltip on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (tooltipVisible) {
        setTooltipVisible(false);
      }
    };

    // Add event listener to parent scrollable container
    const scrollContainer = document.querySelector('.trending_cards');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
    }

    return () => {
      // Clean up event listener
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScroll);
      }
    };
  }, [tooltipVisible]);

  const naviroute = routes.MarketplaceProductDetail.url;
  const ethNaviroute = routes.EthstProductDetail.url;
  const isAvailableForSale =
    topSellingProduct.price > 0 && saleQuantity > 0 && !ownerSameAsUser();
  const isBridgeable = isWbtcst || isEthst;

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

  const handleIncrement = (quantity) => {
    if (decimals) {
      let newValue = Number(quantity) + 0.01;
      newValue = parseFloat(newValue.toFixed(4));
      setQuantity(newValue);
    }
    else {
      if (
        quantity + 1 <= saleQuantity &&
        quantity + 1 <= topSellingProduct.quantity
      ) {
        setQuantity(quantity + 1);
      }
    }
  };

  const handleDecrement = (quantity) => {
    if (decimals) {
      const minValue = 1 / Math.pow(10, decimals || 0);
      if (quantity - 0.01 > 0) {
        setQuantity((prevQuantity) => {
            const newQuantity = parseFloat(
              Math.max(prevQuantity - 0.01, minValue)
            ).toFixed(4);
            return Number(newQuantity);
        });
      }
    }
    else {
      if (quantity - 1 > 0) {
        setQuantity(Math.max(quantity - 1, 1));
      }
    }
  };

  const onKeyDownPress = (e) => {
    if (decimals) {
      if (
        !/[0-9.]/.test(e.key) &&
        e.key !== 'Backspace' &&
        e.key !== 'Delete' &&
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight'
      ) {
        e.preventDefault();
      }
    }
    else {
      if (e.key === '.' || e.key === ',') {
        e.preventDefault();
      }
      // Prevent non-numeric keys except Backspace, Delete, and navigation keys
      if (
        !/^[0-9]$/.test(e.key) &&
        e.key !== 'Backspace' &&
        e.key !== 'Delete' &&
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight'
      ) {
        e.preventDefault();
      }
    }
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
            .replace(':address', topSellingProduct.assetToBeSold)
            .replace(':name', topSellingProduct.name)}`}
          onClick={(e) => {
            // Check if Command (metaKey) or Ctrl (ctrlKey) is pressed
            if (e.metaKey || e.ctrlKey) {
              // Let the browser handle it natively to open in a new tab
            } else {
              e.preventDefault();
              if (isAvailableForSale) {
                navigate(
                  `${naviroute
                    .replace(':address', topSellingProduct.assetToBeSold)
                    .replace(
                      ':name',
                      encodeURIComponent(topSellingProduct.name)
                    )}`,
                  { state: { isCalledFromInventory: false } }
                );
              } else {
                if (isEthst) {
                  navigate(
                    `${ethNaviroute.replace(
                      ':address',
                      topSellingProduct.address
                    )}`,
                    { state: { isCalledFromInventory: false } }
                  );
                } else if (isWbtcst) {
                  navigate(
                    `${routes.WbtcstProductDetail.url.replace(
                      ':address',
                      topSellingProduct.address
                    )}`,
                    { state: { isCalledFromInventory: false } }
                  );
                }
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
                const adjustedPrice =
                  topSellingProduct.price * Math.pow(10, decimals);

                return (
                  <Typography className="font-semibold">
                    {`$${adjustedPrice.toFixed(2)} `}{' '}
                    <span className="font-normal text-xs mr-2 text-primary">
                      <b>{`(${adjustedPrice?.toFixed(2)} ${'USDST'})`}</b>
                    </span>
                  </Typography>
                );
              })()
            : 'No Price Available'}
          {!isAvailableForSale && (
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
            <p>TVL: ${reserve?.tvl.toFixed(2)} </p>
          </div>
        )}
        <div style={customStyle} className="custom-typography">
          <div
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
            className="truncate-html-content"
          ></div>
        </div>
        <div className="bg-[#EEEFFA] p-2 rounded-[5px]">
          <div className="flex justify-between items-center">
            <Typography className="whitespace-nowrap mr-2 text-l">
              Quantity:
            </Typography>
            <Tooltip
              title={
                hasExceededMaxQuantity(quantity)
                  ? `Maximum quantity is ${saleQuantity}`
                  : isBelowMinValue(quantity)
                  ? `Minimum quantity is ${minValue.toFixed(decimals)}`
                  : hasExceedPrecision(quantity)
                  ? `Maximum precision is ${decimals} decimal places`
                  : ''
              }
              color="#e2320d"
              placement="top"
              open={
                tooltipVisible &&
                (isBelowMinValue(quantity) ||
                  hasExceededMaxQuantity(quantity) ||
                  hasExceedPrecision(quantity))
              }
              onOpenChange={(open) => setTooltipVisible(open)}
            >
              <div
                className="flex w-full p-1 bg-white rounded-[5px]"
                style={{
                  border:
                    isBelowMinValue(quantity) ||
                    hasExceededMaxQuantity(quantity) ||
                    hasExceedPrecision(quantity)
                      ? '1px solid #e2320d'
                      : '1px solid transparent',
                }}
              >
                <Typography
                  className={`px-2 bg-[#EEEFFA] rounded-sm ${
                    quantity > step
                      ? 'cursor-pointer'
                      : 'cursor-not-allowed opacity-50'
                  }`}
                  onClick={() => {
                    quantity > step &&
                      setQuantity(
                        roundToSafePrecision(Math.max(quantity - step, step))
                      );
                  }}
                >
                  -
                </Typography>
                <InputNumber
                  className="w-full"
                  size="small"
                  bordered={false}
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(parseFloat(e || 0));
                  }}
                  onPressEnter={(e) => {
                    const newValue = parseFloat(e.target.value, 10);
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
                    quantity < saleQuantity
                      ? 'cursor-pointer'
                      : 'cursor-not-allowed opacity-50'
                  }`}
                  onClick={() =>
                    quantity < saleQuantity &&
                    setQuantity(
                      roundToSafePrecision(
                        Math.min(quantity + step, saleQuantity)
                      )
                    )
                  }
                >
                  +
                </Typography>
              </div>
            </Tooltip>
          </div>
        </div>
        <div className={`flex gap-4`}>
          <Button
            id={`${topSellingProduct?.name?.replace(/ /g, '_')}-buy-now`}
            disabled={
              !isAvailableForSale ||
              hasExceedPrecision(quantity) ||
              isBelowMinValue(quantity) ||
              hasExceededMaxQuantity(quantity)
            }
            type="primary"
            className={`flex-1 h-9 !text-white ${
              !isAvailableForSale ||
              hasExceedPrecision(quantity) ||
              isBelowMinValue(quantity) ||
              hasExceededMaxQuantity(quantity)
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
              if ((await addItemToCart(topSellingProduct, quantity)) === true) {
                navigate('/checkout');
                window.scrollTo(0, 0);
              }
            }}
          >
            Buy Now
          </Button>
          {isBridgeable && reserve && (
            <Button
              id={`${topSellingProduct?.name?.replace(/ /g, '_')}-bridge`}
              disabled={!isBridgeable}
              type="primary"
              className={`flex-1 h-9 !text-white ${
                !isBridgeable
                  ? '!bg-[#808080] cursor-not-allowed'
                  : '!bg-[#13188A] cursor-pointer'
              }`}
              onClick={async () => {
                const dataLayerEventName = isUserProfile
                  ? 'bridge_from_user_profile'
                  : 'bridge_from_top_selling_product';
                window.LOQ.push([
                  'ready',
                  async (LO) => {
                    await LO.$internal.ready('events');
                    const eventName = isUserProfile
                      ? 'Bridge (from User Profile)'
                      : 'Bridge (from Top Selling Product)';
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
                if (isEthst) {
                  navigate(
                    `${ethNaviroute.replace(
                      ':address',
                      topSellingProduct.address
                    )}`,
                    { state: { isCalledFromInventory: false } }
                  );
                } else if (isWbtcst) {
                  navigate(
                    `${routes.WbtcstProductDetail.url.replace(
                      ':address',
                      topSellingProduct.address
                    )}`,
                    { state: { isCalledFromInventory: false } }
                  );
                }
              }}
            >
              Bridge
            </Button>
          )}
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
