import React from "react";
import { Popover, Table, Button } from "antd";

const AssetDetailsPopover = ({ assets, title }) => {
  const columns = [
    {
      title: "Asset",
      dataIndex: "assetId",
      key: "assetId",
    },
    {
      title: "Order Number",
      dataIndex: "orderNumber",
      key: "orderNumber",
    },
    {
      title: "Purchase Date",
      dataIndex: "purchaseDate",
      key: "purchaseDate",
    },
    {
      title: "Number of Assets",
      dataIndex: "numberOfAssets",
      key: "numberOfAssets",
    },
    {
      title: "Purchase Price",
      dataIndex: "purchasePrice",
      key: "purchasePrice",
    },
  ];

  const dataSource = assets.map((asset, index) => ({
    key: index,
    assetId: `Asset ${index + 1}`,
    orderNumber: asset.orderNumber,
    purchaseDate: asset.purchaseDate,
    numberOfAssets: asset.numberOfAssets,
    purchasePrice: asset.purchasePrice,
  }));

  // Table content as per the adjusted requirement
  const tableContent = (
    <Table
      columns={columns}
      dataSource={dataSource}
      size="small"
      pagination={{
        pageSize: 5,
        showTotal: (total, range) =>
          `${range[0]}-${range[1]} of ${total} items`,
      }}
    />
  );

  return (
    <Popover content={tableContent} title={title} trigger="click">
      <Button
        type="link"
        className="p-0 h-auto text-lg text-black  font-semibold hover:text-blue-500"
      >
        {title}
      </Button>
    </Popover>
  );
};

export default AssetDetailsPopover;
