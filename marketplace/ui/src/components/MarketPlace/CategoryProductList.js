import {
  Breadcrumb,
  Collapse,
  Divider,
  Typography,
  Checkbox,
  Spin,
  InputNumber,
  Space,
  Avatar,
  Input,
  notification,
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
import { SearchOutlined, CloseOutlined } from "@ant-design/icons";
import NewTrendingCard from "./NewTrendingCard";
import { FilterIcon } from "../../images/SVGComponents";
import { Images } from "../../images";
import './index.css'

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {
  const [category, setCategory] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedSubCategories, setSelectedSubCategories] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [minPrice, setMinPrice] = useState(0);
  const [subCategories, setSubCategories] = useState([]);
  const [uniqueProductNames, setUniqueProductNames] = useState([]);
  const [desktopOpenFilter, setDesktopOpenFilter] = useState(true);
  const [mobileOpenFilter, setMobileOpenFilter] = useState(false);
  //=========================Categories===============================//
  const categoryDispatch = useCategoryDispatch();
  const { categorys } = useCategoryState();
  const { cartList } = useMarketplaceState();
  const [api] = notification.useNotification();
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

  //============================Marketplace================================//
  const marketplaceDispatch = useMarketplaceDispatch();
  const { marketplaceList, isMarketplaceLoading, marketplaceListCount } = useMarketplaceState();
  useEffect(() => {
    let subCategoriesOfSelectedCategories = "";
    subCategorys.map((sub) => subCategoriesOfSelectedCategories += sub.contract + ",");

    if (category !== "" && hasChecked && !isAuthenticated &&
      ((selectedSubCategories.length === 0 && selectedCategories.length === 0)
        || (selectedSubCategories.length !== 0 && selectedCategories.length !== 0))) {
      actions.fetchMarketplace(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        arrayToStr(selectedSubCategories),
        arrayToStr(selectedProducts),
        arrayToStr(selectedBrands),
        minPrice,
        maxPrice
      );
    } else if (category !== "" && ((selectedSubCategories.length === 0 && selectedCategories.length === 0)
      || (selectedSubCategories.length !== 0 && selectedCategories.length !== 0))) {
      actions.fetchMarketplaceLoggedIn(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        arrayToStr(selectedSubCategories),
        arrayToStr(selectedProducts),
        arrayToStr(selectedBrands),
        minPrice,
        maxPrice
      );
    } else if (selectedSubCategories.length === 0 && selectedCategories.length > 0 && hasChecked && !isAuthenticated) {
      actions.fetchMarketplace(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        subCategoriesOfSelectedCategories,
        arrayToStr(selectedProducts),
        arrayToStr(selectedBrands),
        minPrice,
        maxPrice
      );
    } else if (selectedSubCategories.length === 0 && selectedCategories.length > 0) {
      actions.fetchMarketplaceLoggedIn(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        subCategoriesOfSelectedCategories,
        arrayToStr(selectedProducts),
        arrayToStr(selectedBrands),
        minPrice,
        maxPrice
      );
    }
  }, [
    marketplaceDispatch,
    selectedSubCategories,
    subCategorys,
    selectedProducts,
    selectedBrands,
    minPrice,
    maxPrice,
    category,
    hasChecked,
    isAuthenticated,
  ]);

  useEffect(() => {
    if (marketplaceList?.length > 0) {
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

  const handleFilterClick = () => {
    setDesktopOpenFilter(!desktopOpenFilter);
    setMobileOpenFilter(!mobileOpenFilter);
  };

  const addItemToCart = (product) => {
    if (product.ownerCommonName === user?.commonName) {
      openToast("bottom", true, "Cannot buy your own item")
      return false;
    }
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === product.address) {
        found = true;
        break;
      }
    }
    let items = [];
    if (!found) {
      items = [...cartList, { product, qty: 1 }];
      actions.addItemToCart(marketplaceDispatch, items);

      openToast("bottom", false, "Item added to cart");
      return true;
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.address) {
          const availableQuantity = product.saleQuantity ? product.saleQuantity : 1;
          if (items[index].qty + 1 <= availableQuantity) {
            items[index].qty += 1;
            actions.addItemToCart(marketplaceDispatch, items);

            openToast("bottom", false, "Item updated in cart");
            return true;
          } else {
            openToast(
              "bottom",
              true,
              "Cannot add more than available quantity"
            );
            return false;
          }
        }
      });
    }
  };

  const openToast = (placement, isError, msg) => {
    if (isError) {
      api.error({
        message: msg,
        placement,
        key: 1,
      });
    } else {
      api.success({
        message: msg,
        placement,
        key: 1,
      });
    }
  };

  return (
    <div className={`${mobileOpenFilter ? 'overflow-y-hidden h-[67.5vh] md:h-[100vh] w-[100vw] bg-[#00000020] relative mt-24 md:bg-white md:mt-[auto] md:overflow-scroll trending_cards' : ' '}`}>
      <div className="fixed bg-white w-full top-7 z-10 md:static">
        <Breadcrumb className="text-xs ml-4 md:ml-14 mt-14">
          <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p href={routes.Marketplace.url} className="text-[#13188A] font-semibold hover:bg-transparent text-sm">
                Home
              </p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={e => setSelectedCategories([])}>
            <ClickableCell href={routes.MarketplaceProductList.url}>
              <p href={routes.MarketplaceProductList.url} className={`${selectedCategories.length > 0 ? "text-[#13188A] font-semibold " :"text-[#202020] font-medium"} text-sm hover:bg-transparent`}>
                Marketplace
              </p>
            </ClickableCell>
          </Breadcrumb.Item>
          {selectedCategories?.map((category, index) => (
            <Breadcrumb.Item key={index} className="text-[#202020] font-medium text-sm">
              {category ? category : ""}
            </Breadcrumb.Item>
          ))}
        </Breadcrumb>

        <div className="flex items-center justify-center ml-4 md:ml-14 mr-14 mt-4 gap-4">
          <div className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2" onClick={handleFilterClick}>
            <img src={Images.filter} alt="filter" className=" w-5 h-5 md:w-6 md:h-6"/>
          </div>

          <div className={`flex-1 `}>
            <Input
              size="large"
              placeholder="Search Marketplace"
              prefix={<img src={Images.Header_Search} alt="search" className="w-[18px] h-[18px]" />}
              className="bg-[#F6F6F6] border-none rounded-3xl p-[10px]"
            />
          </div>
        </div>

        <div className="flex items-center ml-4 mt-2 md:ml-14 md:hidden">
          <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
          <Text className="text-gray-800 ml-1 text-sm font-normal">
            {marketplaceList?.length} Results
          </Text>
        </div>
      </div>

      <div className="flex pt-4 mx-14 mt-[60px] md:mt-4 ">
        {/* Filter section */}
        {desktopOpenFilter &&
          <div className="mr-6 w-1/3 hidden md:flex md:flex-col">
            <div className="flex items-center">
              <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
              <Text className="text-xl font-semibold pr-7 ml-1">Filters</Text>
            </div>
            <div className="bg-white border border-solid border-[#E9E9E9] my-6 mb-24">

              {/* Panel - Category */}
              {categorys.length > 0 && (
                <>
                  <Collapse
                    bordered={false}
                    defaultActiveKey={1}
                    expandIconPosition="end"
                    ghost="true"
                    reverse={false}
                    expandIcon={({ isActive }) =>
                      isActive ? <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px", transform:"rotate(180deg)"}} /> : <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px"}}/>
                    }
                  >
                    <Panel header={<Text strong className="text-base">Categories</Text>} key="1">
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
                  <Divider className="m-auto w-[94%] min-w-[80%]" />
                </>
              )}

              {/* Panel - SubCategory */}
              {subCategories.length > 0 && (
                <>
                  <Collapse
                    bordered={false}
                    defaultActiveKey={1}
                    expandIconPosition="end"
                    ghost="true"
                    reverse={false}
                    expandIcon={({ isActive }) =>
                      isActive ? <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px", transform:"rotate(180deg)"}} /> : <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px"}}/>
                    }
                  >
                    <Panel header={<Text strong className="text-base">Sub-Category</Text>} key="1">
                      <Checkbox.Group
                        // onChange={onChangeSubCategory}
                        value={selectedSubCategories}
                      >
                        <div className="flex flex-col gap-3">
                          {subCategories.map((subcategory, index) => (
                            <Checkbox value={subcategory.contract} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
                              {subcategory.name}
                            </Checkbox>
                          ))}
                        </div>
                      </Checkbox.Group>
                    </Panel>
                  </Collapse>
                  <Divider className="m-auto w-[94%] min-w-[80%]" />
                </>
              )}
              <Divider className="m-auto w-[94%] min-w-[80%]" />

              {/* Panel - Price */}
              <Collapse
                bordered={false}
                defaultActiveKey={1}
                expandIconPosition="end"
                ghost="true"
                reverse={false}
                expandIcon={({ isActive }) =>
                      isActive ? <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px", transform:"rotate(180deg)"}} /> : <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px"}}/>
                    }
              >
                <Panel header={<Text strong className="text-base">Price ($)</Text>} key="1">
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
              <Divider className="m-auto w-[94%] min-w-[80%]" />

              {/* Panel - Product */}
              {marketplaceList?.length > 0 && (
                <>
                  <Collapse
                    bordered={false}
                    defaultActiveKey={1}
                    expandIconPosition="end"
                    ghost="true"
                    reverse={false}
                    expandIcon={({ isActive }) =>
                      isActive ? <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px", transform:"rotate(180deg)"}} /> : <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px"}}/>
                    }
                  >
                    <Panel header={<Text strong className="text-base">Product</Text>} key="1">
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
                  <Divider className="m-auto w-[94%] min-w-[80%]" />
                </>
              )}

              {/* Panel - Quantity */}
              <Collapse
                bordered={false}
                defaultActiveKey={1}
                expandIconPosition="end"
                ghost="true"
                reverse={false}
                expandIcon={({ isActive }) =>
                      isActive ? <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px", transform:"rotate(180deg)"}} /> : <img src={Images.Dropdown} alt="img" style={{width:"24px", height:"24px"}}/>
                    }
              >
                <Panel header={<Text strong className="text-base">Quantity</Text>} key="1">
                  <Space className="flex flex-col">
                  <div className="flex flex-col">
                    <Text>Min</Text>
                    <InputNumber min={0} controls={false} prefix="$" 
                    addonAfter={
                    <div className="flex flex-row gap-[1px]">
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        -
                      </Typography> 
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        +
                      </Typography>
                    </div>
                    } 
                    className="w-full"/>
                  </div>
                    
                  <div className="flex flex-col gap-[1px]">
                  <Text>Max</Text>
                    <InputNumber min={minPrice} prefix="$" 
                    controls={false}
                    addonAfter={
                    <div className="flex flex-row">
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        -
                      </Typography> 
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        +
                      </Typography>
                    </div>
                    } 
                    className="w-full"/>
                  </div>
                  </Space>
                </Panel>
              </Collapse>
              <Divider className="m-auto w-[94%] min-w-[80%]" />

              <div className="pb-2"></div>
            </div>
          </div>}

        {/* Product list section */}

        {isMarketplaceLoading ? (
          <div className="h-96 w-full flex justify-center items-center">
            <Spin spinning={isMarketplaceLoading} size="large" />
          </div>
        ) : (
          <div className=" mb-12 w-full">
            <div className="hidden md:flex items-center">
              <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
              <Text className="text-gray-800 ml-1 text-xl font-semibold">
                {marketplaceList?.length} Results
              </Text>
            </div>
            {marketplaceList?.length > 0 ? (
              <div className={`mt-[61px] md:mt-4 mb-8 flex w-full md:grid flex-col items-center ${desktopOpenFilter ? "grid-cols-1 gap-4 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 lg:gap-14 " : " sm:grid-cols-1 gap-4 md:grid-cols-2 md:gap-14 lg:grid-cols-3 lg:gap-16 xl:grid-cols-4"}`} id="product-list">
                {marketplaceList.map((product, index) => {
                  const prodCategory = categorys.find(
                    (c) => c.name === product.category
                  );
                  return (
                    <NewTrendingCard
                      topSellingProduct={product}
                      key={index}
                      addItemToCart={addItemToCart}
                      parent={"Marketplace"}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="h-96 flex justify-center items-center" id="product-list">
                No data found
              </div>
            )}
          </div>
        )}
      </div>

      {
        mobileOpenFilter &&
        <div>
          <div className="mr-6 fixed w-full h-full z-50 top-16 overflow-scroll md:hidden">
            <div className="bg-white shadow-[2px_-2px_4px_0_rgba(0,0,0,0.05)] mb-24">
              <div className="flex items-center justify-between pt-5">
                <Text className="text-base font-semibold pr-7 pl-7 ml-1">Select</Text>
                <Avatar icon={<CloseOutlined />} style={{ color: "#202020" }} className="flex items-center pr-12" onClick={handleFilterClick} />
              </div>
              <Divider className="m-0 mt-3" />

              {/* Panel - Category */}
              {categorys.length > 0 && (
                <>
                  <Collapse
                    bordered={false}
                    expandIconPosition="end"
                    ghost="true"
                    reverse={false}
                    className="pl-4 pr-4"
                  >
                    <Panel header={<Text>Categories</Text>} key="1">
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
              {/* Panel - Sub Category */}
              {currentCategory && (
                <>
                  <Collapse
                    bordered={false}
                    expandIconPosition="end"
                    ghost="true"
                    reverse={false}
                    className="pl-4 pr-4"
                  >
                    <Panel header={<Text>Sub-Category</Text>} key="1">
                      <Checkbox.Group
                        // onChange={onChangeSubCategory}
                        value={selectedSubCategories}
                      >
                        <div className="flex flex-col gap-3">
                          {subCategories.map((subcategory, index) => (
                            <Checkbox value={subcategory.contract} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
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
              {/* Panel - Price */}
              <Collapse
                bordered={false}
                expandIconPosition="end"
                ghost="true"
                reverse={false}
                className="pl-4 pr-4"
              >
                <Panel header={<Text>Price ($)</Text>} key="1">
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

              {/* Panel - Product */}
              {marketplaceList?.length > 0 && (
                <>
                  <Collapse
                    bordered={false}
                    expandIconPosition="end"
                    ghost="true"
                    reverse={false}
                    className="pl-4 pr-4"
                  >
                    <Panel header={<Text>Product</Text>} key="1">
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

              {/* Panel - Quantity */}
              <Collapse
                bordered={false}
                expandIconPosition="end"
                ghost="true"
                reverse={false}
                className="pl-4 pr-4"
              >
                <Panel header={<Text>Quantity</Text>} key="1">
                  <Space className="flex flex-row justify-center">
                  <div className="flex flex-col">
                    <Text>Min</Text>
                    <InputNumber min={0} controls={false} prefix="$" 
                    addonAfter={
                    <div className="flex flex-row gap-[1px]">
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        -
                      </Typography> 
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        +
                      </Typography>
                    </div>
                    } className="w-full"/>
                  </div>
                    
                  <div className="flex flex-col">
                  <Text>Max</Text>
                    <InputNumber min={minPrice} prefix="$" 
                    controls={false}
                    addonAfter={
                    <div className="flex flex-row gap-[1px]">
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        -
                      </Typography> 
                      <Typography className='px-2 bg-[#EEEFFA] cursor-pointer text-xl flex items-center'>
                        +
                      </Typography>
                    </div>
                    }
                    className="w-full"/>
                  </div>
                  </Space>
                </Panel>
              </Collapse>
              <Divider className="m-0" />

              <div className="pb-8"></div>
            </div>
          </div>
          <div className="h-full w-full bg-[#00000020] absolute top-0 md:hidden"></div>
        </div>
      }
    </div >
  );
};

export default CategoryProductList;
