import React, { useState, useEffect } from "react";
import {
  Breadcrumb,
  Input,
  Button,
  Pagination,
  notification,
  Spin,
  Typography,
  Image,
  Tooltip
} from "antd";
import InventoryCard from "./InventoryCard";
import CreateInventoryModal from "./CreateInventoryModal";
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
import { useItemDispatch, useItemState} from "../../contexts/item";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";

const { Search } = Input;

const { Title, Text } = Typography;

const Inventory = ({ user }) => {
  const [open, setOpen] = useState(false);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(10);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [isSearch, setIsSearch] = useState(false);

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
    } else actions.fetchInventory(dispatch, limit, offset, "");
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  useEffect(() => {
    actions.sellerStripeStatus(dispatch, user?.organization);
  }, [dispatch, user]);
  
  useEffect(() => {
    const placement = 'bottom'; // Set placement to 'bottomCenter'
  
    if (stripeStatus !== null && stripeStatus !== undefined) {
      const { chargesEnabled, detailsSubmitted, payoutsEnabled } = stripeStatus;
      
      const isOnboardedSuccess = ( chargesEnabled && detailsSubmitted && payoutsEnabled ) 
      const isOnboardNotStarted = ( !chargesEnabled && !detailsSubmitted && !payoutsEnabled )
  
      if (!( isOnboardedSuccess || isOnboardNotStarted ) ) {
        
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

  useEffect(() => {
    let len = inventories.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [inventories]);

  const showModal = () => {
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
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

  return (
    <>
      {contextHolder}
      {stripeStatus == null || isInventoriesLoading || isLoadingStripeStatus ? (
        <div className="h-screen flex justify-center items-center">
          <Spin size="large" />
        </div>
      ) : (
        <div className="mx-16 mt-14">
          {!isSearch && inventories.length === 0 && offset === 0 ? (
            <div className="h-screen justify-center flex flex-col items-center">
              <Image src={Images.noProductSymbol} preview={false} />
              <Title level={3} className="mt-2">
                No inventory found
              </Title>
              <div className="flex items-center">
                <Button
                  type="primary"
                  className="w-48 bg-primary !hover:bg-primaryHover mr-3"
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
                <Tooltip
                  title={
                    stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled
                      ? ""
                      : "Please connect to Stripe first"
                  }
                  placement="bottom"
                  >
                  <div>
                    <Button
                      id="add-inventory-button"
                      type="primary"
                      className="w-48 bg-primary !hover:bg-primaryHover"
                      onClick={() => {
                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                          window.location.href = loginUrl;
                        } else {
                          showModal()
                        }
                      }}
                      disabled={!stripeStatus.chargesEnabled || !stripeStatus.detailsSubmitted || !stripeStatus.payoutsEnabled}
                    >
                      Add Item
                    </Button>
                  </div>
                </Tooltip>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <Breadcrumb>
                  <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                    <ClickableCell href={routes.Marketplace.url}>
                      Home
                    </ClickableCell>
                  </Breadcrumb.Item>
                  <Breadcrumb.Item>
                    <p className=" text-primary">
                      Inventory
                    </p>
                  </Breadcrumb.Item>
                </Breadcrumb>
                <div className="flex">
                  <Search
                    placeholder="Search"
                    className="w-80 mr-6"
                    allowClear
                    onSearch={queryHandle}
                  />
                  <Button type="primary" className="w-48 mr-3"
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
                  <Tooltip
                    title={
                      stripeStatus.chargesEnabled && stripeStatus.detailsSubmitted && stripeStatus.payoutsEnabled
                        ? ""
                        : "Please connect to Stripe first"
                    }
                    placement="bottom"
                  >
                    <div>
                      <Button id="add-inventory-button" type="primary" className="w-48"
                        onClick={() => {
                          if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                            window.location.href = loginUrl;
                          } else {
                            showModal()
                          }
                        }}
                        disabled={!stripeStatus.chargesEnabled || !stripeStatus.detailsSubmitted || !stripeStatus.payoutsEnabled}
                      >
                        Add Item
                      </Button>
                    </div>
                  </Tooltip>
                </div>
              </div>
              <>
                {inventories.length !== 0 ? (
                  <div className="my-4" id="inventory-list">
                    {inventories.map((inventory, index) => {
                      let category = categorys.find(
                        (c) => c.name === inventory.category
                      );
                      return (
                        <InventoryCard
                          id={index}
                          inventory={inventory}
                          category={category}
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
                  total={inventoriesTotal}
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
        <CreateInventoryModal
          open={open}
          handleCancel={handleCancel}
          categorys={categorys}
          debouncedSearchTerm={debouncedSearchTerm}
          resetPage={onPageChange}
          page={page}
        />
      )}
      {message && openToast("bottom")}
      {itemMsg && itemToast("bottom")}
    </>
  );
};

export default Inventory;
