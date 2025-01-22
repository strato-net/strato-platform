import {
  Button,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tag,
  Table,
  Typography,
} from 'antd';
import BigNumber from 'bignumber.js';
import { useEffect, useState } from 'react';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import { CheckCircleOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';

const { Option } = Select;

const ListForSaleModal = ({
  open,
  handleCancel,
  inventory,
  categoryName,
  limit,
  offset,
  user,
  debouncedSearchTerm,
  category,
  reserves,
  assetsWithEighteenDecimalPlaces,
}) => {
  const [data, setData] = useState([inventory]);
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
    inventory.originAddress
  );
  const [quantity, setQuantity] = useState(() => {
    const selectedQuantity = new BigNumber(
      inventory.saleAddress ? inventory.saleQuantity : inventory.quantity
    );
    return is18DecimalPlaces
      ? selectedQuantity.dividedBy(Math.pow(10, 18))
      : selectedQuantity;
  });
  const [paymentTypes, setPaymentTypes] = useState([]);
  const [availablePaymentServices, setAvailablePaymentServices] = useState([]);
  const [pricePerUnit, setpricePerUnit] = useState(() => {
    return inventory.price
      ? is18DecimalPlaces
        ? inventory.price * Math.pow(10, 18)
        : inventory.price
      : 0.01;
  });

  const inventoryDispatch = useInventoryDispatch();
  const [canList, setCanList] = useState(true);
  const { isListing, issaleUpdating } = useInventoryState();
  const {
    paymentServices,
    arePaymentServicesLoading,
    notOnboarded,
    areNotOnboardedLoading,
  } = usePaymentServiceState();
  const paymentServiceDispatch = usePaymentServiceDispatch();

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
    paymentServiceActions.getNotOnboarded(
      paymentServiceDispatch,
      user?.commonName,
      10,
      0
    );
  }, [paymentServiceDispatch, user]);

  useEffect(() => {
    if (
      inventory.saleAddress
        ? quantity.gt(
            new BigNumber(inventory.quantity).minus(
              new BigNumber(inventory.totalLockedQuantity)
            )
          )
        : quantity.gt(new BigNumber(inventory.quantity))
    ) {
      setCanList(false);
    } else if (
      quantity.lte(0) ||
      pricePerUnit < 0.01 ||
      !pricePerUnit ||
      paymentTypes.length < 1 ||
      (paymentTypes.length === 1 && paymentTypes[0] === -1)
    ) {
      setCanList(false);
    } else {
      setCanList(true);
    }
  }, [quantity, pricePerUnit, paymentTypes]);

  const renderImg = (service) => {
    return service.imageURL && service.imageURL !== '' ? (
      <img
        src={service.imageURL}
        alt={service.serviceName}
        height="16px"
        width="16px"
      />
    ) : (
      ''
    );
  };

  const handleSelect = (values) => {
    const USDSTIndex = availablePaymentServices.findIndex((service) =>
      service.serviceName.toLowerCase().includes('usdst')
    );

    // Ensure 'usdst' service is always selected
    if (USDSTIndex !== -1 && !values.includes(USDSTIndex)) {
      values = [USDSTIndex, ...values];
    }
    setPaymentTypes(values);
  };

  useEffect(() => {
    const excludeUSDST =
      inventory.name &&
      inventory.name.toLowerCase().includes('usdst');

    const diff = paymentServices.filter((ps) => {
      const isNotOnboarded = !notOnboarded.some(
        (x) => x.address === ps.address
      );
      const isUSDSTService =
        excludeUSDST && ps.serviceName.toLowerCase().includes('usdst');
      return isNotOnboarded && !isUSDSTService;
    });

    setAvailablePaymentServices(diff);

    const inventoryPaymentServices = inventory.paymentServices
      ? inventory.paymentServices
          .filter((provider) => provider.value)
          .map((provider) => provider.value)
      : [];

    const selectedPaymentServiceIndices = inventoryPaymentServices.map(
      (inventoryPS) =>
        diff.findIndex(
          (ps) =>
            ps.creator === inventoryPS.creator &&
            ps.serviceName === inventoryPS.serviceName
        )
    );

    const USDSTIndex = diff.findIndex((ps) =>
      ps.serviceName.toLowerCase().includes('usdst')
    );

    // Auto-select 'usdst' if it exists
    if (
      USDSTIndex !== -1 &&
      !selectedPaymentServiceIndices.includes(USDSTIndex)
    ) {
      selectedPaymentServiceIndices.push(USDSTIndex);
    }

    setPaymentTypes(selectedPaymentServiceIndices);
  }, [paymentServices, notOnboarded, inventory.paymentServices]);

  const tagRender = (props) => {
    const { value, closable, onClose } = props;
    const service = availablePaymentServices[value];
    const isUSDSTService = service?.serviceName
      .toLowerCase()
      .includes('usdst');
    const onPreventMouseDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    return service ? (
      <Tag
        onMouseDown={onPreventMouseDown}
        closable={!isUSDSTService && closable} // prevent closing if it's 'usdst'
        onClose={onClose}
        className="flex items-center mr-1"
      >
        {service.serviceName}&nbsp;
        {renderImg(service)}
      </Tag>
    ) : (
      ''
    );
  };

  const handleSubmit = async () => {
    const USDSTService = availablePaymentServices.find((service) =>
      service.serviceName.toLowerCase().includes('usdst')
    );

    let body = {
      paymentServices: paymentTypes
        .filter((p) => availablePaymentServices[p])
        .map((p) => {
          return {
            creator: availablePaymentServices[p].creator,
            serviceName: availablePaymentServices[p].serviceName,
          };
        }),
      price:
        pricePerUnit !== undefined && is18DecimalPlaces
          ? pricePerUnit / Math.pow(10, 18)
          : pricePerUnit,
    };

    // Ensure 'usdst' is included in the submission
    if (
      USDSTService &&
      !body.paymentServices.some((service) =>
        service.serviceName.toLowerCase().includes('usdst')
      )
    ) {
      body.paymentServices.push({
        creator: USDSTService.creator,
        serviceName: USDSTService.serviceName,
      });
    }

    if (inventory.saleAddress) {
      body = { ...body, saleAddress: inventory.saleAddress };
    } else {
      body = { ...body, assetToBeSold: inventory.address };
    }

    body = {
      ...body,
      quantity: (is18DecimalPlaces
        ? quantity.multipliedBy(new BigNumber(10).pow(18))
        : quantity
      ).toFixed(0),
    };

    let isDone;

    if (inventory.saleAddress) {
      isDone = await actions.updateSale(inventoryDispatch, body);
    } else {
      isDone = await actions.listInventory(inventoryDispatch, body);
    }

    if (isDone) {
      await actions.fetchInventory(
        inventoryDispatch,
        limit,
        offset,
        debouncedSearchTerm,
        category && category !== 'All' ? category : undefined,
        queryParams.get('st') === 'true' ||
          window.location.pathname === '/stake'
          ? reserves.map((reserve) => reserve.assetRootAddress)
          : ''
      );
      handleCancel();
    }
  };

  const columns = () => {
    let finalColumns = [
      {
        title: 'Payment Type(s)',
        align: 'center',
        render: () => (
          <Select
            id="paymentTypes"
            mode="multiple"
            tagRender={tagRender}
            placeholder="Select Payment Types"
            name="paymentTypes"
            maxTagCount="responsive"
            value={paymentTypes}
            onChange={handleSelect}
            showSearch={false}
            className="w-64"
            popupClassName="custom-select-no-tick"
          >
            {!arePaymentServicesLoading ? (
              availablePaymentServices.map((e, index) => (
                <Option
                  key={index}
                  value={index}
                  disabled={e.serviceName.toLowerCase().includes('usdst')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      {e.serviceName}
                      &nbsp;
                      {renderImg(e)}
                    </div>
                    {paymentTypes.includes(index) && (
                      <CheckCircleOutlined className="custom-check-icon" />
                    )}
                  </div>
                </Option>
              ))
            ) : (
              <div className="absolute left-[50%] md:top-4">
                <Spin size="large" />
              </div>
            )}
          </Select>
        ),
      },
      {
        title: 'Quantity',
        align: 'center',
        render: () => (
          <InputNumber
            value={quantity}
            controls={false}
            min={1}
            max={
              is18DecimalPlaces
                ? new BigNumber(inventory.quantity).dividedBy(
                    new BigNumber(10).pow(18)
                  )
                : inventory.quantity
            }
            onChange={(value) => setQuantity(new BigNumber(value))}
          />
        ),
      },
      {
        title: 'Unit Price ($)',
        align: 'center',
        render: () => (
          <InputNumber
            value={pricePerUnit}
            controls={false}
            min={0.01}
            onChange={(value) => setpricePerUnit(value)}
            precision={2}
          />
        ),
      },
    ];

    return finalColumns;
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={`${
        inventory.saleAddress ? 'Update' : 'List'
      } - ${decodeURIComponent(inventory.name)}`}
      width={800}
      footer={[
        <div className="flex justify-center md:block">
          <Button
            id="asset-update-list"
            type="primary"
            className="w-32 h-9"
            onClick={handleSubmit}
            disabled={!canList}
            loading={inventory.saleAddress ? issaleUpdating : isListing}
          >
            {inventory.saleAddress ? 'Update' : 'List'}
          </Button>
        </div>,
      ]}
    >
      <div className="head hidden md:block">
        <Table columns={columns()} dataSource={data} pagination={false} />
      </div>
      <div className="flex gap-5 flex-col justify-center md:hidden mt-5">
        <div className="w-full">
          <Typography className="text-[#202020] text-sm font-medium">
            Payment Type (s)
          </Typography>
          <Select
            id="paymentTypes"
            mode="multiple"
            tagRender={tagRender}
            placeholder="Select Payment Types"
            name="paymentTypes"
            maxTagCount="responsive"
            value={paymentTypes}
            onChange={handleSelect}
            showSearch={false}
            className="w-full"
            popupClassName="custom-select-no-tick"
          >
            {availablePaymentServices.map((e, index) => (
              <Option
                key={index}
                value={index}
                disabled={e.serviceName.toLowerCase().includes('usdst')}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    {e.serviceName}&nbsp;
                    {renderImg(e)}
                  </div>

                  {paymentTypes.includes(index) && (
                    <CheckCircleOutlined className="custom-check-icon" />
                  )}
                </div>
              </Option>
            ))}
          </Select>
        </div>
        <div className="w-full">
          <Typography className="text-[#202020] text-sm font-medium">
            Quantity
          </Typography>
          <InputNumber
            className="w-full h-9"
            value={quantity}
            controls={false}
            max={
              is18DecimalPlaces
                ? new BigNumber(inventory.quantity).dividedBy(
                    new BigNumber(10).pow(18)
                  )
                : inventory.quantity
            }
            onChange={(value) => setQuantity(new BigNumber(value))}
          />
        </div>
        <div>
          <Typography className="text-[#202020] text-sm font-medium">
            Unit Price ($)
          </Typography>
          <InputNumber
            className="w-full h-9"
            value={pricePerUnit}
            controls={false}
            min={0.01}
            onChange={(value) => setpricePerUnit(value)}
            precision={2}
          />
        </div>
      </div>
    </Modal>
  );
};

export default ListForSaleModal;
