import React, { useState } from "react";
import { Table, Button, Badge, Avatar } from "antd";
import ConfirmationModal from "./OfferActionModals";
import "./NestedOfferTable.css";

// Updated product data with image URLs
const productData = [
  {
    key: "1",
    productName: "Vintage Sterling Brown Crystal Ring",
    totalQuantity: 3000,
    price: "3300 STRATS",
    totalOffers: 6,
    imageUrl: "https://fileserver.mercata-testnet2.blockapps.net/highway/b878c7de956e27099c1c5f16aa49e725cee03f5e1a9ab2a6ad496af1f0a407ff.png", // Product image
    offers: [
      {
        offerer: "Evelyn",
        quantity: 16,
        price: 200,
        totalPrice: 2800,
        key: "1",
        status: "pending",
      },
      {
        offerer: "Jaime",
        quantity: 6,
        price: 200,
        totalPrice: 1200,
        key: "2",
        status: "accepted",
      },
      {
        offerer: "Andrew",
        quantity: 6,
        price: 200,
        totalPrice: 1200,
        key: "3",
        status: "declined",
      },
    ],
  },
  {
    key: "2",
    productName: "Air Jordan 1 Low SE",
    totalQuantity: 300,
    price: "1300 STRATS",
    totalOffers: 2,
    imageUrl: "https://fileserver.mercata-testnet2.blockapps.net/highway/b878c7de956e27099c1c5f16aa49e725cee03f5e1a9ab2a6ad496af1f0a407ff.png",
    offers: [
      {
        offerer: "Username",
        quantity: 6,
        price: 200,
        totalPrice: 1200,
        key: "1",
        status: "pending",
      },
    ],
  },
];

// Function to assign color based on the first letter of the offerer's name
const getAvatarColor = (name) => {
  const colors = [
    "#f56a00",
    "#7265e6",
    "#ffbf00",
    "#00a2ae",
    "#87d068",
    "#1890ff",
  ];
  const charIndex = name.charCodeAt(0) % colors.length;
  return colors[charIndex];
};

// Sort function for showing pending first and sorting by total price descending
const sortOffers = (offers) => {
  return offers.sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return b.totalPrice - a.totalPrice; // Sort by total price descending
  });
};

// Offer columns will adjust depending on whether the table is "received" or "made"
const offerColumns = (handleAction, tableType) => {
  if (tableType === "received") {
    return [
      {
        title: "Offerer",
        dataIndex: "offerer",
        key: "offerer",
        render: (offerer) => (
          <div style={{ display: "flex", alignItems: "center" }}>
            <Avatar
              style={{ backgroundColor: getAvatarColor(offerer), marginRight: 8, borderRadius: 4 }} // Square avatar
            >
              {offerer.charAt(0).toUpperCase()}
            </Avatar>
            {offerer}
          </div>
        ),
      },
      {
        title: "Quantity",
        dataIndex: "quantity",
        key: "quantity",
        align: "center", // Center alignment
      },
      {
        title: "Price (Qty)",
        dataIndex: "price",
        key: "price",
        align: "center", // Center alignment
        render: (price) => `${price} STRATS`,
      },
      {
        title: "Total Price",
        dataIndex: "totalPrice",
        key: "totalPrice",
        align: "center", // Center alignment
        render: (totalPrice) => `${totalPrice} STRATS`,
      },
      {
        title: "Status",
        key: "status",
        render: (record) => (
          <Badge
            status={
              record.status === "accepted"
                ? "success"
                : record.status === "declined"
                ? "error"
                : "default"
            }
            text={record.status.charAt(0).toUpperCase() + record.status.slice(1)}
          />
        ),
      },
      {
        title: "Action",
        key: "action",
        align: "center",
        render: (text, record) => (
          <>
            {record.status === "pending" && (
              <>
                <Button
                  type="primary"
                  size="small"
                  className="mr-3 !bg-[#EEF3FE] !text-[#1F34B5] hover:!bg-[#D6E1FF] hover:!text-[#0F2299]"
                  onClick={() => handleAction("accept", record)}
                >
                  Accept
                </Button>
                <Button
                  type="primary"
                  size="small"
                  className="!bg-[#FEF0E6] !text-[#B63B38] hover:!bg-[#FFD2C5] hover:!text-[#962626]"
                  onClick={() => handleAction("decline", record)}
                >
                  Decline
                </Button>
              </>
            )}
          </>
        ),
      },
    ];
  } else {
    // For "offers made", we show the date instead of the offerer, and only a "Cancel" button
    return [
      {
        title: "Date",
        dataIndex: "date",
        key: "date",
        align: "center", // Center alignment
      },
      {
        title: "Quantity",
        dataIndex: "quantity",
        key: "quantity",
        align: "center",
      },
      {
        title: "Price (Qty)",
        dataIndex: "price",
        key: "price",
        align: "center", // Center alignment
        render: (price) => `${price} STRATS`,
      },
      {
        title: "Total Price",
        dataIndex: "totalPrice",
        key: "totalPrice",
        align: "center", // Center alignment
        render: (totalPrice) => `${totalPrice} STRATS`,
      },
      {
        title: "Status",
        key: "status",
        render: (record) => (
          <Badge
            status={
              record.status === "accepted"
                ? "success"
                : record.status === "declined"
                ? "error"
                : "default"
            }
            text={record.status.charAt(0).toUpperCase() + record.status.slice(1)}
          />
        ),
      },
      {
        title: "Action",
        key: "action",
        align: "center",
        render: (text, record) => (
          <>
            {record.status === "pending" && (
              <Button
                type="primary"
                size="small"
                className="!bg-[#FEF0E6] !text-[#B63B38] hover:!bg-[#FFD2C5] hover:!text-[#962626]"
                onClick={() => handleAction("cancel", record)}
              >
                Cancel Offer
              </Button>
            )}
          </>
        ),
      },
    ];
  }
};

// Main columns for product data
const columns = [
  {
    title: "Product",
    dataIndex: "productName",
    key: "productName",
    render: (text, record) => (
      <div style={{ display: "flex", alignItems: "center" }}>
        <img
          src={record.imageUrl}
          alt={text}
          style={{
            width: "80px",
            height: "80px",
            objectFit: "cover", // Maintains aspect ratio
            marginRight: "10px",
          }}
        />
        {text}
      </div>
    ),
  },
  {
    title: "Total Quantity",
    dataIndex: "totalQuantity",
    key: "totalQuantity",
    align: "center", // Center alignment
  },
  {
    title: "Price",
    dataIndex: "price",
    key: "price",
    align: "center", // Center alignment
  },
  {
    title: "Total Offers",
    dataIndex: "totalOffers",
    key: "totalOffers",
    align: "center", // Center alignment
  },
];

const NestedTableComponent = ({ tableType }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState(null); // Now we're selecting the offer, not the whole product
  const [actionType, setActionType] = useState(""); // 'accept', 'decline', or 'cancel'

  const handleAction = (action, offer) => {
    setSelectedOffer(offer); // Set the selected offer
    setActionType(action);
    setIsConfirming(true);
  };

  const onConfirm = () => {
    setIsConfirming(false);
    setIsLoading(true);

    // Simulate an API call
    setTimeout(() => {
      setIsLoading(false);
      setIsConfirmed(true);
    }, 2000);
  };

  const onClose = () => {
    setIsConfirming(false);
    setIsLoading(false);
    setIsConfirmed(false);
  };

  const expandedRowRender = (record) => {
    const sortedOffers = sortOffers(record.offers);
    return (
      <Table
        columns={offerColumns(handleAction, tableType)}
        dataSource={sortedOffers}
        pagination={false}
        rowKey="key"
        className="offer-rows"
      />
    );
  };

  return (
    <div>
      <Table
        columns={columns}
        expandable={{
          expandedRowRender,
          rowExpandable: (record) => record.offers.length > 0,
        }}
        dataSource={productData}
        rowKey="key"
        pagination={false}
        className="product-rows"
      />
      <ConfirmationModal
        isOpen={isConfirming || isLoading || isConfirmed}
        onClose={onClose}
        onConfirm={onConfirm}
        product={selectedOffer}
        actionType={actionType}
        isLoading={isLoading}
        isConfirmed={isConfirmed}
      />
    </div>
  );
};

export default NestedTableComponent;
