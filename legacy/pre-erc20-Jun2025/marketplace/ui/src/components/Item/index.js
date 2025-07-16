import React, { useEffect, useState, useMemo } from 'react';
import DataTableComponent from '../DataTableComponent';
import { Breadcrumb, Spin, Input, notification, Pagination } from 'antd';
import { actions } from '../../contexts/item/actions';
import { useItemDispatch, useItemState } from '../../contexts/item';
import { useLocation } from 'react-router-dom';
import ClickableCell from '../ClickableCell';
import routes from '../../helpers/routes';

function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

const Item = () => {
  const { Search } = Input;
  const [inventoryId, setinventoryId] = useState(undefined);
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(10);
  const [page, setPage] = useState(1);

  const [api, contextHolder] = notification.useNotification();

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  const dispatch = useItemDispatch();

  const { items, isItemsLoading, message, success } = useItemState();
  const query = useQuery();

  useEffect(() => {
    setinventoryId(query.get('inventoryId'));
    if (inventoryId !== undefined) {
      actions.fetchItem(dispatch, limit, offset, inventoryId);
    }
  }, [dispatch, limit, offset, inventoryId, query]);

  for (const value in Object.values(items)) {
    if (items[value].ownerOrganizationalUnit === '') {
      items[value].ownerOrganizationalUnit = 'N/A';
    }
  }

  let columns = [
    {
      title: 'Serial Number'.toUpperCase(),
      dataIndex: 'serialNumber',
      align: 'center',
    },
    {
      title: 'Item Number'.toUpperCase(),
      dataIndex: 'itemNumber',
      align: 'center',
    },
  ];

  useEffect(() => {
    let len = items.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [items]);

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };

  return (
    <div>
      {contextHolder}
      <div className="mx-16 mt-14">
        <div className="flex justify-between">
          <Breadcrumb>
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>Home</ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <ClickableCell href={routes.Inventories.url}>
                Inventory
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item>
              <p className="hover:text-primaryHover text-primary font-medium cursor-pointer">
                Serial Number
              </p>
            </Breadcrumb.Item>
          </Breadcrumb>
          <div className="flex">
            <Search placeholder="Search" className="w-80 mr-6" />
          </div>
        </div>
        <div className="my-4">
          {isItemsLoading ? (
            <div className="h-screen flex justify-center items-center">
              <Spin size="large" />
            </div>
          ) : (
            <DataTableComponent
              columns={columns}
              data={items}
              isLoading={isItemsLoading}
              pagination={false}
              scrollX="100%"
            />
          )}
          <Pagination
            current={page}
            onChange={onPageChange}
            total={total}
            showSizeChanger={false}
            className="flex justify-center my-5 "
          />
        </div>
      </div>

      {message && openToast('bottom')}
    </div>
  );
};

export default Item;
