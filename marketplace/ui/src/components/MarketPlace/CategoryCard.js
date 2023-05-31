import React from "react";
import { Card, Typography, Image, Space } from "antd";
import { Images } from "../../images";
import { LeftArrow, RightArrow } from "../../images/SVGComponents";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useCategoryState } from "../../contexts/category";

const { Title, Text } = Typography;

const CategoryCard = () => {
  const navigate = useNavigate();
  const naviroute = routes.MarketplaceProductList.url;
  const { categorys } = useCategoryState();

  const categoryImages = [
    Images.art,
    Images.carbon,
    Images.realEstate
  ];

  return (
    <Card className="w-full">
      <div className="flex justify-between mb-5">
        <Title level={3}>Categories</Title>
        <Space size="large">
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <LeftArrow />
          </div>
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <RightArrow />
          </div>
        </Space>
      </div>
      <div className="flex justify-evenly px-2">
        {categorys.map((category, index) => {
          return (
            <div
              id={category.name}
              key={index}
              className="w-48 h-44 border border-tertiaryB rounded-md py-5 mx-3 cursor-pointer"
              onClick={() =>
                navigate(
                  `${naviroute.replace(":category", category.name)}`
                )
              }
            >
              <div className="flex flex-col items-center text-center">
                <Image
                  src={categoryImages[index]}
                  height={108}
                  width={150}
                  preview={false}
                />
                <Text type="secondary" className="mt-2 text-sm !text-primaryB">
                  {category.name}
                </Text>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default CategoryCard;
