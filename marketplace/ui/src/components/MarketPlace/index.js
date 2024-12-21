import { Button, Image, Typography, Spin, notification } from 'antd';
import CategoryCard from './CategoryCard';
import TopSellingProductCard from './TopSellingProductCard';
import StakeableProductCards from './StakeableProductCards';
import { Images } from '../../images';
import React, { useEffect, useState } from 'react';
import { actions } from '../../contexts/category/actions';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import useDebounce from '../UseDebounce';
import { useNavigate } from 'react-router-dom';
import routes from '../../helpers/routes';
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import { Carousel } from 'react-responsive-carousel';
import { Fade } from 'react-awesome-reveal';
import HelmetComponent from '../Helmet/HelmetComponent';
import { SEO } from '../../helpers/seoConstant';
import { BANNER } from '../../helpers/constants';
import { bannerArrow } from '../../images/SVGComponents';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
import { useEthDispatch } from '../../contexts/eth';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';

// ----------------------------------------------------------

import { Swiper, SwiperSlide } from 'swiper/react';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/effect-fade';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import 'swiper/css/autoplay';

// import required modules
import { EffectFade, Navigation, Pagination, Autoplay } from 'swiper/modules';

const MarketPlace = ({ user, isAuthenticated }) => {
  const limit = 10,
    offset = 0;
  const navigate = useNavigate();
  const dispatch = useCategoryDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const ethDispatch = useEthDispatch();
  const debouncedSearchTerm = useDebounce('', 1000);
  const { iscategorysLoading } = useCategoryState();
  const { reserves } = useInventoryState();
  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  const [totalTvl, setTotalTvl] = useState(0);
  const [averageApy, setAverageApy] = useState(0);
  const [totalCataRewards, setTotalCataRewards] = useState(0);

  useEffect(() => {
    if (reserves) {
      const totalTvl = reserves.reduce(
        (sum, reserves) => sum + reserves.tvl,
        0
      );
      const averageApy =
        reserves.reduce((sum, reserves) => sum + reserves.cataAPYRate, 0) /
        reserves.length;

      const totalCataRewards = reserves.reduce(
        (sum, reserves) => sum + reserves.totalCataRewardIssued,
        0
      );
      setAverageApy(Math.floor(averageApy));
      setTotalTvl(Math.floor(totalTvl));
      setTotalCataRewards(Math.floor(totalCataRewards));
    }
  }, [reserves]);

  useEffect(() => {
    inventoryActions.getAllReserve(inventoryDispatch);
    ethActions.fetchETHSTAddress(ethDispatch)
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      const loginCount = localStorage.getItem('loginCount');
      // If loginCount is not set, it means this is the first login
      if (!loginCount) {
        // Show the notification
        notification.open({
          description:
            'Click here to review some updates on your Assets and Orders!',
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
    navigate(
      `${routes.MarketplaceUserProfile.url.replace(
        ':commonName',
        user.commonName
      )}?tab=my-activity`
    );
  };

  useEffect(() => {
    actions.fetchCategories(dispatch, limit, offset, debouncedSearchTerm);
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  const linkUrl = window.location.href;
  // const navRoute = routes.MarketplaceCategoryProductList.url.replace(':category', 'All');

  const ButtonElement = ({ desktopText, mobileText, url }) => (
    <div className="w-[90%] relative flex justify-between top-[156px] sm:top-[250px] xl:top-[65%] 3xl:top-[70%] left-[4%] sm:left-[7.5%] md:left-[7%] md:top-60 z-50">
      <Button
        id="viewMore"
        onClick={() => {
          navigate(url);
          sessionStorage.setItem('scrollPosition', 0);
        }}
        className="gradient-button border-0  md:h-11 min-h-[44px] border-primary bg-white text-primary hover:text-white"
      >
        <div className="flex items-center">
          <div className="hidden sm:block font-semibold text-lg banner-btn-text">
            {desktopText}
          </div>
          <div className="sm:hidden font-semibold text-base banner-btn-text">
            {mobileText}
          </div>
          <span className="ml-1">{bannerArrow}</span>
        </div>
      </Button>
      <div className="stake-banner-stats md:gap-8 lg:gap-16">
        <div className="text-center">
          <div className="stake-banner-stats-value font-bold text-white">
            ${formattedNum(totalTvl.toFixed(2))}
          </div>
          <div className="stake-banner-stats-title text-white">
            Total Value Locked (TVL)
          </div>
        </div>
        <div className="text-center">
          <div className="stake-banner-stats-value font-bold text-white">
            {averageApy}%
          </div>
          <div className="stake-banner-stats-title text-white">Est. APY</div>
        </div>
        <div className="text-center">
          <div className="stake-banner-stats-value font-bold text-white">
            {totalCataRewards}
          </div>
          <div className="stake-banner-stats-title text-white">
            Rewards Issued (CATA)
          </div>
        </div>
      </div>
    </div>
  );

  const CarouselElement = ({ scrollT }) => (
    <Swiper
      spaceBetween={30}
      effect={'fade'}
      navigation={false}
      centeredSlides={true}
      pagination={{
        clickable: true,
      }}
      autoplay={{
        delay: 8000,
        disableOnInteraction: false,
      }}
      modules={[Autoplay, EffectFade, Navigation, Pagination]}
      className="mySwiper"
    >
      {BANNER.map((item, index) => (
        <SwiperSlide>
          <div
            key={index}
            className="no-select relative p-2 h-[222px] sm:h-[380px] 3xl:h-[480px] mx-1 md:mx-2 md:mt-6 lg:mx-3"
          >
            <ButtonElement
              desktopText={item.desktopText}
              mobileText={item.mobileText}
              url={item.link}
            />
            {item.text}
            <div className="sm:hidden">
              <img
                alt={item.alt}
                title={item.title}
                className="no-select absolute inset-0 z-10 h-[222px] w-[96%] rounded-md md:rounded-[14px] drop-shadow-md mx-auto"
                height={380}
                width="100%"
                src={item.mobileImg}
                preview={false}
              />
            </div>
            <div className="hidden sm:block md:hidden">
              <img
                alt={item.alt}
                title={item.title}
                className="no-select absolute inset-0 z-10 h-[380px] w-[96%] rounded-md md:rounded-[14px] drop-shadow-md mx-auto"
                height={380}
                width="100%"
                src={item.tabletImg}
                preview={false}
              />
            </div>
            <div className="hidden md:block lg:hidden">
              <img
                alt={item.alt}
                title={item.title}
                className="no-select absolute inset-0 z-10 md:h-[330px] w-[98%] rounded-md md:rounded-[14px] drop-shadow-md mx-auto"
                height={380}
                width="100%"
                src={item.laptopImg}
                preview={false}
              />
            </div>
            <div className="hidden lg:block">
              <img
                alt={item.alt}
                title={item.title}
                className="no-select absolute inset-0 z-10 lg:h-[330px] 3xl:h-[480px] w-[98%] rounded-md md:rounded-[14px] drop-shadow-md mx-auto"
                height={380}
                width="100%"
                src={item.desktopImg}
                preview={false}
              />
            </div>
          </div>
        </SwiperSlide>
      ))}
    </Swiper>
  );

  return (
    <>
      <HelmetComponent
        title={SEO.TITLE_META}
        description={SEO.DESCRIPTION_META}
        link={linkUrl}
      />
      <Fade triggerOnce>
        <CarouselElement scrollT={130} />
      </Fade>
      {iscategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <>
          <div className="px-3 md:px-0 py-30 mt-6 md:mt-10 mb-10">
            {/* <CategoryCard /> */}
            <StakeableProductCards />
            <TopSellingProductCard />
          </div>
          <h3 className="text-center text-gray-500 mt-8 mb-4">
            Is there an item you would like to see on the marketplace?
            <a
              href="https://forms.gle/biuEtUHrFdLpX1d36"
              rel="noreferrer"
              target="_blank"
              className="text-blue"
            >
              {' '}
              Let us know!
            </a>
          </h3>
        </>
      )}
    </>
  );
};

export default MarketPlace;
