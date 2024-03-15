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
  notification,
} from "antd";
import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
// Actions
import { actions as categoryActions } from "../../contexts/category/actions";
// import { actions as subCategoryActions } from "../../contexts/subCategory/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions"
// Dispatch and states
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useSubCategoryDispatch, useSubCategoryState } from "../../contexts/subCategory";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";
import { useOrderDispatch} from "../../contexts/order";
// other
import { arrayToStr } from "../../helpers/utils";
import routes from "../../helpers/routes";
import { useLocation, useNavigate } from "react-router-dom";
import { MAX_PRICE } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import NewTrendingCard from "./NewTrendingCard";
import { Images } from "../../images";
import './index.css'
import { debounce } from 'lodash';
import HelmetComponent from "../Helmet/HelmetComponent";
import { SEO } from "../../helpers/seoConstant";

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {

  const location = useLocation();
  const navigate = useNavigate();

  const { state } = location;

  const queryParams = new URLSearchParams(location.search);

  const searchQueryValue = queryParams.get('s') || '';
  const categoryQueryValue = queryParams.get('c') || '';
  const subCategoryQueryValue = queryParams.get('sc') || '';
  const selectedSubCat = subCategoryQueryValue.split(",") || [];
  const [api, contextHolder] = notification.useNotification();
  // States
  const [selectedCategories, setSelectedCategories] = useState(categoryQueryValue);
  const [selectedSubCategories, setSelectedSubCategories] = useState(selectedSubCat);
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [subCategories, setSubCategories] = useState([]);
  const [desktopOpenFilter, setDesktopOpenFilter] = useState(true);
  const [mobileOpenFilter, setMobileOpenFilter] = useState(false);
  const [search, setSearch] = useState(searchQueryValue);
  const [unSelected, setUnSelected] = useState([]);
  const [scrollPosition, setScrollPosition] = useState(state?.scroll || 0);

  //=========================Categories===============================//
  const categoryDispatch = useCategoryDispatch();
  const subCategoryDispatch = useSubCategoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  // states
  const { marketplaceList, isMarketplaceLoading } = useMarketplaceState();
  const { categorys, iscategorysLoading } = useCategoryState();
  let { hasChecked, isAuthenticated } = useAuthenticateState();
  const { subCategorys } = useSubCategoryState();
  const { cartList } = useMarketplaceState();

  const isLoading = isMarketplaceLoading;

  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };
  
   if(!isLoading && !iscategorysLoading){
     window.addEventListener('scroll', handleScroll);
   }

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if(!isLoading){
      window.scrollTo(0, state?.scroll);
    }
  }, [isLoading]);

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
    const selectedSubCat = subCategoryQueryValue.split(",");
    setSelectedSubCategories(selectedSubCat);
  }, [categoryQueryValue]);


  useEffect(() => {
    if(categorys.length > 0 && categoryQueryValue){
      let subCat = categorys.find(item=>item.name===categoryQueryValue).subCategories
      setSubCategories(subCat)
    }
  }, [categorys,categoryQueryValue]);


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
      let baseUrl = new URL(`/marketplace`, window.location.origin);
      const categoryData = selectedCategories.filter(item => item !== "Carbon")
      const selectedCategory = categoryData.join(',')

      if (searchQueryValue) {
        baseUrl.searchParams.set('s', searchQueryValue);
      }

      const url = baseUrl.pathname + baseUrl.search;
      setUnSelected([])
      setSelectedCategories(categoryData)
      navigate(url);
    }

    let baseUrl = new URL(`/marketplace`, window.location.origin);
    const subCategories = valuesChecked.join(',')
    if (categoryQueryValue && valuesChecked.length > 0) {
      baseUrl.searchParams.set('c', categoryQueryValue);
      baseUrl.searchParams.set('sc', subCategories);
    }
    if(valuesChecked.length == 0){
      setSubCategories([])
    }
    if (searchQueryValue) {
      baseUrl.searchParams.set('s', searchQueryValue);
    }
    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { replace: true });
    
    setUnSelected(unSelectedSubCat)
    setSelectedSubCategories(valuesChecked);
  };


  useEffect(() => {
    if (hasChecked && !isAuthenticated) {
      marketplaceActions.fetchMarketplace(
        marketplaceDispatch,
        categoryQueryValue,
        arrayToStr(selectedSubCategories),
        minPrice,
        maxPrice,
        searchQueryValue
      );
    } else if (hasChecked && isAuthenticated) {
      marketplaceActions.fetchMarketplaceLoggedIn(
        marketplaceDispatch,
        categoryQueryValue,
        arrayToStr(selectedSubCategories),
        minPrice,
        maxPrice,
        searchQueryValue
      );
    }
  }, [
    // selectedCategories,
    selectedSubCategories,
    minPrice,
    maxPrice,
    hasChecked,
    isAuthenticated,
    searchQueryValue
  ]);


  const generateBaseUrl = () =>{
    const baseUrl = new URL('/marketplace', window.location.origin);

    if (categoryQueryValue) {
      baseUrl.searchParams.set('c', categoryQueryValue);
    }
    if(subCategoryQueryValue){
      baseUrl.searchParams.set('sc', subCategoryQueryValue);
    }
    if (searchQueryValue) {
      baseUrl.searchParams.set('s', searchQueryValue);
    }

    const url = baseUrl.pathname + baseUrl.search;
    return url;
  }

  useEffect(()=>{
    const url = generateBaseUrl();
      if(!isLoading){
        navigate(url, { state: { scroll: scrollPosition } });
    }else{
      navigate(url, { state: { scroll: state?.scroll || 0 } });
    }

},[scrollPosition])

  //=========================Other functions===============================//
  const linkUrl = window.location.href;
  const metaTitle = selectedCategories.length === 1 ? `${selectedCategories[0]} | ${SEO.TITLE_META} ` : `${SEO.TITLE_META}`
  const metaImg = selectedCategories.length === 1 ? `${selectedCategories[0]}` : `${SEO.IMAGE_META}`
  const metaCategory = selectedCategories.length === 1 ? `?category=${selectedCategories[0]}` : '' 
  const metaDescription = SEO.DESCRIPTION_META

  const clearSelection = () => {
    setSelectedSubCategories([]);
    setSubCategories([]);
  };

  const handleClearFilter = () => {
    const isFilter = selectedCategories.length != 0 || selectedSubCategories.length != 0
      || minPrice !== 0 || maxPrice !== MAX_PRICE
    if (isFilter) {
      const baseUrl = new URL(`/marketplace`, window.location.origin);
      // if (searchQueryValue) {
      //   baseUrl.searchParams.set('s', searchQueryValue);
      // }
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
        <Breadcrumb.Item className="text-[#202020] font-medium text-sm">
          {categoryQueryValue ? categoryQueryValue : ""}
        </Breadcrumb.Item>
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
        isActive ? 
        <img src={Images.Dropdown} 
        alt={metaImg} 
        title={metaImg} 
        style={{ width: "24px", height: "24px", transform: "rotate(180deg)" }} /> : 
        <img src={Images.Dropdown} 
        alt={metaImg} 
        title={metaImg} 
        style={{ width: "24px", height: "24px" }} />
      }
    >
      {children}
    </Collapse>
  }

  const debouncedSetMinPrice = debounce((value) => {
    setMinPrice(value || 0);
  }, 500);

  const debouncedSetMaxPrice = debounce((value) => {
    setMaxPrice(value || MAX_PRICE);
  }, 500);

  const maxPriceValue = maxPrice == MAX_PRICE ? null : maxPrice;

  const PriceFilterComponent = () =>
    <Panel header={<Text strong className="text-base">Price ($)</Text>} key="1">
      <Space>
        <InputNumber size="large" min={0} className="w-full" controls={false} prefix='$' value={minPrice} placeholder="min" 
         onChange={(value) => debouncedSetMinPrice(value)} />
        -
        <InputNumber size="large" controls={false} className="w-full" min={minPrice} prefix='$' value={maxPriceValue} placeholder="max" 
        onChange={(value) => debouncedSetMaxPrice(value)} />
      </Space>
    </Panel>

  const SubCategoryFilterComponent = () =>
    <Panel header={<Text strong className="text-base">Sub Categories</Text>} key="1">
      <Checkbox.Group
        value={selectedSubCategories}
      >
        <div className="flex flex-col gap-3">
          {subCategories.map(({name,contract}, index) => (
            <Checkbox value={contract} key={index} className="m-0 Sub-Category" onChange={onChangeSubCategory}>
              {name}
            </Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </Panel>

  const DesktopFilterComponent = () => <div className="mr-6 w-1/3 hidden md:flex md:flex-col">
    {ClearFilterComponent()}
    <div className="bg-white border border-solid border-[#E9E9E9] my-6 mb-24">

      {subCategories.length > 1 && (
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

        {/* Panel - Sub Category */}
        <>
          {subCategories.length > 1 && MobileCollapseComponent(
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
    <>
   <HelmetComponent 
          title={metaTitle}
          description={metaDescription} 
          link={linkUrl} />
    <div className={`${mobileOpenFilter ? 'overflow-y-hidden h-[100vh] w-[100vw] bg-[#00000020] relative mt-0 md:bg-white md:mt-[auto] md:overflow-scroll trending_cards' : ' '}`}>
      <div className="fixed bg-white w-full top-7 z-10 md:static">
        {BreadCrumbComponent()}
        <div className="flex justify-between items-center ml-4 px-2 mt-2 md:ml-14 md:hidden">
          <div className="flex items-center">
          <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
          <Text className="text-gray-800 ml-1 text-sm font-normal">
            {marketplaceList?.length} Results
          </Text>
          </div>
          <div className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2" onClick={handleFilterClick}>
            <img src={Images.filter} alt="filter" className=" w-5 h-5 md:w-6 md:h-6" />
          </div>
        </div>
      </div>

      <div className="flex pt-4 mx-14 mt-[60px] md:mt-4 ">
        {/* Filter section */}
        {desktopOpenFilter && DesktopFilterComponent()}

        {/* Product list section */}
        <div className="mb-12 w-full">
          <div className="hidden md:flex mt-4 items-center">
          <div className="border mx-2 border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2" 
            onClick={handleFilterClick}>
            <img src={Images.filter} alt="filter" className=" w-5 h-5 md:w-6 md:h-6" />
          </div>
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
    </>
  );
};

export default CategoryProductList;
