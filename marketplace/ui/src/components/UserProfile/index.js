import React, { useEffect, useState } from 'react';
import { Card, Button, Avatar, Tabs, Input, notification } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { UserOutlined } from '@ant-design/icons';
import { Images } from "../../images";
import routes from "../../helpers/routes";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useAuthenticateState } from "../../contexts/authentication";
import { useLocation, useMatch } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useInventoryDispatch } from '../../contexts/inventory';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";



const UserProfile = (user) => {
//states
const [Id, setId] = useState(undefined);
const [activeTab, setActiveTab] = useState('1');
const [offset, setOffset] = useState(0);
const dispatch = useInventoryDispatch();
const { cartList } = useMarketplaceState();
const [api, contextHolder] = notification.useNotification();
const marketplaceDispatch = useMarketplaceDispatch();

let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
const { TabPane } = Tabs;

const navigate = useNavigate();

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
    //instead how about not displaying buttons at all
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





// Mock data for the collection items
const collectionItems = [
  { id: 1, name: 'Envira Amazonia Project', price: 2000 },
  // ... other items
];

// Mock data for the acitivity items
const activityItems = [
  { id: 1, header: 'New Order Received!', message: 'You have received a new order <order number> from <buyer>. <<Fulfill order>><url to Order Details page under Orders (Sold)>.' },
  { id: 2, header: 'Order Fulfilled', message: 'Your order <order number> was fulfilled by <seller>. <<View or List for Sale>><url to MyStore page>' },
  { id: 3, header: 'Inventory Received through Transfer', message: 'You have received one or more items as a free transfer from <transferer>. <<View Transfer>><url to MyStore page>.' },
  { id: 4, header: 'New Order Received!', message: 'You have received a new order <order number> from <buyer>. <<Fulfill order>><url to Order Details page under Orders (Sold)>.' },
  { id: 5, header: 'Order Fulfilled', message: 'Your order <order number> was fulfilled by <seller>. <<View or List for Sale>><url to MyStore page>' },
  { id: 6, header: 'Inventory Received through Transfer', message: 'You have received one or more items as a free transfer from <transferer>. <<View Transfer>><url to MyStore page>.' },
  // ... other items
];

const routeMatch = useMatch({
    path: routes.MarketplaceUserProfile.url,
    strict: true,
  });

useEffect(() => {
    setId(routeMatch?.params?.commonName);
  }, [routeMatch]);



  useEffect(() => {
    if (!isAuthenticated) {
      inventoryActions.fetchInventoryForUser(dispatch, 10, offset, Id);
    } else {
      inventoryActions.fetchInventoryForUser(dispatch, 10, offset, Id);
    }
  }, [dispatch, offset, hasChecked, isAuthenticated, loginUrl, Id]);

 
  // useEffect(() => {
  //   if (Id !== undefined) {
  //     getData();
  //   }
  // }, [Id, dispatch, user]);
  // const getData = async () => {
  //   const data = await inventoryActions.fetchInventoryForUser(dispatch, 10,0,"", "",Id);
  //   console.log(data)
  //   // await actions.fetchInventory(inventoryDispatch, 10, 0, "", categoryName);
  //   // 
  //   // if (data != null) {
  //   //   getPaymentStatus(data.order.paymentSessionId, data.order.sellersCommonName);
  //   // }
  // };

  const handleTabSelect = (key) => {
    setActiveTab(key);
  };

  const ownerSameAsUser = () => {

    // if (user?.commonName === inventoryDetails?.ownerCommonName) {
    //   return true;
    // }

    return false;
  }

  return (
    <div className="container mx-auto p-6">

      {/* User Cover and Prodile Picture Zone */}
      <div className="flex justify-center items-center mb-6 relative p-2 h-[222px] sm:h-[380px] mx-1 sm:mx-2 sm:mt-6 lg:mx-3">
      <img 
        className="absolute inset-0 object-cover z-10 h-[222px] sm:h-[380px] w-full sm:w-[90%] lg:w-[95%] xl:w-[100%] rounded-md sm:rounded-[14px]" 
        src={Images.collectibles} 
        alt="Cover" 
      />
  
      <div className='flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 sm:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md sm:rounded-2xl absolute left-2 sm:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(255,255,255,0.17)] z-50'>
        <h1 className="text-xl font-bold"><Avatar size={100} icon={<UserOutlined />} className="mr-6" />{Id}</h1>
        {/* <Button icon={<EditOutlined />} type="primary">
          Edit Profile
        </Button> */}
      </div>
    </div>
    {/* End of Cover & Profile Picture */}



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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ml-6">

          {collectionItems.map((item) => (
          <Card
            key={item.id}
            hoverable
            cover={<img alt={item.name} src="/path/to/image" />}
            actions={[
              <Button type="primary">Buy Now</Button>
            ]}
          >
            <Card.Meta title={item.name} description={`$${item.price}`} />
          </Card>
          ))}

          </div>

        </TabPane>


        <TabPane tab="Activity" key="2">
    
         {/* Activity Content */}
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ml-6">

          {activityItems.map((item) => (
          <Card
            key={item.id}
            hoverable
          >
            <Card.Meta title={item.header} description={item.message} />
          </Card>
          ))}

         </div>
     
        </TabPane>
     
      </Tabs>

      {/* TABS End */}


    </div>
  );
};

export default UserProfile;
