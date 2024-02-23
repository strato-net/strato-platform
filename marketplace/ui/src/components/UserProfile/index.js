import React, { useEffect, useState } from "react";
import { Button, Avatar, Tabs, Spin, notification, Row, Col, Typography, Pagination } from "antd";
import { UserOutlined, EditOutlined } from "@ant-design/icons";
import { Images } from "../../images";
import routes from "../../helpers/routes";
import { actions as userActivityActions } from "../../contexts/userActivity/actions";
import { actions as orderActions } from "../../contexts/order/actions";
import { useOrderDispatch } from "../../contexts/order";
import {
  useUserActivityDispatch,
  useUserActivityState,
} from "../../contexts/userActivity";
import ActivityFeed from "./ActivityFeed";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useAuthenticateState } from "../../contexts/authentication";
import { useLocation, useMatch, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useInventoryDispatch, useInventoryState } from '../../contexts/inventory';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import NewTrendingCard from './NewTrendingCard';
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { actions as categoryActions } from "../../contexts/category/actions";
import InventoryCard from "../Inventory/InventoryCard";






const UserProfile = (user) => {

const [commonName, setCommonName] = useState(undefined);
const [activeTab, setActiveTab] = useState('1');
const dispatch = useInventoryDispatch();
const categoryDispatch = useCategoryDispatch();
const [category, setCategory] = useState(undefined);
const { cartList } = useMarketplaceState();
const [api, contextHolder] = notification.useNotification();
const marketplaceDispatch = useMarketplaceDispatch();
const { userInventories, isUserInventoriesLoading, inventories, isInventoriesLoading, message, success, isLoadingStripeStatus, stripeStatus, inventoriesTotal } = useInventoryState();
let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
const { TabPane } = Tabs;
const orderDispatch = useOrderDispatch();
const navigate = useNavigate();
const location = useLocation();
const [breadcrumb, setBreadcrumb] = useState('Home / Profile');
const { categorys } = useCategoryState();
const [isOwner, setIsOwner] = useState(false);
const limit = 10;
const [offset, setOffset] = useState(0);
const [page, setPage] = useState(1);
const userActivityDispatch = useUserActivityDispatch();
const { userActivity } = useUserActivityState();

const soldOrdersBaseUrl = new URL("/marketplace/sold-orders", window.location.origin).toString();
const boughtOrdersBaseUrl = new URL("/marketplace/bought-orders", window.location.origin).toString();
const transfersBaseUrl = new URL("/marketplace/order/transfers", window.location.origin).toString();
const params = useParams();

useEffect(() => {
  const searchParams = new URLSearchParams(window.location.search);
  const tab = searchParams.get('tab');
  console.log(tab)
  // Check if the 'tab' query parameter is set to 'my-activity'
  if (tab === 'my-activity') {
    setActiveTab('2'); // Set '2' to open the "My Activity" tab
  }
  }, [commonName]);

    const ownerSameAsUser = (commonNameOfUser) => {
        if (user.user?.commonName === commonNameOfUser) {
          setIsOwner(true);
          return true;
        }
        setIsOwner(false);
        return false;
      };


    const getAllSubcategories = (categories) => {
      let subcategories = [];
      categories.forEach(category => {
          if (category.subCategories && category.subCategories.length > 0) {
              subcategories = subcategories.concat(category.subCategories);
          }
      });
      return subcategories;
    }

    const allSubcategories = getAllSubcategories(categorys);

    useEffect(() => {
      if(isOwner) 
        {
          inventoryActions.fetchInventory(dispatch, limit, offset, "",category);
        }
      }, [dispatch, limit, offset, category, isOwner]);

    useEffect(() => {
      if(isAuthenticated && hasChecked && loginUrl)
        {
          inventoryActions.sellerStripeStatus(dispatch, user.user?.commonName);
        }
    }, [dispatch, user.user]);

    useEffect(() => {
      categoryActions.fetchCategories(categoryDispatch);
    }, [categoryDispatch]);

    const onPageChange = (page) => {
      setOffset((page - 1) * limit);
      setPage(page);
    };

    const handleTabSelectForOwner = (key) => {
      setCategory(key);
      setOffset(0);
      setPage(1);
      return;
      };

    const routeMatch = useMatch({
      path: routes.MarketplaceUserProfile.url,
      strict: true,
    });
  
    useEffect(() => {
        setCommonName(routeMatch?.params?.commonName);
        ownerSameAsUser(routeMatch?.params?.commonName);
      }, [routeMatch]);
  
  
  
    useEffect(() => {
      if(commonName){
          inventoryActions.fetchInventoryForUser(dispatch, 10, 0, commonName);
        }
      }, [dispatch, hasChecked, isAuthenticated, loginUrl, commonName]);
  
    const handleTabSelect = (key) => {
      setActiveTab(key);
      };    

    useEffect(() => {
      if (!user.user) {
        return
      }
      const profile = user.user.commonName
      userActivityActions.fetchUserActivity(userActivityDispatch, profile);
      
    }, [userActivityDispatch, user.user]);



    useEffect(() => {
      // breadcrumb based on the referrer
      const referrer = location.state?.from || location.pathname;
      // console.log(referrer)
      let breadcrumbText = 'Home / My Profile';

      if (referrer.includes('/productList/')) {
        breadcrumbText = 'Home / Product Details / Profile';
      } else if (referrer.includes('/order/bought')) {
        breadcrumbText = 'Home / Orders (Bought) / Profile';
      } else if (referrer.includes('/order/sold')) {
        breadcrumbText = 'Home / Orders (Sold) / Profile';
      } else if (referrer.includes('/order/transfers')) {
        breadcrumbText = 'Home / Transfers / Profile';
      } // Add more conditions if needed

      setBreadcrumb(breadcrumbText);
    }, [location]);

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

    const addItemToCart = async (product, quantity) => {
      if (product.ownerCommonName === user?.commonName) {
        openToast("bottom", true, "Cannot buy your own item");
        return false;
      }

      // Search for the product in the cart
      let foundIndex = cartList.findIndex((item) => item.product.address === product.address);
      let items = [...cartList]; 

      if (foundIndex === -1) {
        // Product not found, check quantity before adding
        const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, [product.saleAddress], [quantity]);
        if (checkQuantity === true) {
          // Quantity check passed, add new item to the cart
          items.push({ product, qty: quantity });
          marketplaceActions.addItemToCart(marketplaceDispatch, items);
          openToast("bottom", false, "Item added to cart");
          return true;
        } else {
          // Not enough quantity, inform the user
          openToast("bottom", true, `Currently available quantity for ${product.name}: ${checkQuantity[0].availableQuantity}. Try lowering the quantity to continue.`);
          return false;
        }
      } else {
        // Product found, prepare to update quantity after check
        const potentialNewQty = items[foundIndex].qty + quantity;
        const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, [product.saleAddress], [potentialNewQty]);
        if (checkQuantity === true) {
          // Quantity check passed, update item quantity in the cart
          items[foundIndex].qty = potentialNewQty;
          marketplaceActions.addItemToCart(marketplaceDispatch, items);
          openToast("bottom", false, "Item updated in cart");
          return true;
        } else {
          // Not enough quantity, inform the user
          openToast("bottom", true, `Currently available quantity for ${product.name}: ${checkQuantity[0].availableQuantity}. Try lowering the quantity to continue.`);
          return false;
        }
      }
    };



  return (
    
    <div className="container mx-auto p-6">
      {/* Breadcrumb */}
      <div className="mb-4 text-sm">
        <span>{breadcrumb}</span>
      </div>
      
      {/* User Cover */}
      <div className="relative mb-6">
        <img 
          className="w-full h-36 sm:h-52 md:h-60 lg:h-68 object-cover rounded-lg" 
          src={Images.collectibles} 
          alt="Cover"
        />

        {/* Profile Picture */}
        <div className="absolute left-1/2 transform -translate-x-1/2 -translate-y-1/2" style={{ bottom: '-90px' }}>
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
        <h1 className="text-lg sm:text-xl md:text-2xl font-bold">{commonName}</h1>
        {/* <p className="text-gray-600">Joined Oct 2023</p> */}
        <Button disabled type="primary" icon={<EditOutlined />} className="mt-4">Edit Profile</Button>
      </div>




      {/* Search Bar and Filter */}

      {/* <div className="flex items-center justify-center ml-4 md:ml-14 mr-14 mt-6 lg:mt-8 gap-4">
          <div className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2" 
          // onClick={handleFilterClick}
        >
          <img
            src={Images.filter}
            alt="filter"
            className=" w-5 h-5 md:w-6 md:h-6"
          />
        </div>

          <div className={`flex-1 `}>
            <Input
              size="large"
              // onChange={(e) => { (e) }}
              placeholder="Search Assets For Sale"
              prefix={<img src={Images.Header_Search} alt="search" className="w-[18px] h-[18px]" />}
              className="bg-[#F6F6F6] border-none rounded-3xl p-[10px]"
            />
          </div>
        </div> */}

      {/* End of Search Bar */}

      {/* TABS Start */}

     
     <Tabs
        defaultActiveKey={activeTab}
        onChange={handleTabSelect}
        className="p-3 ml-6 mr-6 mb-6"
      >


              {/* MyStore Section- For Owners */}

    {isOwner && (
      <TabPane tab="My Store" key="0">
            
            {/* MyStore Assets of the Owner Profile */}

          <Tabs
            defaultActiveKey={category ? category : "All"}
            className="store"
            onChange={(key) => handleTabSelectForOwner(key)}
            items={[
              {
                label: "All",
                key: undefined,
                children: (
                  <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start  inventoryCard max-w-full">
                    {!isInventoriesLoading ? (
                      inventories.map((inventory, index) => {
                        return (
                          <InventoryCard
                            id={index}
                            inventory={inventory}
                            category={category}
                            key={index}
                            // debouncedSearchTerm={debouncedSearchTerm}
                            paymentProviderAddress={
                              stripeStatus ? stripeStatus.paymentProviderAddress : undefined
                            }
                            allSubcategories={allSubcategories}
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
                label: "For Sale",
                key: 'For Sale',
                children: (
                  <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start  inventoryCard max-w-full">
                    {!isUserInventoriesLoading ? (
                      userInventories.map((inventory, index) => {
                        return (
                          <InventoryCard
                            id={index}
                            inventory={inventory}
                            category={category}
                            key={index}
                            // debouncedSearchTerm={debouncedSearchTerm}
                            paymentProviderAddress={
                              stripeStatus ? stripeStatus.paymentProviderAddress : undefined
                            }
                            allSubcategories={allSubcategories}
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
                    {!isInventoriesLoading ? (
                      inventories.map((inventory, index) => {
                        return (
                          <InventoryCard
                            id={index}
                            inventory={inventory}
                            category={category}
                            key={index}
                            // debouncedSearchTerm={debouncedSearchTerm}
                            paymentProviderAddress={
                              stripeStatus ? stripeStatus.paymentProviderAddress : undefined
                            }
                            allSubcategories={allSubcategories}
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

            {isUserInventoriesLoading ?
              <div className="h-96 w-full flex justify-center items-center">
                <Spin spinning={isUserInventoriesLoading} size="large" />
              </div>
              :
              <div className="mt-4 md:mt-4 mb-8 w-full" id="product-list">
                {userInventories?.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {userInventories.map((product, index) => (
                      <NewTrendingCard
                        topSellingProduct={product}
                        key={index}
                        addItemToCart={addItemToCart}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-96 flex justify-center items-center">
                    No Assets Found
                  </div>
                )}
              </div>
            }

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
                    case "sold":
                      description = `You have received a new order ${activity.orderId} from ${activity.purchasersCommonName}.`;
                      href = `${soldOrdersBaseUrl}/${activity.address}`;
                      break;
                    case "bought":
                      description = `Your order ${activity.orderId} was fulfilled by ${activity.sellersCommonName}.`;
                      href = `${boughtOrdersBaseUrl}/${activity.address}`;
                      break;
                    case "transfer":
                      description = `You have received one or more items as a free transfer from ${activity.oldOwnerCommonName}.`;
                      href = transfersBaseUrl; 
                      break;
                    default:
                      description = "Activity occurred";
                      href = "#";
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
    </div>
  );
};

export default UserProfile;
