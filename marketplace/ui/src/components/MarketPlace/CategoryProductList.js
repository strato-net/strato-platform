import { useEffect, useState } from "react";
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
import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
// Actions
import { actions as categoryActions } from "../../contexts/category/actions";
import { actions as subCategoryActions } from "../../contexts/subCategory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
// Dispatch and states
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useSubCategoryDispatch, useSubCategoryState } from "../../contexts/subCategory";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";
// other
import { arrayToStr } from "../../helpers/utils";
import routes from "../../helpers/routes";
import { useLocation, useNavigate } from "react-router-dom";
import { MAX_PRICE } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import NewTrendingCard from "./NewTrendingCard";
import { Images } from "../../images";
import './index.css'

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {

  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);

  const searchQueryValue = queryParams.get('search');
  const categoryQueryValue = queryParams.get('category');
  const minPriceQuery = queryParams.get('minPrice') || 0;
  const maxPriceQuery = queryParams.get('maxPrice') || MAX_PRICE;
  const categoryQueryValueArr = categoryQueryValue ? categoryQueryValue.split(',') : []

  const [api] = notification.useNotification();
  // States
  const [selectedCategories, setSelectedCategories] = useState(categoryQueryValueArr);
  const [selectedSubCategories, setSelectedSubCategories] = useState([]);
  const [minPrice, setMinPrice] = useState(minPriceQuery);
  const [maxPrice, setMaxPrice] = useState(maxPriceQuery);
  const [subCategories, setSubCategories] = useState([]);
  const [uniqueProductNames, setUniqueProductNames] = useState([]);
  const [desktopOpenFilter, setDesktopOpenFilter] = useState(true);
  const [mobileOpenFilter, setMobileOpenFilter] = useState(false);
  const [search, setSearch] = useState(searchQueryValue)

  //=========================Categories===============================//
  const categoryDispatch = useCategoryDispatch();
  const subCategoryDispatch = useSubCategoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  // states
  const { marketplaceList, isMarketplaceLoading } = useMarketplaceState();
  const { categorys } = useCategoryState();
  let { hasChecked, isAuthenticated } = useAuthenticateState();
  const { subCategorys } = useSubCategoryState();
  const { cartList } = useMarketplaceState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, []);

  const onChangeCategory = (checkedValues) => {
    const categoryStr = checkedValues.join(",");
    const baseUrl = new URL('/category', window.location.origin);

    if (checkedValues.length === 0 && searchQueryValue) {
      baseUrl.searchParams.set('search', searchQueryValue);
    }
    if (checkedValues.length > 0) {
      baseUrl.searchParams.set('category', categoryStr);
    }
    if (searchQueryValue) {
      baseUrl.searchParams.set('search', searchQueryValue);
    }

    const url = baseUrl.pathname + baseUrl.search;
    navigate(url);
    setSelectedCategories(checkedValues);

    if (checkedValues.length === 0) {
      clearSelection();
    }
  };

  useEffect(() => {
    const selection = subCategorys.map(item => item.contract)
    setSelectedSubCategories(selection)
    setSubCategories(subCategorys);
  }, [subCategorys]);

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


  useEffect(() => {
    if (hasChecked && !isAuthenticated) {
      marketplaceActions.fetchMarketplace(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        arrayToStr(selectedSubCategories),
        minPriceQuery,
        maxPriceQuery,
        searchQueryValue
      );
    } else if (hasChecked && isAuthenticated) {
      marketplaceActions.fetchMarketplaceLoggedIn(
        marketplaceDispatch,
        arrayToStr(selectedCategories),
        arrayToStr(selectedSubCategories),
        minPriceQuery,
        maxPriceQuery,
        searchQueryValue
      );
    }
  }, [
    // selectedCategories,
    selectedSubCategories,
    minPriceQuery,
    maxPriceQuery,
    hasChecked,
    isAuthenticated,
    searchQueryValue
  ]);

  // useEffect(() => {
  //   if (marketplaceList?.length > 0) {
  //     const uniqueNames = marketplaceList.map((p) => p.name)
  //       .filter(
  //         (name, index, arr) => arr.indexOf(name) == index
  //       );
  //     setUniqueProductNames(uniqueNames);
  //   }
  // }, [marketplaceList]);

  useEffect(() => {
    const timeOut = setTimeout(() => {
      const baseUrl = new URL('/category', window.location.origin);

      if (categoryQueryValue) {
        baseUrl.searchParams.set('category', categoryQueryValue);
      }
      baseUrl.searchParams.set('search', search);
      baseUrl.searchParams.set('minPrice', minPrice);
      baseUrl.searchParams.set('maxPrice', maxPrice);

      const url = baseUrl.pathname + baseUrl.search;
      navigate(url, { replace: true });
    }, 1000);

    return () => {
      clearTimeout(timeOut);
    };
  }, [search, minPrice, maxPrice]);

  //=========================Other functions===============================//

  const clearSelection = () => {
    setSelectedSubCategories([]);
    setSubCategories([]);
  };

  const handleClearFilter = () => {
    const isFilter =  selectedCategories.length != 0 || selectedSubCategories.length != 0
      || minPrice !== 0 || maxPrice !== MAX_PRICE
    if (isFilter) {
      const baseUrl = new URL('/category', window.location.origin);
      if (searchQueryValue) {
        baseUrl.searchParams.set('search', searchQueryValue);
      }
      const url = baseUrl.pathname + baseUrl.search;
      navigate(url)
      clearSelection()
      setSelectedCategories([]);
      setMinPrice(0)
      setMaxPrice(MAX_PRICE)

    }
  }

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

  const handleFilterClick = () => {
    setDesktopOpenFilter(!desktopOpenFilter);
    setMobileOpenFilter(!mobileOpenFilter);
  };

  const addItemToCart = (product, quantity) => {
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
      items = [...cartList, { product, qty: quantity }];
      marketplaceActions.addItemToCart(marketplaceDispatch, items);

      openToast("bottom", false, "Item added to cart");
      return true;
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.address) {
          const availableQuantity = product.saleQuantity ? product.saleQuantity : 1;
          if (items[index].qty + 1 <= availableQuantity) {
            items[index].qty += 1;
            marketplaceActions.addItemToCart(marketplaceDispatch, items);

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
    let msgObj = {
      message: msg,
      placement,
      key: 1,
    }
    isError ? api.error(msgObj) : api.success(msgObj)
  };

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    setSearch(value)
  }

  const isLoading = isMarketplaceLoading;

  const BreadCrumbComponent = () =>
    <Breadcrumb className="text-xs ml-4 md:ml-14 mt-14 lg:mt-5">
      <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
        <ClickableCell href={routes.Marketplace.url}>
          <p href={routes.Marketplace.url} className="text-[#13188A] font-semibold hover:bg-transparent text-sm">
            Home
          </p>
        </ClickableCell>
      </Breadcrumb.Item>
      <Breadcrumb.Item href="" onClick={e => setSelectedCategories([])}>
        <ClickableCell href={routes.MarketplaceProductList.url}>
          <p href={routes.MarketplaceProductList.url} className={`${selectedCategories.length > 0 ? "text-[#13188A] font-semibold " : "text-[#202020] font-medium"} text-sm hover:bg-transparent`}>
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

  const ClearFilterComponent = () =>
    <div className="flex justify-between max-[768px]:px-7 max-[768px]:py-4">
      <div className="flex items-center">
        <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
        <Text className="text-xl font-semibold pr-7 ml-1">Filters</Text>
      </div>
      <div className=" rounded-md cursor-pointer p-1 md:p-2" onClick={handleClearFilter}>
        <Text className="text-xl font-semibold ml-1">Clear All <DeleteOutlined /></Text>
      </div>
    </div>

  const MobileCollapseComponent = (children) => {
    return <Collapse
      bordered={false}
      expandIconPosition="end"
      ghost="true"
      reverse={false}
      className="pl-4 pr-4"
    >
      {children}
    </Collapse>
  }

  const DesktopCollapseComponent = (children) => {
    return <Collapse
      bordered={false}
      defaultActiveKey={1}
      expandIconPosition="end"
      ghost="true"
      reverse={false}
      expandIcon={({ isActive }) =>
        isActive ? <img src={Images.Dropdown} alt="img" style={{ width: "24px", height: "24px", transform: "rotate(180deg)" }} /> : <img src={Images.Dropdown} alt="img" style={{ width: "24px", height: "24px" }} />
      }
    >
      {children}
    </Collapse>
  }

  const PriceFilterComponent = () =>
    <Panel header={<Text strong className="text-base">Price ($)</Text>} key="1">
      <Space>
        <InputNumber size="large" min={0} className="w-full" controls={false} prefix='$' value={minPrice} placeholder="min" onChange={(e) => {
          e === null ? setMinPrice(0) : setMinPrice(e)
        }} />
        -
        <InputNumber size="large" controls={false} className="w-full" min={minPrice} prefix='$' value={maxPrice} placeholder="max" onChange={(e) => {
          e === null ? setMaxPrice(MAX_PRICE) : setMaxPrice(e)
        }} />
      </Space>
    </Panel>

  const SubCategoryFilterComponent = () =>
    <Panel header={<Text strong className="text-base">Sub Categories</Text>} key="1">
      <Checkbox.Group
        value={selectedSubCategories}
      >
        <div className="flex flex-col gap-3">
          {subCategories.filter(item => item.name.toLowerCase().includes('carbon')).map((subcategory, index) => (
            <Checkbox value={subcategory.contract} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
              {subcategory.name}
            </Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </Panel>

  const DesktopFilterComponent = () => <div className="mr-6 w-1/3 hidden md:flex md:flex-col">
    {ClearFilterComponent()}
    <div className="bg-white border border-solid border-[#E9E9E9] my-6 mb-24">

      {categorys.length > 0 && (
        <>
          {DesktopCollapseComponent(<Panel header={<Text strong className="text-base">Categories</Text>} key="1">
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
          </Panel>)}

          <Divider className="m-auto w-[94%] min-w-[80%]" />
        </>
      )}

      {selectedCategories.includes("Carbon") && (
        <>
          {DesktopCollapseComponent(
            SubCategoryFilterComponent()
          )}
          <Divider className="m-auto w-[94%] min-w-[80%]" />
        </>
      )}
      <Divider className="m-auto w-[94%] min-w-[80%]" />

      {DesktopCollapseComponent(
        PriceFilterComponent()
      )}

    </div>
  </div>

  const MobileFilterComponent = () => <div>
    <div className="mr-6 fixed w-full h-full z-50 top-16 overflow-scroll md:hidden">
      <div className="bg-white shadow-[2px_-2px_4px_0_rgba(0,0,0,0.05)] mb-24">
        {ClearFilterComponent()}
        <div className="flex items-center justify-between pt-5">
          <Text className="text-base font-semibold pr-7 pl-7 ml-1">Select</Text>
          <Avatar icon={<CloseOutlined />} style={{ color: "#202020" }} className="flex items-center pr-12" onClick={handleFilterClick} />
        </div>
        <Divider className="m-0 mt-3" />

        {/* Panel - Category */}
        {categorys.length > 0 && (
          <>
            {MobileCollapseComponent(
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
            )}
            <Divider className="m-0" />
          </>
        )}
        {/* Panel - Sub Category */}
        <>
          {selectedCategories.includes("Carbon") && MobileCollapseComponent(
            SubCategoryFilterComponent()
          )}
          <Divider className="m-0" />
        </>
        {/* Panel - Price */}
        {MobileCollapseComponent(
          PriceFilterComponent()
        )}

      </div>
    </div>
    <div className="h-full w-full bg-[#00000020] absolute top-0 md:hidden"></div>
  </div>

  return (
    <div className={`${mobileOpenFilter ? 'overflow-y-hidden h-[100vh] w-[100vw] bg-[#00000020] relative mt-0 md:bg-white md:mt-[auto] md:overflow-scroll trending_cards' : ' '}`}>
      <div className="fixed bg-white w-full top-7 z-10 md:static">
        {BreadCrumbComponent()}

        <div className="flex items-center justify-center ml-4 md:ml-14 mr-14 mt-6 lg:mt-8 gap-4">
          <div className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2" onClick={handleFilterClick}>
            <img src={Images.filter} alt="filter" className=" w-5 h-5 md:w-6 md:h-6" />
          </div>

          <div className={`flex-1`}>
            <Input
              size="large"
              onChange={(e) => { handleChangeSearch(e) }}
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
        {desktopOpenFilter && DesktopFilterComponent()}

        {/* Product list section */}
        <div className="mb-12 w-full">
          <div className="hidden md:flex mt-2 items-center">
            <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
            <Text className="text-gray-800 ml-1 text-xl font-semibold">
              {isLoading ? <Spin spinning={isLoading} size="small" /> : marketplaceList?.length} Results
            </Text>
          </div>
          {isLoading ?
            <div className="h-96 w-full flex justify-center items-center">
              <Spin spinning={isLoading} size="large" />
            </div>
            :
            <div>
              {marketplaceList?.length > 0 ? (
                <div className={`mt-[61px] md:mt-7 mb-8 flex w-full md:grid flex-col items-center ${desktopOpenFilter ? "grid-cols-1 gap-4 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 lg:gap-14 " : " sm:grid-cols-1 gap-4 md:grid-cols-2 md:gap-14 lg:grid-cols-3 lg:gap-16 xl:grid-cols-4"}`} id="product-list">
                  {marketplaceList.map((product, index) => {
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
          }
        </div>
      </div>

      {mobileOpenFilter && MobileFilterComponent()}
    </div>
  );
};

export default CategoryProductList;