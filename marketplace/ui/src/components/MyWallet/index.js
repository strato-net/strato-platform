import React, { useState, useEffect } from "react";
import {
  Breadcrumb,
  notification,
  Avatar,
  Typography,
  Table,
  Tooltip,
} from "antd";
import { ASSET_STATUS } from "../../helpers/constants";
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch } from "../../contexts/category";
import useDebounce from "../UseDebounce";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { usePaymentServiceDispatch } from "../../contexts/payment";
import { actions as paymentServiceActions } from "../../contexts/payment/actions";
import { Images } from "../../images";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import HelmetComponent from "../Helmet/HelmetComponent";
import { SEO } from "../../helpers/seoConstant";
import { useMarketplaceState } from "../../contexts/marketplace";
import { useNavigate } from "react-router-dom";

const MyWallet = ({ user }) => {
  const [queryValue] = useState("");
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const limit = 10;
  const [offset] = useState(0);
  const dispatch = useInventoryDispatch();
  // eslint-disable-next-line no-unused-vars
  const [api, contextHolder] = notification.useNotification();
  const [isSearch] = useState(false);
  const [category] = useState(undefined);
  const linkUrl = window.location.href;
  const { Title, Text } = Typography;
  const navigate = useNavigate();

  const { strats } = useMarketplaceState();
  const stratsBalance = Object.keys(strats).length > 0 ? strats : 0;
  const [totalBalance, setTotalBalance] = useState(0);

  const categoryDispatch = useCategoryDispatch();
  const { inventories, isInventoriesLoading } = useInventoryState();
  const paymentServiceDispatch = usePaymentServiceDispatch();

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
  }, [dispatch, limit, offset, debouncedSearchTerm, category, isSearch]);

  const userName = user.commonName || "";
  const userLetter = userName[0].toUpperCase() || "";

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
        address: null,
      },
    ];

    if (!isInventoriesLoading && inventories.length > 0) {
      const inventoryData = inventories.map((inventory, index) => {
        const quantity = inventory.quantity || 1;
        const price = parseFloat(inventory.price) || 0;
        const value = quantity * price;
        return {
          key: `inventory-${index + 2}`,
          asset: inventory.name,
          image:
            inventory["BlockApps-Mercata-Asset-images"] &&
            inventory["BlockApps-Mercata-Asset-images"].length > 0
              ? inventory["BlockApps-Mercata-Asset-images"][0].value
              : Images.image_placeholder,
          quantity: quantity,
          price: `$${price.toFixed(2)}`,
          gainLoss: inventory.gainLoss || "0%",
          value: `$${value.toFixed(2)}`,
          status: inventory.status,
          address: inventory.address, // Make sure this line is present
        };
      });

      const newTableData = [...baseData, ...inventoryData];
      setTableData(newTableData);

      // Calculate total balance
      const total = newTableData.reduce((sum, item) => {
        const itemValue = parseFloat(item.value.replace("$", ""));
        return sum + (isNaN(itemValue) ? 0 : itemValue);
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
      render: (text, record) => {
        const callDetailPage = () => {
          if (record.key !== "1" && record.address) {
            navigate(
              `${routes.InventoryDetail.url
                .replace(":id", record.address)
                .replace(":name", encodeURIComponent(text))}`,
              {
                state: { isCalledFromInventory: true },
              }
            );
          }
        };

        return (
          <div className="flex items-center">
            <div className="mr-2 w-[74px] h-[52px] flex items-center justify-center">
              <img
                src={record.image}
                alt={text}
                title={text}
                className="rounded-md w-full h-full object-contain"
              />
            </div>
            {record.key !== "1" ? (
              <span
                className="text-xs sm:text-sm text-[#13188A] hover:underline cursor-pointer"
                onClick={callDetailPage}
              >
                {text}
              </span>
            ) : (
              <span className="text-xs sm:text-sm">{text}</span>
            )}
          </div>
        );
      },
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
      render: (price, record) => {
        if (record.key === "1") {
          // For the first row (STRATS), keep the original display
          return (
            <div>
              <div className="text-xs sm:text-sm">{price}</div>
            </div>
          );
        }

        const priceValue = parseFloat(price.replace("$", ""));

        if (priceValue === 0 || isNaN(priceValue)) {
          return (
            <div>
              <div className="text-xs sm:text-sm">-</div>
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
                  -
                </Text>
              </div>
            </div>
          );
        }

        return (
          <div>
            <div className="text-xs sm:text-sm">{price}</div>
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
                {(priceValue / 0.01).toFixed(2)}
              </Text>
            </div>
          </div>
        );
      },
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
      render: (text, record) => {
        if (record.key === "1" || text === "---" || text === "-") {
          return <span className="text-xs sm:text-sm">---</span>;
        }

        // Remove any existing +/- signs and % symbol
        const cleanedText = text.replace(/[+\-%]/g, "");
        const percentage = parseFloat(cleanedText);

        if (isNaN(percentage)) {
          return <span className="text-xs sm:text-sm">---</span>;
        }

        const roundedPercentage = Math.round(percentage);

        if (roundedPercentage === 0) {
          return <span className="text-xs sm:text-sm">0%</span>;
        }

        const isPositive = roundedPercentage > 0;
        const color = isPositive ? "#00A455" : "#C00000";
        const sign = isPositive ? "+" : "-";

        return (
          <span className="text-xs sm:text-sm" style={{ color: color }}>
            {`${sign}${Math.abs(roundedPercentage)}%`}
          </span>
        );
      },
    },
    {
      title: "Value",
      dataIndex: "value",
      key: "value",
      render: (value, record) => {
        if (record.key === "1") {
          // For the first row (STRATS), keep the original value
          return (
            <div>
              <div className="text-xs sm:text-sm">{value}</div>
            </div>
          );
        } else {
          // For all other rows, calculate Value as Quantity * Price
          const quantity = parseFloat(record.quantity);
          const price = parseFloat(record.price.replace("$", ""));
          const calculatedValue = (quantity * price).toFixed(2);

          return (
            <div>
              <div className="text-xs sm:text-sm">${calculatedValue}</div>
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
                  {(parseFloat(calculatedValue) / 0.01).toFixed(2)}
                </Text>
              </div>
            </div>
          );
        }
      },
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
    </>
  );
};

export default MyWallet;
