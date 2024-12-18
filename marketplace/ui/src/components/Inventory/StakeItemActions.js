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
}) => {
  const [stakeType, setStakeType] = useState('Stake');
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);

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
    : inventory?.status && Number(inventory?.status) !== ASSET_STATUS.ACTIVE
    ? inventory?.quantity + (inventory?.saleQuantity || 0)
    : 0;
  const quantity = inventory?.inventories
    ? inventory.totalQuantity
    : inventory?.quantity;
  const stakeQuantity = quantity - collateralQuantity - quantityNotAvailable;
  const uniqueEscrowsPrime = new Set();
  const collateralValue = inventory?.inventories
    ? inventory.inventories.reduce((sum, item) => {
        const escrowAddress = item?.escrow?.address;
        const escrowCollateral = item?.escrow?.collateralValue || 0;

        // Add collateral only if the escrow address is unique
        if (escrowAddress && !uniqueEscrowsPrime.has(escrowAddress)) {
          uniqueEscrowsPrime.add(escrowAddress);
          return sum + escrowCollateral;
        }

        return sum;
      }, 0)
    : 0;
  const maxBorrowableAmount = Math.floor(collateralValue / 2);
  const uniqueBorrowedAddresses = new Set();
  const borrowAmount = inventory?.inventories
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
          onClick={() => showBorrowModal('Unstake')}
          disabled={borrowAmount >= maxBorrowableAmount || collateralQuantity <= 0}
        >
          <BankOutlined /> Borrow
        </Button>
        <Button
          type="link"
          className="text-[#13188A] font-semibold"
          onClick={() => showRepayModal('Unstake')}
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
        />
      )}
    </div>
  );
};

export default StakeItemActions;
