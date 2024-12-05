import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';

import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';

const logo = <img src={Images.strat} alt={''} title={''} className="w-5 h-5" />;

const BorrowModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  productDetailPage,
}) => {
  const { isReservesLoading, reserves, oracle, isBorrowing } =
    useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const isStaked = inventory.sale && inventory.price <= 0;
  const itemName = decodeURIComponent(inventory.name);
  const matchedReserve = reserves?.length
    ? reserves.find((reserve) => reserve.assetRootAddress === inventory.root)
    : null;
  const oracleData = oracle ? oracle : { consensusPrice: 0 };
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  useEffect(() => {
    if (reserves && inventory.data && !isReservesLoading && isStaked) {
      inventoryActions.getOracle(inventoryDispatch, matchedReserve.oracle);
    }
  }, [matchedReserve]);

  const dataForItems = [
    {
      label: `Market price (per unit)`,
      description:
        'The current price of one unit of your RWA, as determined by the oracle.',
      value: `$${matchedReserve.lastUpdatedOraclePrice.toFixed(2)}`,
    },
    {
      label: `Quantity`,
      description:
        'The amount of Real World Assets (RWAs) you are collateralizing.',
      value: `x ${inventory?.escrow?.collateralQuantity}`,
    },
    {
      label: `Market Value`,
      description:
        ' The total value of your staked assets, calculated as Quantity x Oracle Price.',
      value: ` = $${(inventory?.escrow?.collateralValue / 10000).toFixed(2)}`,
    },
    {
      label: 'Loan to Value Ratio',
      description:
        'Indicates you can borrow up to 50% of the market value of your staked RWAs.',
      value: `x ${matchedReserve?.loanToValueRatio}%`,
    },
    {
      label: 'Estimated Loan (in STRATs)',
      description:
        'The projected amount of STRAT tokens you can borrow against your staked RWAs.',
      value: (
        <div className="flex -mr-1">
          =<div className="mx-1">{logo}</div>{' '}
          {parseFloat(inventory?.escrow?.maxLoanAmount / 100).toFixed(2)}
        </div>
      ),
    },
  ];

  const dataForSummary = [];

  const handleSubmit = async () => {
    const body = {
      escrowAddress: inventory?.sale,
      borrowAmount: inventory?.escrow?.maxLoanAmount,
      reserve: matchedReserve?.address,
    };

    const borrowed = await inventoryActions.borrow(inventoryDispatch, body);
    if (borrowed) {
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
      }
      await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
      handleCancel();
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
