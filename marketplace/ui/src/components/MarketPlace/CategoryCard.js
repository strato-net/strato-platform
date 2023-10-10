import React from "react";
import { Card, Typography, Image, Space, Col, Row } from "antd";
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
    Images.materials,
    Images.clothing,

  ];

  return (
    <Card className="w-full">
      <Title level={2}>Categories</Title>
      {/* <Space size="large">
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <LeftArrow />
          </div>
          <div className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center">
            <RightArrow />
          </div>
        </Space> */}
      <Row  className="flex justify-between" >
        {categorys.map((category, index) => {
          return (
            <Col
            sm={12}
            lg={5}
              id={category.name}
              key={index}
              className="gutter-row shadow-xl rounded-xl cursor-pointer overflow-hidden"
              onClick={() => {
                navigate(`${naviroute.replace(":category", category.name)}`);
                TagManager.dataLayer({
                  dataLayer: {
                    event: `${category.name}_filter_homepage`
                  },
                });
              }
              }
            >
              <Image
                src={categoryImages[index]}
                className="object-cover"
                width={'100%'}
                height={'85%'}
                preview={false}
              />
              <Title level={4} type="secondary" className="relative bottom-5 pl-4 !text-primaryB">
                {category.name}
              </Title>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
};

export default CategoryCard;
