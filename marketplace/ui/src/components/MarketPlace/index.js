import { Button, Image, Typography, Spin } from "antd";
import CategoryCard from "./CategoryCard";
import TopSellingProductCard from "./TopSellingProductCard";
import { Images } from "../../images";
import React, { useEffect } from "react";
import { actions as categoryActions } from "../../contexts/category/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import useDebounce from "../UseDebounce";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";

const MarketPlace = () => {
  const limit = 10, offset = 0;
  const navigate = useNavigate();
  const dispatch = useCategoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
  const { isCategorysLoading } = useCategoryState();
  const { topSellingProducts, isTopSellingProductsLoading } = useMarketplaceState();
  let { isAuthenticated } = useAuthenticateState();

  useEffect(() => {
    categoryActions.fetchCategories(dispatch, limit, offset, debouncedSearchTerm);
    if (!isAuthenticated) {
      marketplaceActions.fetchTopSellingProducts(marketplaceDispatch, offset);
    }
    if (isAuthenticated) {
      marketplaceActions.fetchTopSellingProductsLoggedIn(marketplaceDispatch, offset);
    }
  }, []);

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
          onClick={() => navigate(routes.MarketplaceProductList.membershipUrl)}
          className="group w-44 h-11 z-10 absolute left-12 top-60 border border-primary hover:bg-primary">
          <div className="text-primary group-hover:text-white text-sm font-medium ">
            View More
          </div>
        </Button>
        <Image height={540} src={Images.hero2}
          style={{ objectFit: "cover" }}
          preview={false} width="100%" />
      </div>
      {isCategorysLoading ? (
        <div className="h-96 flex justify-center items-center">
          <Spin spinning={isCategorysLoading} size="large" />
        </div>
      ) : (
        <div className="px-8 py-12">
          <CategoryCard />
          {isTopSellingProductsLoading ? <div className="h-96 flex justify-center items-center">
            <Spin spinning={isTopSellingProductsLoading} size="large" />
          </div> : <TopSellingProductCard topSellingProducts={topSellingProducts} />}
        </div>
      )}
    </>
  );
};

export default MarketPlace;
