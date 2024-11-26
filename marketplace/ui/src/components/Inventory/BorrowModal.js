import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';

import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import { Images } from '../../images';

const logo = (
  <img src={Images.strats} alt={''} title={''} className="w-5 h-5" />
);

const BorrowModal = ({
  open,
  handleCancel,
  inventory,
  category,
  debouncedSearchTerm,
  limit,
  offset,
  productDetailPage,
}) => {
  const {
    isStaking,
    isUnstaking,
    isreservessLoading,
    isFetchingOracle,
    reserves,
    oracle,
    isBorrowing
  } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const isLoader =
    isStaking || isUnstaking || isFetchingOracle || isreservessLoading || isBorrowing;
  const isStaked = inventory.sale && inventory.price <= 0;
  const itemName = decodeURIComponent(inventory.name);
  const resAddress = reserves?.length ? reserves[0]?.address : null;
  const oracleData = oracle ? oracle : { consensusPrice: 0 };

  useEffect(() => {
    if (reserves && inventory.data && !isreservessLoading && isStaked) {
      inventoryActions.getOracle(inventoryDispatch, reserves[0].oracle);
    }
  }, [resAddress]);

  const dataForItems = [
    {
      label: `# of ${itemName} to Collateralize`,
      description: 'The number of assets to use as collateral',
      value: `${inventory?.quantity}`,
    },
    {
      label: `Market Value of (${itemName} x ${inventory?.quantity})`,
      description: 'The total market value of the collateral',
      value: `$${(oracleData.consensusPrice.toFixed(2) * inventory?.quantity).toFixed(2)}`,
    },
    {
      label: 'Estimated Loan Amount in STRATs',
      description: 'The estimated amount of CATA to earn daily',
      value: (
        <div className="flex -mr-1">
          {parseFloat(inventory?.stratsLoanAmount).toFixed(2)}
          {logo}
        </div>
      ),
    },
  ];

  const dataForSummary = [
    {
      label: `Market price per ${itemName}`,
      description: 'The current market price of the asset',
      value: `$${oracleData.consensusPrice.toFixed(2)}`,
    },
    {
      label: 'Loan to Value Ratio',
      description: 'The ratio of the loan amount to the collateral value',
      value: `${reserves[0]?.loanToValueRatio}%`,
    },
  ];

  const handleSubmit = async () => {
    const body = {
      escrowAddress: inventory?.sale,
      borrowAmount: Math.floor(Number(parseFloat(inventory?.stratsLoanAmount)) * 100) / 100,
      reserve: reserves[0].address,
    };

    const borrowed = await inventoryActions.borrow(inventoryDispatch, body);
    if (borrowed) {
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
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={
        <div className="text-2xl md:text-3xl font-bold pl-4">
          Borrow Position
        </div>
      }
      width={600}
      centered
      footer={null}
    >
      <div className="flex flex-col px-4 pt-4">
        <div className="flex flex-col gap-2">
          {dataForItems.map((item, index) => (
            <div key={index} className="w-full flex justify-between">
              <div className="flex items-center">
                <p className="text-sm text-gray-500">
                  <strong>{item.label}</strong>
                </p>
                <Tooltip title={item.description}>
                  <QuestionCircleOutlined className="ml-1 text-gray-400 cursor-pointer" />
                </Tooltip>
              </div>
              <p className="flex items-center">
                <strong>{item.value}</strong>
              </p>
            </div>
          ))}

          <div className="flex justify-center w-full">
            <Button
              type="primary"
              className="w-full px-6 h-10 font-bold"
              onClick={handleSubmit}
              disabled={isLoader}
              loading={isLoader}
            >
              Borrow
            </Button>
          </div>
        </div>
        <div className="w-full flex flex-col justify-between mt-4 text-xs">
          {dataForSummary.map((item, index) => (
            <div key={index} className="w-full flex justify-between">
              <div className="flex items-center">
                <p>{item.label}</p>
                <Tooltip title={item.description}>
                  <QuestionCircleOutlined className="ml-1 text-gray-400 cursor-pointer" />
                </Tooltip>
              </div>
              <p className="flex items-center">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default BorrowModal;
