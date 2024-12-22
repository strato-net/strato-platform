import React, { useState } from 'react';
import { Button, Popover } from 'antd';
import BigNumber from 'bignumber.js';
import {
  DollarOutlined,
  EditOutlined,
  SendOutlined,
  PieChartOutlined,
  StopOutlined,
  SwapOutlined,
  RetweetOutlined,
  MoreOutlined,
  RiseOutlined,
  LogoutOutlined,
  BankOutlined,
  SolutionOutlined,
} from '@ant-design/icons';
import {
  ASSET_STATUS,
  OLD_SADDOG_ORIGIN_ADDRESS,
} from '../../helpers/constants';
import ListForSaleModal from './ListForSaleModal';
import UnlistModal from './UnlistModal';
import ResellModal from './ResellModal';
import TransferModal from './TransferModal';
import RedeemModal from './RedeemModal';
import BridgeModal from './BridgeModal';
import StakeModal from './StakeModal';
import BorrowModal from './BorrowModal';
import RepayModal from './RepayModal';

const ItemActions = ({
  inventory,
  limit,
  offset,
  debouncedSearchTerm,
  category,
  allSubcategories,
  user,
  supportedTokens,
  reserves,
  assetsWithEighteenDecimalPlaces,
}) => {
  const itemData = inventory.data;
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(inventory.originAddress);
  const quantity = is18DecimalPlaces
    ? new BigNumber(inventory.quantity).dividedBy(new BigNumber(10).pow(18))
    : new BigNumber(inventory.quantity);
  const saleQuantity =
    inventory.saleQuantity !== undefined
      ? is18DecimalPlaces
        ? new BigNumber(inventory.saleQuantity).dividedBy(new BigNumber(10).pow(18))
        : new BigNumber(inventory.saleQuantity)
      : undefined;  
  const stakeable =
    inventory.root &&
    reserves &&
    reserves.length > 0 &&
    reserves.some((reserve) => inventory.root === reserve.assetRootAddress);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [stakeType, setStakeType] = useState('Stake');
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState({});

  const togglePopover = (id, visible) => {
    setPopoverVisible((prev) => ({ ...prev, [id]: visible }));
  };

  const getCategory = () => {
    const parts = inventory.contract_name.split('-');
    const contractName = parts[parts.length - 1];

    return allSubcategories?.find((c) => c.contract === contractName)?.name;
  };

  function isEditSellDisabled() {
    return (
      getCategory() === 'Carbon Offset' &&
      !(itemData.isMint && itemData.isMint === 'True')
    );
  }

  function isTransferDisabled() {
    return !(
      quantity &&
      quantity.gt(0) &&
      (!inventory.saleAddress || (inventory.saleAddress && saleQuantity.gt(0)))
    );
  }

  function isActive() {
    if (
      inventory.status == ASSET_STATUS.PENDING_REDEMPTION ||
      inventory.status == ASSET_STATUS.RETIRED ||
      inventory.escrow
    ) {
      return false;
    } else {
      return true;
    }
  }

  const isTokenSupported = (inventoryRoot) => {
    return (
      Array.isArray(supportedTokens) &&
      supportedTokens.some(
        (token) => token.mercata_root_address === inventoryRoot
      )
    );
  };

  function disableSADDOGS(inventory) {
    if (!inventory || !inventory.originAddress) {
      return false;
    }
    const address = inventory.originAddress;
    return address.toLowerCase() === OLD_SADDOG_ORIGIN_ADDRESS;
  }

  const showListModal = () => {
    togglePopover(false);
    setListModalOpen(true);
  };

  const handleListModalClose = () => {
    setListModalOpen(false);
  };

  const showUnlistModal = () => {
    togglePopover(false);
    setUnlistModalOpen(true);
  };

  const showStakeModal = (type) => {
    togglePopover(false);
    setStakeModalOpen(true);
    setStakeType(type);
  };

  const handleStakeModalClose = () => {
    setStakeModalOpen(false);
  };

  const showBorrowModal = () => {
    togglePopover(false);
    setBorrowModalOpen(true);
  };

  const handleBorrowModalClose = () => {
    setBorrowModalOpen(false);
  };

  const showRepayModal = () => {
    togglePopover(false);
    setRepayModalOpen(true);
  };

  const handleRepayModalClose = () => {
    setRepayModalOpen(false);
  };

  const handleUnlistModalClose = () => {
    setUnlistModalOpen(false);
  };

  const showResellModal = () => {
    togglePopover(false);
    setResellModalOpen(true);
  };

  const handleResellModalClose = () => {
    setResellModalOpen(false);
  };

  const showTransferModal = () => {
    togglePopover(false);
    setTransferModalOpen(true);
  };

  const handleTransferModalClose = () => {
    setTransferModalOpen(false);
  };

  const showRedeemModal = () => {
    togglePopover(false);
    setRedeemModalOpen(true);
  };

  const handleRedeemModalClose = () => {
    setRedeemModalOpen(false);
  };

  const showBridgeModal = () => {
    togglePopover(false);
    setBridgeModalOpen(true);
  };

  const handleBridgeModalClose = () => {
    setBridgeModalOpen(false);
  };

  return (
    <div className="flex justify-center">
      {(!stakeable || (!inventory?.escrow && stakeable)) && (
        <>
          <Button
            type="link"
            className="text-[#13188A] font-semibold"
            onClick={showListModal}
            disabled={
              isEditSellDisabled() || !isActive() || disableSADDOGS(inventory)
            }
          >
            {inventory.price ? (
              <>
                <EditOutlined /> Edit
              </>
            ) : (
              <>
                <DollarOutlined /> Sell
              </>
            )}
          </Button>
          <Button
            type="link"
            className="text-[#13188A] font-semibold"
            onClick={showTransferModal}
            disabled={isTransferDisabled() || !isActive()}
          >
            <SwapOutlined /> Transfer
          </Button>
        </>
      )}
      {!stakeable && (
        <Button
          type="link"
          className="text-[#13188A] font-semibold w-1/4 flex items-center justify-center"
          onClick={showRedeemModal}
          disabled={
            inventory.price ||
            inventory.address === inventory.originAddress ||
            !isActive() ||
            disableSADDOGS(inventory) ||
            is18DecimalPlaces
          }
        >
          <SendOutlined /> Redeem
        </Button>
      )}

      {!inventory?.escrow && stakeable && (
        <Button
          type="primary"
          className="font-semibold w-1/4 flex items-center justify-center"
          onClick={() => showStakeModal('Stake')}
          disabled={inventory?.escrow || !isActive() || inventory.price}
        >
          <RiseOutlined /> Stake
        </Button>
      )}

      {inventory?.escrow && stakeable && (
        <div className="flex justify-center gap-3">
          <Button
            type="link"
            className="text-[#13188A] font-semibold"
            onClick={() => showStakeModal('Unstake')}
            disabled={
              inventory?.escrow?.borrowedAmount > 0
            }
          >
            <LogoutOutlined /> Unstake
          </Button>
          <Button
            type="link"
            className="text-[#13188A] font-semibold"
            onClick={() => showBorrowModal('Unstake')}
            disabled={
              inventory?.escrow?.borrowedAmount > 0
            }
          >
            <BankOutlined /> Borrow
          </Button>
          <Button
            type="link"
            className="text-[#13188A] font-semibold"
            onClick={() => showRepayModal('Unstake')}
            disabled={
              inventory?.escrow?.borrowedAmount <= 0
            }
          >
            <SolutionOutlined />
            Repay
          </Button>
        </div>
      )}
      {(!stakeable || (!inventory.escrow && stakeable)) && (
        <Popover
          placement="topRight"
          open={popoverVisible[inventory.address] || false}
          onOpenChange={(visible) => togglePopover(inventory.address, visible)}
          content={
            <div className="flex gap-2">
              {stakeable && (
                <Button
                  type="link"
                  className="text-[#13188A] font-semibold"
                  onClick={showRedeemModal}
                  disabled={
                    inventory.price ||
                    inventory.address === inventory.originAddress ||
                    !isActive() ||
                    disableSADDOGS(inventory) ||
                    is18DecimalPlaces
                  }
                >
                  <SendOutlined /> Redeem
                </Button>
              )}
              <Button
                type="link"
                className="text-[#13188A] font-semibold"
                onClick={showUnlistModal}
                disabled={!inventory.price || !isActive()}
              >
                <StopOutlined /> Unlist
              </Button>
              <Button
                type="link"
                className="text-[#13188A] font-semibold"
                onClick={showResellModal}
                disabled={
                  !(
                    itemData.isMint &&
                    itemData.isMint == 'True' &&
                    !disableSADDOGS(inventory)
                  ) || !isActive()
                }
              >
                <PieChartOutlined /> Mint
              </Button>
              <Button
                type="link"
                className={`text-[#13188A] font-semibold ${
                  !isTokenSupported(inventory.root) || inventory.escrow
                    ? 'hidden'
                    : ''
                }`}
                onClick={showBridgeModal}
              >
                <RetweetOutlined /> Bridge
              </Button>
            </div>
          }
        >
          <Button className="text-[#13188A] font-semibold" type="link">
            <MoreOutlined /> More
          </Button>
        </Popover>
      )}
      {listModalOpen && (
        <ListForSaleModal
          open={listModalOpen}
          handleCancel={handleListModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          category={category}
          user={user}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {unlistModalOpen && (
        <UnlistModal
          open={unlistModalOpen}
          handleCancel={handleUnlistModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          saleAddress={inventory.saleAddress}
          category={category}
          reserves={reserves}
        />
      )}
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
      {resellModalOpen && (
        <ResellModal
          open={resellModalOpen}
          handleCancel={handleResellModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          category={category}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {transferModalOpen && (
        <TransferModal
          open={transferModalOpen}
          handleCancel={handleTransferModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          category={category}
          reserves={reserves}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
        />
      )}
      {redeemModalOpen && (
        <RedeemModal
          open={redeemModalOpen}
          handleCancel={handleRedeemModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          category={category}
          reserves={reserves}
        />
      )}
      {bridgeModalOpen && (
        <BridgeModal
          open={bridgeModalOpen}
          handleCancel={handleBridgeModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          category={category}
          reserves={reserves}
        />
      )}
    </div>
  );
};

export default ItemActions;
