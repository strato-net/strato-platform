import React from 'react';
import { Tabs } from 'antd';
import DataTableComponent from '../DataTableComponent';

const OwnershipHistoryTable = ({ tableData, columns }) => {

  const tabItems = Object.keys(tableData).map((address, index) => ({
    key: String(index + 1), // Ensure the key is a string
    label: `Asset ${index + 1}`, // You can replace this with any label you prefer
    children: (
      <div>
        <DataTableComponent
          columns={columns} // Ensure `columns` is correctly passed in
          scrollX="100%"
          data={tableData[address]}
          isLoading={false} // Adjust based on your state
          pagination={{
            defaultPageSize: 10,
            position: ["bottomCenter"],
            showSizeChanger: false,
          }}
        />
      </div>
    ),
  }));

  return <Tabs defaultActiveKey="1" items={tabItems}/>;
};

export default OwnershipHistoryTable;
