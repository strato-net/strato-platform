import React, { useState, useEffect } from "react";
import {
  Breadcrumb,
  Button,
  Pagination,
  notification,
  Spin,
  Select,
  Tabs,
  Avatar,
  Space,
  Typography,
  Table,
  Tooltip,
} from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { CheckCircleOutlined } from "@ant-design/icons";
import { UserOutlined } from "@ant-design/icons";
import InventoryCard from "./InventoryCard";
import { ASSET_STATUS } from "../../helpers/constants";
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
import { ISSUER_STATUS } from "../../helpers/constants";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";

const { Option } = Select;

const MyWallet = ({ user }) => {
  const [open, setOpen] = useState(false);
  const [reqModOpen, setReqModOpen] = useState(false);
  const [queryValue, setQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [isSearch, setIsSearch] = useState(false);
  const [category, setCategory] = useState(undefined);
  const linkUrl = window.location.href;
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { Title, Text } = Typography;

  const { cartList, strats } = useMarketplaceState();
  const stratsBalance = Object.keys(strats).length > 0 ? strats : 0;
  const [totalBalance, setTotalBalance] = useState(0);

  const categoryDispatch = useCategoryDispatch();
  const { categorys } = useCategoryState();
  const {
    inventories,
    isInventoriesLoading,
    message,
    success,
    inventoriesTotal,
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
    if (isSearch) {
      actions.fetchInventorySearch(
        dispatch,
        limit,
        offset,
        debouncedSearchTerm
      );
    } else actions.fetchInventory(dispatch, limit, offset, "", category);
  }, [dispatch, limit, offset, debouncedSearchTerm, category]);

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

  const queryHandle = (e) => {
    setIsSearch(e.length > 0);
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

  const navigate = useNavigate();

  const getAllSubcategories = (categories) => {
    let subcategories = [];
    categories.forEach((category) => {
      if (category.subCategories && category.subCategories.length > 0) {
        subcategories = subcategories.concat(category.subCategories);
      }
    });
    return subcategories;
  };

  const allSubcategories = getAllSubcategories(categorys);

  const handleTabSelect = (key) => {
    setCategory(key);
    setOffset(0);
    setPage(1);
    return;
  };

  const metaImg = category ? category : SEO.IMAGE_META;

  const userName = user.commonName || "";
  const userLetter = userName[0].toUpperCase() || "";

  const renderImg = (service) => {
    return service.imageURL && service.imageURL !== "" ? (
      <img
        src={service.imageURL}
        alt={service.serviceName}
        height="16px"
        width="16px"
      />
    ) : (
      ""
    );
  };

  const [tableData, setTableData] = useState([]);

  useEffect(() => {
    const baseData = [
      {
        key: "1",
        asset: "STRATS",
        image: Images.logo,
        quantity: stratsBalance,
        price: "$0.01",
        gainLoss: "---",
        value: `$${(stratsBalance * 0.01).toFixed(2)}`,
        status: null,
      },
    ];

    if (!isInventoriesLoading && inventories.length > 0) {
      const inventoryData = inventories.map((inventory, index) => ({
        key: `inventory-${index + 2}`,
        asset: inventory.name,
        image:
          inventory["BlockApps-Mercata-Asset-images"] &&
          inventory["BlockApps-Mercata-Asset-images"].length > 0
            ? inventory["BlockApps-Mercata-Asset-images"][0].value
            : Images.image_placeholder,
        quantity: inventory.quantity || 1,
        price: `$${inventory.price || "0.00"}`,
        gainLoss: inventory.gainLoss || "0%",
        value: `$${inventory.value || "0.00"}`,
        status: inventory.status,
      }));

      const newTableData = [...baseData, ...inventoryData];
      setTableData(newTableData);

      // Calculate total balance
      const total = newTableData.reduce((sum, item) => {
        const price = parseFloat(item.price.replace("$", ""));
        return sum + price * item.quantity;
      }, 0);
      setTotalBalance(total.toFixed(2));
    } else {
      setTableData(baseData);
      setTotalBalance((stratsBalance * 0.01).toFixed(2));
    }
  }, [isInventoriesLoading, inventories, stratsBalance]);

  const CustomQuestionIcon = () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="8" fill="#373B9C" />
      <text
        x="8"
        y="12"
        textAnchor="middle"
        fill="white"
        fontSize="12"
        fontFamily="Arial, sans-serif"
      >
        ?
      </text>
    </svg>
  );

  const columns = [
    {
      title: "Asset",
      dataIndex: "asset",
      key: "asset",
      render: (text, record) => (
        <div className="flex items-center">
          <div className="mr-2 w-[74px] h-[52px] flex items-center justify-center">
            <img
              src={record.image}
              alt={text}
              title={text}
              className={`rounded-md w-[161px] ${
                record.status === ASSET_STATUS.PENDING_REDEMPTION
                  ? "h-[140px]"
                  : "h-[161px]"
              } md:object-contain max-w-full max-h-full object-contain`}
              style={{
                width: "auto",
                height: "auto",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            />
          </div>
          <span>{text}</span>
        </div>
      ),
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
    },
    {
      title: "Price",
      dataIndex: "price",
      key: "price",
      render: (price, record) => (
        <div>
          <div className="text-xs sm:text-sm">{price}</div>
          {record.key !== "1" && (
            <div className="flex items-center mt-1">
              <img
                src={Images.logo}
                alt="Small"
                className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
              />
              <Text
                className="text-[10px] sm:text-xs"
                style={{ color: "#747474" }}
              >
                25,000
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: (
        <span className="flex items-center">
          Gain/Loss %{" "}
          <Tooltip title="Calculated as the percentage change between the current marketplace price and the original acquisition price of the asset.">
            <span className="ml-1 cursor-pointer inline-flex items-center">
              <CustomQuestionIcon />
            </span>
          </Tooltip>
        </span>
      ),
      dataIndex: "gainLoss",
      key: "gainLoss",
      render: (text) => {
        if (text === "---") {
          return <span className="text-xs sm:text-sm">{text}</span>;
        }
        const isPositive = text.startsWith("+");
        return (
          <span
            className="text-xs sm:text-sm"
            style={{ color: isPositive ? "#00A455" : "#C00000" }}
          >
            {text}
          </span>
        );
      },
    },
    {
      title: "Value",
      dataIndex: "value",
      key: "value",
      render: (value, record) => (
        <div>
          <div className="text-xs sm:text-sm">{value}</div>
          {record.key !== "1" && (
            <div className="flex items-center mt-1">
              <img
                src={Images.logo}
                alt="Small"
                className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
              />
              <Text
                className="text-[10px] sm:text-xs"
                style={{ color: "#747474" }}
              >
                14,000
              </Text>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <HelmetComponent
        title={`${category ? `${category} |` : ""} ${SEO.TITLE_META} `}
        description={SEO.DESCRIPTION_META}
        link={linkUrl}
      />
      {contextHolder}
      <>
        <div
          className="w-full h-[200px] py-4 px-4 md:h-[250px] bg-[#ADA0E2] bg-opacity-20 flex flex-col justify-between mt-0 lg:-mt-8"
          style={{ borderColor: "#13188A" }}
        >
          <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-[#13188A] font-semibold">Home</p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <p className="text-sm text-[#202020] font-medium">My Wallet</p>
            </Breadcrumb.Item>
          </Breadcrumb>

          <div className="flex flex-col sm:flex-row items-center sm:items-start w-full sm:px-5 md:px-14 mt-4 mb-8">
            <div className="flex flex-col items-center gap-3">
              <Avatar
                size={50}
                style={{
                  backgroundColor: "#373B9C",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: "24px", fontWeight: "bold" }}>
                  {userLetter}
                </span>
              </Avatar>
              <Text
                style={{
                  fontSize: "16px",
                  color: "#373B9C",
                  fontWeight: "600",
                  textAlign: "center",
                }}
                className="mt-2"
              >
                {userName}
              </Text>
            </div>
            <div className="flex flex-col items-center sm:items-start ml-0 sm:ml-10 mt-4 sm:mt-0">
              <Title style={{ color: "#373B9C", marginBottom: "0" }} level={5}>
                Balance:
              </Title>
              <Text
                style={{
                  fontSize: "24px",
                  color: "#373B9C",
                  fontWeight: "bold",
                  marginBottom: "0",
                  marginTop: "7px",
                }}
                className="mt-1"
              >
                ${totalBalance}
              </Text>
              <div className="flex items-center mt-1">
                <img
                  src={Images.logo}
                  alt="Small"
                  style={{ width: "12px", height: "12px", marginRight: "5px" }}
                />
                <Text style={{ fontSize: "14px", color: "#747474" }}>
                  {stratsBalance}
                </Text>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 mx-6 md:mx-5 md:px-10 mb-5">
          <Table
            columns={columns}
            dataSource={tableData}
            pagination={false}
            className="custom-table"
            loading={isInventoriesLoading}
          />
        </div>

        {/* <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start inventoryCard max-w-full">
          {!isInventoriesLoading ? (
            inventories.map((inventory, index) => (
              <div key={index} className="bg-white p-4 rounded-lg shadow-md">
                <img
                  className={`rounded-md w-full ${
                    inventory.status === ASSET_STATUS.PENDING_REDEMPTION
                      ? "h-[140px]"
                      : "h-[161px]"
                  } md:object-contain`}
                  alt={inventory.name}
                  title={inventory.name}
                  src={
                    inventory["BlockApps-Mercata-Asset-images"] &&
                    inventory["BlockApps-Mercata-Asset-images"].length > 0
                      ? inventory["BlockApps-Mercata-Asset-images"][0].value
                      : Images.image_placeholder
                  }
                />
                <h3 className="text-lg font-semibold mt-2">{inventory.name}</h3>
                <p className="text-sm">Quantity: {inventory.quantity}</p>
                <p className="text-sm">Price: ${inventory.price || "0.00"}</p>
                <p className="text-sm">
                  Gain/Loss: {inventory.gainLoss || "0%"}
                </p>
                <p className="text-sm">Value: ${inventory.value || "0.00"}</p>
                <p className="text-sm">Status: {inventory.status}</p>
                {Object.entries(inventory).map(([key, value]) => {
                  // Skip rendering for already displayed fields and complex objects
                  if (
                    [
                      "name",
                      "quantity",
                      "price",
                      "gainLoss",
                      "value",
                      "status",
                      "BlockApps-Mercata-Asset-images",
                    ].includes(key) ||
                    typeof value === "object"
                  ) {
                    return null;
                  }
                  return (
                    <p key={key} className="text-sm">
                      {key}: {value}
                    </p>
                  );
                })}
              </div>
            ))
          ) : (
            <Spin size="large" />
          )}
        </div> */}

        <style jsx>{`
          .custom-table .ant-table-thead > tr > th {
            background-color: white !important;
            color: #373b9c;
            font-weight: bold;
            border: none !important;
          }
          .custom-table .ant-table-tbody > tr > td {
            color: #3f4149;
            border: none !important;
          }
          .custom-table .ant-table {
            border: none !important;
          }
          .custom-table .ant-table-container {
            border: none !important;
          }
          /* Add a bottom border to each row except the last one */
          .custom-table .ant-table-tbody > tr:not(:last-child) > td {
            border-bottom: 1px solid #f0f0f0 !important;
          }
          /* Remove default table outline */
          .custom-table
            .ant-table-container
            table
            > thead
            > tr:first-child
            th:first-child {
            border-top-left-radius: 0;
          }
          .custom-table
            .ant-table-container
            table
            > thead
            > tr:first-child
            th:last-child {
            border-top-right-radius: 0;
          }
        `}</style>
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

export default MyWallet;
