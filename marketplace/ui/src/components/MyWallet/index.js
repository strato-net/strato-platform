import React, { useState, useEffect } from "react";
import { Breadcrumb, Typography, Table, Tooltip, Spin, Tag } from "antd";
import { Images } from "../../images";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import HelmetComponent from "../Helmet/HelmetComponent";
import { SEO } from "../../helpers/seoConstant";
import { useNavigate } from "react-router-dom";
import { useMarketplaceState } from "../../contexts/marketplace";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { actions } from "../../contexts/inventory/actions";

const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, [matches, query]);

  return matches;
};

const MyWallet = ({ user }) => {
  const [isLoading, setIsLoading] = useState(true);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const navigate = useNavigate();
  const naviroute = routes.MyWalletDetail.url;
  const { Title, Text } = Typography;
  const linkUrl = window.location.href;
  const [totalBalance, setTotalBalance] = useState(0);
  const [tableData, setTableData] = useState([]);
  const [stratsBalance, setStratsBalance] = useState(0);
  const dispatch = useInventoryDispatch();
  const { walletData, isWalletDataLoading, error } = useInventoryState();


  const formatNumber = (num) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  useEffect(() => {
    if (user) {
      actions.fetchWalletData(dispatch);
    }
  }, [dispatch, user]);

  useEffect(() => {
    if (walletData) {
      const assets = walletData.inventoriesWithImageUrl;
      let stratsAsset = assets.find(asset => asset.name === "STRATS");
      let stratsQuantity = stratsAsset ? stratsAsset.quantity : 0;
      setStratsBalance(stratsQuantity);

      const processedData = assets
        .filter(asset => asset.name !== "STRATS") // Filter out STRATS from regular assets
        .map((asset, index) => ({
          key: index + 1, // Start from 1 to reserve 0 for STRATS
          asset: asset.name,
          image: asset["BlockApps-Mercata-Asset-images"][0]?.value || Images.image_placeholder,
          quantity: formatNumber(asset.quantity),
          price: asset.price ? `$${formatNumber(parseFloat(asset.price).toFixed(2))}` : "-",
          value: asset.price
            ? `$${formatNumber((asset.quantity * asset.price).toFixed(2))}`
            : "-",
          gainLoss: asset.gainLossPercentage
            ? `${asset.gainLossPercentage}%`
            : "-",
          address: asset.address,
          creator: asset.creator,
          isIssuer: asset.creator === user.commonName,
        }));

      // Add STRATS at the top of the list
      const stratsEntry = {
        key: 0,
        asset: "STRATS",
        image: Images.logo, // Assuming this is the correct path to the STRATS logo
        quantity: formatNumber(stratsQuantity),
        price: "$0.01",
        value: `$${formatNumber((stratsQuantity * 0.01).toFixed(2))}`,
        gainLoss: "-",
        address: stratsAsset ? stratsAsset.address : null,
      };

      setTableData([stratsEntry, ...processedData]);

      const total = [stratsEntry, ...processedData].reduce((sum, item) => {
        const itemValue = parseFloat(item.value.replace("$", "").replace(",", ""));
        return sum + (isNaN(itemValue) ? 0 : itemValue);
      }, 0);
      setTotalBalance(total.toFixed(2));
      setIsLoading(false);
    }
  }, [walletData]);

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
          if (record.key !== "strats" && record.address) {
            navigate(
              `${naviroute
                .replace(":id", record.address)
                .replace(":name", encodeURIComponent(record.asset))}`,
              {
                state: { isCalledFromWallet: true },
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
            <div>
              {record.key !== "strats" ? (
                <span
                  className="text-xs sm:text-sm text-[#13188A] hover:underline cursor-pointer"
                  onClick={callDetailPage}
                >
                  {text}
                </span>
              ) : (
                <span className="text-xs sm:text-sm">{text}</span>
              )}
              {record.isIssuer && (
                <Tag color="blue" className="ml-2">
                  Issuer
                </Tag>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: "Unit Price",
      dataIndex: "price",
      key: "price",
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
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
        const value = parseFloat(text);
        let color = "inherit";
        if (!isNaN(value)) {
          color = value > 0 ? "green" : value < 0 ? "red" : "inherit";
        }
        return <span style={{ color }}>{text}</span>;
      },
    },
    {
      title: "Value",
      dataIndex: "value",
      key: "value",
    },
  ];

  const renderMobileCard = (item) => (
    <div key={item.key}>
      <div className="bg-white p-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-1 flex items-center">
            <img
              src={item.image}
              alt={item.asset}
              className="w-12 h-12 object-contain mr-2"
            />
            {item.key !== "strats" && item.address ? (
              <p
                className="text-sm font-semibold text-[#13188A] hover:underline cursor-pointer"
                onClick={() =>
                  navigate(
                    `${routes.MyWalletDetail.url
                      .replace(":id", item.address)
                      .replace(":name", encodeURIComponent(item.asset))}`,
                    {
                      state: { isCalledFromWallet: true },
                    }
                  )
                }
              >
                {item.asset}
              </p>
            ) : (
              <p className="text-sm font-semibold">{item.asset}</p>
            )}
            {item.isIssuer && (
              <Tag color="blue" className="mt-1">
                Issuer
              </Tag>
            )}
          </div>
          <div className="col-span-1 text-right">
            <p className="text-sm font-bold">{item.value}</p>
            <p className="text-xs text-gray-500">
              {item.quantity} {item.asset === "STRATS" ? "STRATS" : ""}
            </p>
          </div>
          <div className="col-span-1">
            <p className="text-xs">
              <span style={{ color: "#373B9C", fontWeight: "bold" }}>
                Unit Price:
              </span>{" "}
              <span style={{ color: "#3F4149" }}>{item.price}</span>
            </p>
          </div>
          <div className="col-span-1 text-right">
            <p className="text-xs">
              <span style={{ color: "#373B9C", fontWeight: "bold" }}>
                Quantity:
              </span>{" "}
              <span style={{ color: "#3F4149" }}>
                {item.quantity === 0 ? "-" : item.quantity}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMobileView = () => (
    <div className="bg-gray-100 min-h-screen">
      <div className="p-4">
        <div className="rounded-lg overflow-hidden wallet-gradient p-4 flex justify-between items-center">
          <div>
            <Text className="text-white text-sm font-semibold">
              Total Balance:
            </Text>
            <Text className="text-white text-xl font-bold block mt-1">
              ${totalBalance}
            </Text>
          </div>
          <div className="flex items-center">
            <img src={Images.logo} alt="STRATS" className="w-4 h-4 mr-2" />
            <Text className="text-white text-lg font-semibold">
            {formatNumber(stratsBalance)}
            </Text>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="border border-[#D9D9D9] rounded-lg overflow-hidden">
          {tableData.map((item) => renderMobileCard(item))}
        </div>
      </div>
    </div>
  );

  const renderDesktopView = () => (
    <>
      <div
        className="w-full h-[150px] py-4 bg-[#ADA0E2] bg-opacity-20 flex flex-col justify-between mt-0 lg:-mt-8"
        style={{ borderColor: "#13188A" }}
      >
        <div className="mx-5 md:mx-14">
          <Breadcrumb className="mt-2 lg:mt-4">
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-[#13188A] font-semibold">Home</p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <p className="text-sm text-[#202020] font-medium">My Wallet</p>
            </Breadcrumb.Item>
          </Breadcrumb>

          <div className="mt-4">
            <Title style={{ color: "#373B9C", marginBottom: "0" }} level={5}>
              Balance:
            </Title>
            <div className="flex items-center">
              <Text
                style={{
                  fontSize: "24px",
                  color: "#373B9C",
                  fontWeight: "bold",
                  marginRight: "10px",
                }}
              >
                ${totalBalance}
              </Text>
              <div className="flex items-center">
                <img
                  src={Images.logo}
                  alt="STRATS"
                  style={{ width: "12px", height: "12px", marginRight: "5px" }}
                />
                <Text style={{ fontSize: "14px", color: "#747474" }}>
                {formatNumber(Number(stratsBalance).toFixed(2))}
                </Text>
              </div>
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
        />
      </div>
    </>
  );

  return (
    <>
      <HelmetComponent
        title={`My Wallet | ${SEO.TITLE_META}`}
        description={SEO.DESCRIPTION_META}
        link={linkUrl}
      />
      {isLoading ? (
        <div className="flex justify-center items-center h-screen">
          <Spin size="large" />
        </div>
      ) : isMobile ? (
        renderMobileView()
      ) : (
        renderDesktopView()
      )}
      <style jsx>{`
        .custom-table .ant-table-thead > tr > th {
          background-color: white !important;
          color: #373b9c;
          font-weight: bold;
          border: none !important;
        }
        .wallet-gradient {
          background: linear-gradient(
            135deg,
            rgba(55, 59, 156, 1) 30%,
            rgba(58, 71, 164, 0.94) 44%,
            rgba(90, 189, 245, 0.3) 100%
          );
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
        .custom-table .ant-table-tbody > tr:not(:last-child) > td {
          border-bottom: 1px solid #f0f0f0 !important;
        }
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
  );
};

export default MyWallet;
