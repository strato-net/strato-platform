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

  const { data, isStorageLoading } = useStorageState();

  useEffect(() => {
    actions.fetchStorage(
      dispatch,
      limit,
      offset,
      "Asset",
      searchQuery
    );
  }, [dispatch, limit, offset, searchQuery]);

  const [assets, setAssets] = useState([]);

  useEffect(() => {
    let items = [];
    data && data.forEach((asset) => {
      items.push(asset);
    });
    setAssets(items);
  }, [data]);

  const column = [
    {
      title: "Something".toUpperCase(),
      dataIndex: "something",
      key: "something",
      render: (something) => (
        <p>something</p>
      )
    }
  ]

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  }

  useEffect(() => {
    let len = assets.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [assets]);

  return (
    <div>
      <DataTableComponent
        columns = {column}
        data={assets}
        isLoading={isStorageLoading}
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