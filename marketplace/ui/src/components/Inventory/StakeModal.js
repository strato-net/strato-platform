import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';

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
  const escrows = Array.isArray(inventory?.escrow)
    ? inventory.escrow.map((item) => item.address)
    : [inventory?.escrow?.address];
  const collateralQuantity = Array.isArray(inventory.escrow)
    ? inventory.escrow.reduce(
        (sum, item) => sum + (item.collateralQuantity || 0),
        0
      )
    : inventory?.escrow?.collateralQuantity || 0;
  const saleQuantity = inventory?.saleQuantity || 0;
  const stakeQuantity = inventory?.quantity - collateralQuantity - saleQuantity;

  const dataForItems =
    type === 'Stake'
      ? [
          {
            label: `Quantity to Stake`,
            description:
              'The amount of Real World Assets (RWAs) you are staking.',
            value: stakeQuantity,
          },
          {
            label: `Market Value`,
            description:
              'The total value of your staked assets, calculated as Quantity x Oracle Price.',
            value: `$${(
              matchedReserve?.lastUpdatedOraclePrice * stakeQuantity
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
                  (stakeQuantity *
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
            label: `Quantity to Unstake`,
            description:
              'The amount of Real World Assets (RWAs) you are unstaking.',
            value: `${collateralQuantity}`,
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
        escrowAddress: escrows
          ? escrows[0]
          : '0000000000000000000000000000000000000000',
        collateralQuantity: inventory?.quantity - collateralQuantity,
        assets:
          inventory && Array.isArray(inventory.address)
        ? inventory.address
            .filter((item) => !item.sale) // Keep only items without a sale
            .map((item) => item.address) // Extract the address
        : [inventory.address], // Handle the case where address is not an array
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
        quantity: collateralQuantity,
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
              disabled={isLoader}
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
