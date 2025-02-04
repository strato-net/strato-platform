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
function computeTotalCollateralQuantity(inventory) {
  if (!inventory) return 0;

  const uniqueEscrowsPrime = new Set();
  if (Array.isArray(inventory.inventories)) {
    return inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      const escrowCollateral =
        parseFloat(item?.escrow?.collateralQuantity) || 0;
      if (escrowAddress && !uniqueEscrowsPrime.has(escrowAddress)) {
        uniqueEscrowsPrime.add(escrowAddress);
        return sum + escrowCollateral;
      }
      return sum;
    }, 0);
  }

  return parseFloat(inventory?.escrow?.collateralQuantity) || 0;
}

/**
 * Computes total collateral value, ensuring uniqueness by escrow address.
 */
function computeTotalCollateralValue(inventory) {
  if (!inventory) return 0;

  const uniqueEscrowsThird = new Set();
  if (Array.isArray(inventory.inventories)) {
    return inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      const escrowCollateralValue =
        parseFloat(item?.escrow?.collateralValue) || 0;
      if (escrowAddress && !uniqueEscrowsThird.has(escrowAddress)) {
        uniqueEscrowsThird.add(escrowAddress);
        return sum + escrowCollateralValue;
      }
      return sum;
    }, 0);
  }

  return parseFloat(inventory?.escrow?.collateralValue) || 0;
}

/**
 * Computes collateralValue for display. If `inventories` exist, sum unique escrows.
 * Otherwise, proportionally allocate based on (inventory.quantity / totalCollateralQuantity).
 */
function computeCollateralValue(inventory, totalCollateralQuantity) {
  if (!inventory) return 0;

  const uniqueEscrows = new Set();
  if (Array.isArray(inventory.inventories)) {
    return inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      const escrowCollateralValue =
        parseFloat(item?.escrow?.collateralValue) || 0;
      if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
        uniqueEscrows.add(escrowAddress);
        return sum + escrowCollateralValue;
      }
      return sum;
    }, 0);
  }

  const invQuantity = parseFloat(inventory.quantity) || 0;
  const escrowCollateralValue =
    parseFloat(inventory?.escrow?.collateralValue) || 0;
  return escrowCollateralValue * (invQuantity / totalCollateralQuantity || 1);
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
 * Applies 1e18 scaling if the root is in the provided array.
 * This matches the logic done in the StakeModal for 18 decimal places.
 */
function applyDecimalScaling(
  inventory,
  assetsWithEighteenDecimalPlaces,
  values
) {
  if (inventory && assetsWithEighteenDecimalPlaces.includes(inventory.root)) {
    // If root requires division by 1e18, scale these values accordingly
    const scaled = {};
    for (const key in values) {
      // Divide the raw value by 1e18 to normalize
      scaled[key] = values[key] / 1e18;
    }
    return scaled;
  }
  return values;
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

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const totalCollateralQuantity = useMemo(
    () => computeTotalCollateralQuantity(inventory),
    [inventory]
  );

  const totalCollateralValue = useMemo(
    () => computeTotalCollateralValue(inventory),
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

  // Apply scaling if needed (similar to StakeModal logic)
  // const scaledValues = useMemo(() => {
  //   return applyDecimalScaling(inventory, assetsWithEighteenDecimalPlaces, {
  //     collateralValue,
  //     totalCollateralValue,
  //   });
  // }, [inventory, assetsWithEighteenDecimalPlaces, collateralValue, totalCollateralValue]);

  // const { collateralValue: scaledCollateralValue, totalCollateralValue: scaledTotalCollateralValue } = scaledValues;

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

  // For display:
  // `Market Value` = collateralValue / 10000
  // `borrowedAmount` and `loanableAmount` are displayed /100

  const marketValueDisplay = (collateralValue / Math.pow(10,18)).toFixed(2)
  const borrowedAmountDisplay = (borrowedAmount / Math.pow(10, 18)).toFixed(2);
  const loanableAmountDisplay = (loanableAmount / Math.pow(10,18)).toFixed(2);

  // Desired loan amount in USDST
  const [desiredLoanAmount, setDesiredLoanAmount] = useState(((loanableAmount/Math.pow(10,18)).toFixed(2) || 0));

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
      description: `Indicates you can borrow up to ${LTV*100}% of the market value of your staked RWAs.`,
      value: `${LTV*100}%`,
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
            <p
              className="text-xs"
              style={{color: '#f56565' }}
            >
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
      borrowAmount: loanAmount.multipliedBy(new BigNumber(10).pow(18)).toFixed(0),
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
