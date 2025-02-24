import { Button, Modal, Tooltip, InputNumber } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';
import { BigNumber } from 'bignumber.js';

const logo = (
  <img src={Images.USDST} alt="USDST Logo" title="USDST" className="w-5 h-5" />
);

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
}) => {
  const { isRepaying } = useInventoryState();
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const { USDST, isFetchingUSDST } = useMarketplaceState();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  // Initialize state as BigNumber instances.
  const [repayAmount, setRepayAmount] = useState(new BigNumber(0)); // outstanding loan amount (in tokens)
  const [repayValue, setRepayValue] = useState(new BigNumber(0)); // amount the user wants to repay (in tokens)
  const [disableButton, setDisableButton] = useState(false);
  // Flag to set initial values only once per modal open.
  const [initialized, setInitialized] = useState(false);

  // Determine escrow addresses.
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
    if (inventory && USDST && !initialized && open) {
      // Use BigNumber throughout for precision.
      const uniqueEscrowsPrime = new Set();
      const totalCollateralQuantity = inventory?.inventories
        ? inventory.inventories.reduce((sum, item) => {
            const escrowAddress = item?.escrow?.address;
            // Wrap collateral quantity in BigNumber.
            const escrowCollateral = new BigNumber(
              item?.escrow?.collateralQuantity || 0
            );
            if (escrowAddress && !uniqueEscrowsPrime.has(escrowAddress)) {
              uniqueEscrowsPrime.add(escrowAddress);
              return sum.plus(escrowCollateral);
            }
            return sum;
          }, new BigNumber(0))
        : new BigNumber(inventory?.escrow?.collateralQuantity || 0);

      const uniqueBorrowedAddresses = new Set();
      const borrowedAmount = inventory?.inventories
        ? inventory.inventories.reduce((sum, item) => {
            const escrowAddress = item?.escrow?.address;
            // Convert borrowedAmount from its smallest unit to tokens (dividing by 10^18)
            const borrowedValue = new BigNumber(
              item?.escrow?.borrowedAmount || 0
            ).dividedBy(new BigNumber(10).pow(18));
            if (escrowAddress && !uniqueBorrowedAddresses.has(escrowAddress)) {
              uniqueBorrowedAddresses.add(escrowAddress);
              return sum.plus(borrowedValue);
            }
            return sum;
          }, new BigNumber(0))
        : // If not an inventory list, assume a single escrow.
          new BigNumber(inventory?.escrow?.borrowedAmount || 0)
            .dividedBy(new BigNumber(10).pow(18))
            .multipliedBy(
              new BigNumber(inventory?.quantity || 0).dividedBy(
                totalCollateralQuantity
              )
            );

      const USDSTBalance = USDST ? new BigNumber(USDST) : new BigNumber(0);

      // Set the outstanding loan amount.
      setRepayAmount(borrowedAmount);

      // Set the repay amount to the lower of the outstanding loan or the user's USDST balance.
      if (borrowedAmount.gt(USDSTBalance)) {
        setRepayValue(USDSTBalance);
      } else {
        setRepayValue(borrowedAmount);
      }
      setInitialized(true);
      setDisableButton(USDSTBalance.lte(0));
    }
  }, [open, initialized, USDST, inventory]);

  // Reset initialization flag when modal closes.
  useEffect(() => {
    if (!open) {
      setInitialized(false);
    }
  }, [open]);

  useEffect(() => {
    marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
  }, []);

  const dataForItems = [
    {
      label: `Outstanding Loan Amount in USDST`,
      description: 'The amount of USDST needed to fully pay off the loan',
      value: (
        <div className="flex -mr-1">
          {logo} &nbsp;
          {Number(repayAmount).toLocaleString('en-US', {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2,
          })}
        </div>
      ),
    },
    {
      label: `Loan to pay off in USDST`,
      description: 'The amount of USDST you want to pay toward the loan',
      value: (
        <>
          <InputNumber
            // Convert BigNumber to a native number for display.
            value={Number(repayValue).toLocaleString('en-US', {
              maximumFractionDigits: 2,
              minimumFractionDigits: 2,
            })}
            onChange={(value) => {
              if (value === null) {
                setRepayValue(new BigNumber(0));
                return;
              }
              const newValue = new BigNumber(parseFloat(value).toFixed(2));
              setRepayValue(newValue);
            }}
            prefix={logo}
            className="w-full"
            min={0}
            precision={2}
            step={1}
            controls={false}
          />
          {repayValue > parseFloat(repayAmount.toNumber()) && (
            <p className="text-xs" style={{ color: '#f56565' }}>
              *Quantity exceeds available quantity of {(repayAmount.toNumber()).toFixed(2)}
            </p>
          )}
        </>
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
      value: repayValue.multipliedBy(new BigNumber(10).pow(18)).toFixed(0),
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
              disabled={disableButton || repayValue > parseFloat(repayAmount.toNumber()) || repayValue.lte(0)}
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
