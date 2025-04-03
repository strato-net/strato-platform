import React, { useState, useEffect } from 'react';
import { Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
// State
import { useAuthenticateState } from '../../contexts/authentication';
import { useEthDispatch, useEthState } from '../../contexts/eth';
// Assets
import images_placeholder from '../../images/resources/image_placeholder.png';
// other
import { actions as ethActions } from '../../contexts/eth/actions';
import { setCookie } from '../../helpers/cookie';
import { SEO } from '../../helpers/seoConstant';
import LoginModal from './LoginModal';
import routes from '../../helpers/routes';

const NewVaultCard = ({ reserveItem, reserve, parent = '', contextHolder }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const ethDispatch = useEthDispatch();
  const { hasChecked, isAuthenticated, loginUrl, user } =
    useAuthenticateState();
  const { bridgeableTokens } = useEthState();
  const ownerSameAsUser = () => {
    if (user?.commonName === reserveItem?.ownerCommonName) {
      return true;
    }
    return false;
  };
  const isAvailableForSale =
    reserveItem.price > 0 && reserveItem.saleQuantity > 0 && !ownerSameAsUser();

  useEffect(() => {
    const fetchAddresses = async () => {
      ethActions.fetchBridgeableTokens(ethDispatch);
    };

    fetchAddresses();
  }, []);

  const [isModalVisible, setIsModalVisible] = useState(false);

  const queryParams = new URLSearchParams(location.search);
  const categoryQueryValue = queryParams.get('category');
  const categoryQueryValueArr = categoryQueryValue
    ? categoryQueryValue.split(',')
    : [];
  const imgMeta =
    categoryQueryValueArr.length === 1
      ? categoryQueryValueArr[0]
      : SEO.IMAGE_META;


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

  const handleCardClick = () => {
    if (isAvailableForSale) {
      navigate(
        routes.MarketplaceProductDetail.url
          .replace(':address', reserveItem.address)
          .replace(':name', reserveItem.name),
        { state: { isCalledFromInventory: false } }
      );
    } else {
      if (bridgeableTokens?.map((token) => token.address).includes(reserveItem.originAddress)) {
        navigate(
          `${routes.bridgeableProductDetail.url.replace(
            ':address',
            reserveItem.address
          ).replace(':bridgeableAsset', reserveItem.name)}`,
          {
            state: { isCalledFromInventory: false },
          })
      } else {
        navigate(
          `${routes.MarketplaceProductDetail.url
            .replace(':address', reserveItem.root)
            .replace(':name', reserveItem.name)}`,
          { state: { isCalledFromInventory: false } }
        );
      }
    }
  };

  return (
    <>
      <div
        id="productCard"
        className={`relative trending_cards_container_card bg-white p-3 ${parent === 'Marketplace' ? 'min-w-[300px] w-auto' : 'min-w-[230px]'
          }  min-w-[320px] md:min-w-[300px] rounded-md flex flex-col gap-2 md:gap-3 shadow-card_shadow h-max`}
        onClick={handleCardClick}
      >
        {contextHolder}
        <a className="flex items-center gap-4">
          {/* Image on the Left */}
          <img
            className="h-[60px] w-[60px] object-contain rounded-md cursor-pointer"
            src={
              reserveItem['BlockApps-Mercata-Asset-images']?.length > 0
                ? reserveItem['BlockApps-Mercata-Asset-images'][0].value
                : images_placeholder
            }
            alt={imgMeta}
            title={imgMeta}
          />

          {/* Text on the Right */}
          <div className="flex flex-col justify-center w-full">
            <Typography className="font-semibold text-xl text-gray-900 overflow-hidden cursor-pointer whitespace-nowrap text-ellipsis">
              {reserveItem.name}
            </Typography>
            <div className="flex justify-between items-center w-full">
              {/* Interest */}
              <Typography className="font-semibold text-gray-600 overflow-hidden cursor-pointer whitespace-nowrap text-ellipsis">
                TVL: ${reserve?.tvl.toFixed(2)}
              </Typography>
            </div>
          </div>
        </a>
      </div>
      <LoginModal
        visible={isModalVisible}
        onCancel={handleCancel}
        onLogin={handleLogin}
      />
    </>
  );
};

export default NewVaultCard;
