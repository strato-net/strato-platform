import React, { useState } from 'react';
import { Button } from 'antd';
import {
  RiseOutlined,
  LogoutOutlined,
  BankOutlined,
  SolutionOutlined,
} from '@ant-design/icons';
import { ASSET_STATUS } from '../../helpers/constants';
import StakeModal from './StakeModal';
import BorrowModal from './BorrowModal';
import RepayModal from './RepayModal';

const StakeItemActions = ({
  inventory,
  limit,
  offset,
  debouncedSearchTerm,
  category,
  reserves,
  assetsWithEighteenDecimalPlaces,
}) => {
  const [stakeType, setStakeType] = useState('Stake');
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);

  // Calculate collateralQuantity
  const uniqueEscrows = new Set();
  let collateralQuantity = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const escrowCollateral = item?.escrow?.collateralQuantity || 0;
        if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
          uniqueEscrows.add(escrowAddress);
          return sum + escrowCollateral;
        }
        return sum;
      }, 0)
    : inventory?.escrow?.collateralQuantity > inventory?.quantity
    ? inventory?.quantity
    : inventory?.escrow?.collateralQuantity || 0;

  // Calculate quantityNotAvailable
  let quantityNotAvailable = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const status = Number(item.status);
        if (status && status !== ASSET_STATUS.ACTIVE) {
          return sum + (item.quantity || 0);
        }
        return sum;
      }, 0) + (inventory.totalSaleQuantity || 0)
    : inventory?.status && Number(inventory?.status) !== ASSET_STATUS.ACTIVE
    ? (inventory?.quantity || 0) + (inventory?.saleQuantity || 0)
    : 0;

  // Calculate quantity
  let quantity = inventory?.inventories
    ? inventory.totalQuantity
    : assetsWithEighteenDecimalPlaces.includes(inventory?.root || '')
    ? inventory?.quantity / 1e18
    : inventory?.quantity || 0;

  // stakeQuantity = quantity - collateralQuantity - quantityNotAvailable (will recompute after scaling)
  // Calculate collateralValue
  const uniqueEscrowsPrime = new Set();
  let collateralValue = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const escrowCollateralValue = item?.escrow?.collateralValue || 0;
        if (escrowAddress && !uniqueEscrowsPrime.has(escrowAddress)) {
          uniqueEscrowsPrime.add(escrowAddress);
          return sum + escrowCollateralValue;
        }
        return sum;
      }, 0)
    : 0;

  // maxBorrowableAmount = floor(collateralValue / 2) (will recompute after scaling)
  // Calculate borrowedAmount
  const uniqueBorrowedAddresses = new Set();
  let borrowAmount = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const borrowedValue = item?.escrow?.borrowedAmount || 0;
        if (escrowAddress && !uniqueBorrowedAddresses.has(escrowAddress)) {
          uniqueBorrowedAddresses.add(escrowAddress);
          return sum + borrowedValue;
        }
        return sum;
      }, 0)
    : inventory?.escrow?.borrowedAmount || 0;

  /**
   * If the inventory.root is in assetsWithEighteenDecimalPlaces, we need to scale down values by 1e18.
   * This matches the logic used in StakeModal and BorrowModal.
   */
  const requiresDivision = assetsWithEighteenDecimalPlaces.includes(
    inventory?.root || ''
  );

  if (requiresDivision) {
    collateralQuantity /= 1e18;
    quantityNotAvailable /= 1e18;
  }

  // Recompute stakeQuantity after possible scaling
  const stakeQuantity = quantity - collateralQuantity - quantityNotAvailable;

  // Recompute maxBorrowableAmount after scaling
  const maxBorrowableAmount = Math.floor(collateralValue / 2);

  const showStakeModal = (type) => {
    setStakeModalOpen(true);
    setStakeType(type);
  };

  const handleStakeModalClose = () => {
    setStakeModalOpen(false);
  };

  const showBorrowModal = () => {
    setBorrowModalOpen(true);
  };

  const handleBorrowModalClose = () => {
    setBorrowModalOpen(false);
  };

  const showRepayModal = () => {
    setRepayModalOpen(true);
  };

  const handleRepayModalClose = () => {
    setRepayModalOpen(false);
  };

  return (
    <div className="flex justify-center w-full">
      <div className="flex justify-center gap-3">
        <Button
          type="primary"
          className="font-semibold flex items-center justify-center"
          onClick={() => showStakeModal('Stake')}
          disabled={stakeQuantity <= 0}
        >
          <RiseOutlined /> Stake
        </Button>
        <Button
          type="link"
          className="text-[#13188A] font-semibold"
          onClick={() => showStakeModal('Unstake')}
          disabled={borrowAmount > 0 || collateralQuantity <= 0}
        >
          <LogoutOutlined /> Unstake
        </Button>
        <Button
          type="link"
          className="text-[#13188A] font-semibold"
          onClick={() => showBorrowModal()}
          disabled={
            borrowAmount >= maxBorrowableAmount || collateralQuantity <= 0
          }
        >
          <BankOutlined /> Borrow
        </Button>
        <Button
          type="link"
          className="text-[#13188A] font-semibold"
          onClick={() => showRepayModal()}
          disabled={borrowAmount <= 0}
        >
          <SolutionOutlined />
          Repay
        </Button>
      </div>
      {stakeModalOpen && (
        <StakeModal
          open={stakeModalOpen}
          type={stakeType}
          handleCancel={handleStakeModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          saleAddress={inventory.saleAddress}
          category={category}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {borrowModalOpen && (
        <BorrowModal
          open={borrowModalOpen}
          handleCancel={handleBorrowModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          saleAddress={inventory.saleAddress}
          category={category}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {repayModalOpen && (
        <RepayModal
          open={repayModalOpen}
          handleCancel={handleRepayModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          saleAddress={inventory.saleAddress}
          category={category}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
    </div>
  );
};

export default StakeItemActions;
