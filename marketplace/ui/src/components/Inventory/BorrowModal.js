import { Button, Modal, Tooltip, InputNumber } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

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
  const { isReservesLoading, reserves, isBorrowing } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const isStaked = inventory.sale && inventory.price <= 0;
  const itemName = decodeURIComponent(inventory.name);
  const [desiredLoanAmount, setDesiredLoanAmount] = useState(0);

  const handleLoanAmountChange = (value) => {
    setDesiredLoanAmount(value || 0);
  };
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
  const uniqueEscrowsThird = new Set();
  const totalCollateralValue = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const escrowCollateral = item?.escrow?.collateralValue || 0;

        // Add collateral only if the escrow address is unique
        if (escrowAddress && !uniqueEscrowsThird.has(escrowAddress)) {
          uniqueEscrowsThird.add(escrowAddress);
          return sum + escrowCollateral;
        }

        return sum;
      }, 0)
    : inventory?.escrow?.collateralValue || 0;
  const uniqueEscrows = new Set();
  const collateralValue = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const escrowCollateral = item?.escrow?.collateralValue || 0;

        // Add collateral only if the escrow address is unique
        if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
          uniqueEscrows.add(escrowAddress);
          return sum + escrowCollateral;
        }

        return sum;
      }, 0)
    : inventory?.escrow?.collateralValue *
        (inventory?.quantity / totalCollateralQuantity) || 0;
  const matchedReserve = reserves?.length
    ? reserves.find((reserve) => reserve.assetRootAddress === inventory.root)
    : null;
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const uniqueBorrowedAddresses = new Set();
  const borrowedAmount = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const borrowedValue = item?.escrow?.borrowedAmount || 0;

        // Add borrowed amount only if the escrow address is unique
        if (escrowAddress && !uniqueBorrowedAddresses.has(escrowAddress)) {
          uniqueBorrowedAddresses.add(escrowAddress);
          return sum + borrowedValue;
        }

        return sum;
      }, 0)
    : inventory?.escrow?.borrowedAmount || 0;
  const maxBorrowableAmount = Math.floor(totalCollateralValue / 2);
  const loanableAmount =
    maxBorrowableAmount >= borrowedAmount
      ? maxBorrowableAmount - borrowedAmount
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
      description: `Indicates you can borrow up to 50% of the market value of your staked RWAs.`,
      value: '50%',
    },
    {
      label: 'Outstanding Loan (in STRATs)',
      description:
        'The total amount of STRAT tokens you have borrowed against your staked RWAs.',
      value: (
        <div className="flex">
          <div className="mx-1">{logo}</div>{' '}
          {parseFloat(borrowedAmount / 100).toFixed(2)}
        </div>
      ),
    },
    {
      label: 'Estimated Available Loan (in STRATs)',
      description:
        'The projected amount of STRAT tokens you can borrow against your staked RWAs.',
      value: (
        <div className="flex">
          <div className="mx-1">{logo}</div>{' '}
          {parseFloat(loanableAmount / 100).toFixed(2)}
        </div>
      ),
    },
    {
      label: 'Desired Loan Amount',
      description: 'Enter the amount of STRATs you want to borrow.',
      value: (
        <InputNumber
          prefix={logo}
          min={0}
          max={loanableAmount / 100}
          step={0.01}
          value={desiredLoanAmount}
          onChange={handleLoanAmountChange}
          className="w-full"
          controls={false}
        />
      ),
    },
  ];

  const dataForSummary = [];

  const handleSubmit = async () => {
    const body = {
      escrowAddresses: escrows,
      borrowAmount: (desiredLoanAmount*100).toFixed(0),
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
