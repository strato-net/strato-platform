import React, { useState, useEffect } from 'react';

import {
  Breadcrumb,
  Input,
  Button,
  notification,
  Spin,
  Image,
  Typography,
  Pagination,
} from 'antd';
import ProductCard from './ProductCard';
import CreateProductModal from './CreateProductModal';
import { actions } from '../../contexts/product/actions';
import { useProductDispatch, useProductState } from '../../contexts/product';
import useDebounce from '../UseDebounce';
//categories
import { actions as categoryActions } from '../../contexts/category/actions';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
//sub-categories
import { useSubCategoryState } from '../../contexts/subCategory';
import { Images } from '../../images';
import ClickableCell from '../ClickableCell';
import routes from '../../helpers/routes';
import { useAuthenticateState } from '../../contexts/authentication';

const { Search } = Input;
const { Title, Text } = Typography;

const Product = () => {
  const [open, setOpen] = useState(false);
  const dispatch = useProductDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [queryValue, setQueryValue] = useState('');
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [isSearch, setIsSearch] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(10);
  const debouncedSearchTerm = useDebounce(queryValue, 1000);

  //Categories
  const categoryDispatch = useCategoryDispatch();

  //Sub-categories

  const { categorys, iscategorysLoading } = useCategoryState();
  const { subCategorys, issubCategorysLoading } = useSubCategoryState();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  const { products, isProductsLoading, message, success, productsTotal } =
    useProductState();

  useEffect(() => {
    if (isSearch) {
      setOffset(0);
      actions.fetchProduct(dispatch, limit, 0, debouncedSearchTerm);
      setIsSearch(false);
    } else actions.fetchProduct(dispatch, limit, offset, debouncedSearchTerm);
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  useEffect(() => {
    let len = products.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [products]);

  const showModal = () => {
    hasChecked && !isAuthenticated && loginUrl !== undefined
      ? (window.location.href = loginUrl)
      : setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const queryHandle = (e) => {
    setQueryValue(e.target.value);
    setIsSearch(true);
    setPage(1);
  };

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  return (
    <>
      {contextHolder}
      {isProductsLoading || iscategorysLoading || issubCategorysLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isProductsLoading} size="large" />
        </div>
      ) : (
        <div className="mx-16 mt-14 h-screen">
          {products.length === 0 && offset === 0 ? (
            <div className="h-screen justify-center flex flex-col items-center">
              <Image src={Images.noProductSymbol} preview={false} />
              <Title level={3} className="mt-2">
                No product found
              </Title>
              <Text className="text-sm">Start adding your product</Text>
              <Button
                id="add-product-button"
                type="primary"
                className="w-44 h-9 bg-primary !hover:bg-primaryHover mt-6"
                onClick={() => {
                  if (
                    hasChecked &&
                    !isAuthenticated &&
                    loginUrl !== undefined
                  ) {
                    window.location.href = loginUrl;
                  } else {
                    showModal();
                  }
                }}
              >
                Add Product
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <Breadcrumb>
                  <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                    <ClickableCell href={routes.Marketplace.url}>
                      Home
                    </ClickableCell>
                  </Breadcrumb.Item>
                  <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                    <p className="text-primary">Products</p>
                  </Breadcrumb.Item>
                </Breadcrumb>
                <div className="flex">
                  <Search
                    placeholder="Search"
                    className="w-80 mr-6"
                    allowClear
                    onChange={queryHandle}
                    value={queryValue}
                  />
                  <Button
                    id="add-product-button"
                    type="primary"
                    className="w-48"
                    onClick={() => {
                      if (
                        hasChecked &&
                        !isAuthenticated &&
                        loginUrl !== undefined
                      ) {
                        window.location.href = loginUrl;
                      } else {
                        showModal();
                      }
                    }}
                  >
                    Add Product
                  </Button>
                </div>
              </div>
              <>
                {products.length !== 0 ? (
                  <div className="my-4">
                    {products.map((product, index) => {
                      return (
                        <ProductCard
                          product={product}
                          categorys={categorys}
                          subCategorys={subCategorys}
                          key={index}
                          debouncedSearchTerm={debouncedSearchTerm}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="flex justify-center my-10"> No data found</p>
                )}
                <Pagination
                  current={page}
                  onChange={onPageChange}
                  total={productsTotal}
                  showSizeChanger={false}
                  className="flex justify-center my-5 "
                />
                <div className="pb-12"></div>
              </>
            </>
          )}
        </div>
      )}
      {open && (
        <CreateProductModal
          open={open}
          handleCancel={handleCancel}
          categorys={categorys}
          resetPage={onPageChange}
          page={page}
          debouncedSearchTerm={debouncedSearchTerm}
        />
      )}
      {message && openToast('bottom')}
    </>
  );
};

export default Product;
