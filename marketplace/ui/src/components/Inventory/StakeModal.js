import { Button, Modal, Tooltip, InputNumber, Form } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';
import { ASSET_STATUS } from '../../helpers/constants';
import { useState } from 'react';

const logo = <img src={Images.cata} alt={''} title={''} className="w-5 h-5" />;

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
}) => {
  const { isStaking, isUnstaking, isReservesLoading, reserves } =
    useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const isLoader = isStaking || isUnstaking || isReservesLoading;
  const matchedReserve = reserves?.length
    ? reserves.find((reserve) => reserve.assetRootAddress === inventory.root)
    : null;
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

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
  const uniqueEscrows = new Set();
  const collateralQuantity = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const escrowCollateral = item?.escrow?.collateralQuantity || 0;

        // Add collateral only if the escrow address is unique
        if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
          uniqueEscrows.add(escrowAddress);
          return sum + escrowCollateral;
        }

        return sum;
      }, 0)
    : inventory?.escrow?.collateralQuantity > inventory?.quantity
    ? inventory?.quantity
    : inventory?.escrow?.collateralQuantity || 0;
  const quantityNotAvailable = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const status = Number(item.status);
        if (status && status !== ASSET_STATUS.ACTIVE) {
          return sum + (item.quantity || 0);
        }
        return sum;
      }, 0) + inventory.totalSaleQuantity
    : inventory?.status &&  Number(inventory?.status) !== ASSET_STATUS.ACTIVE
    ? inventory?.quantity + (inventory?.saleQuantity || 0)
    : 0;
  const quantity = inventory?.inventories
    ? inventory.totalQuantity
    : inventory?.quantity;
  const stakeQuantity = quantity - collateralQuantity - quantityNotAvailable;
  const allInventories = Array.isArray(inventory.inventories)
    ? inventory.inventories
    : [inventory];
  const assets = allInventories
    .filter((item) => {
      const status = item.status ? Number(item.status) : ASSET_STATUS.ACTIVE ;
      const saleQty = Number(item.saleQuantity) || 0;
      const collatertal = item?.escrow?.[
        'BlockApps-Mercata-Escrow-assets'
      ]?.find((escrow) => escrow.value === item.address)
        ? true
        : false;
      return status === ASSET_STATUS.ACTIVE && saleQty === 0 && !collatertal;
    })
    .map((item) => item.address)
    .filter(Boolean);
  const [inputQuantity, setInputQuantity] = useState(type === 'Stake' ? stakeQuantity : collateralQuantity);
  const handleInputChange = (value) => {
    setInputQuantity(value || 0); // Update the input value
  };

  const dataForItems =
    type === 'Stake'
      ? [
          {
            label: `Quantity Available to Stake`,
            description:
              'The amount of Real World Assets (RWAs) you have available for staking.',
            value: stakeQuantity,
          },
          {
            label: `Quantity to Stake`,
            description: 'Enter the amount of RWAs you want to stake.',
            value: (
              <>
                <InputNumber
                  min={0}
                  value={inputQuantity}
                  onChange={handleInputChange}
                  className="w-full"
                  controls={false}
                />

                {inputQuantity > stakeQuantity ? (
                  <p className="text-xs" style={{ color: 'red' }}>
                    *Quantity exceeds available quantity
                  </p>
                ) : null}
              </>
            ),
          },
          {
            label: `Market Value`,
            description:
              'The total value of your staked assets, calculated as Quantity x Oracle Price.',
            value: `$${(
              matchedReserve?.lastUpdatedOraclePrice * inputQuantity
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
                  (inputQuantity *
                    matchedReserve?.lastUpdatedOraclePrice *
                    (matchedReserve?.cataAPYRate / 10)) /
                  365
                ).toFixed(2)}
              </div>
            ),
          },
        ]
      : [
          {
            label: `Quantity Available to Unstake`,
            description:
              'The amount of Real World Assets (RWAs) available for unstaking.',
            value: `${collateralQuantity}`,
          },
          {
            label: `Quantity to Unstake`,
            description: 'Enter the amount of RWAs you want to unstake.',
            value: (
              <>
                <InputNumber
                  min={0}
                  value={inputQuantity}
                  onChange={handleInputChange}
                  className="w-full"
                  controls={false}
                />

                {inputQuantity > collateralQuantity ? (
                  <p className="text-xs" style={{ color: 'red' }}>
                    *Quantity exceeds available quantity
                  </p>
                ) : null}
              </>
            ),
          },
        ];

  const dataForSummary =
    type === 'Stake'
      ? [
          {
            label: `Market price (per unit)`,
            description:
              ' The current price of one unit of your RWA, as determined by the oracle.',
            value: `$${matchedReserve?.lastUpdatedOraclePrice.toFixed(2)}`,
          },
        ]
      : [];
  const handleSubmit = async () => {
    if (type === 'Stake') {
      const body = {
        escrowAddress:
          escrows && escrows.length > 0
            ? escrows[0]
            : '0000000000000000000000000000000000000000',
        collateralQuantity: inputQuantity,
        assets,
        reserve: matchedReserve?.address,
      };
      const isStaked = await inventoryActions.stakeInventory(
        inventoryDispatch,
        body
      );
      if (isStaked) {
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
        handleCancel();
      }
    }

    if (type === 'Unstake') {
      const body = {
        quantity: inputQuantity,
        escrowAddresses: escrows,
        reserve: matchedReserve?.address,
      };
      const isUnstaked = await inventoryActions.UnstakeInventory(
        inventoryDispatch,
        body
      );
      if (isUnstaked) {
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
          inventoryActions.getAllReserve(inventoryDispatch);
          inventoryActions.getUserCataRewards(inventoryDispatch);
        }
        handleCancel();
      }
    }
  };

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
              <p className="flex items-center justify-end">
                <strong>{item.value}</strong>
              </p>
            </div>
          ))}

          <div className="flex justify-center w-full">
            <Button
              type="primary"
              className="w-full px-6 h-10 font-bold"
              onClick={handleSubmit}
              disabled={
                isLoader ||
                inputQuantity === 0 ||
                (type === 'Stake'
                  ? inputQuantity > stakeQuantity
                  : inputQuantity > collateralQuantity)
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
              of your staked RWAs in STRAT tokens, our stablecoin, providing
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
