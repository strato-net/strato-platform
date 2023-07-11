import React from "react";

import { Table, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";

const DataTableComponent = ({
  columns,
  data,
  isLoading,
  offset,
  limit,
  setOffset,
  naviroute,
  rowKey,
  setSelectedObj,
  selectedRowObj,
  rowSelection,
  pagination,
  scrollX,
}) => {
  const navigate = useNavigate();

  return (
    <Spin spinning={isLoading} delay={500} size="large">
      <Table
        columns={columns}
        dataSource={data}
        sticky={true}
        pagination={
          pagination ?? {
            defaultPageSize: 10,
            showSizeChanger: false,
            position: ["bottomCenter"],
          }
        }
        scroll={{
          x: scrollX ? scrollX : 1300,
        }}
        size="middle"
        rowClassName={(record, index) =>
          index % 2 === 0 ? "bg-white" : "bg-secondry"
        }
        rowKey={rowKey}
        rowSelection={rowSelection}
        onRow={(record) => {
          return {
            onClick: (e) => {
              try {
                navigate(
                  `${naviroute.replace(":id", record.address)}?chainId=${
                    record.chainId
                  }`
                );
              } catch (e) {}
            },
          };
        }}
      />
    </Spin>
  );
};

DataTableComponent.propTypes = {
  columnContentTypes: PropTypes.array,
  rows: PropTypes.array,
  headings: PropTypes.array,
  sortable: PropTypes.array,
  onSort: PropTypes.func,
  defaultSortDirection: PropTypes.string,
  initialSortColumnIndex: PropTypes.number,
  offset: PropTypes.number,
  setOffset: PropTypes.func,
  limit: PropTypes.number,
  isLoading: PropTypes.bool,
};

export default DataTableComponent;
