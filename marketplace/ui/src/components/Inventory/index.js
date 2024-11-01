import React, { useState, useEffect } from "react";
import {
  Breadcrumb,
  Button,
  Pagination,
  notification,
  Spin,
  Select,
  Table,
} from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import image_placeholder from "../../images/resources/image_placeholder.png";
import CreateInventoryModal from "./CreateInventoryModal";
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import useDebounce from "../UseDebounce";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from "../../contexts/payment";
import { actions as paymentServiceActions } from "../../contexts/payment/actions";
import { Images } from "../../images";
import { useItemDispatch, useItemState } from "../../contexts/item";
import { actions as itemActions } from "../../contexts/item/actions";
import { actions as redemptionActions } from "../../contexts/redemption/actions";
import { actions as issuerStatusActions } from "../../contexts/issuerStatus/actions";
import {
  useRedemptionDispatch,
  useRedemptionState,
} from "../../contexts/redemption";
import {
  useIssuerStatusState,
  useIssuerStatusDispatch,
} from "../../contexts/issuerStatus";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";
import HelmetComponent from "../Helmet/HelmetComponent";
import { SEO } from "../../helpers/seoConstant";
import RequestBeAuthorizedIssuerModal from "./RequestBeAuthorizedIssuerModal";
import { ISSUER_STATUS, STRATS_CONVERSION } from "../../helpers/constants";
import "./index.css";

const { Option } = Select;

const Inventory = ({ user }) => {
  const [open, setOpen] = useState(false);
  const [reqModOpen, setReqModOpen] = useState(false);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [category, setCategory] = useState(undefined);
  const linkUrl = window.location.href;
  const metaImg = SEO.IMAGE_META;
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  const categoryDispatch = useCategoryDispatch();
  const { categorys } = useCategoryState();
  const {
    inventories,
    isInventoriesLoading,
    message,
    success,
    inventoriesTotal,
    supportedTokens,
    isFetchingTokens,
  } = useInventoryState();
  const {
    paymentServices,
    arePaymentServicesLoading,
    notOnboarded,
    areNotOnboardedLoading,
  } = usePaymentServiceState();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const [sortedPaymentServices, setSortedPaymentServices] = useState([]);

  const isNotOnboarded = (service) =>
    notOnboarded.some((n) => n.serviceName === service.serviceName);

  useEffect(() => {
    // Create a set of not onboarded service names for quick lookup
    const notOnboardedNames = new Set(notOnboarded.map((n) => n.serviceName));

    // Sort paymentServices array so that not onboarded services come first
    const sortedServices = [...paymentServices]
      .sort((a, b) => {
        return isNotOnboarded(a) - isNotOnboarded(b);
      })
      .map((service) => ({
        ...service,
        isNotOnboarded: notOnboardedNames.has(service.serviceName),
      }));

    setSortedPaymentServices(sortedServices);
  }, [paymentServices, notOnboarded]);

  useEffect(() => {
    if (user && user.commonName) {
      paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
      paymentServiceActions.getNotOnboarded(
        paymentServiceDispatch,
        user.commonName,
        10,
        0
      );
    }
  }, [paymentServiceDispatch, user]);

  const itemDispatch = useItemDispatch();
  const { message: itemMsg, success: itemSuccess } = useItemState();
  const redemptionDispatch = useRedemptionDispatch();
  const { message: redemptionMsg, success: redemptionSuccess } =
    useRedemptionState();
  const [issuerStatus, setIssuerStatus] = useState(user?.issuerStatus);

  useEffect(() => {
    setIssuerStatus(user?.issuerStatus);
  }, [user]);

  const issuerStatusDispatch = useIssuerStatusDispatch();
  const { message: issuerStatusMsg, success: issuerStatusSuccess } =
    useIssuerStatusState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    actions.fetchInventory(dispatch, limit, offset, "", category);
    actions.fetchSupportedTokens(dispatch);
  }, [dispatch, limit, offset, category]);

  const showModal = () => {
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleOnboard = async (service) => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      window.location.href = loginUrl;
    } else {
      const serviceURL = service.serviceURL || service.data.serviceURL;
      const onboardingRoute =
        service.onboardingRoute || service.data.onboardingRoute;
      if (serviceURL && onboardingRoute) {
        const url = `${serviceURL}${onboardingRoute}?username=${user.commonName}&redirectUrl=${window.location.protocol}//${window.location.host}${window.location.pathname}`;
        window.location.replace(url);
      }
    }
  };

  const handleChange = (value) => {
    const service = notOnboarded.find(
      (service) => service.serviceName === value
    );
    handleOnboard(service);
  };

  const showReqModModal = () => {
    setReqModOpen(true);
  };

  const handleReqModCancel = () => {
    setReqModOpen(false);
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

  const onPageChange = (page, pageSize) => {
    setLimit(pageSize);
    setOffset((page - 1) * pageSize);
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

  const redemptionToast = (placement) => {
    if (redemptionSuccess) {
      api.success({
        message: redemptionMsg,
        onClose: redemptionActions.resetMessage(redemptionDispatch),
        placement,
        key: 5,
      });
    } else {
      api.error({
        message: redemptionMsg,
        onClose: redemptionActions.resetMessage(redemptionDispatch),
        placement,
        key: 6,
      });
    }
  };

  const issuerStatusToast = (placement) => {
    if (issuerStatusSuccess) {
      api.success({
        message: issuerStatusMsg,
        onClose: issuerStatusActions.resetMessage(issuerStatusDispatch),
        placement,
        key: 7,
      });
    } else {
      api.error({
        message: issuerStatusMsg,
        onClose: issuerStatusActions.resetMessage(issuerStatusDispatch),
        placement,
        key: 8,
      });
    }
  };

  const columns = [
    {
      title: "Item",
      render: (text, record) => {
        const callDetailPage = () => {
          navigate(
            `${naviroute
              .replace(":id", record.address)
              .replace(":name", encodeURIComponent(record.name))}`,
            {
              state: { isCalledFromInventory: true },
            }
          );
        };
        return (
          <div className="flex items-center">
            <div className="mr-2 w-[74px] h-[52px] flex items-center justify-center">
              <img
                src={
                  record["BlockApps-Mercata-Asset-images"] &&
                  record["BlockApps-Mercata-Asset-images"].length > 0
                    ? record["BlockApps-Mercata-Asset-images"][0].value
                    : image_placeholder
                }
                alt={"Asset image..."}
                className="rounded-md w-full h-full object-contain"
              />
            </div>
            <div>
              <span
                className="text-xs sm:text-sm text-[#13188A] hover:underline cursor-pointer"
                onClick={callDetailPage}
              >
                {record.name}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      title: "Category",
      render: (text, record) => {
        const parts = record.contract_name.split("-");
        const contractName = parts[parts.length - 1];
        return <div>{contractName}</div>;
      },
    },
    {
      title: "Quantity Owned",
      align: "center",
      render: (text, record) => <div>{record.quantity || "N/A"}</div>,
    },
    {
      title: "Quantity Available for Sale",
      align: "center",
      render: (text, record) => (
        <div>{record.quantity - record.totalLockedQuantity || "N/A"}</div>
      ),
    },
    {
      title: "Quantity Listed for Sale",
      align: "center",
      render: (text, record) => <div>{record.saleQuantity || "N/A"}</div>,
    },
    {
      title: "Price",
      align: "center",
      render: (text, record) => (
        <div>
          {record.price ? (
            <>
              ${record.price}{" "}
              <span className="text-xs">
                ({(record.price * STRATS_CONVERSION).toFixed(0)} STRATs)
              </span>
            </>
          ) : (
            "N/A"
          )}
        </div>
      ),
    },
    {
      title: "Status",
      dataIndex: "value",
      key: "value",
    },
    {
      title: "Actions",
      dataIndex: "value",
      key: "value",
    },
  ];

  return (
    <>
      <HelmetComponent
        title={`${SEO.TITLE_META} `}
        description={SEO.DESCRIPTION_META}
        link={linkUrl}
      />
      {contextHolder}
      <>
        <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">Home</p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <p className="text-sm text-[#202020] font-medium">My Items</p>
          </Breadcrumb.Item>
        </Breadcrumb>
        <div className="w-full h-[160px] py-4 px-4 md:h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row md:px-14 justify-between items-center mt-6 lg:mt-8">
          <div className="flex justify-between w-full">
            <Button
              className="!px-1 md:!px-0 flex items-center flex-row-reverse gap-[6px] text-lg md:text-2xl font-semibold !text-[#13188A] "
              type="link"
              icon={
                <img
                  src={Images.ForwardIcon}
                  alt={metaImg}
                  title={metaImg}
                  className="hidden md:block w-6 h-6"
                />
              }
            >
              {" "}
              My Items
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-3 items-center my-2 md:my-0">
            <div className="flex gap-3 items-center">
              {!areNotOnboardedLoading ? (
                <Select
                  className="items-select"
                  style={{ width: 250, height: 40 }}
                  onChange={handleChange}
                  value={"Connect to Payment Provider"}
                >
                  {sortedPaymentServices.map((service) => (
                    <Option
                      key={service.serviceName}
                      value={service.serviceName}
                      disabled={!service.isNotOnboarded}
                    >
                      {service.serviceName}
                      {!service.isNotOnboarded && (
                        <CheckCircleOutlined
                          style={{
                            color: "#28a745",
                            position: "absolute",
                            right: "10px",
                          }}
                        />
                      )}
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
                  if (
                    hasChecked &&
                    !isAuthenticated &&
                    loginUrl !== undefined
                  ) {
                    window.location.href = loginUrl;
                  } else if (issuerStatus != ISSUER_STATUS.AUTHORIZED) {
                    showReqModModal();
                  } else {
                    showModal();
                  }
                }}
              >
                <div className="flex items-center justify-center gap-[6px]">
                  <img
                    src={Images.CreateInventory}
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
          <Table
            columns={columns}
            dataSource={inventories}
            loading={isInventoriesLoading}
            className="custom-table"
            pagination={false}
          />
          <Pagination
            current={page}
            onChange={onPageChange}
            total={inventoriesTotal}
            showTotal={(total) => `Total ${total} items`}
            className="flex justify-center my-5 custom-pagination"
          />
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
      {message && openToast("bottom")}
      {itemMsg && itemToast("bottom")}
      {redemptionMsg && redemptionToast("bottom")}
      {issuerStatusMsg && issuerStatusToast("bottom")}
    </>
  );
};

export default Inventory;
