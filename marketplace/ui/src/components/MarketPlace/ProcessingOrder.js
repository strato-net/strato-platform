import { Spin, notification } from 'antd';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import routes from '../../helpers/routes';
import { actions as orderActions } from '../../contexts/order/actions';
import { useOrderDispatch, useOrderState } from '../../contexts/order';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const ProcessingOrder = () => {
  const query = useQuery();
  const navigate = useNavigate();
  const orderDispatch = useOrderDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const [error, setError] = useState(null);
  const { message, success, isOrderEventLoading } = useOrderState();
  const [api, contextHolder] = notification.useNotification();

  // Memoized values for orderHash and assetAddresses
  const orderHash = useMemo(() => query.get('orderHash'), [query]);
  const assetAddresses = useMemo(
    () => query.get('assets')?.split(',') || [],
    [query]
  );

  const storedConfirmList = useMemo(() => {
    const data = window.localStorage.getItem('confirmOrderList');
    return data ? JSON.parse(data) : [];
  }, []);

  const getCartData = useCallback(async () => {
    try {
      const updatedCart = storedConfirmList.filter(
        (cart) => !assetAddresses.includes(cart.action)
      );
      marketplaceActions.addItemToCart(marketplaceDispatch, updatedCart);

      // Navigate to Transactions after cart update
      navigate(routes.Transactions.url);
    } catch (err) {
      setError(err);
    }
  }, [storedConfirmList, assetAddresses, marketplaceDispatch, navigate]);

  useEffect(() => {
    if (orderHash && assetAddresses.length) {
      orderActions.waitForOrderEvent(orderDispatch, orderHash);
    } else {
      const timer = setTimeout(() => navigate(routes.Marketplace.url), 3000);
      return () => clearTimeout(timer); // Cleanup timeout
    }
  }, [orderHash, assetAddresses, orderDispatch, navigate]);

  useEffect(() => {
    const errorMsg = query.get('error');
    if (errorMsg) setError(new Error(errorMsg));
  }, [query]);

  useEffect(() => {
    if (!isOrderEventLoading && orderHash && assetAddresses.length) {
      getCartData();
    }
  }, [isOrderEventLoading, orderHash, assetAddresses, getCartData]);

  const openNotification = useCallback(
    (type, placement, content) => {
      api[type]({
        message: content,
        onClose: type === 'error' ? () => setError(null) : undefined,
        placement,
        key: type === 'error' ? 2 : 1,
      });
    },
    [api]
  );

  useEffect(() => {
    if (error) openNotification('error', 'bottom', error.message);
  }, [error, openNotification]);

  useEffect(() => {
    if (message) {
      const notificationType = success ? 'success' : 'error';
      openNotification(notificationType, 'bottom', message);
      orderActions.resetMessage(orderDispatch);
    }
  }, [message, success, openNotification, orderDispatch]);

  return (
    <div>
      {contextHolder}
      <div className="h-96 flex flex-col justify-center items-center">
        <Spin spinning={true} size="large" />
        <p className="mt-4">Please wait while your order is being processed</p>
      </div>
    </div>
  );
};

export default ProcessingOrder;
