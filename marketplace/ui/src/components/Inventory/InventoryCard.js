import React, { useState } from "react";
import { Popover, Button, Typography, Tooltip } from "antd";
import {
  DollarOutlined,
  MoreOutlined,
  EditOutlined,
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

  return (
    <div className=" p-3 md:p-[18px] border border-[#BABABA] md:border-[#E9E9E9] rounded-lg sm:w-[343px] md:w-full  ">
      <div className="bg-[#F2F2F9] rounded-md px-[14px] flex justify-between items-center pb-[13px] pt-2 w-full">
        <div>
          <p className="text-lg lg:text-xl font-semibold text-[#202020] cursor-default" onClick={callDetailPage}>
            <Tooltip title={inventory?.name.length > 20 ? inventory?.name : null}>
              <span className=" whitespace-nowrap max-w-[160px] inline-block">
                {inventory?.name.length > 20 ? `${inventory?.name.slice(0, 20)}...` : `${inventory?.name}`}
              </span>
            </Tooltip>
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography className="pt-1">{`(${getCategory()})`}</Typography>
            {inventory?.contract_name.toLowerCase().includes("clothing") && (
              <Typography className='pt-1'>{'Size: ' + inventory?.data?.size || "N/A"}</Typography>
            )}
          </div>
        </div>
        <div className=" pt-[5px]  flex">

          <div className="flex  items-center">
            <Button type="link" className="text-[#13188A] font-semibold text-base h-6 mb-2" onClick={callDetailPage}>Preview</Button>

            {((itemData.isMint === "True" && inventory.quantity === 0) || inventory.quantity > 0) &&
              <Popover
                placement="bottomLeft"
                open={openPop}
                className=""
                id="sideMenu"
                onOpenChange={handleOpenChange}
                title={
                  <div className="font-medium">
                    {inventory.price ? (<div>
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showListModal}
                      >
                        <EditOutlined />
                        <p className="ml-3">Edit Listing</p>
                      </div>
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showUnlistModal}
                      >
                        <StopOutlined />
                        <p className="ml-3">Unlist</p>
                      </div>
                    </div>) : paymentProviderAddress && !(getCategory() == "Carbon Offset" && !(itemData.isMint && itemData.isMint == "True")) ? (<div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showListModal}
                    >
                      <DollarOutlined />
                      <p className="ml-3">List for Sale</p>
                    </div>) : (<div></div>)}
                    {itemData.isMint && itemData.isMint == "True" ? (<div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showResellModal}
                    >
                      <PieChartOutlined />
                      <p className="ml-3">Mint</p>
                    </div>) : (<div></div>)}

                    {inventory.quantity && parseInt(inventory.quantity) > 0 && (!inventory.saleAddress || (inventory.saleAddress && parseInt(inventory.saleQuantity) > 0)) ? (
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showTransferModal}
                      >
                        <SwapOutlined />
                        <p className="ml-3">Transfer</p>
                      </div>
                    ) : (
                      <div></div>
                    )}

                    {!inventory.price && inventory.address !== inventory.originAddress &&
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showRedeemModal}
                      >
                        <DollarOutlined />
                        <p className="ml-3">Redeem</p>
                      </div>
                    }

                  </div>
                }
                trigger="click"
              >
                <MoreOutlined />
              </Popover>
            }
          </div>
        </div>
      </div>
      <div className="pt-[14px] flex lg:flex-row  flex-col items-center gap-y-4 md:gap-[18px]">
        <div>
          <img
            className="rounded-md  w-[161px] h-[161px] md:object-contain"
            alt={imgMeta}
            title={imgMeta}
            src={
              inventory.images && inventory.images.length > 0
                ? inventory.images[0]
                : image_placeholder}

          />
        </div>

        <div className="pt-[7px] lg:hidden flex items-center gap-[5px]">
          {inventory.price ?
            <div className="flex items-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
              <p className="text-[#4D4D4D] text-[8px]">Published</p>
            </div>
            :
            (inventory.data.isMint && inventory.data.isMint === "False" && inventory.quantity === 0) || (!inventory.data.isMint && inventory.quantity === 0) ?
              <div className="flex items-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#FFA500]"></div>
                <p className="text-[#4D4D4D] text-[8px]">Sold Out</p>
              </div>
              :
              <div className="flex items-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[8px]">Unpublished</p>
              </div>
          }
        </div>

        <div className="flex flex-col gap-4 px-[18px] py-4 border border-[#E9E9E9] rounded-md w-full ">
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
      <div className="flex justify-between">
        {inventory.price ?
          <div className="pt-[7px] hidden lg:flex items-center gap-[5px] bg-[#1548C329] p-[6px] rounded-md">
            <div className="w-[10px] h-[10px] rounded-full bg-[#119B2D]"></div>
            <p className="text-[#4D4D4D] text-xs"> Published </p>
          </div>
          :
          (inventory.data.isMint && inventory.data.isMint === "False" && inventory.quantity === 0) || (!inventory.data.isMint && inventory.quantity === 0) ?
            <div className="pt-[7px] hidden lg:flex items-center gap-[5px] bg-[#FFA50029] p-[6px] rounded-md">
              <div className="w-[10px] h-[10px] rounded-full bg-[#FFA500]"></div>
              <p className="text-[#4D4D4D] text-xs"> Sold Out </p>
            </div>
            :
            <div className="pt-[7px] hidden lg:flex items-center gap-[5px] bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[10px] h-[10px] rounded-full bg-[#ff4d4f]"></div>
              <p className="text-[#4D4D4D] text-xs"> Unpublished </p>
            </div>
        }
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