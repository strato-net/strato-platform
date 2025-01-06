import { Button, Modal, Tooltip, InputNumber } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';
import { ASSET_STATUS } from '../../helpers/constants';
import { useState, useMemo } from 'react';
import BigNumber from 'bignumber.js';

const logo = <img src={Images.cata} alt={''} title={''} className="w-5 h-5" />;

/**
 * Helper function to compute the total collateral quantity.
 * If `inventory.inventories` exists, we sum up unique escrow collateral quantities.
 * Otherwise, we use `inventory.escrow.collateralQuantity` directly (capped at inventory.quantity if it exceeds).
 */
function computeCollateralQuantity(inventory, is18DecimalPlaces) {
  if (!inventory) return 0;

  let collateralQuantity = 0;
  const uniqueEscrows = new Set();

  if (
    Array.isArray(inventory.inventories) &&
    inventory.inventories.length > 0
  ) {
    // Summation of unique escrow collateral from all inventories
    collateralQuantity = inventory.inventories.reduce((sum, item) => {
      const escrowAddress = item?.escrow?.address;
      const escrowCollateral =
        parseFloat(item?.escrow?.collateralQuantity) || 0;

      if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
        uniqueEscrows.add(escrowAddress);
        return sum + escrowCollateral;
      }
      return sum;
    }, 0);
  } else if (inventory?.escrow?.collateralQuantity) {
    // Fallback if inventories array doesn't exist
    const escrowCollateral =
      parseFloat(inventory.escrow.collateralQuantity) || 0;
    const invQuantity = parseFloat(inventory.quantity) || 0;
    collateralQuantity =
      escrowCollateral > invQuantity ? invQuantity : escrowCollateral;
  }

  // If root requires division by 1e18, normalize the collateral quantity
  if (is18DecimalPlaces) {
    collateralQuantity /= 1e18;
  }

  return collateralQuantity;
}

/**
 * Calculates the quantity that is not available for staking (due to status or sale).
 */
function computeQuantityNotAvailable(inventory) {
  if (!inventory) return 0;

  if (Array.isArray(inventory.inventories)) {
    return (
      inventory.inventories.reduce((sum, item) => {
        const status = Number(item.status);
        if (status && status !== ASSET_STATUS.ACTIVE) {
          return sum + (item.quantity || 0);
        }
        return sum;
      }, 0) + (inventory.totalSaleQuantity || 0)
    );
  } else {
    const status = Number(inventory.status);
    const saleQuantity = inventory.saleQuantity || 0;
    // If single inventory is not active
    return status && status !== ASSET_STATUS.ACTIVE
      ? (inventory.quantity || 0) + saleQuantity
      : 0;
  }
}

/**
 * Computes the total available stake quantity based on:
 * total quantity - collateralQuantity - quantityNotAvailable.
 */
function computeStakeQuantity(
  inventory,
  collateralQuantity,
  is18DecimalPlaces
) {
  const quantity = Array.isArray(inventory.inventories)
    ? inventory.totalQuantity
    : is18DecimalPlaces
    ? inventory?.quantity / 1e18
    : inventory?.quantity || 0;
  return quantity - collateralQuantity - computeQuantityNotAvailable(inventory);
}

/**
 * Retrieves active, non-collateralized, non-sale assets from the inventory.
 */
function computeAssets(inventory) {
  const allInventories = Array.isArray(inventory.inventories)
    ? inventory.inventories
    : [inventory];

  return allInventories
    .filter((item) => {
      const status = item.status ? Number(item.status) : ASSET_STATUS.ACTIVE;
      const saleQty = Number(item.saleQuantity) || 0;

      const hasCollateral = Boolean(
        item?.['BlockApps-Mercata-Escrow-assets']?.find(
          (escrow) => escrow.value === item.address
        )
      );

      // Include only active, non-sale, non-collateral items
      return status === ASSET_STATUS.ACTIVE && saleQty === 0 && !hasCollateral;
    })
    .map((item) => item.address)
    .filter(Boolean);
}

/**
 * Prepares the data for display items (either Stake or Unstake).
 * @param {string} type - "Stake" or "Unstake"
 */
function prepareDataForItems(
  type,
  stakeQuantity,
  collateralQuantity,
  inputQuantity,
  matchedReserve,
  logo,
  is18DecimalPlaces
) {
  if (type === 'Stake') {
    return [
      {
        label: 'Quantity Available to Stake',
        description:
          'The amount of Real World Assets (RWAs) you have available for staking.',
        value: stakeQuantity,
      },
      {
        label: 'Quantity to Stake',
        description: 'Enter the amount of RWAs you want to stake.',
        value: null, // Handled in UI
      },
      {
        label: 'Market Value',
        description:
          'The total value of your staked assets, calculated as Quantity x Oracle Price.',
        value: `$${(
          matchedReserve?.lastUpdatedOraclePrice *
          (is18DecimalPlaces ? inputQuantity * 1e18 : inputQuantity)
        ).toFixed(2)}`,
      },
      {
        label: 'Daily Estimated Reward (CATA)',
        description:
          'The expected daily earnings in CATA tokens from staking your RWAs.',
        value: (
          <div className="flex">
            <div className="mx-1">{logo}</div>
            {(
              ((is18DecimalPlaces ? inputQuantity * 1e18 : inputQuantity) *
                matchedReserve?.lastUpdatedOraclePrice *
                (matchedReserve?.cataAPYRate / 10)) /
              365
            ).toFixed(2)}
          </div>
        ),
      },
    ];
  }

  // Unstake
  return [
    {
      label: 'Quantity Available to Unstake',
      description:
        'The amount of Real World Assets (RWAs) available for unstaking.',
      value: `${collateralQuantity}`,
    },
    {
      label: 'Quantity to Unstake',
      description: 'Enter the amount of RWAs you want to unstake.',
      value: null, // Handled in UI
    },
  ];
}

/**
 * Prepares the data for the summary section (applicable when staking).
 */
function prepareDataForSummary(type, matchedReserve, is18DecimalPlaces) {
  if (type === 'Stake') {
    return [
      {
        label: 'Market price (per unit)',
        description:
          'The current price of one unit of your RWA, as determined by the oracle.',
        value: `$${(is18DecimalPlaces
          ? matchedReserve?.lastUpdatedOraclePrice * 1e18
          : matchedReserve?.lastUpdatedOraclePrice
        ).toFixed(2)}`,
      },
    ];
  }
  return [];
}

/**
 * The main StakeModal component.
 */
const StakeModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  type,
  productDetailPage,
  assetsWithEighteenDecimalPlaces,
}) => {
  const { isStaking, isUnstaking, isReservesLoading, reserves } =
    useInventoryState();
  const inventoryDispatch = useInventoryDispatch();
  const isLoader = isStaking || isUnstaking || isReservesLoading;
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces?.includes(
    inventory.root
  );

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const matchedReserve = useMemo(() => {
    if (reserves?.length) {
      return reserves.find(
        (reserve) => reserve.assetRootAddress === inventory.root
      );
    }
    return null;
  }, [reserves, inventory.root]);
  // Compute collateral quantity
  const collateralQuantity = useMemo(
    () => computeCollateralQuantity(inventory, is18DecimalPlaces),
    [inventory, is18DecimalPlaces]
  );

  // Compute stake quantity (only relevant for staking)
  const stakeQuantity = useMemo(
    () =>
      computeStakeQuantity(inventory, collateralQuantity, is18DecimalPlaces),
    [inventory, collateralQuantity]
  );

  // Compute assets for staking
  const assets = useMemo(() => computeAssets(inventory), [inventory]);

  const [inputQuantity, setInputQuantity] = useState(
    type === 'Stake' ? stakeQuantity : collateralQuantity
  );

  const handleInputChange = (value) => {
    setInputQuantity(value || 0);
  };

  const escrows = useMemo(() => {
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
  }, [inventory]);

  const dataForItems = prepareDataForItems(
    type,
    stakeQuantity,
    collateralQuantity,
    inputQuantity,
    matchedReserve,
    logo,
    is18DecimalPlaces
  );

  const dataForSummary = prepareDataForSummary(
    type,
    matchedReserve,
    is18DecimalPlaces
  );

  /**
   * Handles the stake or unstake action submission.
   */
  const handleSubmit = async () => {
    if (type === 'Stake') {
      const body = {
        escrowAddress:
          escrows && escrows.length > 0
            ? escrows[0]
            : '0000000000000000000000000000000000000000',
        collateralQuantity: (is18DecimalPlaces
          ? new BigNumber(inputQuantity).multipliedBy(new BigNumber(10).pow(18))
          : new BigNumber(inputQuantity)
        ).toFixed(0),
        assets,
        reserve: matchedReserve?.address,
      };

      const isStaked = await inventoryActions.stakeInventory(
        inventoryDispatch,
        body
      );
      if (isStaked) {
        await refreshDataAfterAction();
        handleCancel();
      }
    }

    if (type === 'Unstake') {
      const body = {
        quantity: (is18DecimalPlaces
          ? new BigNumber(inputQuantity).multipliedBy(new BigNumber(10).pow(18))
          : new BigNumber(inputQuantity)
        ).toFixed(0),
        escrowAddresses: escrows,
        reserve: matchedReserve?.address,
      };

      const isUnstaked = await inventoryActions.UnstakeInventory(
        inventoryDispatch,
        body
      );
      if (isUnstaked) {
        await refreshDataAfterAction();
        handleCancel();
      }
    }
  };

  /**
   * Refresh the inventory and reserve data after a successful stake/unstake action.
   */
  const refreshDataAfterAction = async () => {
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
        isStakePage ? reserves.map((reserve) => reserve.assetRootAddress) : ''
      );
      await inventoryActions.getAllReserve(inventoryDispatch);
      await inventoryActions.getUserCataRewards(inventoryDispatch);
    }
  };

  const maxAllowedQuantity =
    type === 'Stake' ? stakeQuantity : collateralQuantity;

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={
        <div className="text-2xl md:text-3xl font-bold pl-4">Collateral</div>
      }
      width={500}
      centered
      footer={null}
    >
      <div className="flex flex-col px-4 pt-4">
        <div className="flex flex-col gap-4">
          {dataForItems.map((item, index) => (
            <div
              key={index}
              className="w-full flex justify-between items-start"
            >
              <div className="flex items-center">
                <p className="text-sm text-gray-500">
                  <strong>{item.label}</strong>
                </p>
                <Tooltip title={item.description}>
                  <QuestionCircleOutlined className="ml-1 text-gray-400 cursor-pointer" />
                </Tooltip>
              </div>
              {item.value === null ? (
                <div className="flex flex-col items-end w-1/2">
                  <InputNumber
                    min={0}
                    value={inputQuantity}
                    onChange={handleInputChange}
                    className="w-full"
                    controls={false}
                  />
                  {inputQuantity > maxAllowedQuantity && (
                    <p className="text-xs" style={{ color: '#f56565' }}>
                      *Quantity exceeds available quantity of{' '}
                      {maxAllowedQuantity}
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex items-center justify-end">
                  <strong>{item.value}</strong>
                </p>
              )}
            </div>
          ))}

          <div className="flex justify-center w-full">
            <Button
              type="primary"
              className="w-full px-6 h-10 font-bold"
              onClick={handleSubmit}
              disabled={
                isLoader ||
                inputQuantity <= 0 ||
                inputQuantity > maxAllowedQuantity
              }
              loading={isLoader}
            >
              {type}
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
          <br />
          {type === 'Stake' && (
            <div>
              By staking your RWAs, you earn daily rewards in the form of CATA,
              our governance token. Additionally, you have the option to borrow
              (interest-free for a limited time!) up to 50% of the market value
              of your staked RWAs in USDST tokens, our stablecoin, providing
              immediate liquidity while your assets remain staked and continue
              to earn CATA rewards. If you prefer not to borrow, you can simply
              stake your RWAs to benefit from the daily CATA rewards.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default StakeModal;
