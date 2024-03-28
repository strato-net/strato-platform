import { Button, Image, Typography, Spin, notification } from "antd";
import CategoryCard from "./CategoryCard";
import TopSellingProductCard from "./TopSellingProductCard";
import { Images } from "../../images";
import React, { useEffect } from "react";
import { actions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import useDebounce from "../UseDebounce";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import { Carousel } from "react-responsive-carousel";
import { Fade } from "react-awesome-reveal";
import HelmetComponent from "../Helmet/HelmetComponent";
import { SEO } from "../../helpers/seoConstant";

const MarketPlace = ({ user, isAuthenticated }) => {
  const limit = 10, offset = 0;
  const navigate = useNavigate();
  const dispatch = useCategoryDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const { iscategorysLoading } = useCategoryState();
  
  useEffect(() => {
    if (isAuthenticated) {
      const loginCount = localStorage.getItem('loginCount');
      // If loginCount is not set, it means this is the first login
      if (!loginCount) {
        // Show the notification
        notification.open({
          description: 'Click here to review some updates on your Assets and Orders!',
          icon: null,
          btn: (
            <Button
              type="primary"
              onClick={() => navigateToUserProfile()}
              style={{
                borderRadius: '20px', 
                color: '#fff',
              }}
            >
              Explore now
            </Button>
          ),
          placement: 'bottomRight',
          style: {
            borderRadius: '12px',
          },
        });
        // Set loginCount to 1 to indicate the user has logged in at least once
        localStorage.setItem('loginCount', '1');
      }
    }
  }, [isAuthenticated, navigate]);

  const navigateToUserProfile = () => {
    navigate(`${routes.MarketplaceUserProfile.url.replace(":commonName", user.commonName)}?tab=my-activity`);
  };

  useEffect(() => {
    actions.fetchCategories(dispatch, limit, offset, debouncedSearchTerm);
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  const linkUrl = window.location.href;
  const metaImg = SEO.IMAGE_META
  
  return (
    <>
    <HelmetComponent 
          title={SEO.TITLE_META}
          description={SEO.DESCRIPTION_META} 
          link={linkUrl} />
    <Fade triggerOnce>
      <Carousel autoPlay centerSlidePercentage={95} showArrows={false} infiniteLoop showStatus={false} swipeable emulateTouch autoFocus centerMode>
        <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2 md:mt-6 lg:mx-3">
          <div  className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md md:rounded-2xl absolute left-2 md:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[40px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[106px] md:w-[135px] h-8 md:h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold md:text-lg">
                View More
              </div>
            </Button>
          </div>
          <img 
          alt={metaImg}
          title={metaImg}
          className="absolute inset-0 z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" 
          height={380} width="100%" src={Images.art_card} preview={false} />
        </div>
        <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
          <div  className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md md:rounded-2xl absolute left-2 md:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[40px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[106px] md:w-[135px] h-8 md:h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold md:text-lg">
                View More
              </div>
            </Button>
          </div>
          <img 
          alt={metaImg}
          title={metaImg}
          className="absolute inset-0 z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.carousel_first} preview={false} />
        </div>
        <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
          <div  className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md md:rounded-2xl absolute left-2 md:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[40px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[106px] md:w-[135px] h-8 md:h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold md:text-lg">
                View More
              </div>
            </Button>
          </div>
          <img 
          alt={metaImg}
          title={metaImg}
          className="absolute inset-0 z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.carbon_card} preview={false} />
        </div>
        <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
          <div  className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md md:rounded-2xl absolute left-2 md:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[40px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[106px] md:w-[135px] h-8 md:h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold md:text-lg">
                View More
              </div>
            </Button>
          </div>
          <img 
          alt={metaImg}
          title={metaImg}
          className="absolute inset-0 object-cover z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.Metal_card} preview={false} />
        </div>
        <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
          <div  className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 h-[67%] sm:h-32 md:h-40 w-[92%] sm:w-[70%] md:w-[500px] rounded-md md:rounded-2xl absolute left-2 md:left-10 top-10 sm:top-20 md:top-44 bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[40px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[106px] md:w-[135px] h-8 md:h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold md:text-lg">
                View More
              </div>
            </Button>
          </div>
          <img 
          alt={metaImg}
          title={metaImg}
          className="absolute inset-0 object-cover z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.collectibles} preview={false} />
        </div>
      </Carousel>
      </Fade>
      {iscategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <div className="px-3 md:px-0 py-30 mt-6 md:mt-10 mb-10">
          <CategoryCard />
          <TopSellingProductCard />
        </div>
      )}
    </>
  );
};

export default MarketPlace;