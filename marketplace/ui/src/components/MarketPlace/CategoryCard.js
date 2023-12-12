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
    Images.art,
    Images.carbon,
    Images.metals,
    Images.clothing,
    Images.membership,
    Images.collectibles
  ];

  return (
    // <Card className="w-full">
    <>
      <div className="flex justify-between mb-5">
        <Title level={3} className="text-4xl font-semibold" style={{fontSize : "36px" ,  }}>Categories</Title>
        {/* <Space size="large">
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <LeftArrow />
          </div>
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <RightArrow />
          </div>
        </Space> */}
      </div>
      <div className="flex gap-[15px] ">
        {categorys.map((category, index) => {
          return (
            <div
              id={category.name}
              key={index}
              className="w-[248px] h-[200px] border border-tertiaryB  mx-3 rounded-lg cursor-pointer"
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
              <div className="flex flex-col items-center ">
                <Image
                  src={categoryImages[index]}
                  height={140}
                  width={248}
                  className="rounded-t-lg"
                  preview={false}
                />
                <div className="py-3  ">
                <Text type="secondary" className=" text-2xl !text-primaryB font-semibold " style={{textAlign : "left"}} >
                  {category.name}
                </Text>
               
                  </div>
                
              </div>
            </div>
          );
        })}
      </div>
     {/* </Card> */}
    </>
  );
};

export default CategoryCard;
