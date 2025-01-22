import React, { useState, useEffect, useRef } from 'react';
import { Button, Typography, Tooltip, Popover } from 'antd';
import { BigNumber } from 'bignumber.js';
import {
  DollarOutlined,
  EditOutlined,
  SendOutlined,
  PieChartOutlined,
  StopOutlined,
  SwapOutlined,
  RetweetOutlined,
  LogoutOutlined,
  RiseOutlined,
  SolutionOutlined,
  BankOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import PreviewInventoryModal from './PreviewInventoryModal';
import { useNavigate } from 'react-router-dom';
import ListForSaleModal from './ListForSaleModal';
import UnlistModal from './UnlistModal';
import ResellModal from './ResellModal';
import TransferModal from './TransferModal';
import RedeemModal from './RedeemModal';
import BridgeModal from './BridgeModal';
import StakeModal from './StakeModal';
import routes from '../../helpers/routes';
import {
  ASSET_STATUS,
  OLD_SADDOG_ORIGIN_ADDRESS,
} from '../../helpers/constants';
import image_placeholder from '../../images/resources/image_placeholder.png';
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import { SEO } from '../../helpers/seoConstant';
import { Images } from '../../images';
import { useInventoryState } from '../../contexts/inventory';
import { useEthState } from '../../contexts/eth';
import RepayModal from './RepayModal';
import BorrowModal from './BorrowModal';
const USDSTIcon = <img src={Images.USDST} alt="USDST" className="w-5 h-5" />;

const InventoryCard = ({
  inventory,
  category,
  debouncedSearchTerm,
  id,
  allSubcategories,
  limit,
  offset,
  user,
  supportedTokens,
  assetsWithEighteenDecimalPlaces,
}) => {
  const textRef = useRef(null);
  const { isReserveLoading, reserves } = useInventoryState();
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [open, setOpen] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [stakeType, setStakeType] = useState('Stake');
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [redeemModalOpen, setRedeemModalOpen] = useState(false);
  const [bridgeModalOpen, setBridgeModalOpen] = useState(false);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState({});
  const { ethstAddress } = useEthState();

  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;
  const ethNaviroute = routes.EthstProductDetail.url;
  const imgMeta = category ? category : SEO.TITLE_META;
  const itemData = inventory.data;
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(inventory.originAddress);
  const quantity = is18DecimalPlaces
    ? new BigNumber(inventory.quantity).dividedBy(new BigNumber(10).pow(18))
    : new BigNumber(inventory.quantity);
  const price = inventory?.price
    ? is18DecimalPlaces
      ? new BigNumber(inventory.quantity).multipliedBy(
          new BigNumber(10).pow(18)
        )
      : new BigNumber(inventory.quantity)
    : undefined;
  const saleQuantity =
    inventory.saleQuantity !== undefined
      ? is18DecimalPlaces
        ? new BigNumber(inventory.saleQuantity || 0).dividedBy(
            new BigNumber(10).pow(18)
          )
        : new BigNumber(inventory.saleQuantity || 0)
      : undefined;
  const totalLockedQuantity = inventory.totalLockedQuantity
    ? is18DecimalPlaces
      ? new BigNumber(inventory.totalLockedQuantity || 0).dividedBy(
          new BigNumber(10).pow(18)
        )
      : new BigNumber(inventory.totalLockedQuantity || 0)
    : new BigNumber(0);
  const stakeable =
    inventory.root &&
    reserves &&
    reserves.length > 0 &&
    reserves.some((reserve) => inventory.root === reserve.assetRootAddress);

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
    if (inventory.originAddress === ethstAddress) {
      navigate(`${ethNaviroute.replace(':address', inventory.address)}`, {
        state: { isCalledFromInventory: false },
      });
    } else {
      navigate(
        `${naviroute
          .replace(':id', inventory.address)
          .replace(':name', encodeURIComponent(inventory.name))}`,
        {
          state: { isCalledFromInventory: true },
        }
      );
    }
  };

  const getCategory = () => {
    const parts = inventory.contract_name.split('-');
    const contractName = parts[parts.length - 1];

    let category = allSubcategories?.find(
      (c) => c.contract === contractName
    )?.name;
    return category;
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
    return (
      getCategory() === 'Carbon Offset' &&
      !(itemData.isMint && itemData.isMint === 'True')
    );
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

  // Function to check if the inventory.root is within the supportedTokens array
  const isTokenSupported = (inventoryRoot) => {
    return (
      Array.isArray(supportedTokens) &&
      supportedTokens.some(
        (token) => token.mercata_root_address === inventoryRoot
      )
    );
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
    <div
      id={`asset-${inventory?.name}`}
      className="p-3 md:p-[18px] border border-[#BABABA] md:border-[#E9E9E9] rounded-lg sm:w-[343px] md:w-full  "
    >
      <div className="bg-[#F2F2F9] rounded-md px-[14px] flex flex-col justify-between items-center pb-[13px] pt-2 w-full">
        <div className="w-full">
          <div className="flex flex-col lg:flex-row w-full">
            <div className="flex-grow min-w-0">
              <p
                className="text-lg lg:text-xl font-semibold text-[#202020] hover:text-[#4285F4] cursor-pointer"
                onClick={callDetailPage}
              >
                {isOverflowing ? (
                  <Tooltip title={inventory?.name}>
                    <span
                      ref={textRef}
                      className="whitespace-nowrap overflow-hidden text-ellipsis block"
                    >
                      {inventory?.name}
                    </span>
                  </Tooltip>
                ) : (
                  <span
                    ref={textRef}
                    className="whitespace-nowrap overflow-hidden text-ellipsis block"
                  >
                    {inventory?.name}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-row space-x-2 lg:justify-self-end whitespace-nowrap">
              <Typography className="lg:pt-1">{`(${getCategory()})`}</Typography>
              {inventory?.contract_name.toLowerCase().includes('clothing') && (
                <Typography className="lg:pt-1">
                  {'Size: ' + inventory?.data?.size || 'N/A'}
                </Typography>
              )}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 w-full">
            {(!stakeable || (!inventory.escrow && stakeable)) && (
              <>
                <Button
                  type="link"
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
                  onClick={showListModal}
                  disabled={
                    isEditSellDisabled() ||
                    !isActive() ||
                    disableSADDOGS(inventory)
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
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
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
                className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
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

            {!inventory.escrow && stakeable && (
              <Button
                type="primary"
                className="font-semibold w-full flex items-center justify-center"
                onClick={() => showStakeModal('Stake')}
                disabled={inventory.price || !isActive()}
              >
                <RiseOutlined /> Stake
              </Button>
            )}

            {inventory.escrow && stakeable && (
              <>
                <Button
                  type="link"
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
                  onClick={() => showStakeModal('Unstake')}
                  disabled={inventory?.escrow?.borrowedAmount > 0}
                >
                  <LogoutOutlined /> Unstake
                </Button>
                <Button
                  type="link"
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
                  onClick={() => showBorrowModal('Unstake')}
                  disabled={inventory?.escrow?.borrowedAmount > 0}
                >
                  <BankOutlined /> Borrow
                </Button>
                <Button
                  type="link"
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
                  onClick={() => showRepayModal('Unstake')}
                  disabled={inventory?.escrow?.borrowedAmount <= 0}
                >
                  <SolutionOutlined />
                  Repay
                </Button>
              </>
            )}
            {(!stakeable || (!inventory.escrow && stakeable)) && (
              <>
                {stakeable && (
                  <Button
                    type="link"
                    className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
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
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
                  onClick={showUnlistModal}
                  disabled={!inventory.price || !isActive()}
                >
                  <StopOutlined /> Unlist
                </Button>
                <Button
                  type="link"
                  className="text-[#13188A]  text-left px-0 font-semibold text-sm h-6"
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
                  className={`text-[#13188A]  text-left px-0 font-semibold text-sm h-6 ${
                    !isTokenSupported(inventory.root) || inventory.escrow
                      ? 'hidden'
                      : ''
                  }`}
                  onClick={showBridgeModal}
                >
                  <RetweetOutlined /> Bridge
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="pt-[14px] flex lg:flex-row flex-col items-center lg:items-stretch gap-y-4 md:gap-[18px]">
        <div className="inline-block text-center">
          <div>
            <img
              className={`rounded-md w-[161px] ${
                inventory.status == ASSET_STATUS.PENDING_REDEMPTION
                  ? 'h-[140px]'
                  : 'h-[161px]'
              }  md:object-contain`}
              alt={imgMeta}
              title={imgMeta}
              src={
                inventory['BlockApps-Mercata-Asset-images'] &&
                inventory['BlockApps-Mercata-Asset-images'].length > 0
                  ? inventory['BlockApps-Mercata-Asset-images'][0].value
                  : image_placeholder
              }
            />
          </div>

          <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
            {inventory.price || inventory?.escrow ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">
                  {inventory?.escrow ? 'Staked' : 'Published'}
                </p>
              </div>
            ) : inventory.status == ASSET_STATUS.PENDING_REDEMPTION ? (
              <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
                <div className="w-[7px] sm:w-[12px] h-[7px] rounded-full bg-[#FFA500]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Pending Redemption</p>
              </div>
            ) : inventory.status == ASSET_STATUS.RETIRED ? (
              <div className="flex items-center justify-center gap-2 bg-[#c3152129] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Retired</p>
              </div>
            ) : (inventory.data.isMint &&
                inventory.data.isMint === 'False' &&
                quantity.eq(0)) ||
              (!inventory.data.isMint && quantity.eq(0)) ? (
              <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#FFA500]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Sold Out</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Unpublished</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 px-[18px] py-4 border border-[#E9E9E9] rounded-md w-full ">
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Owned</p>
            <p className="text-[#202020] font-semibold">
              {quantity.toNumber().toLocaleString('en-US', {
                maximumFractionDigits: 4,
                minimumFractionDigits: 0,
              }) || 'N/A'}
            </p>
          </div>
          {stakeable ? (
            <div className="flex justify-between  ">
              <p className="text-[#6A6A6A]">Quantity Staked </p>
              <p className="text-[#202020] font-semibold">
                {inventory?.escrow
                  ? quantity.toNumber().toLocaleString('en-US', {
                      maximumFractionDigits: 4,
                      minimumFractionDigits: 0,
                    })
                  : 0}
              </p>
            </div>
          ) : (
            <>
              <div className="flex justify-between  ">
                <p className="text-[#6A6A6A]">Quantity Available for Sale </p>
                <p className="text-[#202020] font-semibold">
                  {quantity
                    .minus(totalLockedQuantity)
                    .toNumber()
                    .toLocaleString('en-US', {
                      maximumFractionDigits: 4,
                      minimumFractionDigits: 0,
                    }) || 'N/A'}
                </p>
              </div>
              <div className="flex justify-between  ">
                <p className="text-[#6A6A6A]">Quantity Listed for Sale</p>
                <p className="text-[#202020] font-semibold">
                  {saleQuantity ? saleQuantity.toString() : 'N/A'}
                </p>
              </div>
              <div className="flex justify-between  ">
                <p className="text-[#6A6A6A]">Price</p>
                <p className="text-[#202020] font-semibold">
                  {price ? (
                    <p className="flex">
                      <span>${price.toString()}</span>
                      <p className="flex text-xs items-center">
                        &nbsp;(
                        {price.toString()}{' '}
                        {USDSTIcon})
                      </p>
                    </p>
                  ) : (
                    'N/A'
                  )}
                </p>
              </div>
            </>
          )}
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
          saleAddress={inventory.saleAddress}
          categoryName={category}
          reserves={reserves}
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
          categoryName={category}
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
      {transferModalOpen && (
        <TransferModal
          open={transferModalOpen}
          handleCancel={handleTransferModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
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
          categoryName={category}
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
          categoryName={category}
          reserves={reserves}
        />
      )}
    </div>
  );
};

export default InventoryCard;
