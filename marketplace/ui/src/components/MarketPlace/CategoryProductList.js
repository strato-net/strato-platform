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
import { actions as orderActions } from "../../contexts/order/actions"
import { useOrderDispatch} from "../../contexts/order";

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

  const [api, contextHolder] = notification.useNotification();
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
  const [unSelected, setUnSelected] = useState([])

  //=========================Categories===============================//
  const categoryDispatch = useCategoryDispatch();
  const subCategoryDispatch = useSubCategoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
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
    baseUrl.searchParams.set('minPrice', minPrice);
    baseUrl.searchParams.set('maxPrice', maxPrice);

    const url = baseUrl.pathname + baseUrl.search;
    navigate(url);
    setSelectedCategories(checkedValues);

    if (checkedValues.length === 0) {
      clearSelection();
    }
  };

  useEffect(() => {
    let selection = subCategorys.map(item => item.contract)
    selection = selection.filter((item) => {
      if (unSelected.includes(item)) { }
      else { return item }
    })
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
    const unSelectedSubCat = subCategorys.filter((item) => {
      if(valuesChecked.includes(item.contract)){}
      else{ return item }
    }).map(item => item.contract)

    // The state variable unSelectedSubCat tracks the deselected subcategories. 
    // Initially, all subcategories are stored as selected, which occurs when a new category is chosen. 
    // In this context, if both "CarbonDAO" and "CarbonOffset" 
    // are found within unSelectedSubCat, the "Carbon" category is also deselected.
    if(unSelectedSubCat.includes("CarbonDAO") && unSelectedSubCat.includes("CarbonOffset")){
      const baseUrl = new URL('/category', window.location.origin);
      const categoryData = selectedCategories.filter(item=>item!=="Carbon")
      const selectedCategory = categoryData.join(',')

      if (selectedCategory) {
        baseUrl.searchParams.set('category', selectedCategory);
      }
      if (search) {
        baseUrl.searchParams.set('search', search);
      }
      baseUrl.searchParams.set('minPrice', minPrice);
      baseUrl.searchParams.set('maxPrice', maxPrice);

      const url = baseUrl.pathname + baseUrl.search;
      setUnSelected([])
      setSelectedCategories(categoryData)
      navigate(url, { replace: true });
    }

    setUnSelected(unSelectedSubCat)
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

  useEffect(() => {
    const timeOut = setTimeout(() => {
      const baseUrl = new URL('/category', window.location.origin);

      if (categoryQueryValue) {
        baseUrl.searchParams.set('category', categoryQueryValue);
      }
      if (search) {
        baseUrl.searchParams.set('search', search);
      }
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
    const isFilter = selectedCategories.length != 0 || selectedSubCategories.length != 0
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

  const addItemToCart = async (product, quantity) => {
    if (product.ownerCommonName === user?.commonName) {
      openToast("bottom", true, "Cannot buy your own item");
      return false;
    }
  
    // Search for the product in the cart
    let foundIndex = cartList.findIndex((item) => item.product.address === product.address);
    let items = [...cartList];
  
    // Found index will be -1 if it's not in the cart list
    if (foundIndex === -1) {
      // Product not found, check quantity before adding
      const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, [product.saleAddress], [quantity]);
      console.log("checkQuantity", checkQuantity)
      if (checkQuantity === true) {
        // Quantity check passed, add new item to the cart
        items.push({ product, qty: quantity });
        marketplaceActions.addItemToCart(marketplaceDispatch, items);
        openToast("bottom", false, "Item added to cart");
        return true;
      } else {
        // Not enough quantity, inform the user
        // Case 1: Item is out of stock
        if (checkQuantity[0].availableQuantity === 0) {
          openToast("bottom", true, `Unfortunately, ${product.name} is currently out of stock. We recommend checking back soon or browsing similar items available now.`);
        } else { // Case 2: We are trying to add too much quantity
          openToast("bottom", true, `Unfortunately, only ${checkQuantity[0].availableQuantity} units of ${product.name} are available. Please update your cart quantity accordingly.`);
        }
        return false;
      }
    } else {
      // Product found, prepare to update quantity after check
      const potentialNewQty = items[foundIndex].qty + quantity; 
      const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, [product.saleAddress], [quantity]);
      if (checkQuantity === true) {
        // Quantity check passed, update item quantity in the cart
        items[foundIndex].qty = potentialNewQty; 
        marketplaceActions.addItemToCart(marketplaceDispatch, items);
        openToast("bottom", false, "Item updated in cart");
        return true;
      } else {
        // Not enough quantity, inform the user
        if (checkQuantity[0].availableQuantity === 0) {
          openToast("bottom", true, `Unfortunately, ${product.name} is currently out of stock. We recommend checking back soon or browsing similar items available now.`);
        } else { // Case 2: We are trying to add too much quantity
          openToast("bottom", true, `Unfortunately, only ${checkQuantity[0].availableQuantity} units of ${product.name} are available. Please update your cart quantity accordingly.`);
        }        
        return false;
      }
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
    <div className="flex justify-between m-2 max-[768px]:px-7 max-[768px]:py-4">
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

  const maxPriceValue = maxPrice == MAX_PRICE ? null : maxPrice;

  const PriceFilterComponent = () =>
    <Panel header={<Text strong className="text-base">Price ($)</Text>} key="1">
      <Space>
        <InputNumber size="large" min={0} className="w-full" controls={false} prefix='$' value={minPrice} placeholder="min" onChange={(e) => {
          e === null ? setMinPrice(0) : setMinPrice(e)
        }} />
        -
        <InputNumber size="large" controls={false} className="w-full" min={minPrice} prefix='$' value={maxPriceValue} placeholder="max" onChange={(e) => {
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
          <div className="hidden md:flex mt-4 items-center">
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

                <div className={`mt-[61px] md:mt-4 mb-8 flex w-full md:grid flex-col items-center ${desktopOpenFilter ? "grid-cols-1 gap-4 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5 lg:gap-14 xl:gap-x-10 2xl:gap-x-20" : " sm:grid-cols-1 gap-4 md:grid-cols-2 md:gap-14 lg:grid-cols-3 lg:gap-16 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 5xl:grid-cols-7"}`} id="product-list">
                  {marketplaceList
                    // .filter(product => product.saleQuantity > 0)
                    .map((product, index) => {
                      return (
                        <NewTrendingCard
                          topSellingProduct={product}
                          key={index}
                          addItemToCart={addItemToCart}
                          parent={"Marketplace"}
                          api={api}
                          contextHolder={contextHolder}
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
