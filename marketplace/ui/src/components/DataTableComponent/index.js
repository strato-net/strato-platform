import React from 'react';

import { Table, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';

const DataTableComponent = ({
  columns,
  data,
  isLoading,
  onChange,
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
        className="custom-table"
        sticky={true}
        pagination={
          pagination && {
            defaultPageSize: 10,
            showSizeChanger: false,
            position: ['bottomCenter'],
          }
        }
        scroll={{
          x: scrollX ? scrollX : 1050,
        }}
        // scrollX={true}
        size="middle"
        rowClassName={'bg-white'}
        rowKey={rowKey}
        rowSelection={rowSelection}
        onChange={onChange}
        onRow={(record) => {
          return {
            onClick: () => {
              try {
                navigate(
                  `${naviroute.replace(':id', record.address)}?chainId=${
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
