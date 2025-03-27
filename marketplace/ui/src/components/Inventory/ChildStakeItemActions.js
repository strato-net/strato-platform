import React, { useState } from 'react';
import { Button } from 'antd';
import {
  RiseOutlined,
  LogoutOutlined,
  BankOutlined,
  RetweetOutlined,
} from '@ant-design/icons';
import { ASSET_STATUS } from '../../helpers/constants';
import StakeModal from './StakeModal';
import BorrowModal from './BorrowModal';
import RepayModal from './RepayModal';
import BridgeWallet from '../ETHST/BridgeWallet';
import BigNumber from 'bignumber.js';

const ChildStakeItemActions = ({
  inventory,
  limit,
  offset,
  debouncedSearchTerm,
  category,
  reserves,
  assetsWithEighteenDecimalPlaces,
  bridgeableTokens,
}) => {
  const [stakeType, setStakeType] = useState('Stake');
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);
  const [bridgeOutModalOpen, setBridgeOutModalOpen] = useState(false);

  const totalCollateralQuantity = inventory?.escrow?.collateralQuantity || 0;
  const collateralQuantity =
    totalCollateralQuantity > inventory?.quantity
      ? inventory.quantity
      : totalCollateralQuantity;
  const saleQuantity = inventory?.saleQuantity || 0;
  const quantity = inventory?.quantity || 0;
  const collateralValue = inventory?.escrow?.collateralValue;
  const maxBorrowableAmount = Math.floor(collateralValue / 2);
  const borrowAmount = inventory?.escrow?.borrowedAmount || 0;
  const decimals = assetsWithEighteenDecimalPlaces.includes(
    inventory.root
  ) ? 18 : inventory.decimals || 0;
  const displayedQuantity = new BigNumber(inventory.quantity).dividedBy(
    new BigNumber(10).pow(decimals)
  );

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

  const isBridgeableToken = (inventoryRoot) => {
    return (
      Array.isArray(bridgeableTokens) &&
      bridgeableTokens.find((address) => address === inventoryRoot)
    );
  };

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

  const showBridgeOutModal = () => {
    setBridgeOutModalOpen(true);
  };

  const handleBridgeOutModalClose = () => {
    setBridgeOutModalOpen(false);
  };

  return (
    <div className="flex justify-center w-full">
      <div className="flex justify-center gap-3">
        <Button
          type="primary"
          className="font-semibold flex items-center justify-center"
          onClick={() => showStakeModal('Stake')}
          disabled={
            (saleQuantity > 0 ? true : collateralQuantity >= quantity) ||
            !isActive()
          }
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
        {/* temporary removing bridgeout button
        <Button
          type="link"
          className={`text-[#13188A] font-semibold ${
            !isBridgeableToken(inventory.root) ||
            (inventory.escrow && inventory.escrow.address)
              ? 'invisible'
              : ''
          }`}
          onClick={showBridgeOutModal}
        >
          <RetweetOutlined /> Bridge
        </Button> */}
        <Button
          type="link"
          className="text-[#13188A] font-semibold invisible"
          onClick={() => showBorrowModal('Unstake')}
          disabled={true}
        >
          <BankOutlined /> Borrow
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
      {bridgeOutModalOpen && (
        <BridgeWallet
          open={bridgeOutModalOpen}
          handleCancel={handleBridgeOutModalClose}
          accountDetails={{
            assetRootAddress: inventory.root,
            balance: displayedQuantity.toString(),
            decimals: decimals,
          }}
          pageDetails={{ limit, offset, categoryName: category, reserves }}
          tokenName={inventory.name}
          tabKey={'2'}
        />
      )}
    </div>
  );
};

export default ChildStakeItemActions;
