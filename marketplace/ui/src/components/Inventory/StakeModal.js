import { Button, Modal } from 'antd';
import { useEffect, useState } from 'react';
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import { Images } from '../../images';

const logo = (
  <img src={Images.strats} alt={''} title={''} className="w-5 h-5 " />
);

const StakeModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  type,
  productDetailPage,
}) => {
  const {
    isStaking,
    isUnstaking,
    isReserveAddress,
    isCalculatedValue,
    reserveAddress,
    calculatedValue,
  } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const { paymentServices } = usePaymentServiceState();
  const isLoader =
    isStaking || isUnstaking || isCalculatedValue || isReserveAddress;
  const isStaked = inventory.stratsLoanAmount && inventory.stratsLoanAmount > 0;
  const itemName = decodeURIComponent(inventory.name);
  const resAddress = reserveAddress?.length ? reserveAddress[0]?.address : null;

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
  }, []);

  useEffect(() => {
    if (reserveAddress && inventory.data && !isReserveAddress && !isStaked) {
      const body = {
        assetAmount: inventory?.quantity,
        loanToValueRatio: reserveAddress[0].loanToValueRatio,
      };
      inventoryActions.calculateValue(inventoryDispatch, body);
    }
  }, [resAddress]);

  const handleSubmit = async () => {
    const stratsService = paymentServices.find(
      (item) => item.serviceName === 'STRATS' && item.creator === 'Server'
    );
    if (type === 'Stake') {
      const body = {
        assetAmount: inventory?.quantity,
        assetAddress: inventory?.address,
        stratPaymentService: {
          creator: stratsService.creator,
          serviceName: stratsService.serviceName,
        },
        reserve: reserveAddress[0].address,
      };

      const isStaked = await inventoryActions.stakeInventory(
        inventoryDispatch,
        body
      );
      if (isStaked) {
        if (productDetailPage) {
          await inventoryActions.fetchInventoryDetail(
            inventoryDispatch,
            productDetailPage
          );
        } else {
          await inventoryActions.fetchInventory(
            inventoryDispatch,
            limit,
            offset,
            debouncedSearchTerm,
            category && category !== 'All' ? category : undefined
          );
        }
        await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
        handleCancel();
      }
    }

    if (type === 'Unstake') {
      const body = {
        escrow: inventory?.sale,
        stratsPaymentService: stratsService.address,
      };
      const isUnstaked = await inventoryActions.UnstakeInventory(
        inventoryDispatch,
        body
      );
      if (isUnstaked) {
        if (productDetailPage) {
          await inventoryActions.fetchInventoryDetail(
            inventoryDispatch,
            productDetailPage
          );
        } else {
          await inventoryActions.fetchInventory(
            inventoryDispatch,
            limit,
            offset,
            debouncedSearchTerm,
            category && category !== 'All' ? category : undefined
          );
        }
        await marketplaceActions.fetchStratsBalance(marketplaceDispatch);
        handleCancel();
      }
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={
        <div className="text-2xl md:text-3xl font-bold text-gray-900 pl-4">
          Collateral: {itemName}
        </div>
      }
      width={1000}
      centered={true}
      footer={null}
    >
      <div className="flex flex-col md:flex-row gap-6 p-4">
        {/* Left Section (2/3 Width) */}
        <div className="w-full md:w-2/3 grid grid-cols-2 gap-y-6 gap-x-8">
          <div className="col-span-2 flex items-end">
            <span className="text-2xl font-semibold text-gray-900">$30</span>
            <span className="text-xl text-gray-500 ml-4">
              Market Price (Valid for 3 minutes)
            </span>
          </div>
          {/* Row 1 */}
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">
              {reserveAddress[0]?.loanToValueRatio}% (Max{' '}
              {reserveAddress[0]?.loanToValueRatio}%)
            </span>
            <span className="text-sm text-gray-500">Loan to Value Ratio</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">2%</span>
            <span className="text-sm text-gray-500">Interest on Loan</span>
          </div>

          {/* Column 2 */}
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">10%</span>
            <span className="text-sm text-gray-500">Liquidation Penalty</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">$28</span>
            <span className="text-sm text-gray-500">Liquidation Price</span>
          </div>

          {/* Row 3 */}
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">
              {reserveAddress[0]?.cataAPYRate}%
            </span>
            <span className="text-sm text-gray-500">Cata Reward (APY)</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">12 Months</span>
            <span className="text-sm text-gray-500">Term</span>
          </div>

          {/* Row 4 */}
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900">
              {inventory?.quantity}
            </span>
            <span className="text-sm text-gray-500">Available to Deposit</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-gray-900 flex items-center">
              <span>{calculatedValue}</span>
              <img
                src={Images.strats}
                alt={''}
                title={''}
                className="w-8 h-8 "
              />
            </span>
            <span className="text-sm text-gray-500">Available to Borrow</span>
          </div>
        </div>

        {/* Right Section (1/3 Width) */}
        <div className="w-full md:w-1/3 flex flex-col items-center gap-6 border border-gray-200 rounded-lg p-6 shadow-md">
          <h3 className="text-lg font-semibold text-gray-900">
            Configure Borrow Position
          </h3>
          <div className="w-full">
            <p className="text-sm text-gray-500 mb-2">
              Deposit {inventory?.name}
            </p>
            <div className="border border-gray-300 h-12 rounded-md flex items-center justify-center">
              <p>{inventory?.quantity}</p>
            </div>
          </div>
          <div className="w-full">
            <p className="text-sm text-gray-500 mb-2">Borrow (STRATs)</p>
            <div className="border border-gray-300 h-12 rounded-md flex items-center justify-center">
              <div className="flex items-center">
                <p>{isStaked ? inventory.stratsLoanAmount : calculatedValue}</p>
                {logo}
              </div>
            </div>
          </div>
          <div className="flex justify-center w-full">
            <Button
              type="primary"
              className="w-full px-6 h-10 font-medium"
              onClick={handleSubmit}
              disabled={isLoader}
              loading={isLoader}
            >
              Borrow
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default StakeModal;
