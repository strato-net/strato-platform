import { Button, Modal, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useEffect } from 'react';

import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';

import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import { Images } from '../../images';

const logo = (
  <img src={Images.strats} alt={''} title={''} className="w-5 h-5" />
);

const RepayModal = ({
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
    isRepaying
  } = useInventoryState();
  // Dispatch
  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const paymentServiceDispatch = usePaymentServiceDispatch();

  const { paymentServices } = usePaymentServiceState();
  const isStaked = inventory.sale && inventory.price <= 0;
  const itemName = decodeURIComponent(inventory.name);

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
  }, []);

  const dataForItems = [
    {
      label: `Loan to pay off in STRATs`,
      description: 'The amount of CATA to pay off the loan',
      value: (
        <div className="flex -mr-1">
          {inventory?.borrowedAmount}
          {logo}
        </div>
      ),
    },
  ];

  const dataForSummary = [];

  const handleSubmit = async () => {
    const stratsService = paymentServices.find(
      (item) => item.serviceName === 'STRATS' && item.creator === 'Server'
    );
    const body = {
      escrow: inventory?.sale,
      stratsPaymentService: stratsService.address,
    };

    const borrowed = await inventoryActions.repay(inventoryDispatch, body);
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
        <div className="text-2xl md:text-3xl font-bold pl-4">Loan Position</div>
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
              loading={isRepaying}
            >
              Repay
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

export default RepayModal;
