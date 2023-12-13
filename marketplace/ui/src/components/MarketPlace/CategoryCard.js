import React from "react";
import { Card, Typography, Image, Space } from "antd";
import { LeftArrow, RightArrow } from "../../images/SVGComponents";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useCategoryState } from "../../contexts/category";
import { Images } from "../../images";
import TagManager from "react-gtm-module";

const { Title, Text } = Typography;

const CategoryCard = () => {
  const navigate = useNavigate();
  const naviroute = routes.MarketplaceProductList.url;
  const { categorys } = useCategoryState();

  const categoryImages = [
    Images["Art-category"],
    Images["Carbon-category"],
    Images["Material-category"],
    Images["Clothing-category"],
    Images["Material-category"],
  ];

  return (
    <>
      <div className="mb-5 md:px-10">
        <Title level={3} ><span className="text-xl md:text-4xl font-semibold ">Shop by Categories </span></Title>
        {/* <Space size="large">
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <LeftArrow />
          </div>
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <RightArrow />
          </div>
        </Space> */}
      </div>
      <div className="flex justify-start gap-4 lg:gap-[15px] flex-wrap px-[4px] md:px-10">
        {categorys.map((category, index) => {
          return (
            <div
              id={category.name}
              key={index}
              className=" w-[162px] md:w-[228px] xl:w-[280px] h-[160px] md:h-[185px] xl:h-[200px] border border-tertiaryB shadow-category   rounded-lg cursor-pointer"
              onClick={() => {
                navigate(`${naviroute.replace(":category", category.name)}`);
                window.LOQ.push(['ready', async LO => {
                  // Track an event
                  await LO.$internal.ready('events')
                  LO.events.track(`Homepage Filter - ${category.name}`)
                }])
                TagManager.dataLayer({
                  dataLayer: {
                    event: `${category.name}_filter_homepage`
                  },
                });
                }
              }
            >
              <div className="flex flex-col">
                <img
                  src={categoryImages[index]}
                  className="rounded-t-lg px-[9px] py-[6px] lg:px-[0px] lg:py-[0px] h-[110px] md:h-[140px]"
                  preview={false}
                />
                <div className="py-2 xl:py-3 flex justify-center md:justify-start ">
                <Text type="secondary" className="text-lg md:text-xl lg:text-2xl !text-primaryB font-semibold" >
                  <span className="p-3 font-sans">
                  {category.name}
                    </span>
                </Text>
                  </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default CategoryCard;
