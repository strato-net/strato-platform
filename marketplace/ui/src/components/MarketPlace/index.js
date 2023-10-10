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
import HomeListSection from "./HomeScreenCards/HomeListSection";

const MarketPlace = () => {
  const limit = 10, offset = 0;
  const navigate = useNavigate();
  const dispatch = useCategoryDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const { iscategorysLoading } = useCategoryState();

  useEffect(() => {
    actions.fetchCategories(dispatch, limit, offset, debouncedSearchTerm);
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  const data = [
    {
      name: "Product 1",
      price: "19.99",
      quantity: 5,
      image: "https://miro.medium.com/v2/resize:fit:512/1*x-EBQaqOV_clY8yVq3Wbmw.png"
    },
    {
      name: "Product 2",
      price: "29.99",
      quantity: 10,
      image: "https://tradingplatforms.com/wp-content/uploads/2022/04/ezgif-2-c503185458.jpg"
    },
    {
      name: "Product 3",
      price: "14.95",
      quantity: 8,
      image: "https://i.imgur.com/BkhrPF4.png"
    },
    {
      name: "Product 4",
      price: "39.99",
      quantity: 3,
      image: "https://img.freepik.com/premium-photo/cute-boy-pixar-style-cartoon-3d-illustration-generative-ai_808510-252.jpg"
    },
    {
      name: "Product 5",
      price: "9.99",
      quantity: 15,
      image: "https://img.freepik.com/premium-photo/funny-childish-female-young-character-light-color-background-generative-ai_58409-29585.jpg"
    },
    {
      name: "Product 6",
      price: "49.99",
      quantity: 2,
      image: "https://i.pinimg.com/736x/77/d4/15/77d41520a3f07995b184797a3734bf44.jpg"
    },
    {
      name: "Product 7",
      price: "24.99",
      quantity: 7,
      image: "https://img.freepik.com/premium-photo/illustration-boy-running-magical-land-generative-ai_7023-123664.jpg"
    },
    {
      name: "Product 8",
      price: "34.95",
      quantity: 6,
      image: "https://example.com/image8.jpghttps://img.freepik.com/premium-photo/3d-rendering-boy-running-road-with-schoolbag-his-back_432516-4830.jpg"
    }
  ];

  return (
    <>
      <div className="relative">
        <Typography.Text className="w-80 z-10 absolute left-12 top-12 text-5xl leading-[60px] text-white font-semibold">
          Explore New Products
        </Typography.Text>
        <Typography.Text className="absolute z-10 left-12 top-48 text-sm text-white">
        </Typography.Text>
        <Button
          id="viewMore"
          onClick={() => navigate(routes.MarketplaceProductList.url)}
          className="group w-56 h-14 z-10 absolute left-12 top-60 border border-white hover:bg-primary opacity-80">
          <div className="text-white font-bold group-hover:text-white text-base text-lg">
            View More
          </div>
        </Button>
        <Image className="absolute inset-0 w-full h-full object-cover" style={{ filter: "brightness(0.7) saturate(70%) sepia(10%)" }} height={380} src={Images.hero2} preview={false} width="100%" />
      </div>
      {iscategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <div className="px-8 py-12">
          <CategoryCard />
          <HomeListSection heading="Trending in Arts" list={data} />
          <TopSellingProductCard />
        </div>
      )}
    </>
  );
};

export default MarketPlace;
