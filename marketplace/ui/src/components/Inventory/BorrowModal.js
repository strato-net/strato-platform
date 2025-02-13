import { Button, Modal, Tooltip, InputNumber } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect, useState, useMemo } from 'react';

import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';
import BigNumber from 'bignumber.js';

const logo = <img src={Images.USDST} alt={''} title={''} className="w-5 h-5" />;

/**
 * Helper to compute total collateral quantity from inventory.
 * Includes checking for unique escrow addresses and summing collateral.
 */
function computeTotalCollateralQuantity(inventory, decimalFactor) {
  // If no inventory, return 0 as a BigNumber
  if (!inventory) return new BigNumber(0);

  let collateralQuantity = new BigNumber(0);
  const uniqueEscrows = new Set();

  if (
    Array.isArray(inventory.inventories) &&
    inventory.inventories.length > 0
  ) {
    // Sum unique escrow collateral quantities from all inventories
    collateralQuantity = inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      // Create a BigNumber from the collateral quantity (or 0 if missing)
      const escrowCollateral = new BigNumber(
        item?.escrow?.collateralQuantity || 0
      );

      if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
        uniqueEscrows.add(escrowAddress);
        return sum.plus(escrowCollateral);
      }
      return sum;
    }, new BigNumber(0));
  } else if (inventory?.escrow?.collateralQuantity) {
    // Fallback if inventories array doesn't exist:
    const escrowCollateral = new BigNumber(
      inventory.escrow.collateralQuantity || 0
    );
    const invQuantity = new BigNumber(inventory.quantity || 0);
    // Use the smaller of the two values:
    collateralQuantity = escrowCollateral.gt(invQuantity)
      ? invQuantity
      : escrowCollateral;
  }

  if (decimalFactor.gt(0)) {
    collateralQuantity = collateralQuantity.dividedBy(decimalFactor);
  }

  return collateralQuantity;
}

/**
 * Computes collateralValue for display. If `inventories` exist, sum unique escrows.
 * Otherwise, proportionally allocate based on (inventory.quantity / totalCollateralQuantity).
 */
function computeCollateralValue(inventory, totalCollateralQuantity) {
  if (!inventory) return new BigNumber(0);

  const uniqueEscrows = new Set();

  if (Array.isArray(inventory.inventories)) {
    return inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      const escrowCollateralValue = new BigNumber(
        item?.escrow?.collateralValue || 0
      );

      if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
        uniqueEscrows.add(escrowAddress);
        return sum.plus(escrowCollateralValue);
      }
      return sum;
    }, new BigNumber(0));
  }

  const invQuantity = new BigNumber(inventory.quantity || 0);
  const escrowCollateralValue = new BigNumber(
    inventory?.escrow?.collateralValue || 0
  );
  const totalCollateralBN = new BigNumber(totalCollateralQuantity || 1);

  return escrowCollateralValue
    .multipliedBy(invQuantity.dividedBy(totalCollateralBN))
    .toString();
}

/**
 * Computes borrowed amount, ensuring uniqueness by escrow address.
 */
function computeBorrowedAmount(inventory) {
  if (!inventory) return 0;

  const uniqueBorrowedAddresses = new Set();
  if (Array.isArray(inventory.inventories)) {
    return inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      const borrowedValue = parseFloat(item?.escrow?.borrowedAmount) || 0;
      if (escrowAddress && !uniqueBorrowedAddresses.has(escrowAddress)) {
        uniqueBorrowedAddresses.add(escrowAddress);
        return sum + borrowedValue;
      }
      return sum;
    }, 0);
  }

  return parseFloat(inventory?.escrow?.borrowedAmount) || 0;
}

/**
 * Compute ESCROW addresses array.
 */
function computeEscrows(inventory) {
  if (inventory?.inventories) {
    return [
      ...new Set(
        inventory.inventories
          .map((item) => item?.escrow?.address)
          .filter(Boolean)
      ),
    ];
  }
  if (inventory?.escrow?.address) {
    return [inventory.escrow.address];
  }
  return [];
}

/**
 * BorrowModal component
 */
const BorrowModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  productDetailPage,
  assetsWithEighteenDecimalPlaces,
}) => {
  const { isReservesLoading, reserves, isBorrowing } = useInventoryState();
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const isStaked = inventory.sale && inventory.price <= 0;
  const decimalFactor = new BigNumber(10).pow(
    assetsWithEighteenDecimalPlaces?.includes(inventory.root)
      ? 18
      : inventory.decimals || 0
  );

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const totalCollateralQuantity = useMemo(
    () => computeTotalCollateralQuantity(inventory, decimalFactor),
    [inventory]
  );

  const collateralValue = useMemo(
    () => computeCollateralValue(inventory, totalCollateralQuantity),
    [inventory, totalCollateralQuantity]
  );

  const borrowedAmount = useMemo(
    () => computeBorrowedAmount(inventory),
    [inventory]
  );

  const matchedReserve = useMemo(() => {
    if (reserves?.length && inventory?.root) {
      return reserves.find(
        (reserve) => reserve.assetRootAddress === inventory.root
      );
    }
    return null;
  }, [reserves, inventory?.root]);

  // Compute final displayed values after scaling:
  // The code divides these values by 100 or 10000 for display:
  // collateralValue is displayed as `collateralValue / 10000`
  // borrowedAmount and loanableAmount as `... / 100`
  // We'll keep the same formatting after scaling by 1e18.
  const LTV = matchedReserve?.name.toLowerCase().includes('ethst') ? 0.3 : 0.5;
  const maxBorrowableAmount = Math.floor(collateralValue * LTV);
  const loanableAmount =
    maxBorrowableAmount >= borrowedAmount
      ? maxBorrowableAmount - borrowedAmount
      : 0;

  const marketValueDisplay = (collateralValue / Math.pow(10, 18)).toFixed(2);
  const borrowedAmountDisplay = (borrowedAmount / Math.pow(10, 18)).toFixed(2);
  const loanableAmountDisplay = (loanableAmount / Math.pow(10, 18)).toFixed(2);

  // Desired loan amount in USDST
  const [desiredLoanAmount, setDesiredLoanAmount] = useState(
    (loanableAmount / Math.pow(10, 18)).toFixed(2) || 0
  );

  useEffect(() => {
    if (
      reserves &&
      inventory.data &&
      !isReservesLoading &&
      isStaked &&
      matchedReserve
    ) {
      inventoryActions.getOracle(inventoryDispatch, matchedReserve.oracle);
    }
  }, [
    matchedReserve,
    reserves,
    inventory,
    isReservesLoading,
    isStaked,
    inventoryDispatch,
  ]);

  const escrows = useMemo(() => computeEscrows(inventory), [inventory]);

  const dataForItems = [
    {
      label: `Market Value`,
      description:
        ' The total value of your staked assets, calculated as Quantity x Oracle Price.',
      value: `$${marketValueDisplay}`,
    },
    {
      label: 'Max LTV',
      description: `Indicates you can borrow up to ${
        LTV * 100
      }% of the market value of your staked RWAs.`,
      value: `${LTV * 100}%`,
    },
    {
      label: 'Outstanding Loan (in USDST)',
      description:
        'The total amount of USDST tokens you have borrowed against your staked RWAs.',
      value: (
        <div className="flex">
          <div className="mx-1">{logo}</div>
          {borrowedAmountDisplay}
        </div>
      ),
    },
    {
      label: 'Estimated Available Loan (in USDST)',
      description:
        'The projected amount of USDST tokens you can borrow against your staked RWAs.',
      value: (
        <div className="flex">
          <div className="mx-1">{logo}</div>
          {loanableAmountDisplay}
        </div>
      ),
    },
    {
      label: 'Desired Loan Amount',
      description: 'Enter the amount of USDST you want to borrow.',
      value: (
        <>
          <InputNumber
            prefix={logo}
            min={0}
            step={1}
            value={desiredLoanAmount}
            onChange={(value) => setDesiredLoanAmount(value || 0)}
            className="w-full"
            precision={2}
            controls={false}
          />
          {desiredLoanAmount > parseFloat(loanableAmountDisplay) && (
            <p className="text-xs" style={{ color: '#f56565' }}>
              *Quantity exceeds available quantity of {loanableAmountDisplay}
            </p>
          )}
        </>
      ),
    },
  ];

  const dataForSummary = [];

  const handleSubmit = async () => {
    const loanAmount = new BigNumber(desiredLoanAmount);

    const body = {
      escrowAddresses: escrows,
      borrowAmount: loanAmount.multipliedBy(new BigNumber(10).pow(18)),
      reserve: matchedReserve?.address,
    };

    const borrowed = await inventoryActions.borrow(inventoryDispatch, body);
    if (borrowed) {
      handleCancel();
      if (productDetailPage) {
        await inventoryActions.fetchInventoryDetail(
          inventoryDispatch,
          productDetailPage
        );
      } else {
        const isStakePage =
          queryParams.get('st') === 'true' ||
          window.location.pathname === '/stake';
        await inventoryActions.fetchInventory(
          inventoryDispatch,
          limit,
          offset,
          debouncedSearchTerm,
          category && category !== 'All' ? category : undefined,
          isStakePage ? reserves.map((res) => res.assetRootAddress) : ''
        );
      }
      await inventoryActions.getAllReserve(inventoryDispatch);
      await inventoryActions.getUserCataRewards(inventoryDispatch);
      await marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={
        <div className="text-2xl md:text-3xl font-bold pl-4">
          Borrow Position
        </div>
      }
      width={600}
      centered
      footer={null}
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
              loading={isBorrowing}
              disabled={
                desiredLoanAmount <= 0 ||
                desiredLoanAmount > parseFloat(loanableAmountDisplay)
              }
            >
              Borrow
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

export default BorrowModal;
