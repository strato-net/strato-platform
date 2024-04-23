import React, { useEffect, useRef, useState } from "react";
import { Typography, Button } from "antd";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useCategoryState } from "../../contexts/category";
import { Images } from "../../images";
import TagManager from "react-gtm-module";
import { Fade } from "react-awesome-reveal";
import { SEO } from "../../helpers/seoConstant";

const { Title, Text } = Typography;

const CategoryCard = () => {
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const naviroute = routes.MarketplaceCategoryProductList.url;
  const { categorys } = useCategoryState();

  const categoryImages = [
    Images["Carbon-category"],
    Images["Metal"],
    Images["Clothing-category"],
    Images["collectibles"],
    Images["tokens_card"],
    Images["Art-category"],
    Images["membership_card"],
  ];

  const [prevVisible, setPrevVisible] = useState(false);
  const [nextVisible, setNextVisible] = useState(true);
  useEffect(() => {
    const parent = containerRef.current;
    const handleScroll = (e) => {
      setPrevVisible(parent.scrollLeft !== 0);
      setNextVisible(
        Math.round(parent.offsetWidth + parent.scrollLeft) !==
          parent.scrollWidth
      );
    };

    // Scroll listener to change visibility of left and right arrow button
    parent?.addEventListener("scroll", handleScroll);
    return () => {
      parent?.removeEventListener("scroll", handleScroll);
    };
  }, [categorys]);

  const scroll = (left) => {
    containerRef.current.scrollBy({
      top: 0,
      left,
      behavior: "smooth",
    });
  };

  return (
    <>
      <Fade triggerOnce>
      <Title className="md:px-10 !text-xl md:!text-4xl !text-left py-2">
        Shop by Category
      </Title>
      </Fade>
      <Fade direction="left" triggerOnce>
        <div className="mobile-hide">
          <div
            ref={containerRef}
            className="overflow-x-auto gap-16 px-10 py-5 flex trending_cards"
          >
            {categorys.map((category, index) => {
              return (
                <div
                  id={category.name}
                  key={index}
                  className="transition-transform duration-500 hover:scale-105 min-w-[162px] md:min-w-[210px] 2xl:min-w-[248px] h-[160px] md:h-[180px] 2xl:h-[200px] border border-tertiaryB shadow-category rounded-lg cursor-pointer"
                  onClick={() => {
                    const subCat = category.subCategories
                      .map((item) => item.contract)
                      .join(",");
                    const url = `${naviroute.replace(
                      ":category",
                      category.name
                    )}?sc=${subCat}`;
                    navigate(url);
                    sessionStorage.setItem("scrollPosition", 0);
                    window.LOQ.push([
                      "ready",
                      async (LO) => {
                        // Track an event
                        await LO.$internal.ready("events");
                        LO.events.track(`Homepage Filter - ${category.name}`);
                      },
                    ]);
                    TagManager.dataLayer({
                      dataLayer: {
                        event: `${category.name}_filter_homepage`,
                      },
                    });
                  }}
                >
                  <div className="flex flex-col">
                    <img
                      alt={SEO.IMAGE_META}
                      title={SEO.IMAGE_META}
                      src={categoryImages[index]}
                      className="rounded-t-lg px-[9px] py-[6px] lg:px-[0px] lg:py-[0px] h-[110px] md:h-[125px] 2xl:h-[140px]"
                      preview={false}
                    />

                    <div className="py-2 xl:py-3 flex justify-center md:justify-start ">
                      <Text
                        type="secondary"
                        className="text-lg md:text-xl lg:text-2xl !text-primaryB font-semibold"
                      >
                        <span className="p-3 font-sans">{category.name}</span>
                      </Text>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <Button
            type="primary"
            onClick={() => scroll(-300)}
            className={`${
              !prevVisible ? "hidden" : "md:flex hidden"
            } cursor-pointer absolute z-10 justify-center items-center top-24 left-24 h-12 w-12 text-2xl bg-[#6A6A6A] rounded-full text-white`}
          >
            {"<"}
          </Button>
          <Button
            type="primary"
            onClick={() => scroll(300)}
            className={`${
              !nextVisible ? "hidden" : "md:flex hidden"
            } cursor-pointer absolute justify-center items-center top-24 right-24 h-12 w-12 text-2xl bg-[#6A6A6A] rounded-full text-white z-20`}
          >
            {">"}
          </Button>
        </div>
        <div className="desktop-hide flex justify-start sm:justify-center md:justify-start gap-3 lg:gap-[15px] flex-wrap px-0 md:px-10 xl:grid xl:grid-cols-6"> {/* Show this div on mobile/tablet */}
          {categorys.map((category, index) => {
            return (
              <div
                id={category.name}
                key={index}
                className="transition-transform duration-500 hover:scale-105 w-[162px] md:w-[210px] 2xl:w-[248px] h-[160px] md:h-[180px] 2xl:h-[200px] border border-tertiaryB shadow-category rounded-lg cursor-pointer"
                onClick={() => {
                  const subCat = category.subCategories.map((item)=>item.contract).join(",")
                  const url = `${naviroute.replace(':category', category.name)}?sc=${subCat}`
                  navigate(url)
                  sessionStorage.setItem('scrollPosition', 0);
                  window.LOQ.push(['ready', async LO => {
                    // Track an event
                    await LO.$internal.ready('events')
                    LO.events.track(`Homepage Filter - ${category.name}`)
                  }])
                  TagManager.dataLayer({
                    dataLayer: {
                      event: `${category.name}_filter_homepage`,
                    },
                  });
                }}
              >
                <div className="flex flex-col">
                  <img
                    alt={SEO.IMAGE_META}
                    title={SEO.IMAGE_META}
                    src={categoryImages[index]}
                    className="rounded-t-lg px-[9px] py-[6px] lg:px-[0px] lg:py-[0px] h-[110px] md:h-[125px] 2xl:h-[140px]"
                    preview={false}
                  />

                    <div className="py-2 xl:py-3 flex justify-center md:justify-start ">
                      <Text
                        type="secondary"
                        className="text-lg md:text-xl lg:text-2xl !text-primaryB font-semibold"
                      >
                        <span className="p-3 font-sans">{category.name}</span>
                      </Text>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </Fade>
    </>
  );
};

export default CategoryCard;
