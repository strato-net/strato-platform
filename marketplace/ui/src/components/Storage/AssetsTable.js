import React, { useEffect, useState } from "react";
import { useStorageDispatch, useStorageState } from "../../contexts/storage";
import { actions } from "../../contexts/storage/actions";
import useDebounce from "../UseDebounce";
import DataTableComponent from "../DataTableComponent";
import { Pagination } from "antd";

const AssetsTable = ({ user }) => {
  const dispatch = useStorageDispatch();
  const debouncedSearchTerm = useDebounce("", 1000);
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
      debouncedSearchTerm
    );
  }, [dispatch, limit, offset, debouncedSearchTerm]);

  const [data, setData ] = useState([]);
  useEffect(() => {
    let items = [];
    assets && assets.forEach((asset) => {
      items.push(asset);
    });
    setData(items);
  }, [assets]);

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