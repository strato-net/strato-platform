import React, { useEffect, useState } from 'react';
import {
  Button,
  Avatar,
  Tabs,
  Spin,
  notification,
  Row,
  Col,
  Typography,
  Pagination,
  Breadcrumb,
} from 'antd';
import { UserOutlined, EditOutlined } from '@ant-design/icons';
import { Images } from '../../images';
import routes from '../../helpers/routes';
import { actions as userActivityActions } from '../../contexts/userActivity/actions';
import { actions as orderActions } from '../../contexts/order/actions';
import { useOrderDispatch } from '../../contexts/order';
import {
  useUserActivityDispatch,
  useUserActivityState,
} from '../../contexts/userActivity';
import ActivityFeed from './ActivityFeed';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
import { useAuthenticateState } from '../../contexts/authentication';
import { Link, useLocation, useMatch, useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useEthDispatch } from '../../contexts/eth';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import NewTrendingCard from '../MarketPlace/NewTrendingCard';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import { actions as categoryActions } from '../../contexts/category/actions';
import InventoryCard from '../Inventory/InventoryCard';
import { useItemDispatch, useItemState } from '../../contexts/item';
import { actions as itemActions } from '../../contexts/item/actions';
import ClickableCell from '../ClickableCell';
import {
  homeUrl,
  soldOrderDetailssBaseUrl,
  boughtOrderDetailssBaseUrl,
  ordersBaseUrl,
  transfersBaseUrl,
} from '../../helpers/constants';

const UserProfile = ({ user }) => {
  
  const [activeTab, setActiveTab] = useState('1');
  const dispatch = useInventoryDispatch();
  const categoryDispatch = useCategoryDispatch();
  const ethDispatch = useEthDispatch();
  const [category, setCategory] = useState(undefined);
  const { cartList } = useMarketplaceState();
  const [api, contextHolder] = notification.useNotification();
  const marketplaceDispatch = useMarketplaceDispatch();
  const {
    userInventories,
    isUserInventoriesLoading,
    inventories,
    isInventoriesLoading,
    message,
    success,
    inventoriesTotal,
    supportedTokens,
    isFetchingTokens,
  } = useInventoryState();
  const [assetsWithEighteenDecimalPlaces, setAssetsWithEighteenDecimalPlaces] = useState('');

  useEffect(() => {
    const fetchAddresses = async () => {
      const assetsWithEighteenDecimalPlaces = await marketplaceActions.fetchAssetsWithEighteenDecimalPlaces(
        marketplaceDispatch
      );
      await ethActions.fetchETHSTAddress(ethDispatch);
      setAssetsWithEighteenDecimalPlaces(assetsWithEighteenDecimalPlaces);
    };

    fetchAddresses();
  }, []);

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { TabPane } = Tabs;
  const orderDispatch = useOrderDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { categorys } = useCategoryState();
  const [isOwner, setIsOwner] = useState(false);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const userActivityDispatch = useUserActivityDispatch();
  const { userActivity } = useUserActivityState();
  const [wishlistData, setWishlistData] = useState([]);
  const routeMatch = useMatch({
    path: routes.MarketplaceUserProfile.url,
    strict: true,
  });
  const [commonName, setCommonName] = useState(routeMatch?.params?.commonName);
  const [breadcrumbs, setBreadcrumbs] = useState([
    { text: 'Home', path: homeUrl },
  ]);

  const params = useParams();

  //items
  const itemDispatch = useItemDispatch();
  const { message: itemMsg, success: itemSuccess } = useItemState();

  /********************************************************************************************************************************************************
                                   useEffects and Helper Methods
/*******************************************************************************************************************************************************/

  // This gets our wishlist data
  useEffect(() => {
    const storedWishlist = localStorage.getItem('wishList');
    const parsedWishlist = storedWishlist ? JSON.parse(storedWishlist) : [];
    setWishlistData(parsedWishlist);
  }, []);

  // Notification Pop-Up redirect
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const tab = searchParams.get('tab');
    // Check if the 'tab' query parameter is set to 'my-activity'
    if (tab === 'my-activity') {
      setActiveTab('2'); // Set '2' to open the "My Activity" tab
    }
  }, [commonName]);

  // helper
  const ownerSameAsUser = (commonNameOfUser) => {
    if (user?.commonName === commonNameOfUser) {
      setIsOwner(true);
      return true;
    }
    setIsOwner(false);
    return false;
  };

  // helper
  const getAllSubcategories = (categories) => {
    let subcategories = [];
    categories.forEach((category) => {
      if (category.subCategories && category.subCategories.length > 0) {
        subcategories = subcategories.concat(category.subCategories);
      }
    });
    return subcategories;
  };

  const allSubcategories = getAllSubcategories(categorys);

  //Fetch inventories for owner previewing their own profile
  useEffect(() => {
    if (isOwner) {
      inventoryActions.fetchInventory(dispatch, limit, offset, '', category);
      inventoryActions.fetchSupportedTokens(dispatch);
    }
  }, [dispatch, limit, offset, category, isOwner]);

  // Fetch Categories
  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  //helper
  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  // Tab Selection for MyWallet tab
  const handleTabSelectForOwner = (key) => {
    setCategory(key);
    setOffset(0);
    setPage(1);
    return;
  };

  //set Common Name to Fetch Inventories
  useEffect(() => {
    setCommonName(routeMatch?.params?.commonName);
    ownerSameAsUser(routeMatch?.params?.commonName);
  }, [routeMatch]);

  // Inventories For Sale fetch
  useEffect(() => {    
    if(user?.commonName === commonName){
      inventoryActions.fetchInventoryForUser(dispatch, 10000, 0, '', undefined, '', commonName);
    }
  }, [dispatch, hasChecked, isAuthenticated, loginUrl, commonName]);

  // Tab selection
  const handleTabSelect = (key) => {
    setActiveTab(key);
  };

  // User Activity Fetch
  useEffect(() => {
    if (!user) {
      return;
    }
    const profile = user.commonName;
    userActivityActions.fetchUserActivity(userActivityDispatch, profile);
  }, [userActivityDispatch, user]);

  // Bread Crumbs logic
  useEffect(() => {
    let initialBreadcrumbs = [{ text: 'Home', path: homeUrl }];
    const referrer = location.state?.from || location.pathname;

    if (referrer.includes('/dp/')) {
      const segments = referrer.split('/'); // Split the referrer by '/'
      const productID = segments[2];
      const productName = segments.pop(); // Get the last segment, which should be the address

      // productID check before pushing to breadcrumbs
      if (productID) {
        const productDetailsPath = new URL(
          `/dp/${productID}/${productName}`,
          window.location.origin
        ).toString();
        initialBreadcrumbs.push({
          text: 'Product Details',
          path: productDetailsPath,
        });
      }
    } else if (referrer.includes(ordersBaseUrl)) {
      initialBreadcrumbs.push({ text: 'Orders', path: ordersBaseUrl });
    } else if (referrer.includes(transfersBaseUrl)) {
      initialBreadcrumbs.push({ text: 'Transfers', path: transfersBaseUrl });
    }

    initialBreadcrumbs.push({
      text: isOwner ? 'My Profile' : 'Profile',
      path: '',
    });

    setBreadcrumbs(initialBreadcrumbs);
  }, [location, isOwner]);

  //helper
  const itemToast = (placement) => {
    if (itemSuccess) {
      api.success({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        placement,
        key: 3,
      });
    } else {
      api.error({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        placement,
        key: 4,
      });
    }
  };

  //helper
  const openToast = (placement, success, message) => {
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

  const addItemToCart = async (product, quantity) => {
    const items = [{ product, qty: quantity }];
    marketplaceActions.addItemToCart(marketplaceDispatch, items);
    navigate('/checkout');
    window.scrollTo(0, 0);
  };

  /**************************************************************************************************************************************************************************************
                                                   RENDER UI
/**************************************************************************************************************************************************************************************/

  return (
    <div className="container mx-auto">
      {contextHolder}
      {/* Bread Crumb Navigation */}
      <div className="px-6 md:px-5 lg:py-1 lg:mt-3 orders">
        <Breadcrumb>
          {breadcrumbs.map((breadcrumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <Breadcrumb.Item key={index}>
                {breadcrumb.path && !isLast ? (
                  // If it has a path and it's not the last breadcrumb, it's styled as a clickable link
                  <Link
                    to={breadcrumb.path}
                    className="text-sm !text-[#13188A] font-semibold"
                  >
                    {breadcrumb.text}
                  </Link>
                ) : (
                  // Last breadcrumb or if it has no path
                  <p
                    className={`text-sm ${
                      isLast ? 'text-black' : 'text-[#13188A]'
                    } ${isLast ? 'font-normal' : 'font-semibold'}`}
                  >
                    {breadcrumb.text}
                  </p>
                )}
              </Breadcrumb.Item>
            );
          })}
        </Breadcrumb>
      </div>

      {/* User Cover */}
      <div className="relative mb-6 px-6">
        <img
          className="w-full h-36 sm:h-52 md:h-60 lg:h-68 object-cover rounded-lg"
          src={Images.blockapps_cover}
          alt="Cover"
        />

        {/* Profile Picture */}
        <div
          className="absolute left-1/2 transform -translate-x-1/2 -translate-y-1/2"
          style={{ bottom: '-90px' }}
        >
          <Avatar
            size={100}
            // src={profileImage}
            icon={<UserOutlined />}
            className="border-4 border-black"
          />
        </div>
      </div>

      {/* User Name and Edit Profile */}
      <div className="text-center my-12">
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold">
          {commonName}
        </h1>
        {/* <p className="text-gray-600">Joined Oct 2023</p> */}
        <Button
          disabled
          type="primary"
          icon={<EditOutlined />}
          className="mt-4"
        >
          Edit Profile
        </Button>
      </div>

      {/* TABS Start */}

      <Tabs
        defaultActiveKey={activeTab}
        onChange={handleTabSelect}
        className="p-3 mx-1 lg:mx-6 mb-6"
      >
        {/* MyWallet Section- For Owners */}

        {isOwner && (
          <TabPane tab="My Wallet" key="0">
            {/* MyWallet Assets of the Owner Profile */}

            <Tabs
              defaultActiveKey={category ? category : 'All'}
              className="items"
              onChange={(key) => handleTabSelectForOwner(key)}
              items={[
                {
                  label: 'All',
                  key: undefined,
                  children: (
                    <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start  inventoryCard max-w-full">
                      {!isInventoriesLoading && !isFetchingTokens ? (
                        inventories.map((inventory, index) => {
                          return (
                            <InventoryCard
                              id={index}
                              inventory={inventory}
                              category={category}
                              key={index}
                              // debouncedSearchTerm={debouncedSearchTerm}
                              allSubcategories={allSubcategories}
                              supportedTokens={supportedTokens}
                              user={user}
                              assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
                            />
                          );
                        })
                      ) : (
                        <div className="absolute left-[50%] md:top-4">
                          <Spin size="large" />
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  label: 'For Sale',
                  key: 'For Sale',
                  children: (
                    <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start  inventoryCard max-w-full">
                      {!isUserInventoriesLoading && !isFetchingTokens ? (
                        userInventories.map((inventory, index) => {
                          return (
                            <InventoryCard
                              id={index}
                              inventory={inventory}
                              category={category}
                              key={index}
                              // debouncedSearchTerm={debouncedSearchTerm}
                              allSubcategories={allSubcategories}
                              supportedTokens={supportedTokens}
                              user={user}
                              assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
                            />
                          );
                        })
                      ) : (
                        <div className="absolute left-[50%] md:top-4">
                          <Spin size="large" />
                        </div>
                      )}
                    </div>
                  ),
                },
                ...categorys.map((categoryObject, index) => ({
                  label: categoryObject.name,
                  key: categoryObject.name,
                  children: (
                    <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 inventoryCard max-w-full">
                      {!isInventoriesLoading && !isFetchingTokens ? (
                        inventories.map((inventory, index) => {
                          return (
                            <InventoryCard
                              id={index}
                              inventory={inventory}
                              category={category}
                              key={index}
                              // debouncedSearchTerm={debouncedSearchTerm}
                              allSubcategories={allSubcategories}
                              supportedTokens={supportedTokens}
                              user={user}
                              assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
                            />
                          );
                        })
                      ) : (
                        <div className="absolute left-[50%] md:top-4">
                          <Spin size="large" />
                        </div>
                      )}
                    </div>
                  ),
                })),
              ]}
            />

            <div className="flex justify-center pt-6">
              <Pagination
                current={page}
                onChange={onPageChange}
                total={inventoriesTotal}
                showSizeChanger={false}
                className="flex justify-center my-5 "
              />
            </div>
          </TabPane>
        )}

        {/* Assets For Sale Content - For All Users */}

        {!isOwner && (
          <TabPane tab="Assets For Sale" key="1">
            {/* Assets of the User */}

            {isUserInventoriesLoading ? (
              <div className="h-96 w-full flex justify-center items-center">
                <Spin spinning={isUserInventoriesLoading} size="large" />
              </div>
            ) : (
              <div className="mt-4 md:mt-4 mb-8 w-full" id="product-list">
                {userInventories?.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {userInventories.map((product, index) => (
                      <NewTrendingCard
                        topSellingProduct={product}
                        key={index}
                        addItemToCart={addItemToCart}
                        isUserProfile={true}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-96 flex justify-center items-center">
                    No Assets Found
                  </div>
                )}
              </div>
            )}
          </TabPane>
        )}

        {/* Wishlist Section - For Owners */}
        {isOwner && (
          <TabPane tab="Wishlist" key="3">
            <div className="mt-4 md:mt-4 mb-8 w-full" id="wishlist">
              {wishlistData.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {wishlistData.map((product, index) => (
                    <NewTrendingCard
                      topSellingProduct={product}
                      key={index}
                      addItemToCart={addItemToCart}
                    />
                  ))}
                </div>
              ) : (
                <div className="h-96 flex justify-center items-center">
                  Your wishlist is empty.
                </div>
              )}
            </div>
          </TabPane>
        )}

        {/* Activity Section - For Owners */}
        {isOwner && (
          <TabPane tab="My Activity" key="2">
            {/* Activity Content */}
            {userActivity && userActivity.length > 0 ? (
              <div className="activity-list">
                {userActivity.map((activity, index) => {
                  let description;
                  let href;
                  switch (activity.type) {
                    case 'sold':
                      description = `You have received a new order ${activity.orderId} from ${activity.purchasersCommonName}.`;
                      href = `${soldOrderDetailssBaseUrl}/${activity.transaction_hash}`;
                      break;
                    case 'bought':
                      description = `Your order ${activity.orderId} was fulfilled by ${activity.sellersCommonName}.`;
                      href = `${boughtOrderDetailssBaseUrl}/${activity.transaction_hash}`;
                      break;
                    case 'transfer':
                      description = `You have received one or more items as a free transfer from ${activity.oldOwnerCommonName}.`;
                      href = transfersBaseUrl;
                      break;
                    default:
                      description = 'Activity occurred';
                      href = '#';
                  }
                  return (
                    <ActivityFeed
                      key={index}
                      type={activity.type}
                      description={description}
                      timestamp={activity.block_timestamp}
                      href={href}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="no-activity-message">
                <Typography.Text type="secondary">
                  You have no recent activity.
                </Typography.Text>
              </div>
            )}
          </TabPane>
        )}
      </Tabs>

      {/* TABS End */}
      {message && openToast('bottom', success, message)}
      {itemMsg && itemToast('bottom')}
    </div>
  );
};

export default UserProfile;
