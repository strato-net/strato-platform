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
  const navRoute = routes.MarketplaceCategoryProductList.url.replace(':category', 'All');

  return (
    <>
      <HelmetComponent
        title={SEO.TITLE_META}
        description={SEO.DESCRIPTION_META}
        link={linkUrl} />
      <Fade triggerOnce>
        <Carousel autoPlay centerSlidePercentage={95} showArrows={false} infiniteLoop showStatus={false} swipeable emulateTouch autoFocus centerMode>
          <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2 md:mt-6 lg:mx-3">
            <div className="absolute top-40 left-8 md:left-24 md:top-60 z-50">
              <Button
                id="viewMore"
                onClick={() => {
                  navigate(navRoute);
                  sessionStorage.setItem('scrollPosition', 0);
                }}
                className="gradient-button h-auto md:h-11 border-primary bg-white text-primary hover:text-white"
              >
                <div className="flex items-center">
                  <div className="hidden md:block font-semibold text-lg">
                    Explore More
                  </div>
                  <div className="md:hidden font-semibold text-base">
                    Explore
                  </div>
                  <img src={Images.button_arrow} />
                </div>
              </Button>
            </div>
            <div className="hidden md:block ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_desktop_one} preview={false}
              />
            </div>
            <div className="md:hidden ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_mobile_one} preview={false}
              />
            </div>
          </div>
          <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
            <div className="absolute top-40 left-8 md:left-24 md:top-60 z-50">
              <Button
                id="viewMore"
                onClick={() => {
                  navigate(navRoute);
                  sessionStorage.setItem('scrollPosition', 0);
                }}
                className="gradient-button h-auto md:h-11 border-primary bg-white text-primary hover:text-white"
              >
                <div className="flex items-center">
                  <div className="hidden md:block font-semibold text-lg">
                    Explore More
                  </div>
                  <div className="md:hidden font-semibold text-base">
                    Explore
                  </div>
                  <img src={Images.button_arrow} />
                </div>
              </Button>
            </div>
            <div className="hidden md:block ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_desktop_two} preview={false}
              />
            </div>
            <div className="md:hidden ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_mobile_two} preview={false}
              />
            </div>
          </div>
          <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
            <div className="absolute top-40 left-8 md:left-24 md:top-60 z-50">
              <Button
                id="viewMore"
                onClick={() => {
                  navigate(navRoute);
                  sessionStorage.setItem('scrollPosition', 0);
                }}
                className="gradient-button h-auto md:h-11 border-primary bg-white text-primary hover:text-white"
              >
                <div className="flex items-center">
                  <div className="hidden md:block font-semibold text-lg">
                    Explore More
                  </div>
                  <div className="md:hidden font-semibold text-base">
                    Explore
                  </div>
                  <img src={Images.button_arrow} />
                </div>
              </Button>
            </div>
            <div className="hidden md:block ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_desktop_three} preview={false}
              />
            </div>
            <div className="md:hidden ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_mobile_three} preview={false}
              />
            </div>
          </div>
          <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
            <div className="absolute top-40 left-8 md:left-24 md:top-60 z-50">
              <Button
                id="viewMore"
                onClick={() => {
                  navigate(navRoute);
                  sessionStorage.setItem('scrollPosition', 0);
                }}
                className="gradient-button h-auto md:h-11 border-primary bg-white text-primary hover:text-white"
              >
                <div className="flex items-center">
                  <div className="hidden md:block font-semibold text-lg">
                    Explore More
                  </div>
                  <div className="md:hidden font-semibold text-base">
                    Explore
                  </div>
                  <img src={Images.button_arrow} />
                </div>
              </Button>
            </div>
            <div className="hidden md:block ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_desktop_four} preview={false}
              />
            </div>
            <div className="md:hidden ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_mobile_four} preview={false}
              />
            </div>
          </div>
          <div className="relative p-2 h-[222px] md:h-[380px] mx-1 md:mx-2  md:mt-6 lg:mx-3">
            <div className="absolute top-40 left-8 md:left-24 md:top-60 z-50">
              <Button
                id="viewMore"
                onClick={() => {
                  navigate(navRoute);
                  sessionStorage.setItem('scrollPosition', 0);
                }}
                className="gradient-button h-auto md:h-11 border-primary bg-white text-primary hover:text-white"
              >
                <div className="flex items-center">
                  <div className="hidden md:block font-semibold text-lg">
                    Explore More
                  </div>
                  <div className="md:hidden font-semibold text-base">
                    Explore
                  </div>
                  <img src={Images.button_arrow} />
                </div>
              </Button>
            </div>
            <div className="hidden md:block ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_desktop_five} preview={false}
              />
            </div>
            <div className="md:hidden ">
              <img
                alt={metaImg}
                title={metaImg}
                className="absolute inset-0 z-10 h-[222px] md:h-[330px] md:w-[90%] rounded-md md:rounded-[14px] drop-shadow-md"
                height={380} width="100%" src={Images.carousel_mobile_five} preview={false}
              />
            </div>
          </div>
        </Carousel>
      </Fade>
      {iscategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <div className="px-3 md:px-0 py-30 mt-6 md:mt-10 mb-10">
          {/* <CategoryCard /> */}
          <TopSellingProductCard />
        </div>
      )}
    </>
  );
};

export default MarketPlace;