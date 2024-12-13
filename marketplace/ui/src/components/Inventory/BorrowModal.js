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
  const { isReservesLoading, reserves, isBorrowing } =
    useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const isStaked = inventory.sale && inventory.price <= 0;
  const itemName = decodeURIComponent(inventory.name);
  const matchedReserve = reserves?.length
    ? reserves.find((reserve) => reserve.assetRootAddress === inventory.root)
    : null;
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const escrowCollateralQuantity = Array.isArray(inventory.escrow)
    ? inventory.escrow.reduce(
        (sum, item) => sum + (item.collateralQuantity || 0),
        0
      )
    : inventory?.escrow?.collateralQuantity || 0;
  const collateralValue = Math.floor(
    Array.isArray(inventory.escrow)
      ? inventory.escrow.reduce(
          (sum, item) => sum + (item.collateralValue || 0),
          0
        )
      : (inventory?.escrow?.collateralValue || 0) *
          (inventory?.quantity / escrowCollateralQuantity)
  );
  const borrowedAmount = Array.isArray(inventory.escrow)
    ? inventory.escrow.reduce(
        (sum, item) => sum + (item.borrowedAmount || 0),
        0
      )
    : inventory?.escrow?.borrowedAmount || 0;
  const loanableAmount =
    Math.floor(collateralValue / 2) >= borrowedAmount
      ? Math.floor(collateralValue / 2) - borrowedAmount
      : 0;

  useEffect(() => {
    if (reserves && inventory.data && !isReservesLoading && isStaked) {
      inventoryActions.getOracle(inventoryDispatch, matchedReserve.oracle);
    }
  }, [matchedReserve]);

  const dataForItems = [
    {
      label: `Market Value`,
      description:
        ' The total value of your staked assets, calculated as Quantity x Oracle Price.',
      value: `$${(collateralValue / 10000).toFixed(2)}`,
    },
    {
      label: 'Maximum loan percentage',
      description:
        `Indicates you can borrow up to 50% of the market value of your staked RWAs.`,
      value: '50%',
    },
    {
      label: 'Estimated Loan (in STRATs)',
      description:
        'The projected amount of STRAT tokens you can borrow against your staked RWAs.',
      value: (
        <div className="flex -mr-1">
          <div className="mx-1">{logo}</div>{' '}
          {parseFloat(loanableAmount / 100).toFixed(2)}
        </div>
      ),
    },
  ];

  const dataForSummary = [];

  const handleSubmit = async () => {
    const body = {
      escrowAddresses: Array.isArray(inventory?.escrow) 
      ? inventory.escrow.map(item => item.address) 
      : [inventory?.escrow?.address],
      borrowAmount: loanableAmount,
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
      await inventoryActions.getAllReserve(inventoryDispatch);
      await inventoryActions.getUserCataRewards(inventoryDispatch);
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
