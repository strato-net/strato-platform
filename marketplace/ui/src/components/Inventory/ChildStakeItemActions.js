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

const ChildStakeItemActions = ({
  inventory,
  limit,
  offset,
  debouncedSearchTerm,
  category,
  reserves,
  assetsWithEighteenDecimalPlaces
}) => {
  const [stakeType, setStakeType] = useState('Stake');
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);

  const totalCollateralQuantity = inventory?.escrow?.collateralQuantity || 0;
  const collateralQuantity = totalCollateralQuantity > inventory?.quantity ? inventory.quantity : totalCollateralQuantity;
  const saleQuantity = inventory?.saleQuantity || 0;
  const quantity = inventory?.quantity || 0;
  const collateralValue = inventory?.escrow?.collateralValue;
  const maxBorrowableAmount = Math.floor(collateralValue / 2);
  const borrowAmount = inventory?.escrow?.borrowedAmount || 0;

  
  function isActive() {
    if (
      inventory.status == ASSET_STATUS.PENDING_REDEMPTION ||
      inventory.status == ASSET_STATUS.RETIRED
    ) {
      return false;
    } else {
      return true;
    }
  }

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
          disabled={(saleQuantity > 0 ? true : collateralQuantity >= quantity) || !isActive()}
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
          className="text-[#13188A] font-semibold invisible"
          onClick={() => showBorrowModal('Unstake')}
          disabled={true}
        >
          <BankOutlined /> Borrow
        </Button>
        <Button
          type="link"
          className="text-[#13188A] font-semibold invisible"
          onClick={() => showRepayModal('Unstake')}
          disabled={true}
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

export default ChildStakeItemActions;
