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
//events
import { actions as eventActions } from "../../contexts/event/actions";
import { useEventDispatch, useEventState } from "../../contexts/event";
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
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(10);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  //Categories
  const categoryDispatch = useCategoryDispatch();
  
  const { categorys, iscategorysLoading } = useCategoryState();
  const { inventories, isInventoriesLoading, message, success, isLoadingStripeStatus, stripeStatus } =
  useInventoryState();

  //events
  const eventsDispatch = useEventDispatch();
  const {
    message: eventMsg,
    success: eventSuccess
  } = useEventState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    actions.fetchInventory(dispatch, limit, offset, debouncedSearchTerm);
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  useEffect(() => {
       actions.sellerStripeStatus(dispatch, user?.organization);
  }, [dispatch, user]);

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

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  const eventToast = (placement) => {
    if (eventSuccess) {
      api.success({
        message: eventMsg,
        onClose: eventActions.resetMessage(eventsDispatch),
        placement,
        key: 3,
      });
    } else {
      api.error({
        message: eventMsg,
        onClose: eventActions.resetMessage(eventsDispatch),
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
          {inventories.length === 0 && offset === 0 ? (
            <div className="h-screen justify-center flex flex-col items-center">
              <Image src={Images.noProductSymbol} preview={false} />
              <Title level={3} className="mt-2">
                No inventory found
              </Title>
              <Text className="text-sm">Start adding your inventory</Text>
              <div className="flex items-center">
                <Button
                  type="primary"
                  className="w-44 h-9 bg-primary !hover:bg-primaryHover mt-6 mr-3"
                  onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      onboardSeller()
                    }
                  }}
                  disabled={stripeStatus.detailsSubmitted}
                  >
                  {"Connect Stripe"}
                </Button>
                <Button
                  id="add-inventory-button"
                  type="primary"
                  className="w-44 h-9 bg-primary !hover:bg-primaryHover mt-6 ml-3"
                  onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      showModal()
                    }
                  }}
                >
                  Add Inventory
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <Breadcrumb>
                  <Breadcrumb.Item href="javascript:;">
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
                  <Search placeholder="Search" className="w-80 mr-3" />
                  <Button type="primary" className="w-48 mr-3" disabled={stripeStatus.detailsSubmitted}
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        window.location.href = loginUrl;
                      } else {
                        onboardSeller()
                      }
                    }}
                  >
                    {"Connect Stripe"}
                  </Button>
                  <Button id="add-inventory-button" type="primary" className="w-48"
                    onClick={() => {
                      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                        window.location.href = loginUrl;
                      } else {
                        showModal()
                      }
                    }}
                  >
                    Add Inventory
                  </Button>
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
                  total={total}
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
      {eventMsg && eventToast("bottom")}
    </>
  );
};

export default Inventory;
