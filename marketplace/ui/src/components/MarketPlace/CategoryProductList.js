import { useEffect, useState } from "react";
import { useMatch } from "react-router-dom";
import {
  Collapse,
  Divider,
  Typography,
  Checkbox,
  InputNumber,
  Space,
  Spin,
  Row,
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
  const { subCategorys, issubCategorysLoading } = useSubCategoryState();
  const { hasChecked, isAuthenticated, loginUrl, isCheckingAuthentication } = useAuthenticateState();
  const { categorys, iscategorysLoading } = useCategoryState();

  const [productList, setProductList] = useState([])
  const [category, setCategory] = useState("");
  const [brands, setBrands] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedSubCategories, setSelectedSubCategories] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [minPrice, setMinPrice] = useState(0);
  const maxQty = MAX_QUANTITY;
  const minQty = 0;
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

  const applyFilters = () => {
    let filteredList = marketplaceList;

    if (selectedSubCategories.length > 0) {
      filteredList = filteredList.filter(item =>
        selectedSubCategories.includes(item.subCategory)
      );
    }

    if (selectedProducts.length > 0) {
      filteredList = filteredList.filter(item =>
        selectedProducts.includes(item.productId)
      );
    }

    if (selectedBrands.length > 0) {
      filteredList = filteredList.filter(item =>
        selectedBrands.includes(item.manufacturer)
      );
    }

    if (debouncedMinPrice || debouncedMaxPrice) {
      filteredList = filteredList.filter(item =>
        (!debouncedMinPrice || item.pricePerUnit >= debouncedMinPrice) &&
        (!debouncedMaxPrice || item.pricePerUnit <= debouncedMaxPrice)
      );
    }

    setProductList(filteredList);
  };

  useEffect(() => {
    applyFilters();
  }, [
    selectedSubCategories,
    selectedProducts,
    selectedBrands,
    debouncedMinPrice,
    debouncedMaxPrice
  ]);

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

  useEffect(() => {
    if (category !== "" && hasChecked && !isAuthenticated && loginUrl) {
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
    } else if (category !== "" && isAuthenticated && !loginUrl) {
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
    debouncedMinQty,
    debouncedMaxQty,
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

  const FilterLoaderComponent = () => <Row> <Spin className="mx-auto" /> </Row>

  const PriceFilterComponent = () => {
    return <Collapse
      bordered={false}
      defaultActiveKey={1}
      expandIconPosition="end"
      ghost="true"
      reverse={false}
      className="pl-8 pr-7"
    >
      <Panel header={<Text strong>Price</Text>} key="1">
        {isLoading
          ? FilterLoaderComponent()
          : <Space>
            <InputNumber min={0} prefix='$' placeholder="min" controls={false} onChange={(e) => {
              e === null ? setMinPrice(0) : setMinPrice(e)
            }} />
            -
            <InputNumber min={minPrice} prefix='$' placeholder="max" controls={false} onChange={(e) => {
              e === null ? setMaxPrice(MAX_PRICE) : setMaxPrice(e)
            }} />
          </Space>}
      </Panel>
    </Collapse>
  }

  const SubCategoryFilterComponent = () => {
    return <>
      <Collapse
        bordered={false}
        defaultActiveKey={1}
        expandIconPosition="end"
        ghost="true"
        reverse={false}
        className="pl-8 pr-7"
      >
        <Panel header={<Text strong>Sub-Category</Text>} key="1">
          {isLoading
            ? FilterLoaderComponent()
            : <Checkbox.Group
              value={selectedSubCategories}
            >
              <div className="flex flex-col gap-3">
                {subCategorys.map(({ name }, index) => (
                  <Checkbox value={name} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
                    {name}
                  </Checkbox>
                ))}
              </div>
            </Checkbox.Group>}
        </Panel>
      </Collapse>
      <Divider className="m-0" />
    </>
  }

  const ProductFilterComponent = () => {
    return <>
      <Collapse
        bordered={false}
        defaultActiveKey={1}
        expandIconPosition="end"
        ghost="true"
        reverse={false}
        className="pl-8 pr-7"
      >
        <Panel header={<Text strong>Product</Text>} key="1">
          {isLoading ? FilterLoaderComponent() : marketplaceList.length > 0 && <Checkbox.Group
            value={selectedProducts}
          >
            <div className="flex flex-col gap-3">
              {productList.map(({ productId, name }, index) => (
                <Checkbox value={productId} key={index} className="m-0" onChange={onChangeProduct}>
                  {name}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>}
        </Panel>
      </Collapse>
      <Divider className="m-0" />
    </>
  }

  const BrandFilterComponent = () => {
    return <>
      <Collapse
        bordered={false}
        defaultActiveKey={1}
        expandIconPosition="end"
        ghost="true"
        reverse={false}
        className="pl-8 pr-7"
      >
        <Panel header={<Text strong>Brand</Text>} key="1">
          {isLoading
            ? FilterLoaderComponent()
            : brands.length > 0 && marketplaceList.length > 0 && <Checkbox.Group
              value={selectedBrands}
            >
              <div className="flex flex-col gap-3">
                {brands.map((brand, index) => (
                  <Checkbox value={brand} key={index} className="m-0" onChange={onChangeBrand}>
                    {brand}
                  </Checkbox>
                ))}
              </div>
            </Checkbox.Group>}
        </Panel>
      </Collapse>
      <Divider className="m-0" />
    </>
  }

  const isLoading = issubCategorysLoading || isMarketplaceLoading || iscategorysLoading || isMarketplaceInitialLoading || isCheckingAuthentication;

  return (
    <div>
      <BreadCrumbComponent />
      <div className="flex pt-4">
        {/* Filter section */}
        <div className="mr-6 pt-4 h-screen sticky top-2 ">
          <Text className="text-xl font-semibold  pl-12 pr-7">Filters</Text>
          <div className="h-screen w-96">
            <div className="bg-white shadow-[2px_-2px_4px_0_rgba(0,0,0,0.05)] my-6 pt-4 mb-24 overflow-y-scroll h-3/4">
              {PriceFilterComponent()}
              <Divider className="m-0" />
              {currentCategory && SubCategoryFilterComponent()}
              {ProductFilterComponent()}
              {BrandFilterComponent()}

              <div className="pb-24"></div>
            </div>
          </div>
        </div>
        {isLoading
          ? <LoaderComponent />
          : <div className="w-9/12 mb-12 mt-4">
            <Text className="text-sm text-secondryB">
              {productList.length} Products found
            </Text>
            {marketplaceList.length > 0
              ? <div className="mt-6 mb-8 mr-10" id="product-list">
                {productList.map((product, index) =>
                  <CategoryProductCard
                    product={product}
                    key={index}
                  />
                )}
              </div>
              : <NoProductComponent text={"Product"} />
            }
          </div>}
      </div>
    </div>
  );
};

export default CategoryProductList;
