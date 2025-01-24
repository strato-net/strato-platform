import { useEffect, useState } from 'react';
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
  Pagination,
  notification,
} from 'antd';
import { debounce } from 'lodash';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CloseOutlined, DeleteOutlined } from '@ant-design/icons';
// Actions
import { actions as categoryActions } from '../../contexts/category/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
// Dispatch and states
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useAuthenticateState } from '../../contexts/authentication';
import { useEthDispatch } from '../../contexts/eth';
// other
import { MAX_PRICE, availabilityOptions } from '../../helpers/constants';
import { TOAST_MSG } from '../../helpers/msgConstants';
import HelmetComponent from '../Helmet/HelmetComponent';
import NewTrendingCard from './NewTrendingCard';
import { SEO } from '../../helpers/seoConstant';
import ClickableCell from '../ClickableCell';
import routes from '../../helpers/routes';
import { Images } from '../../images';
import './index.css';

const { Panel } = Collapse;
const { Text } = Typography;

const CategoryProductList = ({ user }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const { state } = location;
  const { category } = useParams();
  const categoryParam = category === 'All' ? '' : category;
  const queryParams = new URLSearchParams(location.search);

  const searchQueryValue = queryParams.get('s') || '';
  const subCategoryQueryValue = queryParams.get('sc') || '';
  const selectedSubCat = subCategoryQueryValue.split(',') || [];
  const [api, contextHolder] = notification.useNotification();
  // States
  const [selectedSubCategories, setSelectedSubCategories] =
    useState(selectedSubCat);
  const [selectedAvailability, setSelectedAvailability] = useState([
    'forSale'
  ]);
  const [desktopOpenFilter, setDesktopOpenFilter] = useState(true);
  const [mobileOpenFilter, setMobileOpenFilter] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [subCategories, setSubCategories] = useState([]);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [minPrice, setMinPrice] = useState(0);
  const [offset, setOffset] = useState(1);
  const [limit, setLimit] = useState(10);

  // Dispatch
  const categoryDispatch = useCategoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const ethDispatch = useEthDispatch();
  // states
  const { marketplaceList, marketplaceListCount, isMarketplaceLoading } =
    useMarketplaceState();
  const { hasChecked, isAuthenticated } = useAuthenticateState();
  const { categorys } = useCategoryState();
  const { cartList } = useMarketplaceState();
  const isLoading = isMarketplaceLoading;

  useEffect(() => {
    ethActions.fetchETHSTAddress(ethDispatch);
  });

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
    const selectedSubCat = subCategoryQueryValue.split(',');
    setSelectedSubCategories(selectedSubCat);
  }, [categoryParam]);

  useEffect(() => {
    if (categorys.length > 0 && categoryParam !== 'All') {
      let subCat = categorys.find(
        (item) => item.name === categoryParam
      )?.subCategories;
      setSubCategories(subCat);
    } else {
      setSubCategories([]);
    }
  }, [categorys, categoryParam, subCategoryQueryValue]);

  const onChangeSubCategory = (e) => {
    let valuesChecked = checkValues(e, selectedSubCategories);
    const unSelectedSubCat = categorys
      .find((item) => item.name === categoryParam)
      .subCategories.filter((item) => {
        if (valuesChecked.includes(item.contract)) {
        } else {
          return item;
        }
      })
      .map((item) => item.contract);

    // The state variable unSelectedSubCat tracks the deselected subcategories.
    // Initially, all subcategories are stored as selected, which occurs when a new category is chosen.
    // In this context, if both "CarbonDAO" and "CarbonOffset"
    // are found within unSelectedSubCat, the "Carbon" category is also deselected.
    if (
      (categoryParam === 'Carbon' &&
        unSelectedSubCat.includes('CarbonDAO') &&
        unSelectedSubCat.includes('CarbonOffset')) ||
      (categoryParam === 'Tokens' &&
        unSelectedSubCat.length === subCategories.length)
    ) {
      let baseUrl = new URL(`/c/All`, window.location.origin);

      const url = baseUrl.pathname + baseUrl.search;
      navigate(url, { replace: true });
    } else {
      let baseUrl = new URL(`/c/${category}`, window.location.origin);
      const subCategories = valuesChecked.join(',');
      if (categoryParam && valuesChecked.length > 0) {
        baseUrl.searchParams.set('sc', subCategories);
      }
      if (valuesChecked.length === 0) {
        setSubCategories([]);
      }
      if (searchQueryValue) {
        baseUrl.searchParams.set('s', searchQueryValue);
      }
      const url = baseUrl.pathname + baseUrl.search;
      navigate(url, { replace: true });
    }

    setSelectedSubCategories(valuesChecked);
  };

  const availabilityFilter = `&forSale=${selectedAvailability.includes(
    'forSale'
  )}&soldOut=${selectedAvailability.includes('soldOut')}`;
  useEffect(() => {
    if (hasChecked && !isAuthenticated) {
      marketplaceActions.fetchMarketplace(
        marketplaceDispatch,
        categoryParam,
        subCategoryQueryValue,
        minPrice,
        maxPrice,
        searchQueryValue,
        availabilityFilter,
        offset,
        limit
      );
    } else if (hasChecked && isAuthenticated) {
      marketplaceActions.fetchMarketplaceLoggedIn(
        marketplaceDispatch,
        categoryParam,
        subCategoryQueryValue,
        minPrice,
        maxPrice,
        searchQueryValue,
        availabilityFilter,
        offset,
        limit
      );
    }
  }, [
    categoryParam,
    subCategoryQueryValue,
    minPrice,
    maxPrice,
    hasChecked,
    isAuthenticated,
    searchQueryValue,
    selectedAvailability,
    offset,
    limit,
  ]);

  const generateBaseUrl = () => {
    const baseUrl = new URL(`/c/${category}`, window.location.origin);

    if (subCategoryQueryValue) {
      baseUrl.searchParams.set('sc', subCategoryQueryValue);
    }
    if (searchQueryValue) {
      baseUrl.searchParams.set('s', searchQueryValue);
    }

    const url = baseUrl.pathname + baseUrl.search;
    return url;
  };

  const getSavedScrollPosition = () => {
    return parseInt(sessionStorage.getItem('scrollPosition')) || 0;
  };

  const saveScrollPosition = (position) => {
    sessionStorage.setItem('scrollPosition', position);
  };

  useEffect(() => {
    const handleScroll = () => {
      saveScrollPosition(window.scrollY);
      setScrollPosition(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [scrollPosition]);

  useEffect(() => {
    const url = generateBaseUrl();
    navigate(url, { state: { scroll: getSavedScrollPosition() } });
  }, []);

  useEffect(() => {
    if (!isLoading) {
      window.scrollTo(0, state?.scroll);
    }
  }, [isLoading, state?.scroll]);

  //=========================Other functions===============================//
  const linkUrl = window.location.href;
  const metaTitle =
    categoryParam === 1
      ? `${categoryParam} | ${SEO.TITLE_META} `
      : `${SEO.TITLE_META}`;
  const metaImg =
    categoryParam === 1 ? `${categoryParam}` : `${SEO.IMAGE_META}`;
  const metaCategory = categoryParam === 1 ? `?category=${categoryParam}` : '';
  const metaDescription = SEO.DESCRIPTION_META;

  const handleClearFilter = () => {
    const isFilter =
      minPrice !== 0 ||
      maxPrice !== MAX_PRICE ||
      selectedAvailability.length !== 2;
    if (isFilter) {
      const baseUrl = new URL(`/c/${category}`, window.location.origin);
      if (subCategoryQueryValue) {
        baseUrl.searchParams.set('sc', subCategoryQueryValue);
      }
      const url = baseUrl.pathname + baseUrl.search;
      navigate(url);
      setMinPrice(0);
      setMaxPrice(MAX_PRICE);
      setSelectedAvailability(['forSale', 'soldOut']);
    }
  };

  const checkValues = (e, arr) => {
    let tempValues = [...arr];
    const existingIndex = tempValues.indexOf(e.target.value);
    if (e.target.checked) {
      if (existingIndex === -1) {
        tempValues.push(e.target.value);
      }
    } else {
      tempValues.splice(existingIndex, 1);
    }
    return tempValues;
  };

  const handleFilterClick = () => {
    setDesktopOpenFilter(!desktopOpenFilter);
    setMobileOpenFilter(!mobileOpenFilter);
  };

  const onChangeAvailability = (checkedValues) => {
    setSelectedAvailability(checkedValues);
  };
  // const addItemToCart = async (product, quantity) => {
  //   if (product.ownerCommonName === user?.commonName) {
  //     openToast("bottom", true, TOAST_MSG.CANNOT_BUY_OWN_ITEM);
  //     return false;
  //   }

  //   // Search for the product in the cart
  //   let foundIndex = cartList.findIndex((item) => item.product.address === product.address);
  //   let items = [...cartList];

  //   // Found index will be -1 if it's not in the cart list
  //   if (foundIndex === -1) {
  //     // Product not found, check quantity before adding
  //     const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, [product.saleAddress], [quantity]);
  //     if (checkQuantity === true) {
  //       // Quantity check passed, add new item to the cart
  //       // Adding single object to keep single product in cart
  //       items = [{ product, qty: quantity }];
  //       marketplaceActions.addItemToCart(marketplaceDispatch, items);
  //       openToast("bottom", false, TOAST_MSG.ITEM_ADDED_TO_CART);
  //       return true;
  //     } else {
  //       // Not enough quantity, inform the user
  //       // Case 1: Item is out of stock
  //       if (checkQuantity[0].availableQuantity === 0) {
  //         openToast("bottom", true, TOAST_MSG.OUT_OF_STOCK(product));
  //       } else { // Case 2: We are trying to add too much quantity
  //         openToast("bottom", true, TOAST_MSG.TOO_MUCH_QUANTITY(checkQuantity, product));
  //         setTimeout(() => {
  //           navigate('/checkout')
  //         }, 2000);
  //       }
  //       return false;
  //     }
  //   } else {
  //     // Product found, prepare to update quantity after check
  //     const potentialNewQty = items[foundIndex].qty + quantity;
  //     const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, [product.saleAddress], [potentialNewQty]);
  //     if (checkQuantity === true) {
  //       // Quantity check passed, update item quantity in the cart
  //       items[foundIndex].qty = potentialNewQty;
  //       marketplaceActions.addItemToCart(marketplaceDispatch, items);
  //       openToast("bottom", false, TOAST_MSG.ITEM_UPDATED_IN_CART);
  //       return true;
  //     } else {
  //       // Not enough quantity, inform the user
  //       if (checkQuantity[0].availableQuantity === 0) {
  //         openToast("bottom", true, TOAST_MSG.OUT_OF_STOCK(product));
  //       } else { // Case 2: We are trying to add too much quantity
  //         openToast("bottom", true, TOAST_MSG.TOO_MUCH_QUANTITY(checkQuantity, product));
  //         setTimeout(() => {
  //           navigate('/checkout')
  //         }, 2000);
  //       }
  //       return false;
  //     }
  //   }
  // };

  const addItemToCart = async (product, quantity) => {
    const items = [{ product, qty: quantity }];
    marketplaceActions.addItemToCart(marketplaceDispatch, items);
    navigate('/checkout');
    window.scrollTo(0, 0);
  };

  const openToast = (placement, isError, msg) => {
    let msgObj = {
      message: msg,
      placement,
      key: 1,
    };
    isError ? api.error(msgObj) : api.success(msgObj);
  };

  const BreadCrumbComponent = () => (
    <Breadcrumb className="text-xs ml-4 md:ml-14 mt-14 lg:mt-5">
      <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
        <ClickableCell href={routes.Marketplace.url}>
          <p
            href={routes.Marketplace.url}
            className="text-[#13188A] font-semibold hover:bg-transparent text-sm"
          >
            Home
          </p>
        </ClickableCell>
      </Breadcrumb.Item>
      <Breadcrumb.Item className="text-[#202020] font-medium text-sm">
        Category
      </Breadcrumb.Item>
      {category && (
        <Breadcrumb.Item className="text-[#202020] font-medium text-sm">
          {category}
        </Breadcrumb.Item>
      )}
    </Breadcrumb>
  );

  const ClearFilterComponent = () => (
    <div className="flex justify-between flex-wrap m-2 max-[768px]:px-7 max-[768px]:py-4">
      <div className="flex items-center">
        <div className="w-2 h-2 bg-[#13188A] rounded-md"></div>
        <Text className="text-xl font-semibold pr-7 ml-1">Filters</Text>
      </div>
      <div
        className=" rounded-md cursor-pointer p-1 md:p-2"
        onClick={handleClearFilter}
      >
        <Text className="text-xl font-semibold ml-1">
          Clear All <DeleteOutlined />
        </Text>
      </div>
    </div>
  );

  const MobileCollapseComponent = (children) => {
    return (
      <Collapse
        bordered={false}
        expandIconPosition="end"
        ghost="true"
        reverse={false}
        className="pl-4 pr-4"
      >
        {children}
      </Collapse>
    );
  };

  const DesktopCollapseComponent = (children) => {
    return (
      <Collapse
        bordered={false}
        defaultActiveKey={1}
        expandIconPosition="end"
        ghost="true"
        reverse={false}
        expandIcon={({ isActive }) => (
          <img
            src={Images.Dropdown}
            alt={metaImg}
            title={metaImg}
            style={{
              width: '24px',
              height: '24px',
              transform: `${isActive ? 'rotate(180deg)' : 'rotate(0deg)'}`,
            }}
          />
        )}
      >
        {children}
      </Collapse>
    );
  };

  const debouncedSetMinPrice = debounce((value) => {
    setMinPrice(value || 0);
  }, 500);

  const debouncedSetMaxPrice = debounce((value) => {
    setMaxPrice(value || MAX_PRICE);
  }, 500);

  const maxPriceValue = maxPrice === MAX_PRICE ? null : maxPrice;

  const PriceFilterComponent = () => (
    <Panel
      header={
        <Text strong className="text-base">
          Price ($)
        </Text>
      }
      key="1"
    >
      <Space>
        <InputNumber
          size="large"
          min={0}
          className="w-full"
          controls={false}
          prefix="$"
          value={minPrice}
          placeholder="min"
          onChange={(value) => debouncedSetMinPrice(value)}
        />
        -
        <InputNumber
          size="large"
          controls={false}
          className="w-full"
          min={minPrice}
          prefix="$"
          value={maxPriceValue}
          placeholder="max"
          onChange={(value) => debouncedSetMaxPrice(value)}
        />
      </Space>
    </Panel>
  );

  const AvailabilityFilter = () => (
    <>
      <Panel
        header={
          <Text strong className="text-base">
            Availability
          </Text>
        }
        key="1"
      >
        <Checkbox.Group
          onChange={onChangeAvailability}
          value={selectedAvailability}
        >
          <div className="flex flex-col gap-3">
            {availabilityOptions.map((category, index) => (
              <Checkbox value={category.value} key={index} className="m-0">
                {category.label}
              </Checkbox>
            ))}
          </div>
        </Checkbox.Group>
      </Panel>
      <Divider className="m-auto w-[94%] min-w-[80%]" />
    </>
  );

  const SubCategoryFilterComponent = () => (
    <Panel
      header={
        <Text strong className="text-base">
          Sub Categories
        </Text>
      }
      key="1"
    >
      <Checkbox.Group value={selectedSubCategories}>
        <div className="flex flex-col gap-3">
          {subCategories?.map(({ name, contract }, index) => (
            <Checkbox
              value={contract}
              key={index}
              className="m-0 Sub-Category"
              onChange={onChangeSubCategory}
            >
              {name}
            </Checkbox>
          ))}
        </div>
      </Checkbox.Group>
    </Panel>
  );

  const DesktopFilterComponent = () => (
    <div className="mr-6 w-1/3 hidden md:flex md:flex-col">
      {ClearFilterComponent()}
      <div className="bg-white border border-solid border-[#E9E9E9] my-6 mb-24">
        {subCategories?.length !== 0 &&
          (category === 'Carbon' || category === 'Tokens') && (
            <>
              {DesktopCollapseComponent(SubCategoryFilterComponent())}
              <Divider className="m-auto w-[94%] min-w-[80%]" />
            </>
          )}
        <Divider className="m-auto w-[94%] min-w-[80%]" />

        {DesktopCollapseComponent(PriceFilterComponent())}

        {DesktopCollapseComponent(AvailabilityFilter())}
      </div>
    </div>
  );

  const MobileFilterComponent = () => (
    <div>
      <div className="mr-6 fixed w-full h-full z-50 top-16 overflow-scroll md:hidden">
        <div className="bg-white shadow-[2px_-2px_4px_0_rgba(0,0,0,0.05)] mb-24">
          {ClearFilterComponent()}
          <div className="flex items-center justify-between pt-5">
            <Text className="text-base font-semibold pr-7 pl-7 ml-1">
              Select
            </Text>
            <Avatar
              icon={<CloseOutlined />}
              style={{ color: '#202020' }}
              className="flex items-center pr-12"
              onClick={handleFilterClick}
            />
          </div>
          <Divider className="m-0 mt-3" />
          <>
            {subCategories?.length > 1 &&
              (category === 'Carbon' || category === 'Tokens') &&
              MobileCollapseComponent(SubCategoryFilterComponent())}
            <Divider className="m-0" />
          </>
          {/* Panel - Price */}
          {MobileCollapseComponent(PriceFilterComponent())}

          {MobileCollapseComponent(AvailabilityFilter())}
        </div>
      </div>
      <div className="h-full w-full bg-[#00000020] absolute top-0 md:hidden"></div>
    </div>
  );

  return (
    <>
      <HelmetComponent
        title={metaTitle}
        description={metaDescription}
        link={linkUrl}
      />
      <div
        className={`${
          mobileOpenFilter
            ? 'overflow-y-hidden h-[100vh] w-[100vw] bg-[#00000020] relative mt-0 md:bg-white md:mt-[auto] md:overflow-scroll trending_cards'
            : ' '
        }`}
      >
        <div className="fixed bg-white w-full top-7 z-10 md:static">
          {BreadCrumbComponent()}
          <div className="flex justify-between items-center ml-4 px-2 mt-2 md:ml-14 md:hidden">
            <div className="flex items-center"></div>
            <div
              className="border border-solid border-[#6A6A6A] rounded-md cursor-pointer p-1 md:p-2"
              onClick={handleFilterClick}
            >
              <img
                src={Images.filter}
                alt={metaImg}
                title={metaImg}
                className=" w-5 h-5 md:w-6 md:h-6"
              />
            </div>
          </div>
        </div>

        <div className="flex pt-4 mx-14 mt-[60px] md:mt-4 ">
          {/* Filter section */}
          {desktopOpenFilter && DesktopFilterComponent()}

          {/* Product list section */}
          <div className="mb-12 w-full">
            {isLoading ? (
              <div className="h-96 w-full flex justify-center items-center">
                <Spin spinning={isLoading} size="large" />
              </div>
            ) : (
              <div>
                {marketplaceListCount > 0 ? (
                  <div
                    className={`mt-[61px] md:mt-4 mb-8 flex w-full gap-4 md:grid flex-col items-center ${
                      desktopOpenFilter
                        ? 'grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 4xl:grid-cols-5 lg:gap-14 xl:gap-x-10 2xl:gap-x-20'
                        : ' sm:grid-cols-1 md:grid-cols-2 md:gap-14 lg:grid-cols-3 lg:gap-16 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 5xl:grid-cols-7'
                    }`}
                    id="product-list"
                  >
                    {marketplaceList.map((product, index) => {
                      return (
                        <NewTrendingCard
                          topSellingProduct={product}
                          key={index}
                          addItemToCart={addItemToCart}
                          parent={'Marketplace'}
                          api={api}
                          contextHolder={contextHolder}
                          scrollPosition={scrollPosition}
                          saveScrollPosition={saveScrollPosition}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className="h-96 flex justify-center items-center"
                    id="product-list"
                  >
                    No data found
                  </div>
                )}
              </div>
            )}
            <Pagination
              onChange={(page, pageSize) =>
                setOffset(page) & setLimit(pageSize)
              }
              total={marketplaceListCount}
              size="default"
              showTotal={(total) => `Total ${total} items`}
            />
          </div>
        </div>
        {mobileOpenFilter && MobileFilterComponent()}
      </div>
    </>
  );
};

export default CategoryProductList;
