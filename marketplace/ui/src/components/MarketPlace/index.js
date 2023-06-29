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
      <div className="relative">
        <Typography.Text className="w-80 z-10 absolute left-12 top-12 text-5xl leading-[60px]">
          Explore New Products
        </Typography.Text>
        <Typography.Text className="absolute z-10 left-12 top-48 text-sm text-grayDark">
        </Typography.Text>
        <Button
          id="viewMore"
          onClick={() => navigate(routes.MarketplaceProductList.url)}
          className="group w-44 h-11 z-10 absolute left-12 top-60 border border-primary hover:bg-primary">
          <div className="text-primary group-hover:text-white text-sm font-medium ">
            View More
          </div>
        </Button>
        <Image height={380} src={Images.hero2} preview={false} width="100%" />
      </div>
      {iscategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <div className="px-8 py-12">
          <CategoryCard />
          <TopSellingProductCard />
        </div>
      )}
    </>
  );
};

export default MarketPlace;
