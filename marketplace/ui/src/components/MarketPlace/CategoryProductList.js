import { useEffect, useState, useRef } from "react";
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
// import CategoryProductCard from "./CategoryProductCard";
import { useMatch } from "react-router-dom";
import { CloseOutlined } from "@ant-design/icons";
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
// import useDebounce from "../UseDebounce";
import { MAX_PRICE } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import NewTrendingCard from "./NewTrendingCard";
// import { FilterIcon } from "../../images/SVGComponents";
import { Images } from "../../images";
import './index.css'

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {
  const [api] = notification.useNotification();
  // States
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
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  // useRef() to keep track of the previous value of the debounced search term
  const previousDebouncedSearchRef = useRef();
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
  let currentCategory;

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const routeMatch = useMatch({
    path: routes.MarketplaceProductList.url,
    strict: true,
  });

  const categoryRouteMatch = useMatch({
    path: routes.MarketplaceCategoryProductList.url,
    strict: true,
  });

  const onChangeCategory = (checkedValues) => {
    setSelectedCategories(checkedValues);
    currentCategory = categorys.find((c) => c.name === checkedValues);
    if (checkedValues.length === 0) clearSelection();
  };

  useEffect(() => {
    let param = routeMatch ? routeMatch?.pathname : categoryRouteMatch.params?.category;
    let newCategory = [];
    if (param !== "/category") newCategory.push(param);
    setCategory(param);
    setSelectedCategories(newCategory);
  }, []);

  currentCategory = categorys.find((c) => c.name === category);
  currentCategory ?? (currentCategory = " ");

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

  useEffect(() => {
    let subCategoriesOfSelectedCategories = subCategorys.map(sub => sub.contract).join(',');

    const callAPI = () => {
      if (hasChecked && !isAuthenticated) {
        marketplaceActions.fetchMarketplace(
          marketplaceDispatch,
          arrayToStr(selectedCategories),
          selectedCategories.length > 0 && selectedSubCategories.length === 0 ? subCategoriesOfSelectedCategories : arrayToStr(selectedSubCategories),
          arrayToStr(selectedProducts),
          arrayToStr(selectedBrands),
          minPrice,
          maxPrice,
          debouncedSearch
        );
      } else {
        marketplaceActions.fetchMarketplaceLoggedIn(
          marketplaceDispatch,
          arrayToStr(selectedCategories),
          selectedCategories.length > 0 && selectedSubCategories.length === 0 ? subCategoriesOfSelectedCategories : arrayToStr(selectedSubCategories),
          arrayToStr(selectedProducts),
          arrayToStr(selectedBrands),
          minPrice,
          maxPrice,
          debouncedSearch
        );
      }
    };

    // Check if the current search term has changed from the previous search term and if it is not an empty string
    if (debouncedSearch !== previousDebouncedSearchRef.current && debouncedSearch !== "") {
      const debounceTimer = setTimeout(() => {
        callAPI();
      }, 1000);

      return () => {
        // set previousDebouncedSearchRef to store the debounced search current term
        previousDebouncedSearchRef.current = debouncedSearch;
        clearTimeout(debounceTimer);
      };
    } else {
      callAPI();
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
    debouncedSearch
  ]);

  useEffect(() => {
    setDebouncedSearch(search);
  }, [search]);

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

  const handleSearch = (e) => {
    setSearch(e.target.value)
  }

  const isLoading = isMarketplaceLoading;

  const BreadCrumbCompnent = () =>
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

  const DesktopFilterComponent = () => <div className="mr-6 w-1/3 hidden md:flex md:flex-col">
    <div className="flex items-center">
      <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
      <Text className="text-xl font-semibold pr-7 ml-1">Filters</Text>
    </div>
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

      {subCategories.length > 0 && (
        <>
          {DesktopCollapseComponent(
            <Panel header={<Text strong className="text-base">Sub Categories</Text>} key="1">
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
          )}
          <Divider className="m-auto w-[94%] min-w-[80%]" />
        </>
      )}
      <Divider className="m-auto w-[94%] min-w-[80%]" />

      {DesktopCollapseComponent(
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
      )}
      <Divider className="m-auto w-[94%] min-w-[80%]" />

      {marketplaceList?.length > 0 && (
        <>
          {DesktopCollapseComponent(
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
          )}
          <Divider className="m-auto w-[94%] min-w-[80%]" />
        </>
      )}
      <div className="pb-2"></div>
    </div>
  </div>

  const MobileFilterComponent = () => <div>
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
            {MobileCollapseComponent(
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
            )}
            <Divider className="m-0" />
          </>
        )}
        {/* Panel - Sub Category */}
        {currentCategory && (
          <>
            {MobileCollapseComponent(
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
            )}
            <Divider className="m-0" />
          </>
        )}
        {/* Panel - Price */}
        {MobileCollapseComponent(
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
        )}
        <Divider className="m-0" />

        {/* Panel - Product */}
        {marketplaceList?.length > 0 && (
          <>
            {MobileCollapseComponent(
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
            )}
            <Divider className="m-0" />
          </>
        )}
        <div className="pb-8"></div>
      </div>
    </div>
    <div className="h-full w-full bg-[#00000020] absolute top-0 md:hidden"></div>
  </div>

  return (
    <div className={`${mobileOpenFilter ? 'overflow-y-hidden h-[100vh] w-[100vw] bg-[#00000020] relative mt-0 md:bg-white md:mt-[auto] md:overflow-scroll trending_cards' : ' '}`}>
      <div className="fixed bg-white w-full top-7 z-10 md:static">
        {BreadCrumbCompnent()}

        <div className="flex items-center justify-center ml-4 md:ml-14 mr-14 mt-6 lg:mt-8 gap-4">
          <div className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2" onClick={handleFilterClick}>
            <img src={Images.filter} alt="filter" className=" w-5 h-5 md:w-6 md:h-6" />
          </div>

          <div className={`flex-1 `}>
            <Input
              size="large"
              onChange={(e) => { handleSearch(e) }}
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
        {isLoading ? (
          <div className="h-96 w-full flex justify-center items-center">
            <Spin spinning={isLoading} size="large" />
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

      {mobileOpenFilter && MobileFilterComponent()}
    </div >
  );
};

export default CategoryProductList;