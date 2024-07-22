import React, { useState, useEffect } from "react";
import { Button, Pagination, Spin, Select, Tabs } from "antd";
import { CheckCircleOutlined } from '@ant-design/icons';
import InventoryCard from "./InventoryCard";
import CreateInventoryModal from "./CreateInventoryModal";
// Actions
import { actions as categoryActions } from "../../contexts/category/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as paymentServiceActions } from "../../contexts/payment/actions";
import { actions as itemActions } from "../../contexts/item/actions";
import { actions as redemptionActions } from "../../contexts/redemption/actions";
import { actions as issuerStatusActions } from "../../contexts/issuerStatus/actions";
// Dispatch & States
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useIssuerStatusState, useIssuerStatusDispatch } from "../../contexts/issuerStatus";
import { usePaymentServiceDispatch, usePaymentServiceState } from "../../contexts/payment";
import { useRedemptionDispatch, useRedemptionState } from "../../contexts/redemption";
import { useItemDispatch, useItemState } from "../../contexts/item";
// Components
import RequestBeAuthorizedIssuerModal from "./RequestBeAuthorizedIssuerModal";
import { showToast } from "../Notification/ToastComponent";
import HelmetComponent from "../Helmet/HelmetComponent";
import BreadcrumbComponent from "../BreadCrumb";
// other
import { useAuthenticateState } from "../../contexts/authentication";
import { ISSUER_STATUS } from '../../helpers/constants';
import { SEO } from "../../helpers/seoConstant";
import useDebounce from "../UseDebounce";
import { Images } from "../../images";

const { Option } = Select;
const limit = 10;

const Inventory = ({ user }) => {
  // Dispatch
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const categoryDispatch = useCategoryDispatch();
  const dispatch = useInventoryDispatch();

  const itemDispatch = useItemDispatch();
  const redemptionDispatch = useRedemptionDispatch();
  const issuerStatusDispatch = useIssuerStatusDispatch();
  // States
  const { inventories, isInventoriesLoading, message, success, inventoriesTotal } = useInventoryState();
  const { paymentServices, notOnboarded, areNotOnboardedLoading } = usePaymentServiceState();
  const { message: issuerStatusMsg, success: issuerStatusSuccess } = useIssuerStatusState();
  const { message: redemptionMsg, success: redemptionSuccess } = useRedemptionState();
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { message: itemMsg, success: itemSuccess } = useItemState();
  const { categorys } = useCategoryState();
  // useStates
  const [open, setOpen] = useState(false);
  const [reqModOpen, setReqModOpen] = useState(false);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedService, setSelectedService] = useState(null);
  const [isSearch, setIsSearch] = useState(false);
  const [category, setCategory] = useState(undefined);
  const linkUrl = window.location.href;

  const [sortedPaymentServices, setSortedPaymentServices] = useState([]);

  const isNotOnboarded = (service) => notOnboarded.some(n => n.serviceName === service.serviceName);

  useEffect(() => {
    // Create a set of not onboarded service names for quick lookup
    const notOnboardedNames = new Set(notOnboarded.map(n => n.serviceName));

    // Sort paymentServices array so that not onboarded services come first
    const sortedServices = [...paymentServices].sort((a, b) => {
      return isNotOnboarded(a) - isNotOnboarded(b);
    }).map(service => ({
      ...service,
      isNotOnboarded: notOnboardedNames.has(service.serviceName),
    }));

    setSortedPaymentServices(sortedServices);
  }, [paymentServices, notOnboarded]);

  
  useEffect(() => {
    if (user && user.commonName) {
      paymentServiceActions.getPaymentServices(paymentServiceDispatch);
      paymentServiceActions.getNotOnboarded(paymentServiceDispatch, user.commonName, 10, 0);
    }
  }, [paymentServiceDispatch, user]);

  useEffect(() => {
    const stripeServiec = notOnboarded.some(service => service.serviceName === 'Stripe');
    if (stripeServiec) {
      setSelectedService(notOnboarded.find(service => service.serviceName === 'Stripe'));
    } else {
      setSelectedService(notOnboarded[0]);
    }
  }, [paymentServices, notOnboarded]);
  
  const [issuerStatus, setIssuerStatus] = useState(user?.issuerStatus);

  useEffect(() => {
    setIssuerStatus(user?.issuerStatus);
  }, [user]);

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    if (isSearch) {
      inventoryActions.fetchInventorySearch(dispatch, limit, offset, debouncedSearchTerm);
    } else inventoryActions.fetchInventory(dispatch, limit, offset, "", category);
  }, [dispatch, limit, offset, debouncedSearchTerm, category]);

  const handleCancel = () => setOpen(false);

  const handleOnboard = async (service) => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      window.location.href = loginUrl;
    } else {
      const serviceURL = service.serviceURL || service.data.serviceURL;
      const onboardingRoute = service.onboardingRoute || service.data.onboardingRoute;
      if (serviceURL && onboardingRoute) {
        const url = `${serviceURL}${onboardingRoute}?username=${user.commonName}&redirectUrl=${window.location.protocol}//${window.location.host}${window.location.pathname}`;
        window.location.replace(url);
      }
    }
  };

  const handleChange = value => {
    const service = notOnboarded.find(service => service.serviceName === value);
    handleOnboard(service);
  };

  const handleReqModCancel = () => setReqModOpen(false);

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

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

  const handleTabSelect = (key) => {
    setCategory(key);
    setOffset(0);
    setPage(1);
    return;
  };

  const metaImg = category ? category : SEO.IMAGE_META;

  return (
    <>
      <HelmetComponent 
        title={`${category ? `${category} |` :''} ${SEO.TITLE_META} `}
        description={SEO.DESCRIPTION_META} 
        link={linkUrl} 
      />
      <>
      <BreadcrumbComponent  />
        <div className="w-full h-[160px] py-4 px-4 md:h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row md:px-14 justify-between items-center mt-6 lg:mt-8">
          <div className="flex justify-between w-full">
            <Button className="!px-1 md:!px-0 flex items-center flex-row-reverse gap-[6px] text-lg md:text-2xl font-semibold !text-[#13188A] " 
              type="link" 
              icon={<img src={Images.ForwardIcon} 
              alt={metaImg} 
              title={metaImg}
              className="hidden md:block w-6 h-6" />}> My Items
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-3 items-center my-2 md:my-0">
            <div className="flex gap-3 items-center">
              {!areNotOnboardedLoading ? (
                <Select
                  className="items-select"
                  style={{ width: 250, height: 40 }}
                  onChange={handleChange}
                  value={'Connect to Payment Provider'}
                  disabled={notOnboarded.length === 0}
                >
                  {sortedPaymentServices.map(service => (
                    <Option 
                      key={service.serviceName} 
                      value={service.serviceName}
                      disabled={!service.isNotOnboarded}
                    >
                      {service.serviceName}
                      {!service.isNotOnboarded && <CheckCircleOutlined style={{ color: '#28a745',position: 'absolute', right: '10px' }} />}
                    </Option>
                  ))}
                </Select>
              ) : (
                <Spin size="large" />
              )}
            </div>
            <div className="flex gap-3 items-center">
              <Button
                type="primary"
                id="createItem"
                className="w-[250px] sm:w-40 flex items-center justify-center gap-[6px]"
                style={{ height: 40 }}
                onClick={() => {
                  if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                    window.location.href = loginUrl;
                  } else {
                    setOpen(true)
                  }
                }}
              >
                <div className="flex items-center justify-center gap-[6px]">
                  <img src={Images.CreateInventory} 
                    alt={metaImg}
                    title={metaImg}
                    className="w-[18px] h-[18px]" 
                  />
                  Create Item
                </div>
              </Button>
            </div>
          </div>
        </div>
        <div className="pt-6 mx-6 md:mx-5 md:px-10 mb-5">
          <Tabs
            defaultActiveKey={category ? category : "All"}
            className="items"
            onChange={(key) => handleTabSelect(key)}
            items={[
              {
                label: "All",
                key: undefined,
                children: (
                  <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start inventoryCard max-w-full">
                    {!isInventoriesLoading ? (
                      inventories.map((inventory, index) => (
                        <InventoryCard
                          id={index}
                          limit={limit}
                          offset={offset}
                          inventory={inventory}
                          category={category}
                          key={index}
                          debouncedSearchTerm={debouncedSearchTerm}
                          allSubcategories={allSubcategories}
                          user={user}
                        />
                      ))
                    ) : (
                      <Spin size="large" />
                    )}
                  </div>
                ),
              },
              ...categorys.map((categoryObject, index) => ({
                label: categoryObject.name,
                key: categoryObject.name,
                children: (
                  <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 inventoryCard max-w-full">
                    {!isInventoriesLoading ? (
                      inventories.map((inventory, index) => (
                        <InventoryCard
                          id={index}
                          inventory={inventory}
                          category={category}
                          key={index}
                          debouncedSearchTerm={debouncedSearchTerm}
                          allSubcategories={allSubcategories}
                        />
                      ))
                    ) : (
                      <Spin size="large" />
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
              className="flex justify-center my-5"
            />
          </div>
        </div>
      </>
      {open && (
        <CreateInventoryModal
          open={open}
          handleCancel={handleCancel}
          categorys={categorys}
          debouncedSearchTerm={debouncedSearchTerm}
          resetPage={onPageChange}
          page={page}
          categoryName={category}
        />
      )}
      {reqModOpen && (
        <RequestBeAuthorizedIssuerModal
          open={reqModOpen}
          handleCancel={handleReqModCancel}
          commonName={user.commonName}
          emailAddr={user.email}
          issuerStatus={issuerStatus}
          setIssuerStatus={setIssuerStatus}
        />
      )}
      {message && showToast({
        message:message,
        onClose: inventoryActions.resetMessage(dispatch),
        success:success,
        placement: 'bottom',
      })}
      {itemMsg &&  showToast({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        success:itemSuccess,
        placement: 'bottom',
      })}
      {redemptionMsg && showToast({
        message: redemptionMsg,
        onClose: redemptionActions.resetMessage(redemptionDispatch),
        success: redemptionSuccess,
        placement: 'bottom',
      })}
      {issuerStatusMsg && showToast({
        message: issuerStatusMsg,
        onClose: issuerStatusActions.resetMessage(issuerStatusDispatch),
        success: issuerStatusSuccess,
        placement: 'bottom',
      })}
    </>
  );
};

export default Inventory;
