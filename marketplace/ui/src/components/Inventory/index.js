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
  Tooltip,
  Tabs
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
import { useItemDispatch, useItemState } from "../../contexts/item";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";
import CategoryCard from "../MarketPlace/CategoryCard";

const { Search } = Input;

const { Title, Text } = Typography;

const Inventory = ({ user }) => {
  const [open, setOpen] = useState(false);
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
  
  // ------------------ Tabs Start------------------
  const handleTabSelect = (key) => {
    console.log("key: ", key);
    setCategory(key);
    setOffset(0);
    setPage(1);
    return;
  };
  
  const allCategory = { name: "All" };

  const tabItems = [allCategory, ...categorys].map((category, index) => {
    return {
      label: category.name,
      key: category.name,
      children: (
        <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-full">
          {inventories.map((inventory, index) => {
            let category = categorys.find((c) => c.name === inventory.category);
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
              />
            );
          })}
        </div>
      ),
    };
  });
  // ------------------ Tabs END------------------

  return (
    <>
      {contextHolder}
      {stripeStatus == null || isInventoriesLoading || isLoadingStripeStatus ? (
        <div className="h-screen flex justify-center items-center">
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Breadcrumb className="sm:lg:mx-14">
            <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-[#13188A] font-semibold">
                  Home
                </p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <p className=" text-[#202020] font-medium">
                My Store
              </p>
            </Breadcrumb.Item>
          </Breadcrumb>
          <div className="w-full h-[116px] py-4 px-4 md:h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row md:px-14  justify-between items-center mt-11">
            <div className="flex justify-between w-full">
              <Button className="flex items-center flex-row-reverse gap-[6px] text-2xl font-medium text-[#13188A]" type="link" icon={<img src={Images.ForwardIcon} alt="inventory" className="w-6 h-6" />}> Inventory
              </Button>
              <div className="md:hidden">
                <Button type="link" className="flex items-center gap-2 text-sm font-medium text-[#13188A] flex-row-reverse" icon={<img src={Images.ForwardIcon} alt="view all" className="w-[18px] h-[18px]" />}>view All</Button>

              </div>
            </div>
            <div className="flex">
              <Button type="primary" className="w-40 mr-3"
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
          <div className="pt-6 mx-4 md:mx-5 md:px-14  lg:mx-1 mb-5 ">
            <Tabs defaultActiveKey={category ? category : "All"}
              className="store"
              onChange={(key) => handleTabSelect(key)}
              items={tabItems}
            />
            <div className="md:flex justify-center pt-6  hidden ">
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
          />
        )
      }
      {message && openToast("bottom")}
      {itemMsg && itemToast("bottom")}
    </>
  );
};

export default Inventory;