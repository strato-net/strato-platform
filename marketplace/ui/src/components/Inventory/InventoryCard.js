import React, { useState } from "react";
import { Popover, Button, Typography, Tooltip } from "antd";
import {
  DollarOutlined,
  MoreOutlined,
  EditOutlined,
  FormOutlined,
  SendOutlined,
  PieChartOutlined,
  StopOutlined,
  SwapOutlined
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import AddEventModal from "./AddEventModal";
import { useNavigate } from "react-router-dom";
import ListForSaleModal from "./ListForSaleModal";
import UnlistModal from "./UnlistModal";
import ResellModal from "./ResellModal";
import TransferModal from "./TransferModal";
import RedeemModal from "./RedeemModal";
import routes from "../../helpers/routes";
import { ASSET_STATUS } from "../../helpers/constants";
import image_placeholder from "../../images/resources/image_placeholder.png";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import { SEO } from "../../helpers/seoConstant";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id, paymentProviderAddress, allSubcategories, limit, offset }) => {
  const [openPop, setOpenPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;
  const imgMeta = category ? category : SEO.TITLE_META

  const itemData = inventory.data;

  const handleCancel = () => {
    setOpen(false);
  };

  const handleCancelEdit = () => {
    setOpenEdit(false);
  };

  const hide = () => {
    setOpenPop(false);
  };
  const handleOpenChange = (newOpen) => {
    setOpenPop(newOpen);
  };

  const showListModal = () => {
    hide();
    setListModalOpen(true);
  };

  const handleListModalClose = () => {
    setListModalOpen(false);
  };

  const showUnlistModal = () => {
    hide();
    setUnlistModalOpen(true);
  };

  const handleUnlistModalClose = () => {
    setUnlistModalOpen(false);
  };

  const showResellModal = () => {
    hide();
    setResellModalOpen(true);
  };

  const handleResellModalClose = () => {
    setResellModalOpen(false);
  };

  const showTransferModal = () => {
    hide();
    setTransferModalOpen(true);
  };

  const handleTransferModalClose = () => {
    setTransferModalOpen(false);
  };

  const showRedeemModal = () => {
    hide();
    setRedeemModalOpen(true);
  };

  const handleRedeemModalClose = () => {
    setRedeemModalOpen(false);
  };

  const callDetailPage = () => {
    navigate(`${naviroute.replace(":id", inventory.address).replace(":name", inventory.name)}`, {
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
    return !paymentProviderAddress || (getCategory() === "Carbon Offset" && !(itemData.isMint && itemData.isMint === "True"));
  }

  /**
   * Determines if the Transfer button should be disabled.
   * 
   * The button is disabled if any of the following conditions are true:
   * - inventory.quantity is not set or is zero, meaning there is nothing to transfer.
   * - inventory.saleAddress is set but inventory.saleQuantity is not greater than zero, indicating
   *   there are no available items left to transfer that are not already committed to a sale.
   * 
   * @returns {boolean} True if the button should be disabled, false otherwise.
   */
  function isTransferDisabled() {
    return !(inventory.quantity && parseInt(inventory.quantity) > 0 && (!inventory.saleAddress || (inventory.saleAddress && parseInt(inventory.saleQuantity) > 0)));
  }


  return (
    <div className=" p-3 md:p-[18px] border border-[#BABABA] md:border-[#E9E9E9] rounded-lg sm:w-[343px] md:w-full">
      <div className="bg-[#F2F2F9] rounded-md px-[14px] flex flex-col justify-between items-center pb-[13px] pt-2 w-full">
        <div className="w-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 w-full auto-cols-max">
            <p className="text-lg lg:text-xl font-semibold text-[#202020] hover:text-[#4285F4] cursor-pointer" onClick={callDetailPage}>
              <Tooltip title={inventory?.name.length > 20 ? inventory?.name : null}>
                <span className=" whitespace-nowrap max-w-[160px] inline-block">
                  {inventory?.name.length > 20 ? `${inventory?.name.slice(0, 17)}...` : `${inventory?.name}`}
                </span>
              </Tooltip>
            </p>
            <div className="flex space-x-2 lg:justify-self-end">
              <Typography className="lg:pt-1">{`(${getCategory()})`}</Typography>
              {inventory?.contract_name.toLowerCase().includes("clothing") && (
                <Typography className='lg:pt-1'>{'Size: ' + inventory?.data?.size || "N/A"}</Typography>
              )}
            </div>
          </div>
          <div className="mt-3">
            {((itemData.isMint === "True" && inventory.quantity === 0) || inventory.quantity > 0) &&
              <div className="grid grid-cols-3 gap-1 w-full">
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showListModal} disabled={isEditSellDisabled()}>
                  {inventory.price ? <><EditOutlined /> Edit</> : <><DollarOutlined /> Sell</>}
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showUnlistModal} disabled={!inventory.price}>
                  <><StopOutlined /> Unlist</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showResellModal} disabled={!(itemData.isMint && itemData.isMint == "True")}>
                  <><PieChartOutlined /> Mint</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showTransferModal} disabled={isTransferDisabled()}>
                  <><SwapOutlined /> Transfer</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" disabled={true}>
                  <><SendOutlined /> Redeem</>
                </Button>
                <Button type="link" className="text-[#13188A] text-left px-0 font-semibold text-sm h-6" onClick={showRedeemModal} disabled={inventory.price || inventory.address === inventory.originAddress}>
                  <><DollarOutlined /> Redeem</>
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
                inventory.images && inventory.images.length > 0
                  ? inventory.images[0]
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
                  <div className="w-[12px] h-[7px] rounded-full bg-[#FFA500]"></div>
                  <p className="text-[#4D4D4D] text-[13px]">Pending Redemption</p>
                </div>
                :
                (inventory.status == ASSET_STATUS.RETIRED) ?
                  <div className="flex items-center justify-center gap-2 bg-[#c3152129] p-[6px] rounded-md">
                    <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                    <p className="text-[#4D4D4D] text-[13px]">Retired</p>
                  </div>
                  :
                  (inventory.data.isMint && inventory.data.isMint === "False" && inventory.quantity === 0) || (!inventory.data.isMint && inventory.quantity === 0) ?
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
            <p className="text-[#202020] font-semibold">{inventory.quantity || "N/A"}</p>
          </div> <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Available for Sale </p>
            <p className="text-[#202020] font-semibold">{(inventory.quantity - (inventory.totalLockedQuantity ? inventory.totalLockedQuantity : 0)) || "N/A"}</p>
          </div> <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Listed for Sale</p>
            <p className="text-[#202020] font-semibold">{inventory.saleQuantity || "N/A"}</p>
          </div>
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Price</p>
            <p className="text-[#202020] font-semibold">{inventory?.price || "N/A"}</p>
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
      {openEdit && (
        <AddEventModal
          open={openEdit}
          handleCancel={handleCancelEdit}
          inventoryId={inventory.address}
          productId={inventory.productId}
        />
      )}
      {listModalOpen && (
        <ListForSaleModal
          open={listModalOpen}
          handleCancel={handleListModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          paymentProviderAddress={paymentProviderAddress}
          categoryName={category}
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
    </div>
  );

}

export default InventoryCard;