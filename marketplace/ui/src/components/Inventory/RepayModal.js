import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';

import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';

const logo = <img src={Images.USDST} alt={''} title={''} className="w-5 h-5" />;

const RepayModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  productDetailPage,
  reserves,
  assetsWithEighteenDecimalPlaces,
}) => {
  const { isRepaying } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const paymentServiceDispatch = usePaymentServiceDispatch();

  const { paymentServices } = usePaymentServiceState();
  const { USDST, isFetchingUSDST } = useMarketplaceState();
  const isStaked = inventory.sale && inventory.price <= 0;
  const itemName = decodeURIComponent(inventory.name);
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const [repayAmount, setRepayAmount] = useState(0);
  const [disableButton, setDisableButton] = useState(false);
  const escrows = inventory?.inventories
    ? [
        ...new Set(
          inventory.inventories
            .map((item) => item?.escrow?.address)
            .filter(Boolean)
        ),
      ]
    : inventory?.escrow?.address
    ? [inventory.escrow.address]
    : [];

  useEffect(() => {
    if (inventory && USDST) {
      const uniqueEscrowsPrime = new Set();
      const totalCollateralQuantity = inventory?.inventories
        ? inventory.inventories.reduce((sum, item) => {
            const escrowAddress = item?.escrow?.address;
            const escrowCollateral = item?.escrow?.collateralQuantity || 0;

            // Add collateral only if the escrow address is unique
            if (escrowAddress && !uniqueEscrowsPrime.has(escrowAddress)) {
              uniqueEscrowsPrime.add(escrowAddress);
              return sum + escrowCollateral;
            }

            return sum;
          }, 0)
        : inventory?.escrow?.collateralQuantity;
      const uniqueBorrowedAddresses = new Set();
      const borrowedAmount = inventory?.inventories
        ? inventory.inventories.reduce((sum, item) => {
            const escrowAddress = item?.escrow?.address;
            const borrowedValue =
              item?.escrow?.borrowedAmount / Math.pow(10, 18) || 0;

            // Add borrowed amount only if the escrow address is unique
            if (escrowAddress && !uniqueBorrowedAddresses.has(escrowAddress)) {
              uniqueBorrowedAddresses.add(escrowAddress);
              return sum + borrowedValue;
            }

            return sum;
          }, 0)
        : (inventory?.escrow?.borrowedAmount / Math.pow(10, 18)) *
          (inventory?.quantity / totalCollateralQuantity);
      const USDSTBalance =
        Object.keys(USDST).length > 0 ? USDST * Math.pow(10, 18) : 0;
      setRepayAmount(borrowedAmount);
      if (borrowedAmount > USDSTBalance) {
        setDisableButton(true);
      }
    }
  }, [USDST, inventory]);

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
    marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
  }, []);

  const dataForItems = [
    {
      label: `Loan to pay off in USDST`,
      description: 'The amount of USDST to pay off the loan',
      value: (
        <div className="flex -mr-1">
          {logo} &nbsp;
          {repayAmount.toFixed(2)}
        </div>
      ),
    },
  ];

  const dataForSummary = [];

  const handleSubmit = async () => {
    const matchedReserve = reserves?.length
      ? reserves.find((reserve) => reserve.assetRootAddress === inventory.root)
      : null;
    const body = {
      escrows,
      reserve: matchedReserve?.address,
    };

    const repayed = await inventoryActions.repay(inventoryDispatch, body);
    if (repayed) {
      handleCancel();
      if (productDetailPage) {
        await inventoryActions.fetchInventoryDetail(
          inventoryDispatch,
          productDetailPage
        );
      } else {
        await inventoryActions.fetchInventory(
          inventoryDispatch,
          limit,
          offset,
          debouncedSearchTerm,
          category && category !== 'All' ? category : undefined,
          queryParams.get('st') === 'true' ||
            window.location.pathname === '/stake'
            ? reserves.map((reserve) => reserve.assetRootAddress)
            : ''
        );
        await inventoryActions.getAllReserve(inventoryDispatch);
        await inventoryActions.getUserCataRewards(inventoryDispatch);
      }
      await marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={
        <div className="text-2xl md:text-3xl font-bold pl-4">Loan Position</div>
      }
      width={600}
      centered
      footer={null}
      loading={isFetchingUSDST}
    >
      <div className="flex flex-col px-4 pt-4">
        <div className="flex flex-col gap-2">
          {dataForItems.map((item, index) => (
            <div key={index} className="w-full flex justify-between">
              <div className="flex items-center">
                <p className="text-sm text-gray-500">
                  <strong>{item.label}</strong>
                </p>
                <Tooltip title={item.description}>
                  <QuestionCircleOutlined className="ml-1 text-gray-400 cursor-pointer" />
                </Tooltip>
              </div>
              <p className="flex items-center">
                <strong>{item.value}</strong>
              </p>
            </div>
          ))}

          <div className="flex justify-center w-full">
            <Button
              type="primary"
              className="w-full px-6 h-10 font-bold"
              onClick={handleSubmit}
              loading={isRepaying}
              disabled={disableButton}
            >
              Repay
            </Button>
          </div>
        </div>
        <div className="w-full flex flex-col justify-between mt-4 text-xs">
          {dataForSummary.map((item, index) => (
            <div key={index} className="w-full flex justify-between">
              <div className="flex items-center">
                <p>{item.label}</p>
                <Tooltip title={item.description}>
                  <QuestionCircleOutlined className="ml-1 text-gray-400 cursor-pointer" />
                </Tooltip>
              </div>
              <p className="flex items-center">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default RepayModal;
