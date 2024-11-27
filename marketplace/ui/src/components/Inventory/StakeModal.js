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
import { Images } from '../../images';
import { useLocation } from 'react-router-dom';

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

  const { paymentServices } = usePaymentServiceState();
  const isLoader =
    isStaking || isUnstaking || isFetchingOracle || isreservessLoading;
  const isStaked = inventory.stratsLoanAmount && inventory.stratsLoanAmount > 0;
  const itemName = decodeURIComponent(inventory.name);
  const resAddress = reserves?.length ? reserves[0]?.address : null;
  const oracleData = oracle ? oracle : { consensusPrice: 0 };
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

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
            label: `Quantity to Stake`,
            description: 'The amount of Real World Assets (RWAs) you are staking.',
            value: `${inventory?.quantity}`,
          },
          {
            label: `Market Value`,
            description: 'The total value of your staked assets, calculated as Quantity x Oracle Price.',
            value: `$${
              (oracleData.consensusPrice.toFixed(2) * inventory?.quantity).toFixed(2)
            }`,
          },
          {
            label: 'Daily Estimated Reward (CATA)',
            description: 'The expected daily earnings in CATA tokens from staking your RWAs.',
            value: (
              <div className="flex -mr-1">
                {(
                  ((inventory?.quantity *
                    (isStaked
                      ? inventory.stratsLoanAmount
                      : oracleData.consensusPrice.toFixed(2) *
                        reserves[0]?.loanToValueRatio)) /
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
            label: `Quantity to Unstake`,
            description: 'The amount of Real World Assets (RWAs) you are unstaking.',
            value: `${inventory?.quantity}`,
          },
        ];

  const dataForSummary =
    type === 'Stake'
      ? [
          {
            label: `Market price (per unit)`,
            description: ' The current price of one unit of your RWA, as determined by the oracle.',
            value: `$${oracleData.consensusPrice.toFixed(2)}`,
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
            category && category !== 'All' ? category : undefined,
            queryParams.get('st') === 'true' ? reserves[0].assetRootAddress : ''
          );
        }
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
            category && category !== 'All' ? category : undefined,
            queryParams.get('st') === 'true' ? reserves[0].assetRootAddress : ''
          );
        }
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
          Collateral
        </div>
      }
      width={500}
      centered
      footer={null}
    >
      <div className="flex flex-col px-4 pt-4">
        <div className="flex flex-col gap-4">
          {dataForItems.map((item, index) => (
            <div key={index} className="w-full flex justify-between items-start">
              <div className="flex items-center">
                <p className="text-sm w-44 md:w-full text-gray-500">
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
