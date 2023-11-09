import { useEffect, useState } from "react";
import { useMatch } from "react-router-dom";
import {
  Collapse,
  Divider,
  Typography,
  Checkbox,
  Spin,
  InputNumber,
  Space,
} from "antd";
// Components
import CategoryProductCard from "./CategoryProductCard";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
import NoProductComponent from "../NoProductFound/NoProductComponent";
import LoaderComponent from "../Loader/LoaderComponent";
// Actions
import { actions as categoryActions } from "../../contexts/category/actions";
import { actions as subCategoryActions } from "../../contexts/subCategory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
// Dispatch and Actions
import { useSubCategoryDispatch, useSubCategoryState } from "../../contexts/subCategory";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useAuthenticateState } from "../../contexts/authentication";
// Utils, Constants
import { MAX_QUANTITY, MAX_PRICE } from "../../helpers/constants";
import { arrayToStr } from "../../helpers/utils";
import routes from "../../helpers/routes";
import useDebounce from "../UseDebounce";

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {
  // Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const subCategoryDispatch = useSubCategoryDispatch();
  const categoryDispatch = useCategoryDispatch();
  // States
  const { marketplaceList, isMarketplaceLoading, isMarketplaceInitialLoading } = useMarketplaceState();
  const { subCategorys, isSubCategorysLoading } = useSubCategoryState();
  const { hasChecked, isAuthenticated } = useAuthenticateState();
  const { categorys, isCategorysLoading } = useCategoryState();

  const [productList, setProductList] = useState([])
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

  let currentCategory;

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, []);

  const routeMatch = useMatch({
    path: routes.MarketplaceProductList.url,
    strict: true,
  });

  // const onChangeCategory = (checkedValues) => {
  //   setSelectedCategories(checkedValues);
  //   currentCategory = categorys.find((c) => c.name === checkedValues);
  //   if (checkedValues.length) clearSelection();
  // };

  useEffect(() => {
    let param = routeMatch?.params?.category;
    let newCategory = [];
    if (param !== ":category") newCategory.push(param);
    setCategory(param);
    setSelectedCategories(newCategory);
  }, []);

  currentCategory = categorys.find((c) => c.name === category);
  currentCategory ?? (currentCategory = " ");

  useEffect(() => {
    let categorys = null;
    if (selectedCategories.length) {
      categorys = arrayToStr(selectedCategories);
      subCategoryActions.fetchSubCategoryList(subCategoryDispatch, categorys);
    }
  }, [selectedCategories]);

  const onChangeSubCategory = (e) => {
    let valuesChecked = checkValues(e, selectedSubCategories)
    setSelectedSubCategories(valuesChecked);
  };

  const onChangeProduct = (e) => {
    let valuesChecked = checkValues(e, selectedProducts)
    setSelectedProducts(valuesChecked);
    if (valuesChecked.length === 0 && selectedBrands.length === 0) {
      setProductList(marketplaceList)
    } else {
      let filteredBrandProduct;
      if (valuesChecked.length !== 0 && selectedBrands.length !== 0) {
        filteredBrandProduct = marketplaceList.filter((item) => (valuesChecked.includes(item.productId) && selectedBrands.includes(item.manufacturer)));
      }
      if (valuesChecked.length === 0 && selectedBrands.length !== 0) {
        filteredBrandProduct = marketplaceList.filter((item) => (selectedBrands.includes(item.manufacturer)));
      }
      if (valuesChecked.length !== 0 && selectedBrands.length === 0) {
        filteredBrandProduct = marketplaceList.filter((item) => (valuesChecked.includes(item.productId)));
      }
      setProductList(filteredBrandProduct);
    }
  };

  const onChangeBrand = (e) => {
    let valuesChecked = checkValues(e, selectedBrands)
    setSelectedBrands(valuesChecked);

    if (valuesChecked.length === 0 && selectedProducts.length === 0) {
      setProductList(marketplaceList);
    } else {
      let filteredBrandProduct;
      if (valuesChecked.length !== 0 && selectedProducts.length !== 0) {
        filteredBrandProduct = marketplaceList.filter((item) => (valuesChecked.includes(item.manufacturer) && selectedProducts.includes(item.productId)));
      }
      if (valuesChecked.length === 0 && selectedProducts.length !== 0) {
        filteredBrandProduct = marketplaceList.filter((item) => (selectedProducts.includes(item.productId)));
      }
      if (valuesChecked.length !== 0 && selectedProducts.length === 0) {
        filteredBrandProduct = marketplaceList.filter((item) => (valuesChecked.includes(item.manufacturer)));
      }
      setProductList(filteredBrandProduct);
    }
  };

  useEffect(() => {
    if (category !== "" && hasChecked && !isAuthenticated) {
      marketplaceActions.fetchMarketplace(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        arrayToStr(selectedSubCategories),
        arrayToStr(selectedProducts),
        arrayToStr(selectedBrands),
        debouncedMinQty,
        debouncedMaxQty,
        debouncedMinPrice,
        debouncedMaxPrice
      );
    } else if (category !== "" && isAuthenticated) {
      marketplaceActions.fetchMarketplaceLoggedIn(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        arrayToStr(selectedSubCategories),
        arrayToStr(selectedProducts),
        arrayToStr(selectedBrands),
        debouncedMinQty,
        debouncedMaxQty,
        debouncedMinPrice,
        debouncedMaxPrice
      );
    }
  }, [
    selectedCategories,
    selectedSubCategories,
    // selectedProducts,
    // selectedBrands,
    debouncedMinQty,
    debouncedMaxQty,
    debouncedMinPrice,
    debouncedMaxPrice,
    category,
    hasChecked,
    isAuthenticated,
  ]);

  useEffect(() => {
    if (marketplaceList.length > 0) {
      var uniqueBrands =
        marketplaceList.map((p) => p.manufacturer)
          .filter(
            (manufacturer, index, arr) => arr.indexOf(manufacturer) === index
          );
      setBrands(uniqueBrands);
    }
    setProductList(marketplaceList)
  }, [marketplaceList]);

  // const clearSelection = () => {
  //   setSelectedSubCategories([]);
  //   setSelectedProducts([]);
  //   setSelectedBrands([]);
  // };

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

  const isLoading = isSubCategorysLoading || isMarketplaceLoading || isCategorysLoading || isMarketplaceInitialLoading;

  return (
    <div>
      <BreadCrumbComponent />
      <div className="flex pt-4">
        {/* Filter section */}
        <div className="mr-6 pt-4">
          <div className="bg-white shadow-[2px_-2px_4px_0_rgba(0,0,0,0.05)] my-6 pt-4 mb-24">
            <Text className="text-xl font-semibold  pl-12 pr-7">Filters</Text>
            <Divider className="m-0 mt-3" />
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

            {/* Panel - SubCategory */}
            {currentCategory && (
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
                      value={selectedSubCategories}
                    >
                      <div className="flex flex-col gap-3">
                        {subCategorys.map(({ name }, index) => (
                          <Checkbox value={name} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
                            {name}
                          </Checkbox>
                        ))}
                      </div>
                    </Checkbox.Group>
                  </Panel>
                </Collapse>
                <Divider className="m-0" />
              </>
            )}

            {/* Panel - Product */}
            {marketplaceList.length > 0 && (
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
                      value={selectedProducts}
                    >
                      <div className="flex flex-col gap-3">
                        {(selectedBrands.length > 0 ? productList : marketplaceList).map(({ productId, name }, index) => (
                          <Checkbox value={productId} key={index} className="m-0" onChange={onChangeProduct}>
                            {name}
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
            {brands.length > 0 && marketplaceList.length > 0 && (
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
                            {brand}
                          </Checkbox>
                        ))}
                      </div>
                    </Checkbox.Group>
                  </Panel>
                </Collapse>
                <Divider className="m-0" />
              </>
            )}
            <div className="pb-24"></div>
          </div>
        </div>

        {/* Product list section */}
        {isLoading
          ? <LoaderComponent />
          : (
            <div className="w-9/12 mb-12">
              <Text className="text-sm text-secondryB">
                {marketplaceList.length} Products found
              </Text>
              {marketplaceList.length > 0
                ? <div className="mt-4 mb-8 mr-10" id="product-list">
                  {productList.map((product, index) => {
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
                : <NoProductComponent text={"Product"} />
              }
            </div>
          )}
      </div>
    </div>
  );
};

export default CategoryProductList;
