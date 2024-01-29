import React, { useState, useEffect } from "react";
import {
  Breadcrumb,
  Input,
  Button,
  Pagination,
  notification,
  Spin,
  Typography,
  Tooltip,
  Tabs
} from "antd";
import InventoryCard from "./InventoryCard";
import CreateInventoryModal from "./CreateInventoryModal";
import CreateBundleModal from "./CreateBundleModal";
//categories
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import useDebounce from "../UseDebounce";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { Images } from "../../images";
//items
import { actions as itemActions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";

const { Search } = Input;

const { Title, Text } = Typography;

const Inventory = ({ user }) => {
  const [open, setOpen] = useState(false);
  const [openBundleModal, setOpenBundleModal] = useState(false);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [isSearch, setIsSearch] = useState(false);
  const [category, setCategory] = useState(undefined);

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  //Categories
  const categoryDispatch = useCategoryDispatch();

  const { categorys } = useCategoryState();
  const { inventories, isInventoriesLoading, message, success, isLoadingStripeStatus, stripeStatus, inventoriesTotal } =
    useInventoryState();

  //items
  const itemDispatch = useItemDispatch();
  const {
    message: itemMsg,
    success: itemSuccess
  } = useItemState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    if (isSearch) {
      actions.fetchInventorySearch(dispatch, limit, offset, debouncedSearchTerm);
    } else actions.fetchInventory(dispatch, limit, offset, "", category);
  }, [dispatch, limit, offset, debouncedSearchTerm, category]);

  useEffect(() => {
    actions.sellerStripeStatus(dispatch, user?.commonName);
  }, [dispatch, user]);

  useEffect(() => {
    const placement = 'bottom'; // Set placement to 'bottomCenter'

    if (stripeStatus !== null && stripeStatus !== undefined) {
      const { chargesEnabled, detailsSubmitted, payoutsEnabled } = stripeStatus;

      const isOnboardedSuccess = (chargesEnabled && detailsSubmitted && payoutsEnabled)
      const isOnboardNotStarted = (!chargesEnabled && !detailsSubmitted && !payoutsEnabled)

      if (!(isOnboardedSuccess || isOnboardNotStarted)) {

        setTimeout(() => {

          api.error({
            key: 1,
            message: "Something went wrong with your Stripe account.",
            description: "Please connect again.",
            onClose: () => actions.resetMessage(dispatch),
            placement,
          });
        }, 1000);
      }
    }
  }, [stripeStatus]);

  const showModal = () => {
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const showBundleModal = () => {
    setOpenBundleModal(true);
  };

  const handleCancelBundleModal = () => {
    setOpenBundleModal(false);
  };


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

  const queryHandle = (e) => {
    if (e.length === 0 || e === "") {
      setIsSearch(false)
    } else {
      setIsSearch(true)
    }
    setQueryValue(e);
    setOffset(0);
    setPage(1);
  };

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  const itemToast = (placement) => {
    if (itemSuccess) {
      api.success({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        placement,
        key: 3,
      });
    } else {
      api.error({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        placement,
        key: 4,
      });
    }
  };

  const navigate = useNavigate();

  const onboardSeller = async () => {
    navigate(routes.OnboardingSellerToStripe.url)
  }

  const getAllSubcategories = (categories) => {
    let subcategories = [];
    categories.forEach(category => {
      if (category.subCategories && category.subCategories.length > 0) {
        subcategories = subcategories.concat(category.subCategories);
      }
    });
    return subcategories;
  }

  const allSubcategories = getAllSubcategories(categorys);

  // ------------------ Tabs Start------------------
  const handleTabSelect = (key) => {
    setCategory(key);
    setOffset(0);
    setPage(1);
    return;
  };
  // ------------------ Tabs END------------------

  return (
    <>
      {contextHolder}
      {stripeStatus == null || isLoadingStripeStatus ? (
        <div className="h-screen flex justify-center items-center">
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-[#13188A] font-semibold">
                  Home
                </p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <p className="text-sm text-[#202020] font-medium">
                My Store
              </p>
            </Breadcrumb.Item>
          </Breadcrumb>
          <div className="w-full h-[116px] py-4 px-4 md:h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row md:px-14  justify-between items-center mt-6 lg:mt-8">
            <div className="flex justify-between w-full">
              <Button className="!px-1 md:!px-0 flex items-center flex-row-reverse gap-[6px] text-lg md:text-2xl font-semibold !text-[#13188A] " type="link" icon={<img src={Images.ForwardIcon} alt="inventory" className="hidden md:block w-6 h-6" />}> Inventory
              </Button>
            </div>
            <div className="flex gap-3">
              <Button type="primary" className="w-40 h-9 "
                onClick={() => {
                  if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                    window.location.href = loginUrl;
                  } else {
                    onboardSeller()
                  }
                }}
                disabled={stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled}
              >
                {"Connect Stripe"}
              </Button>
              <Button
                type="primary"
                className="w-40 h-9 flex items-center justify-center gap-[6px]"
                onClick={() => {
                  if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                    window.location.href = loginUrl;
                  } else {
                    showBundleModal()
                  }
                }}
                disabled={!stripeStatus.chargesEnabled || !stripeStatus.detailsSubmitted || !stripeStatus.payoutsEnabled}
              >
                <div className="flex items-center justify-center gap-[6px]">
                  <img src={Images.CreateInventory} alt="Inventory" className="w-[18px] h-[18px]" />
                  Create Bundle
                </div>
              </Button>
              <Tooltip
                title={
                  stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled
                    ? ""
                    : "Please connect to Stripe first"
                }
                placement="bottom"
              >
                <Button
                  type="primary"
                  className="w-40 h-9 flex items-center justify-center gap-[6px]"
                  onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      showModal()
                    }
                  }}
                  disabled={!stripeStatus.chargesEnabled || !stripeStatus.detailsSubmitted || !stripeStatus.payoutsEnabled}
                >
                  <div className="flex items-center justify-center gap-[6px]">
                    <img src={Images.CreateInventory} alt="Inventory" className="w-[18px] h-[18px]" />
                    Create Inventory
                  </div>
                </Button>
              </Tooltip>
            </div>
          </div>
          <div className="pt-6 mx-6 md:mx-5 md:px-10 mb-5 ">
            <Tabs
              defaultActiveKey={category ? category : "All"}
              className="store"
              onChange={(key) => handleTabSelect(key)}
              items={[
                {
                  label: "All",
                  key: undefined,
                  children: (
                    <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 sm:place-items-center md:place-items-start  inventoryCard max-w-full">
                      {!isInventoriesLoading ? (
                        inventories.map((inventory, index) => {
                          return (
                            <InventoryCard
                              id={index}
                              inventory={inventory}
                              category={category}
                              key={index}
                              debouncedSearchTerm={debouncedSearchTerm}
                              paymentProviderAddress={
                                stripeStatus ? stripeStatus.paymentProviderAddress : undefined
                              }
                              allSubcategories={allSubcategories}
                            />
                          );
                        })
                      ) : (
                        <div className="absolute left-[50%] md:top-4">
                          <Spin size="large" />
                        </div>
                      )}
                    </div>
                  ),
                },
                ...categorys.map((categoryObject, index) => ({
                  label: categoryObject.name,
                  key: categoryObject.name,
                  children: (
                    <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 inventoryCard max-w-full">
                      {!isInventoriesLoading ? (
                        inventories.map((inventory, index) => {
                          return (
                            <InventoryCard
                              id={index}
                              inventory={inventory}
                              category={category}
                              key={index}
                              debouncedSearchTerm={debouncedSearchTerm}
                              paymentProviderAddress={
                                stripeStatus ? stripeStatus.paymentProviderAddress : undefined
                              }
                              allSubcategories={allSubcategories}
                            />
                          );
                        })
                      ) : (
                        <div className="absolute left-[50%] md:top-4">
                          <Spin size="large" />
                        </div>
                      )}
                    </div>
                  ),
                })),
              ]}
            />

            <div className="flex justify-center pt-6">
              <Pagination
                current={page}
                onChange={onPageChange}
                total={inventoriesTotal}
                showSizeChanger={false}
                className="flex justify-center my-5 "
              />
            </div>
          </div>
        </>
      )}
      {
        open && (
          <CreateInventoryModal
            open={open}
            handleCancel={handleCancel}
            categorys={categorys}
            debouncedSearchTerm={debouncedSearchTerm}
            resetPage={onPageChange}
            page={page}
            categoryName={category}
          />
        )
      }
      {
        openBundleModal && (
          <CreateBundleModal
            open={openBundleModal}
            handleCancel={handleCancelBundleModal}
          />
        )
      }
      {message && openToast("bottom")}
      {itemMsg && itemToast("bottom")}
    </>
  );
};

export default Inventory;