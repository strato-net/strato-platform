import React, { useEffect, useState } from "react";
import { Card, Button, Avatar, Tabs, Input, Row, Col, Typography } from "antd";
import { EditOutlined, ShoppingCartOutlined } from "@ant-design/icons";
import { UserOutlined } from "@ant-design/icons";
import { Images } from "../../images";
import routes from "../../helpers/routes";
import { useLocation, useMatch } from "react-router-dom";
import { useInventoryDispatch } from "../../contexts/inventory";
import { actions as userActivityActions } from "../../contexts/userActivity/actions";
import {
  useUserActivityDispatch,
  useUserActivityState,
} from "../../contexts/userActivity";
import ActivityFeed from "./ActivityFeed";

const UserProfile = (user) => {
  //states
  const [Id, setId] = useState(undefined);
  const [activeTab, setActiveTab] = useState("1");
  const dispatch = useInventoryDispatch();

  const { TabPane } = Tabs;
  const { Title, Text, Paragraph } = Typography;

  const userActivityDispatch = useUserActivityDispatch();
  const { userActivity } = useUserActivityState();

  console.log("userActiity", userActivity);

  // Temp values for body
  // Get the current date and time
  const currentDate = new Date();

  // Subtract 10 days from the current date
  // Note: The Date object in JavaScript counts dates in milliseconds, so you need to convert 10 days to milliseconds
  // 1 day = 24 hours, 1 hour = 60 minutes, 1 minute = 60 seconds, 1 second = 1000 milliseconds
  const tenDaysInMilliseconds = 10 * 24 * 60 * 60 * 1000;
  const tenDaysAgoDate = new Date(
    currentDate.getTime() - tenDaysInMilliseconds
  );

  // If you need the timestamp in seconds (common for Unix timestamps used in backends), you can convert it as follows
  const tenDaysAgoTimestampSeconds = Math.floor(
    tenDaysAgoDate.getTime() / 1000
  );
  console.log(tenDaysAgoTimestampSeconds);

  useEffect(() => {
    const body = {
      user: "Vijay Rajasekaran",
      gtField: "block_timestamp",
      gtValue: tenDaysAgoTimestampSeconds,
    };
    userActivityActions.fetchUserActivity(userActivityDispatch, body);
  }, [userActivityDispatch, tenDaysAgoTimestampSeconds]);

  // Mock data for the collection items
  const collectionItems = [
    { id: 1, name: "Envira Amazonia Project", price: 2000 },
    // ... other items
  ];

  const routeMatch = useMatch({
    path: routes.MarketplaceUserProfile.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.address);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      getData();
    }
  }, [Id, dispatch, user]);

  const getData = async () => {
    // const data = await actions.fetchOrderDetails(dispatch, Id);
    // if (data != null) {
    //   getPaymentStatus(data.order.paymentSessionId, data.order.sellersCommonName);
    // }
  };

  const handleTabSelect = (key) => {
    setActiveTab(key);
  };

  const ownerSameAsUser = () => {
    // if (user?.commonName === inventoryDetails?.ownerCommonName) {
    //   return true;
    // }

    return false;
  };

  const allActivities = [
    ...userActivity.soldOrders.map((item) => ({ ...item, type: "sold" })),
    ...userActivity.boughtOrders.map((item) => ({ ...item, type: "bought" })),
    ...userActivity.transfers.map((item) => ({ ...item, type: "transfer" })),
  ];

  // Sort activities by timestamp if needed
  allActivities.sort(
    (a, b) => new Date(b.block_timestamp) - new Date(a.block_timestamp)
  );

  return (
    <div className="container mx-auto p-6">
      {/* User Cover and Prodile Picture Zone */}
      <div className="flex justify-center items-center mb-6 relative p-2 h-[222px] sm:h-[380px] mx-1 sm:mx-2 sm:mt-6 lg:mx-3">
        <img
          className="absolute inset-0 object-cover z-10 h-[222px] sm:h-[380px] w-full sm:w-[90%] lg:w-[95%] xl:w-[100%] rounded-md sm:rounded-[14px]"
          src={Images.collectibles}
          alt="Cover"
        />

        <div className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 sm:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md sm:rounded-2xl absolute left-2 sm:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(255,255,255,0.17)] z-50">
          <h1 className="text-xl font-bold">
            <Avatar size={100} icon={<UserOutlined />} className="mr-6" />
            Profile Name
          </h1>
          <p className="text-gray-500 mr-6">Joined October 2023</p>
          {/* <Button icon={<EditOutlined />} type="primary">
          Edit Profile
        </Button> */}
        </div>
      </div>
      {/* End of Cover & Profile Picture */}

      {/* Search Bar and Filter */}

      <div className="flex items-center justify-center ml-4 md:ml-14 mr-14 mt-6 lg:mt-8 gap-4">
        <div
          className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2"
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
            placeholder="Search Marketplace"
            prefix={
              <img
                src={Images.Header_Search}
                alt="search"
                className="w-[18px] h-[18px]"
              />
            }
            className="bg-[#F6F6F6] border-none rounded-3xl p-[10px]"
          />
        </div>
      </div>

      {/* End of Search Bar */}

      {/* TABS Start */}

      <Tabs
        defaultActiveKey={activeTab}
        onChange={handleTabSelect}
        className="p-3 ml-6 mr-6 mb-6"
      >
        <TabPane tab="Assets For Sale" key="1">
          {/* Assets of the User */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ml-6">
            {collectionItems.map((item) => (
              <Card
                key={item.id}
                hoverable
                cover={<img alt={item.name} src="/path/to/image" />}
                actions={[<Button type="primary">Buy Now</Button>]}
              >
                <Card.Meta title={item.name} description={`$${item.price}`} />
              </Card>
            ))}
          </div>
        </TabPane>

        <TabPane tab="My Activity" key="2">
          {/* Activity Content */}
          <div className="activity-list">
            {allActivities.map((activity, index) => {
              let description;
              switch (activity.type) {
                case "sold":
                  description = `Sold to ${activity.purchasersCommonName} for $${activity.totalPrice}`;
                  break;
                case "bought":
                  description = `Bought from ${activity.sellersCommonName} for $${activity.totalPrice}`;
                  break;
                case "transfer":
                  description = `Transferred ${activity.assetName} to ${activity.newOwnerCommonName}`;
                  break;
                default:
                  description = "Activity occurred";
              }
              return (
                <ActivityFeed
                  key={index}
                  type={activity.type}
                  description={description}
                  timestamp={activity.block_timestamp}
                />
              );
            })}
          </div>
        </TabPane>
      </Tabs>

      {/* TABS End */}
    </div>
  );
};

export default UserProfile;
