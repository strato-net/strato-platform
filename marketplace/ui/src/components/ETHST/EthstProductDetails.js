import React, { useState, useEffect, useMemo } from 'react';
import {
  Row,
  Breadcrumb,
  Button,
  Typography,
  Tabs,
  Spin,
  notification,
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
//actions
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as categoryActions } from '../../contexts/category/actions';
import { actions as marketPlaceActions } from '../../contexts/marketplace/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
// dispatch & state
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import { useAuthenticateState } from '../../contexts/authentication';
import { useEthDispatch, useEthState } from '../../contexts/eth';
// components
import HelmetComponent from '../Helmet/HelmetComponent';
import DataTableComponent from '../DataTableComponent';
import ProductItemDetails from '../MarketPlace/ProductItemDetails';
import PriceChartAndStats from '../MarketPlace/PriceChartAndStats';
import PreviewMode from '../RichEditor/PreviewMode';
import ClickableCell from '../ClickableCell';
import TimeRangeTabs from '../MarketPlace/TimeRangeTabs';
import Statistics from '../MarketPlace/Statistics';
import EthstSteps from './EthstSteps';
import LoginModal from '../MarketPlace/LoginModal';
import StakeModal from '../Inventory/StakeModal';
import BorrowModal from '../Inventory/BorrowModal';
import RepayModal from '../Inventory/RepayModal';
import BridgeWallet from './BridgeWallet';

// other
import { setCookie } from '../../helpers/cookie';
import routes from '../../helpers/routes';
import '../MarketPlace/index.css';

import image_placeholder from '../../images/resources/image_placeholder.png';
import 'react-responsive-carousel/lib/styles/carousel.min.css'; // requires a loader

import { SEO } from '../../helpers/seoConstant';
import { ASSET_STATUS, fileServerUrl } from '../../helpers/constants';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Ethers5Adapter } from '@reown/appkit-adapter-ethers5';
import { mainnet, sepolia } from '@reown/appkit/networks';
import { useAppKit, useAppKitAccount, createAppKit } from '@reown/appkit/react';
import { ethers } from 'ethers';

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
  const marketplaceDispatch = useMarketplaceDispatch();
  const ethDispatch = useEthDispatch();
  // state
  const { categorys, iscategorysLoading } = useCategoryState();
  const {
    inventoryDetails,
    isInventoryDetailsLoading,
    isInventoryOwnershipHistoryLoading,
    inventoryOwnershipHistory,
    priceHistory,
    isFetchingPriceHistory,
    reserves,
  } = useInventoryState();
  const { cartList } = useMarketplaceState();
  const { success, message } = useEthState();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [timeFilter, setTimeFilter] = useState('1');
  const [itemData, setItemData] = useState({});
  const [Id, setId] = useState(undefined);
  const [bridgeWalletModalOpen, setBridgeWalletModalOpen] = useState(false);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [stakeType, setStakeType] = useState(null);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);
  // For Wishlist Icon Rendering
  const [isWishlisted, setIsWishlisted] = useState(false);

  // Stakeable
  const isStaked =
    inventoryDetails?.escrow &&
    inventoryDetails?.escrow?.collateralQuantity > 0;

  const matchingReserve = reserves?.find(
    (reserve) => reserve.assetRootAddress === inventoryDetails?.root
  );
  let isCalledFromInventory = false;
  if (state !== null && state !== undefined) {
    isCalledFromInventory = state.isCalledFromInventory;
  } else if (pathname.includes('inventories')) {
    isCalledFromInventory = true;
  }

  const routeMatch = useMatch({
    path: routes.EthstProductDetail.url,
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

  const projectId = '776a599eda93a02ba9c62ee8ca5f35af';
  const ethers5Adapter = new Ethers5Adapter();

  createAppKit({
    adapters: [ethers5Adapter],
    metadata: {
      name: 'Mercata Marketplace',
      description:
        'STRATO Mercata marketplace for buying, selling, and investing in fractionalized assets.',
      url: 'https://marketplace.mercata.blockapps.net/',
      icons: ['https://avatars.githubusercontent.com/u/179229932?s=200&v=4'],
    },
    networks: [fileServerUrl.includes('test') ? sepolia : mainnet],
    projectId,
    enableWalletConnect: false,
    features: {
      email: false,
      socials: [],
      emailShowWallets: false,
    },
  });

  const appKit = useAppKit();
  const rawAccount = useAppKitAccount();
  const [ethBalance, setEthBalance] = useState(0);
  const [signer, setSigner] = useState({});

  const account = useMemo(() => {
    return rawAccount && rawAccount.address ? rawAccount : null;
  }, [rawAccount?.address]);

  useEffect(() => {
    const fetchBalance = async () => {
      if (account?.address) {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const balanceWei = await provider.getBalance(account.address);
        const signer = provider.getSigner();
        setSigner(signer);
        setEthBalance(ethers.utils.formatEther(balanceWei));
      }
    };

    fetchBalance();
  }, [account]);

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

  const showBridgeWalletModal = () => {
    setBridgeWalletModalOpen(true);
  };

  const handleBridgeWalletModalClose = () => {
    setBridgeWalletModalOpen(false);
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

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: ethActions.resetMessage(ethDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: ethActions.resetMessage(ethDispatch),
        placement,
        key: 2,
      });
    }
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
          <EthstSteps />
          <div className="flex w-full flex-col md:leading-12 px-4 sm:px-8 md:px-0 items-center md:w-[750px] md:w-[835px] xl:w-[858px]  md:mx-auto mt-12">
            <div className="flex md:justify-center gap-[15px] md:gap-6 flex-col md:flex-row items-center">
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
              <div className="w-72">
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
                    <div>
                      <Text className="text-[#202020] text-xs font-medium  self-center">
                        {details?.creator || 'N/A'}
                      </Text>
                    </div>
                  </div>
                </div>

                {!ownerSameAsUser() && (
                  <div className=" pt-4 lg:pt-[22px]">
                    <Paragraph
                      level={4}
                      id="price"
                      className=" text-[#13188A] text-xl font-bold lg:text-2xl lg:font-semibold"
                    >
                      <div className="text-lg">
                        Est. APY: {matchingReserve?.cataAPYRate}%
                      </div>
                      <div className="text-lg">
                        TVL: ${matchingReserve?.tvl.toFixed(2)}
                      </div>
                    </Paragraph>
                  </div>
                )}

                {!ownerSameAsUser() && (
                  <>
                    <div className="flex gap-4 justify-between lg:justify-start  pt-4 w-full">
                      <Button
                        type="primary"
                        className={`w-[100%]  h-9 !bg-[#13188A] !hover:bg-primaryHover !text-white`}
                        onClick={async () => {
                          if (!isAuthenticated || !user) {
                            setIsModalVisible(true);
                          } else {
                            if (account?.address) {
                              showBridgeWalletModal();
                            } else {
                              appKit.open();
                            }
                          }
                        }}
                      >
                        {account?.address ? 'Bridge' : 'Connect Wallet'}
                      </Button>
                    </div>
                    {account?.address && (
                      <div className="bg-[#13188A] rounded-full mt-2">
                        <appkit-account-button />
                      </div>
                    )}
                  </>
                )}
                {ownerSameAsUser() && (
                  <>
                    <div className="flex gap-4 justify-between lg:justify-start  pt-4 w-full">
                      <Button
                        className={`bg-[#13188A] text-white w-[100%] h-9`}
                        onClick={async () => {
                          if (ownerSameAsUser()) {
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
                          Please{' '}
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
                          </span>{' '}
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
                      <PriceChartAndStats
                        priceHistory={priceHistory}
                      />
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
          
        />
      )}
      {bridgeWalletModalOpen && (
        <BridgeWallet
          open={bridgeWalletModalOpen}
          handleCancel={handleBridgeWalletModalClose}
          signer={signer}
          accountDetails={{
            walletAddress: account?.address,
            ethBalance: ethBalance,
          }}
        />
      )}
      {borrowModalOpen && (
        <BorrowModal
          open={borrowModalOpen}
          handleCancel={handleBorrowModalClose}
          productDetailPage={Id}
          inventory={inventoryDetails}
          reserves={reserves}
        />
      )}
      {repayModalOpen && (
        <RepayModal
          open={repayModalOpen}
          handleCancel={handleRepayModalClose}
          productDetailPage={Id}
          inventory={inventoryDetails}
          reserves={reserves}
        />
      )}
      {message && openToast('bottom')}
    </>
  );
};

export default ProductDetails;
