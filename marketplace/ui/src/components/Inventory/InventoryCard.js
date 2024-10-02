import React, { useState, useEffect, useRef } from "react";
import { Button, Typography, Tooltip } from "antd";
import {
  DollarOutlined,
  EditOutlined,
  SendOutlined,
  PieChartOutlined,
  StopOutlined,
  SwapOutlined,
  RetweetOutlined
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import { useNavigate } from "react-router-dom";
import ListForSaleModal from "./ListForSaleModal";
import UnlistModal from "./UnlistModal";
import ResellModal from "./ResellModal";
import TransferModal from "./TransferModal";
import RedeemModal from "./RedeemModal";
import BridgeModal from "./BridgeModal";
import routes from "../../helpers/routes";
import { ASSET_STATUS, STRATS_CONVERSION, OLD_SADDOG_ORIGIN_ADDRESS } from "../../helpers/constants";
import image_placeholder from "../../images/resources/image_placeholder.png";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import { SEO } from "../../helpers/seoConstant";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id, allSubcategories, limit, offset, user, supportedTokens }) => {
  const textRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;
  const imgMeta = category ? category : SEO.TITLE_META
  const itemData = inventory.data;
  const isStrats = itemData.quantityIsDecimal && itemData.quantityIsDecimal === "True"
  const quantity = isStrats ? parseFloat((inventory.quantity / 100).toFixed(2)) : inventory.quantity
  const price = inventory?.price ? (isStrats ? parseFloat(inventory?.price * 100).toFixed(2) : inventory?.price) : undefined ;
  const saleQuantity = isStrats
    ? inventory.saleQuantity !== undefined
      ? parseFloat((inventory.saleQuantity / 100).toFixed(2))
      : undefined
    : inventory.saleQuantity;
  const totalLockedQuantity = inventory.totalLockedQuantity
    ? isStrats
      ? (inventory.totalLockedQuantity / 100).toFixed(2)
      : inventory.totalLockedQuantity
    : 0;

  const handleCancel = () => {
    setOpen(false);
  };

  const showListModal = () => {
    setListModalOpen(true);
  };

  const handleListModalClose = () => {
    setListModalOpen(false);
  };

  const showUnlistModal = () => {
    setUnlistModalOpen(true);
  };

  const handleUnlistModalClose = () => {
    setUnlistModalOpen(false);
  };

  const showResellModal = () => {
    setResellModalOpen(true);
  };

  const handleResellModalClose = () => {
    setResellModalOpen(false);
  };

  const showTransferModal = () => {
    setTransferModalOpen(true);
  };

  const handleTransferModalClose = () => {
    setTransferModalOpen(false);
  };

  const showRedeemModal = () => {
    setRedeemModalOpen(true);
  };

  const handleRedeemModalClose = () => {
    setRedeemModalOpen(false);
  };
  
  const showBridgeModal = () => {
    setBridgeModalOpen(true);
  };

  const handleBridgeModalClose = () => {
    setBridgeModalOpen(false);
  };

  const callDetailPage = () => {
    navigate(`${naviroute.replace(":id", inventory.address).replace(":name", encodeURIComponent(inventory.name))}`, {
      state: { isCalledFromInventory: true },
    });
  };

  const getCategory = () => {
    const parts = inventory.contract_name.split('-');
    const contractName = parts[parts.length - 1];

    return allSubcategories?.find(c => c.contract === contractName)?.name
  };

  /**
   * Determines if the Edit or Sell button should be disabled.
   * 
   * The button is disabled if:
   * - No payment provider address is set, meaning no transactions can be processed.
   * - The item is categorized as "Carbon Offset" and either:
   *   - isMint is not set to "True", or
   *   - isMint is missing, which means the item isn't allowed to be minted.
   * 
   * @returns {boolean} True if the button should be disabled, false otherwise.
   */
  function isEditSellDisabled() {
    return (getCategory() === "Carbon Offset" && !(itemData.isMint && itemData.isMint === "True"));
  }

  /**
   * Determines if the Transfer button should be disabled.
   * 
   * The button is disabled if any of the following conditions are true:
   * - quantity is not set or is zero, meaning there is nothing to transfer.
   * - inventory.saleAddress is set but saleQuantity is not greater than zero, indicating
   *   there are no available items left to transfer that are not already committed to a sale.
   * 
   * @returns {boolean} True if the button should be disabled, false otherwise.
   */
  function isTransferDisabled() {
    return !(quantity && quantity > 0 && (!inventory.saleAddress || (inventory.saleAddress && saleQuantity > 0)));
  }

  function isActive() {
    if (inventory.status == ASSET_STATUS.PENDING_REDEMPTION || inventory.status == ASSET_STATUS.RETIRED) {
      return false;
    } else {
      return true;
    }
  }

  // Function to check if the inventory.root is within the supportedTokens array
  const isTokenSupported = (inventoryRoot) => {
    return Array.isArray(supportedTokens) && supportedTokens.some(token => token.mercata_root_address === inventoryRoot);
  };  

  /**
   * Determines if the Tooltip of the asset name should be displayed.
   */
  useEffect(() => {
    const checkOverflow = () => {
      const element = textRef.current;
      if (element) {
        const isOverflow = element.scrollWidth > element.clientWidth;
        setIsOverflowing(isOverflow);
      }
    };

    // Check overflow on mount and window resize
    checkOverflow();
    window.addEventListener('resize', checkOverflow);

    return () => window.removeEventListener('resize', checkOverflow);
  }, []);

  function disableSADDOGS(inventory) {
    if (!inventory || !inventory.originAddress) {
      return false; // or handle the undefined case as needed
    }
    const address = inventory.originAddress;
    return address.toLowerCase() === OLD_SADDOG_ORIGIN_ADDRESS;
  }

  return (
    <div id={`asset-${inventory?.name}`} className="p-3 md:p-[18px] border border-[#BABABA] md:border-[#E9E9E9] rounded-lg sm:w-[343px] md:w-full  ">
      <div className="bg-[#F2F2F9] rounded-md px-[14px] flex flex-col justify-between items-center pb-[13px] pt-2 w-full">
        <div className="w-full">
          <div className="flex flex-col lg:flex-row w-full">
            <div className="flex-grow min-w-0">
              <p className="text-lg lg:text-xl font-semibold text-[#202020] hover:text-[#4285F4] cursor-pointer" onClick={callDetailPage}>
                {isOverflowing ? (
                  <Tooltip title={inventory?.name}>
                    <span ref={textRef} className="whitespace-nowrap overflow-hidden text-ellipsis block">
                      {inventory?.name}
                    </span>
                  </Tooltip>
                ) : (
                  <span ref={textRef} className="whitespace-nowrap overflow-hidden text-ellipsis block">
                    {inventory?.name}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-row space-x-2 lg:justify-self-end whitespace-nowrap">
              <Typography className="lg:pt-1">{`(${getCategory()})`}</Typography>
              {inventory?.contract_name.toLowerCase().includes("clothing") && (
                <Typography className='lg:pt-1'>{'Size: ' + inventory?.data?.size || "N/A"}</Typography>
              )}
            </div>
          </div>
          <div className="mt-3">
            {((itemData.isMint === "True" && quantity === 0) || quantity > 0) &&
              <div className="grid grid-cols-3 gap-1 w-full">
                <Button id="sell-listing-btn" type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showListModal} disabled={isEditSellDisabled() || !isActive() || disableSADDOGS(inventory)}>
                  {inventory.price ? <><EditOutlined /> Edit</> : <><DollarOutlined /> Sell</>}
                </Button>
                <Button id="asset-card-unlist-btn" type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showUnlistModal} disabled={!inventory.price || !isActive()}>
                  <><StopOutlined /> Unlist</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showResellModal} disabled={!(itemData.isMint && itemData.isMint == "True" && !disableSADDOGS(inventory)) || !isActive()}>
                  <><PieChartOutlined /> Mint</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showTransferModal} disabled={isTransferDisabled() || !isActive() }>
                  <><SwapOutlined /> Transfer</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showRedeemModal} disabled={inventory.price || inventory.address === inventory.originAddress || !isActive() || disableSADDOGS(inventory)}>
                  <><SendOutlined /> Redeem</>
                </Button>
                <Button type="link" className={`text-[#13188A] text-left px-0 font-semibold text-sm h-6 ${!isTokenSupported(inventory.root) ? 'hidden' : ''}`} onClick={showBridgeModal}>
                  <><RetweetOutlined /> Bridge</>
                </Button>
              </div>
            }
          </div>
        </div>
      </div>
      <div className="pt-[14px] flex lg:flex-row flex-col items-center lg:items-stretch gap-y-4 md:gap-[18px]">
        <div className="inline-block text-center">
          <div>
            <img
              className={`rounded-md w-[161px] ${inventory.status == ASSET_STATUS.PENDING_REDEMPTION ? "h-[140px]" : "h-[161px]"}  md:object-contain`}
              alt={imgMeta}
              title={imgMeta}
              src={
                inventory["BlockApps-Mercata-Asset-images"] && inventory["BlockApps-Mercata-Asset-images"].length > 0
                  ? inventory["BlockApps-Mercata-Asset-images"][0].value
                  : image_placeholder}

            />
          </div>


          <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
            {inventory.price ?
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Published</p>
              </div>
              :
              (inventory.status == ASSET_STATUS.PENDING_REDEMPTION) ?
                <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
                  <div className="w-[7px] sm:w-[12px] h-[7px] rounded-full bg-[#FFA500]"></div>
                  <p className="text-[#4D4D4D] text-[13px]">Pending Redemption</p>
                </div>
                :
                (inventory.status == ASSET_STATUS.RETIRED) ?
                  <div className="flex items-center justify-center gap-2 bg-[#c3152129] p-[6px] rounded-md">
                    <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                    <p className="text-[#4D4D4D] text-[13px]">Retired</p>
                  </div>
                  :
                  (inventory.data.isMint && inventory.data.isMint === "False" && quantity === 0) || (!inventory.data.isMint && quantity === 0) ?
                    <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
                      <div className="w-[7px] h-[7px] rounded-full bg-[#FFA500]"></div>
                      <p className="text-[#4D4D4D] text-[13px]">Sold Out</p>
                    </div>
                    :
                    <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                      <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                      <p className="text-[#4D4D4D] text-[13px]">Unpublished</p>
                    </div>
            }
          </div>
        </div>


        <div className="flex flex-col justify-between gap-4 px-[18px] py-4 border border-[#E9E9E9] rounded-md w-full ">
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Owned</p>
            <p className="text-[#202020] font-semibold">{ quantity || "N/A"}</p>
          </div> <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Available for Sale </p>
            <p className="text-[#202020] font-semibold">{(quantity - totalLockedQuantity) || "N/A"}</p>
          </div> <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Listed for Sale</p>
            <p className="text-[#202020] font-semibold">{saleQuantity || "N/A"}</p>
          </div>
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Price</p>
            <p className="text-[#202020] font-semibold">
              {price ? (
                <>
                  ${price} <span className="text-xs">({(price * STRATS_CONVERSION).toFixed(0)} STRATS)</span>
                </>
              ) : (
                "N/A"
              )}
            </p>
          </div>

        </div>

      </div>
      {open && (
        <PreviewInventoryModal
          open={open}
          handleCancel={handleCancel}
          inventory={inventory}
          category={category}
        />
      )}
      {listModalOpen && (
        <ListForSaleModal
          open={listModalOpen}
          handleCancel={handleListModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
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
          saleAddress={inventory.saleAddress}
          categoryName={category}
        />
      )}
      {resellModalOpen && (
        <ResellModal
          open={resellModalOpen}
          handleCancel={handleResellModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}

        />
      )}
      {transferModalOpen && (
        <TransferModal
          open={transferModalOpen}
          handleCancel={handleTransferModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
        />
      )}
      {redeemModalOpen && (
        <RedeemModal
          open={redeemModalOpen}
          handleCancel={handleRedeemModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
        />
      )}
      {bridgeModalOpen && (
        <BridgeModal
          open={bridgeModalOpen}
          handleCancel={handleBridgeModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
        />
      )}
    </div>
  );

}

export default InventoryCard;