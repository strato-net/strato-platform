import React, { useEffect, useState } from 'react';
import { Button, Avatar, Tabs, Spin, notification } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { UserOutlined } from '@ant-design/icons';
import { Images } from "../../images";
import routes from "../../helpers/routes";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useAuthenticateState } from "../../contexts/authentication";
import { useLocation, useMatch, Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useInventoryDispatch, useInventoryState } from '../../contexts/inventory';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import NewTrendingCard from './NewTrendingCard';


const UserProfile = (user) => {

const [commonName, setCommonName] = useState(undefined);
const [activeTab, setActiveTab] = useState('1');
const [offset, setOffset] = useState(0);
const dispatch = useInventoryDispatch();
const { cartList } = useMarketplaceState();
const [api, contextHolder] = notification.useNotification();
const marketplaceDispatch = useMarketplaceDispatch();
const { userInventories, isUserInventoriesLoading } = useInventoryState();
let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
const { TabPane } = Tabs;

const navigate = useNavigate();
const location = useLocation();
const [breadcrumbs, setBreadcrumbs] = useState([]);


useEffect(() => {
  // Define a base breadcrumb path
  const baseCrumbs = [
    { label: 'Home', path: '/' },
  ];

  // Determine the source and set breadcrumbs
  const path = location.pathname;
  let sourceCrumbs = [];
  
  if (path.includes('/marketplace/productList/')) {
    sourceCrumbs.push({ label: 'Product Detail', path: path });
  } else if (path.includes('/marketplace/order/bought')) {
    sourceCrumbs.push({ label: 'Orders (Bought)', path: path });
  } else if (path.includes('/marketplace/order/sold')) {
    sourceCrumbs.push({ label: 'Orders (Sold)', path: path });
  } else if (path.includes('/marketplace/order/transfers')) {
    sourceCrumbs.push({ label: 'Transfers', path: path });
  }
  
  // Append the "Profile" as the last part of the breadcrumbs
  sourceCrumbs.push({ label: 'Profile', path: `/marketplace/profile/${commonName}` });

  // Combine the base with source-specific breadcrumbs
  setBreadcrumbs(baseCrumbs.concat(sourceCrumbs));
}, [location, commonName]);

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

const addItemToCart = (product, quantity) => {
  if (product.ownerCommonName === user?.commonName) {
    openToast("bottom", true, "Cannot buy your own item")
    return false;
  }
  let found = false;
  for (var i = 0; i < cartList.length; i++) {
    if (cartList[i].product.address === product.address) {
      found = true;
      break;
    }
  }
  let items = [];
  if (!found) {
    items = [...cartList, { product, qty: quantity }];
    marketplaceActions.addItemToCart(marketplaceDispatch, items);

    openToast("bottom", false, "Item added to cart");
    return true;
  } else {
    items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.address) {
        const availableQuantity = product.saleQuantity ? product.saleQuantity : 1;
        if (items[index].qty + 1 <= availableQuantity) {
          items[index].qty += 1;
          marketplaceActions.addItemToCart(marketplaceDispatch, items);

          openToast("bottom", false, "Item updated in cart");
          return true;
        } else {
          openToast(
            "bottom",
            true,
            "Cannot add more than available quantity"
          );
          return false;
        }
      }
    });
  }
};






const routeMatch = useMatch({
    path: routes.MarketplaceUserProfile.url,
    strict: true,
  });

useEffect(() => {
    setCommonName(routeMatch?.params?.commonName);
  }, [routeMatch]);



  useEffect(() => {
      if(commonName) inventoryActions.fetchInventoryForUser(dispatch, 10, offset, commonName);
  }, [dispatch, offset, hasChecked, isAuthenticated, loginUrl, commonName]);

  const handleTabSelect = (key) => {
    setActiveTab(key);
  };


  return (
    
    <div className="container mx-auto p-6">
      {/* Breadcrumb */}
      <div className="mb-4 text-sm">
        {console.log(breadcrumbs)}
        {breadcrumbs.map((crumb, index) => (
          <span key={index}>
            {index > 0 && " / "}
            {index < breadcrumbs.length - 1 ? (
              <Link to={crumb.path}>{crumb.label}</Link>
            ) : (
              crumb.label
            )}
          </span>
        ))}
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
            <img src={Images.filter} alt="filter" className=" w-5 h-5 md:w-6 md:h-6" />
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

      <Tabs defaultActiveKey={activeTab} onChange={handleTabSelect} className="p-3 ml-6 mr-6 mb-6">

        
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


        <TabPane tab="Activity" key="2">
    
         {/* Activity Content */}
     
        </TabPane>
     
      </Tabs>

      {/* TABS End */}


    </div>
  );
};

export default UserProfile;
