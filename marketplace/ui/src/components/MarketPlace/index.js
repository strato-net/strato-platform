import { Button, Image, Typography, Spin } from "antd";
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

const MarketPlace = () => {
  const limit = 10, offset = 0;
  const navigate = useNavigate();
  const dispatch = useCategoryDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const { iscategorysLoading } = useCategoryState();

  useEffect(() => {
    actions.fetchCategories(dispatch, limit, offset, debouncedSearchTerm);
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  return (
    <>
      <Carousel autoPlay centerSlidePercentage={95} showArrows={false} infiniteLoop showStatus={false} swipeable emulateTouch autoFocus centerMode>
        <div className="relative p-2 h-[222px] md:h-[380px] ml-3">
          <div className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 mt-28 h-[90%] w-[90%] sm:w-[60%] md:h-52 rounded-3xl md:w-[480px] absolute left-6 md:left-12 md:top-12 -top-[104px] bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[60px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[135px] h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold text-lg">
                View More
              </div>
            </Button>
          </div>
          <img className="absolute inset-0 object-cover z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.carousel_first} preview={false} />
        </div>
        <div className="relative p-2 h-[222px] md:h-[380px] mx-6">
          <div className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 mt-28 h-[90%] w-[90%] sm:w-[60%] md:h-52 rounded-3xl md:w-[480px] absolute left-6 md:left-12 md:top-12 -top-[104px] bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[60px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[135px] h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold text-lg">
                View More
              </div>
            </Button>
          </div>
          <img className="absolute inset-0 object-cover z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.carousel_first} preview={false} />
        </div>
        <div className="relative p-2 h-[222px] md:h-[380px] mr-3">
          <div className="flex flex-col gap-3 backdrop-blur-2xl text-left p-4 px-3 md:px-8 mt-28 h-[90%] w-[90%] sm:w-[60%] md:h-52 rounded-3xl md:w-[480px] absolute left-6 md:left-12 md:top-12 -top-[104px] bg-[rgba(256,256,256,0.17)] z-50">
            <Typography.Text className="text-base md:text-2xl md:leading-[60px] text-white font-semibold">
              Welcome to Mercata Marketplace!
            </Typography.Text>
            <Typography.Text className="md:text-sm text-white pr-0">
              Explore trending real-world assets
            </Typography.Text>
            <Button
              id="viewMore"
              onClick={() => navigate(routes.MarketplaceProductList.url)}
              className="group w-[135px] h-11 border border-primary bg-white opacity-80">
              <div className="text-primary font-semibold text-lg">
                View More
              </div>
            </Button>
          </div>
          <img className="absolute inset-0 object-cover z-10 h-[222px] md:h-[380px] md:w-[90%] rounded-md md:rounded-[14px]" height={380} width="100%" src={Images.carousel_first} preview={false} />
        </div>
      </Carousel>
      {iscategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <div className="px-3 md:px-0 py-30 mt-10 mb-10 md:mb-20">
          <CategoryCard />
          <TopSellingProductCard />
        </div>
      )}
    </>
  );
};

export default MarketPlace;
