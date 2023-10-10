import {
  Breadcrumb,
  Collapse,
  Divider,
  Typography,
  Checkbox,
  Spin,
  InputNumber,
  Space,
  Row,
  Col,
  Input,
  Select,
  Button,
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
import { filterIcon, searchIcon } from "../../images/SVGComponents";

const { Panel } = Collapse;
const { Text, Link } = Typography;

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
    if (checkedValues.length) clearSelection();
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
  const { marketplaceList, isMarketplaceLoading } = useMarketplaceState();
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
        debouncedMaxPrice
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
        debouncedMaxPrice
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
  ]);

  //============================Manufacturers/Brands=============================//
  useEffect(() => {
    if (marketplaceList.length > 0) {
      var uniqueBrands =
        marketplaceList.map((p) => p.manufacturer)
          .filter(
            (manufacturer, index, arr) => arr.indexOf(manufacturer) == index
          );
      setBrands(uniqueBrands);
    }
  }, [marketplaceList]);

  //=========================Other functions===============================//

  const clearSelection = () => {
    setSelectedSubCategories([]);
    setSelectedProducts([]);
    setSelectedBrands([]);
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
    <div className="mx-16">
      <Breadcrumb className="text-lg mt-14">
        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            <Link underline href={routes.Marketplace.url} className="text-primary font-bold hover:bg-transparent">
              Home
            </Link>
          </ClickableCell>
        </Breadcrumb.Item>
        {selectedCategories?.map((category, index) => (
          <Breadcrumb.Item key={index} className="text-primaryB">
            {category ? category : ""}
          </Breadcrumb.Item>
        ))}
      </Breadcrumb>
      <Row className="mt-4 flex justify-between">
        <Col sm={2} lg={1} className="h-12" >
          <Button size="large" block={true} className="h-12 mt-1" >
            <Text className="mx-auto mt-1">{filterIcon()}</Text>
          </Button>
        </Col>
        <Col sm={8} md={14} lg={12} xl={18} >
          <Input type="search" prefix={searchIcon()} size="large" placeholder="Search Marketplace" className="h-12 pl-3" />
        </Col>
        <Col sm={8} md={6} lg={6} xl={4} xxl={3} >
          <Select
            defaultValue="SortBy"
            size="large"
            // style={{ width: 120 }}
            className="py-1 w-52 float-right"
            // onChange={handleChange}
            options={[
              { value: 'SortBy', label: 'SortBy' },
              { value: 'Highest Price', label: 'Highest Price' },
              { value: 'Lowest Price', label: 'Lowest Price' },
              // { value: 'Yiminghe', label: 'Latest' },
            ]}
          />
        </Col>
      </Row>


      <Row className="flex justify-between mt-10">
        {/* Filter section */}
        <Col span={5} className="mb">
          <Text className="text-xl font-semibold">Filters</Text>
          <Divider className="m-0 mt-3" />
          <Row className="shadow-lg rounded-md" style={{border:"1px solid #0000002E"}} >
            {/* Panel - Category */}
            {categorys.length > 0 && (
              <>
                <Collapse
                  bordered={false}
                  defaultActiveKey={1}
                  expandIconPosition="end"
                  ghost="true"
                  reverse={false}
                  className="pr-7"
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
              className="pr-7"
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
              className="pr-7"
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
            {currentCategory && (
              <>
                <Collapse
                  bordered={false}
                  defaultActiveKey={1}
                  expandIconPosition="end"
                  ghost="true"
                  reverse={false}
                  className="pr-7"
                >
                  <Panel header={<Text strong>Sub-Category</Text>} key="1">
                    <Checkbox.Group
                      // onChange={onChangeSubCategory}
                      value={selectedSubCategories}
                    >
                      <div className="flex flex-col gap-3">
                        {subCategorys.map((subcategory, index) => (
                          <Checkbox value={subcategory.name} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
                            {subcategory.name}
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
                  className="pr-7"
                >
                  <Panel header={<Text strong>Product</Text>} key="1">
                    <Checkbox.Group
                      // onChange={onChangeProduct}
                      value={selectedProducts}
                    >
                      <div className="flex flex-col gap-3">
                        {marketplaceList.map((product, index) => (
                          <Checkbox value={product.productId} key={index} className="m-0" onChange={onChangeProduct}>
                            {decodeURIComponent(product.name)}
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
                  className="pr-7"
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
            )}
            <div className="pb-24"></div>
          </Row>
        </Col>

        {/* Product list section */}
        {isMarketplaceLoading ? (
          <div className="h-96 w-9/12 flex justify-center items-center">
            <Spin spinning={isMarketplaceLoading} size="large" />
          </div>
        ) : (
          <Col span={18} className="mb-8" >
            <Text className="text-md" strong>
              {marketplaceList.length} Results
            </Text>
            {marketplaceList.length > 0 ? (
              <Row gutter={[24, 12]} className="flex  md:gap-x-10  mt-4 mb-8 mr-10" id="product-list">
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
              </Row>
            ) : (
              <div className="h-96 flex justify-center items-center" id="product-list">
                No data found
              </div>
            )}
          </Col>
        )}
      </Row>
    </div>
  );
};

export default CategoryProductList;
