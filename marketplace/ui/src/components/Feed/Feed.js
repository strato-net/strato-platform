import { Breadcrumb, notification } from 'antd';
import React, { useEffect, useState } from 'react';
import routes from '../../helpers/routes';
import ClickableCell from '../ClickableCell';
import { actions as categoryActions } from '../../contexts/category/actions';
import { useCategoryState, useCategoryDispatch } from '../../contexts/category';
import { useTransactionState } from '../../contexts/transaction';
import GlobalTransaction from './GlobalTransaction';

const Feed = ({ user }) => {
  const categoryDispatch = useCategoryDispatch();

  const { userTransactions, isTransactionLoading } = useTransactionState();
  const { categorys } = useCategoryState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  return (
    <div>
      {contextHolder}
      <div className="px-4 md:px-10 lg:py-2 lg:mt-3 orders">
        <Breadcrumb>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">Home</p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <p className=" text-sm text-[#202020] font-medium">
              Global Transactions
            </p>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>
      <GlobalTransaction
        user={user}
        isAllOrdersLoading={isTransactionLoading}
      />
    </div>
  );
};

export default Feed;
