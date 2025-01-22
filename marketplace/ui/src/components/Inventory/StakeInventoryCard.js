import React, { useState, useEffect, useRef } from 'react';
import { Button, Typography, Tooltip } from 'antd';
import { BigNumber } from 'bignumber.js';
import {
  LogoutOutlined,
  RiseOutlined,
  SolutionOutlined,
  BankOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import StakeModal from './StakeModal';
import routes from '../../helpers/routes';
import { ASSET_STATUS } from '../../helpers/constants';
import image_placeholder from '../../images/resources/image_placeholder.png';
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import { SEO } from '../../helpers/seoConstant';
import { Images } from '../../images';
import { useInventoryState } from '../../contexts/inventory';
import RepayModal from './RepayModal';
import BorrowModal from './BorrowModal';
const USDSTIcon = <img src={Images.USDST} alt="USDST" className="w-5 h-5" />;

const StakeInventoryCard = ({
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
  const { reserves } = useInventoryState();
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [stakeType, setStakeType] = useState('Stake');
  const [borrowModalOpen, setBorrowModalOpen] = useState(false);
  const [repayModalOpen, setRepayModalOpen] = useState(false);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);

  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;
  const imgMeta = category ? category : SEO.TITLE_META;
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces?.includes(
    inventory.root
  );

  const uniqueEscrows = new Set();
  let collateralQuantity = inventory?.inventories
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
  collateralQuantity = is18DecimalPlaces
    ? collateralQuantity / 1e18
    : collateralQuantity;
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
    : is18DecimalPlaces
    ? inventory?.quantity / 1e18
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
  let borrowAmount = inventory?.inventories
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

  const escrows = inventory?.inventories
    ? [
        ...new Set(
          inventory.inventories
            .map((item) => item?.escrow?.address)
            .filter(Boolean)
        ),
      ]
    : inventory?.escrow?.address
    ? [inventory.escrow.address]
    : [];
  const isStaked = escrows.length > 0;
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

  const callDetailPage = () => {
    navigate(
      `${naviroute
        .replace(':id', inventory.address[0].address)
        .replace(':name', encodeURIComponent(inventory.name))}`,
      {
        state: { isCalledFromInventory: true },
      }
    );
  };

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
              <Typography className="lg:pt-1 flex gap-1">
                Borrowed Amount: {USDSTIcon}
                {(borrowAmount / Math.pow(10, 18)).toFixed(2)}
              </Typography>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 w-full">
            <Button
              type="primary"
              className="font-semibold w-full flex items-center justify-center"
              onClick={() => showStakeModal('Stake')}
              disabled={stakeQuantity <= 0}
            >
              <RiseOutlined /> Stake
            </Button>
            <>
              <Button
                type="link"
                className="text-[#13188A] px-0 font-semibold text-sm h-6"
                onClick={() => showStakeModal('Unstake')}
                disabled={borrowAmount > 0 || collateralQuantity <= 0}
              >
                <LogoutOutlined /> Unstake
              </Button>
              <Button
                type="link"
                className="text-[#13188A] px-0 font-semibold text-sm h-6"
                onClick={() => showBorrowModal('Unstake')}
                disabled={
                  borrowAmount >= maxBorrowableAmount || collateralQuantity <= 0
                }
              >
                <BankOutlined /> Borrow
              </Button>
              <Button
                type="link"
                className="text-[#13188A] px-0 font-semibold text-sm h-6"
                onClick={() => showRepayModal('Unstake')}
                disabled={borrowAmount <= 0}
              >
                <SolutionOutlined />
                Repay
              </Button>
            </>
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
            {isStaked ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Staked</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] sm:w-[12px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Unstaked</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 px-[18px] py-4 border border-[#E9E9E9] rounded-md w-full ">
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Owned</p>
            <p className="text-[#202020] font-semibold">
              {quantity.toLocaleString('en-US', {
                maximumFractionDigits: 4,
                minimumFractionDigits: 0,
              }) || 'N/A'}
            </p>
          </div>
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Stakeable</p>
            <p className="text-[#202020] font-semibold">
              {stakeQuantity.toLocaleString('en-US', {
                maximumFractionDigits: 4,
                minimumFractionDigits: 0,
              }) || 'N/A'}
            </p>
          </div>
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Staked </p>
            <p className="text-[#202020] font-semibold">
              {collateralQuantity.toLocaleString('en-US', {
                maximumFractionDigits: 4,
                minimumFractionDigits: 0,
              })}
            </p>
          </div>
        </div>
      </div>
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
    </div>
  );
};

export default StakeInventoryCard;
