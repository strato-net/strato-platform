import React, { useState } from "react";
import { Button, Popover } from "antd";
import {
  DollarOutlined,
  EditOutlined,
  SendOutlined,
  PieChartOutlined,
  StopOutlined,
  SwapOutlined,
  RetweetOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import {
  ASSET_STATUS,
  OLD_SADDOG_ORIGIN_ADDRESS,
} from "../../helpers/constants";
import ListForSaleModal from "./ListForSaleModal";
import UnlistModal from "./UnlistModal";
import ResellModal from "./ResellModal";
import TransferModal from "./TransferModal";
import RedeemModal from "./RedeemModal";
import BridgeModal from "./BridgeModal";
import StakeModal from "./StakeModal";

const ItemActions = ({
  inventory,
  limit,
  offset,
  debouncedSearchTerm,
  category,
  allSubcategories,
  user,
  supportedTokens,
  // togglePopover,
}) => {
  const itemData = inventory.data;
  const isStrats =
    itemData.quantityIsDecimal && itemData.quantityIsDecimal === "True";
  const quantity = isStrats
    ? parseFloat((inventory.quantity / 100).toFixed(2))
    : inventory.quantity;
  const saleQuantity = isStrats
    ? inventory.saleQuantity !== undefined
      ? parseFloat((inventory.saleQuantity / 100).toFixed(2))
      : undefined
    : inventory.saleQuantity;
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [stakeType, setStakeType] = useState("Stake");
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState({});

  const togglePopover = (id, visible) => {
    setPopoverVisible((prev) => ({ ...prev, [id]: visible }));
  };

  const getCategory = () => {
    const parts = inventory.contract_name.split("-");
    const contractName = parts[parts.length - 1];

    return allSubcategories?.find((c) => c.contract === contractName)?.name;
  };

  function isEditSellDisabled() {
    return (
      getCategory() === "Carbon Offset" &&
      !(itemData.isMint && itemData.isMint === "True")
    );
  }

  function isTransferDisabled() {
    return !(
      quantity &&
      quantity > 0 &&
      (!inventory.saleAddress || (inventory.saleAddress && saleQuantity > 0))
    );
  }

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
    <div className="flex">
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
      <Button
        type="link"
        className="text-[#13188A] font-semibold"
        onClick={showRedeemModal}
        disabled={
          inventory.price ||
          inventory.address === inventory.originAddress ||
          !isActive() ||
          disableSADDOGS(inventory)
        }
      >
        <SendOutlined /> Redeem
      </Button>

      {!inventory.isStake && <Button
        type="link"
        className="text-[#13188A] font-semibold"
        onClick={() => showStakeModal("Stake")}
        // disabled={!inventory.price || !isActive()}
      >
        <StopOutlined /> Stake
      </Button>}

     {inventory.isStake && <Button
        type="link"
        className="text-[#13188A] font-semibold"
        onClick={() => showStakeModal("Unstake")}
        // disabled={!inventory.price || !isActive()}
      >
        <StopOutlined /> Unstake
      </Button>}
      <Popover
        placement="topRight"
        open={popoverVisible[inventory.address] || false}
        onOpenChange={(visible) => togglePopover(inventory.address, visible)}
        content={
          <div className="flex gap-2">
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
                  itemData.isMint == "True" &&
                  !disableSADDOGS(inventory)
                ) || !isActive()
              }
            >
              <PieChartOutlined /> Mint
            </Button>
            <Button
              type="link"
              className={`text-[#13188A] font-semibold ${
                !isTokenSupported(inventory.root) ? "hidden" : ""
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
        />
      )}
      {stakeModalOpen && (
        <StakeModal
          open={stakeModalOpen}
          type={stakeType} // Stake / Unstake handle the modal functionality based on this.
          handleCancel={handleStakeModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          debouncedSearchTerm={debouncedSearchTerm}
          saleAddress={inventory.saleAddress}
          category={category}
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
        />
      )}
    </div>
  );
};

export default ItemActions;
