import React, { useEffect, useState } from "react";
import { useStorageDispatch, useStorageState } from "../../contexts/storage";
import { actions } from "../../contexts/storage/actions";
import DataTableComponent from "../DataTableComponent";
import { Pagination } from "antd";

const AssetsTable = ({ user, searchQuery }) => {
  const dispatch = useStorageDispatch();
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(10);
  const [page, setPage] = useState(1);

  const { assets, isAssetsLoading } = useStorageState();

  useEffect(() => {
    actions.fetchAssets(
      dispatch,
      limit,
      offset,
      searchQuery
    );
  }, [dispatch, limit, offset, searchQuery]);

  const [data, setData] = useState([]);

  useEffect(() => {
    let items = [];
    assets.forEach((asset) => {
      const { ["record_id"]: omittedKey, ...rest } = asset;
      items.push({
        recordId: asset.record_id,
        recordData: rest,
      });
    });
    setData(items);
  }, [assets]);

  const column = [
    {
      title: "Record ID".toUpperCase(),
      dataIndex: "recordId",
      key: "recordId",
      render: (recordId) => (
        <p>{recordId}</p>
      )
    },
    {
      title: "Record Data".toUpperCase(),
      dataIndex: "recordData",
      key: "recordData",
      render: (recordData) => (
        <p><pre>{JSON.stringify(recordData, null, 2)}</pre></p>
      )
    }
  ]

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  }

  useEffect(() => {
    let len = data.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [data]);

  return (
    <div>
      <DataTableComponent
        columns = {column}
        data={data}
        isLoading={isAssetsLoading}
        pagination={false}
        scrollX="100%"
      />
      <Pagination
        current={page}
        onChange={onPageChange}
        total={total}
        showSizeChanger={false}
        className="flex justify-center my-5"
      />
    </div>
  )
};

export default AssetsTable;