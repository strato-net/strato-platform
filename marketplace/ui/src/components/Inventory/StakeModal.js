import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
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
  <img src={Images.strats} alt={''} title={''} className="w-5 h-5" />
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
    isreservessLoading,
    isFetchingOracle,
    reserves,
    oracle,
  } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();

  const { paymentServices } = usePaymentServiceState();
  const isLoader =
    isStaking || isUnstaking || isFetchingOracle || isreservessLoading;
  const isStaked = inventory.stratsLoanAmount && inventory.stratsLoanAmount > 0;
  const itemName = decodeURIComponent(inventory.name);
  const resAddress = reserves?.length ? reserves[0]?.address : null;
  const oracleData = oracle ? oracle : { consensusPrice: 0 };

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
  }, []);

  useEffect(() => {
    if (reserves && inventory.data && !isreservessLoading && !isStaked) {
      inventoryActions.getOracle(inventoryDispatch, reserves[0].oracle);
    }
  }, [resAddress]);

  const dataForItems =
    type === 'Stake'
      ? [
          {
            label: `# of ${inventory?.name} to Collateralize`,
            description: 'The number of assets to use as collateral',
            value: `${inventory?.quantity}`,
          },
          {
            label: `Market Value of ${inventory?.name} x ${inventory?.quantity}`,
            description: 'The total market value of the collateral',
            value: `$${(oracleData.consensusPrice).toFixed(2) * inventory?.quantity}`,
          },
          {
            label: 'Estimated Loan in STRATs',
            description: 'The estimated amount of STRATs to borrow',
            value: (
              <div className="flex -mr-1">
                {isStaked ? inventory.stratsLoanAmount : (oracleData.consensusPrice).toFixed(2) * reserves[0]?.loanToValueRatio}
                {logo}
              </div>
            ),
          },
          {
            label: 'Dailt Estimated Reward (CATA)',
            description: 'The estimated amount of CATA to earn daily',
            value: (
              <div className="flex -mr-1">
                {(
                  ((inventory?.quantity *
                    (isStaked ? inventory.stratsLoanAmount : (oracleData.consensusPrice).toFixed(2) * reserves[0]?.loanToValueRatio)) /
                    100) *
                  (reserves[0]?.cataAPYRate / 100)
                ).toFixed(2)}

                {logo}
              </div>
            ),
          },
        ]
      : [
          {
            label: `# of ${inventory?.name} to Unstake`,
            description: 'The number of assets to unstake',
            value: `${inventory?.quantity}`,
          },
          {
            label: 'Remaining Loan in STRATs',
            description: 'The remaining value after unstaking',
            value: (
              <div className="flex -mr-1">
                {isStaked ? inventory.stratsLoanAmount : (oracleData.consensusPrice).toFixed(2) * reserves[0]?.loanToValueRatio}
                {logo}
              </div>
            ),
          },
        ];

  const dataForSummary =
    type === 'Stake'
      ? [
          {
            label: `Market price per ${inventory?.name}`,
            description: 'The current market price of the asset',
            value: `$${(oracleData.consensusPrice).toFixed(
              2
            )}`,
          },
          {
            label: 'Loan to Value Ratio',
            description:
              'The ratio of the loan amount to the market value of the collateral',
            value: `${reserves[0]?.loanToValueRatio}%`,
          },
        ]
      : [];

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
        reserve: reserves[0].address,
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
        escrowAddress: inventory?.sale,
        reserve: reserves[0].address,
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
        <div className="text-2xl md:text-3xl font-bold pl-4">
          Collateral: {itemName}
        </div>
      }
      width={600}
      centered
      footer={null}
    >
      <div className="flex flex-col px-4 pt-4">
        <p className="text-sm text-gray-500">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
          eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
          minim veniam, quis nostrud exercitation ullamco laboris nisi ut
          aliquip ex ea commodo consequat. Duis aute irure dolor in
          reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
          pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
          culpa qui officia deserunt mollit anim id est laborum.
        </p>
        <h3 className="text-xl font-bold mt-4 mb-2">Borrow Position</h3>
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
              {type}
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

export default StakeModal;
