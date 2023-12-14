import {
  Breadcrumb,
  Collapse,
  Divider,
  Typography,
  Checkbox,
  Spin,
  InputNumber,
  Space,
  Pagination
} from "antd";
import CategoryProductCard from "./CategoryProductCard";
//categories
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useEffect, useState } from "react";
//sub-categories
import { actions as subCategoryActions } from "../../contexts/subCategory/actions";
import {
  useSubCategoryDispatch,
  useSubCategoryState,
} from "../../contexts/subCategory";
//Marketplace
import { actions } from "../../contexts/marketplace/actions";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { arrayToStr } from "../../helpers/utils";
import routes from "../../helpers/routes";
import useDebounce from "../UseDebounce";
import { useMatch } from "react-router-dom";
import { MAX_QUANTITY, MAX_PRICE } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import { useAuthenticateState } from "../../contexts/authentication";

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {
  const [category, setCategory] = useState("");
  const [brands, setBrands] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedSubCategories, setSelectedSubCategories] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [minPrice, setMinPrice] = useState(0);
  const [maxQty, setMaxQty] = useState(MAX_QUANTITY);
  const [minQty, setMinQty] = useState(0);
  const debouncedMaxQty = useDebounce(maxQty, 1000);
  const debouncedMinQty = useDebounce(minQty, 1000);
  const debouncedMaxPrice = useDebounce(maxPrice, 1000);
  const debouncedMinPrice = useDebounce(minPrice, 1000);
  const [subCategories, setSubCategories] = useState([]);
  const [uniqueProductNames, setUniqueProductNames] = useState([]);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  //=========================Categories===============================//
  const categoryDispatch = useCategoryDispatch();
  const { categorys } = useCategoryState();
  let currentCategory;

  let { hasChecked, isAuthenticated } = useAuthenticateState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const routeMatch = useMatch({
    path: routes.MarketplaceProductList.url,
    strict: true,
  });

  const onChangeCategory = (checkedValues) => {
    setSelectedCategories(checkedValues);
    currentCategory = categorys.find((c) => c.name === checkedValues);
    if (checkedValues.length === 0) clearSelection();
  };

  useEffect(() => {
    let param = routeMatch?.params?.category;
    let newCategory = [];
    if (param !== ":category") newCategory.push(param);
    setCategory(param);
    setSelectedCategories(newCategory);
  }, []);

  currentCategory = categorys.find((c) => c.name === category);
  currentCategory ?? (currentCategory = " ");
  //=========================Sub-categories===============================//

  const subCategoryDispatch = useSubCategoryDispatch();
  const { subCategorys } = useSubCategoryState();
  
  useEffect(() => {
    setSubCategories(subCategorys);
  }, [subCategorys]);

  useEffect(() => {
    let categorys = null;
    if (selectedCategories.length) {
      categorys = arrayToStr(selectedCategories);
      subCategoryActions.fetchSubCategoryList(subCategoryDispatch, categorys);
    }
  }, [subCategoryDispatch, selectedCategories]);

  const onChangeSubCategory = (e) => {
    let valuesChecked = checkValues(e, selectedSubCategories)
    setSelectedSubCategories(valuesChecked);
  };

  const onChangeProduct = (e) => {
    let valuesChecked = checkValues(e, selectedProducts)
    setSelectedProducts(valuesChecked);
  };

  const onChangeBrand = (e) => {
    let valuesChecked = checkValues(e, selectedBrands)
    setSelectedBrands(valuesChecked);
  };
  //============================Marketplace================================//
  const marketplaceDispatch = useMarketplaceDispatch();
  const { marketplaceList, isMarketplaceLoading, marketplaceListCount } = useMarketplaceState();
  useEffect(() => {
    if (category !== "" && hasChecked && !isAuthenticated) {
        actions.fetchMarketplace(
          marketplaceDispatch,
          arrayToStr(selectedCategories),
          arrayToStr(selectedSubCategories),
          arrayToStr(selectedProducts),
          arrayToStr(selectedBrands),
          debouncedMinQty,
          debouncedMaxQty,
          debouncedMinPrice,
          debouncedMaxPrice,
          limit,
          offset
        );
    } else if (category !== "") {
        actions.fetchMarketplaceLoggedIn(
          marketplaceDispatch,
          arrayToStr(selectedCategories),
          arrayToStr(selectedSubCategories),
          arrayToStr(selectedProducts),
          arrayToStr(selectedBrands),
          debouncedMinQty,
          debouncedMaxQty,
          debouncedMinPrice,
          debouncedMaxPrice,
          limit,
          offset
          );
    }
  }, [
    marketplaceDispatch,
    selectedCategories,
    selectedSubCategories,
    selectedProducts,
    selectedBrands,
    debouncedMinQty,
    debouncedMaxQty,
    debouncedMinPrice,
    debouncedMaxPrice,
    category,
    hasChecked,
    isAuthenticated,
    offset,
  ]);

  //============================Manufacturers/Brands=============================//
  useEffect(() => {
    if (marketplaceList?.length > 0) {
      var uniqueBrands =
        marketplaceList.map((p) => p.manufacturer)
          .filter(
            (manufacturer, index, arr) => arr.indexOf(manufacturer) == index
          );
      setBrands(uniqueBrands);

      const uniqueNames = marketplaceList.map((p) => p.name)
                            .filter(
                              (name, index, arr) => arr.indexOf(name) == index
                            );
      setUniqueProductNames(uniqueNames);
    }
  }, [marketplaceList]);

  //=========================Other functions===============================//

  const clearSelection = () => {
    setSelectedSubCategories([]);
    setSelectedProducts([]);
    setSelectedBrands([]);
    setSubCategories([]);
  };
  
  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  //=============================================================================//
  const checkValues = (e, arr) => {
    let tempValues = [...arr];
    const existingIndex = tempValues.indexOf(e.target.value);
    if (e.target.checked) {
      if (existingIndex === -1) {
        tempValues.push(e.target.value)
      }
    } else {
      tempValues.splice(existingIndex, 1);
    }
    return tempValues;
  }
  //============================================================================//

  return (
    <div>
      <Breadcrumb className="text-xs ml-14 mt-14">
      <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            <p href={routes.Marketplace.url} className="text-primaryB hover:bg-transparent">
              Home
            </p>
          </ClickableCell>
        </Breadcrumb.Item>
        {selectedCategories?.map((category, index) => (
          <Breadcrumb.Item key={index} className="text-primary">
            {category ? category : ""}
          </Breadcrumb.Item>
        ))}
      </Breadcrumb>
      <div className="flex pt-4">
        {/* Filter section */}
        <div className="mr-6 pt-4">
          <div className="bg-white shadow-[2px_-2px_4px_0_rgba(0,0,0,0.05)] my-6 pt-4 mb-24">
            <Text className="text-xl font-semibold  pl-12 pr-7">Filters</Text>
            <Divider className="m-0 mt-3" />

            {/* Panel - Category */}
            {categorys.length > 0 && (
              <>
                <Collapse
                  bordered={false}
                  defaultActiveKey={1}
                  expandIconPosition="end"
                  ghost="true"
                  reverse={false}
                  className="pl-8 pr-7"
                >
                  <Panel header={<Text strong>Categories</Text>} key="1">
                    <Checkbox.Group
                      onChange={onChangeCategory}
                      value={selectedCategories}
                    >
                      <div className="flex flex-col gap-3">
                        {categorys.map((category, index) => (
                          <Checkbox value={category.name} key={index} className="m-0">
                            {category.name}
                          </Checkbox>
                        ))}
                      </div>
                    </Checkbox.Group>
                  </Panel>
                </Collapse>
                <Divider className="m-0" />
              </>
            )}

            {/* Panel - Price */}
            <Collapse
              bordered={false}
              defaultActiveKey={1}
              expandIconPosition="end"
              ghost="true"
              reverse={false}
              className="pl-8 pr-7"
            >
              <Panel header={<Text strong>Price</Text>} key="1">
                <Space>
                  <InputNumber min={0} prefix='$' placeholder="min" onChange={(e) => {
                    e === null ? setMinPrice(0) : setMinPrice(e)
                  }} />
                  -
                  <InputNumber min={minPrice} prefix='$' placeholder="max" onChange={(e) => {
                    e === null ? setMaxPrice(MAX_PRICE) : setMaxPrice(e)
                  }} />
                </Space>
              </Panel>
            </Collapse>
            <Divider className="m-0" />

            {/* Panel - Quantity */}
            <Collapse
              bordered={false}
              defaultActiveKey={1}
              expandIconPosition="end"
              ghost="true"
              reverse={false}
              className="pl-8 pr-7"
            >
              <Panel header={<Text strong>Quantity</Text>} key="1">
              <Space>
                  <InputNumber min={0} placeholder="min" onChange={(e) => {
                    e === null ? setMinQty(0) : setMinQty(e)
                  }} />
                  -
                  <InputNumber min={minPrice} placeholder="max" onChange={(e) => {
                    e === null ? setMaxQty(MAX_QUANTITY) : setMaxQty(e)
                  }} />
                </Space>
              </Panel>
            </Collapse>
            <Divider className="m-0" />

            {/* Panel - SubCategory */}
            {/* {currentCategory && (
              <>
                <Collapse
                  bordered={false}
                  defaultActiveKey={1}
                  expandIconPosition="end"
                  ghost="true"
                  reverse={false}
                  className="pl-8 pr-7"
                >
                  <Panel header={<Text strong>Sub-Category</Text>} key="1">
                    <Checkbox.Group
                      // onChange={onChangeSubCategory}
                      value={selectedSubCategories}
                    >
                      <div className="flex flex-col gap-3">
                      </div>
                    </Checkbox.Group>
                  </Panel>
                </Collapse>
                <Divider className="m-0" />
              </>
            )} */}

            {/* Panel - Product */}
            {marketplaceList?.length > 0 && (
              <>
                <Collapse
                  bordered={false}
                  defaultActiveKey={1}
                  expandIconPosition="end"
                  ghost="true"
                  reverse={false}
                  className="pl-8 pr-7"
                >
                  <Panel header={<Text strong>Product</Text>} key="1">
                    <Checkbox.Group
                      // onChange={onChangeProduct}
                      value={selectedProducts}
                    >
                      <div className="flex flex-col gap-3">
                        {uniqueProductNames.map((product, index) => (
                          <Checkbox value={product} key={index} className="m-0" onChange={onChangeProduct}>
                            {decodeURIComponent(product)}
                          </Checkbox>
                        ))}
                      </div>
                    </Checkbox.Group>
                  </Panel>
                </Collapse>
                <Divider className="m-0" />
              </>
            )}

            {/* Panel - Manufacturer/Brand */}
            {/* {brands.length > 0 && marketplaceList.length > 0 && (
              <>
                <Collapse
                  bordered={false}
                  defaultActiveKey={1}
                  expandIconPosition="end"
                  ghost="true"
                  reverse={false}
                  className="pl-8 pr-7"
                >
                  <Panel header={<Text strong>Brand</Text>} key="1">
                    <Checkbox.Group
                      value={selectedBrands}
                    >
                      <div className="flex flex-col gap-3">
                        {brands.map((brand, index) => (
                          <Checkbox value={brand} key={index} className="m-0" onChange={onChangeBrand}>
                            {decodeURIComponent(brand)}
                          </Checkbox>
                        ))}
                      </div>
                    </Checkbox.Group>
                  </Panel>
                </Collapse>
                <Divider className="m-0" />
              </>
            )} */}
            <div className="pb-24"></div>
          </div>
        </div>

        {/* Product list section */}
        {isMarketplaceLoading ? (
          <div className="h-96 w-9/12 flex justify-center items-center">
            <Spin spinning={isMarketplaceLoading} size="large" />
          </div>
        ) : (
          <div className="w-9/12 mb-12">
            <Text className="text-sm text-secondryB">
              {marketplaceListCount} Products found
            </Text>
            {marketplaceList?.length > 0 ? (
              <div className="mt-4 mb-8 mr-10" id="product-list">
                {marketplaceList.map((product, index) => {
                  const prodCategory = categorys.find(
                    (c) => c.name === product.category
                  );
                  return (
                    <CategoryProductCard
                      product={product}
                      key={index}
                      category={prodCategory == null ? "" : prodCategory.name}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="h-96 flex justify-center items-center" id="product-list">
                No data found
              </div>
            )}
            <Pagination
              current={page}
              onChange={onPageChange}
              total={marketplaceListCount}
              showSizeChanger={false}
              className="flex justify-center my-5 "
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryProductList;
