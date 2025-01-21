import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Breadcrumb,
  Typography,
  Divider,
  notification,
  Input,
  Button,
  Spin,
} from 'antd';
import { Link, useMatch } from 'react-router-dom';
import { actions } from '../../contexts/order/actions';
import { useOrderDispatch, useOrderState } from '../../contexts/order';
import { useMarketplaceState } from '../../contexts/marketplace';
import routes from '../../helpers/routes';
import classNames from 'classnames';
import { EyeOutlined } from '@ant-design/icons';
import DataTableComponent from '../DataTableComponent';
import { getStringDate } from '../../helpers/utils';
import { getStatus } from './constant';
import { useNavigate } from 'react-router-dom';
import { US_DATE_FORMAT } from '../../helpers/constants';
import ClickableCell from '../ClickableCell';
import image_placeholder from '../../images/resources/image_placeholder.png';
import { ResponsiveOrderDetailCard } from './ResponsiveOrderDetailCard';
import { LeftArrow } from '../../images/SVGComponents';

const BoughtOrderDetails = ({ user, users }) => {
  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  const [comment, setcomment] = useState('');
  const [Id, setId] = useState(undefined);
  const [data, setdata] = useState([]);
  const dispatch = useOrderDispatch();
  const { Text } = Typography;
  const [api, contextHolder] = notification.useNotification();
  const [status, setStatus] = useState(getStatus(0));
  const { TextArea } = Input;
  const [paid, setPaid] = useState('Processing');
  const { assetsWithEighteenDecimalPlaces } = useMarketplaceState();

  const navigate = useNavigate();

  const openToastOrder = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  const {
    orderDetails,
    isorderDetailsLoading,
    isbuyerDetailsUpdating,
    success,
    message,
  } = useOrderState();
  const details = orderDetails;

  const routeMatch = useMatch({
    path: routes.BoughtOrderDetails.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      getData();
    }
  }, [Id, dispatch]);

  const getData = async () => {
    await actions.fetchOrderDetails(dispatch, Id);
  };

  useEffect(() => {
    if (orderDetails) {
      const statusInt = parseInt(orderDetails.order.status);
      setStatus(getStatus(statusInt));
      if (statusInt === 3) {
        setPaid('Paid');
      } else if (statusInt === 4) {
        setPaid('Canceled');
      }
      setcomment(orderDetails.order.comments);
      const orderQuantities = orderDetails.order.quantities
        ? orderDetails.order.quantities
        : orderDetails.order['BlockApps-Mercata-Order-quantities'].map(
            (item) => item.value
          );
      let items = [];
      orderDetails.assets.forEach((prod, index) => {
        const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
          prod.root
        );
        const productPrice = is18DecimalPlaces
          ? (prod.price * Math.pow(10, 18)).toFixed(2)
          : prod.price;
        const productQuantity = is18DecimalPlaces
          ? orderQuantities[index] / Math.pow(10, 18)
          : orderQuantities[index];
        items.push({
          address: prod.address,
          chainId: prod.chainId,
          key: prod.address,
          productImage:
            prod['BlockApps-Mercata-Asset-images'].length > 0
              ? prod['BlockApps-Mercata-Asset-images'][0].value
              : image_placeholder,
          productName: prod,
          name: prod.name,
          unitPrice: productPrice,
          quantity: productQuantity
            ? formattedNum(productQuantity.toFixed(0))
            : '--',
          amount: formattedNum(
            (
              productPrice *
              (orderQuantities[index] / Math.pow(10, 18))
            ).toFixed(2)
          ),
          serialNumber: prod,
          tax: prod.tax ? prod.tax : 0,
        });
      });
      setdata(items);
    }
  }, [orderDetails, assetsWithEighteenDecimalPlaces]);

  const OrderData = ({ title, value }) => {
    return (
      <Col>
        <Text className="block text-[#6A6A6A] text-[13px] mb-2">{title}</Text>
        <Text
          id={title}
          className="block text-[#202020] text-[17px] font-semibold"
        >
          {value}
        </Text>
      </Col>
    );
  };

  const statusComponent = (status) => {
    const statusClasses = {
      ['Awaiting Shipment']: {
        textClass: 'bg-[#EBF7FF]',
        bgClass: 'bg-[#13188A]',
      },
      ['Awaiting Fulfillment']: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      ['Payment Pending']: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      ['Closed']: {
        textClass: 'bg-[#119B2D33]',
        bgClass: 'bg-[#119B2D]',
      },
      ['Canceled']: {
        textClass: 'bg-[#FFF0F0]',
        bgClass: 'bg-[#FF0000]',
      },
    };

    const { textClass, bgClass } = statusClasses[status] || {
      textClass: 'bg-[#FFF6EC]',
      bgClass: 'bg-[#119B2D]',
    };
    return (
      <div
        className={classNames(
          textClass,
          'status_contain w-max h-max text-center py-1 px-3 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1'
        )}
      >
        <div className={classNames(bgClass, 'h-3 w-3 rounded-sm')}></div>
        <p className="!mb-0 text-[11px] md:text-sm">{status}</p>
      </div>
    );
  };

  const statusComponentForPayment = (status) => {
    const statusClasses = {
      ['Processing']: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      ['Paid']: {
        textClass: 'bg-[#119B2D33]',
        bgClass: 'bg-[#119B2D]',
      },
      ['Payment Failed']: {
        textClass: 'bg-[#FFF0F0]',
        bgClass: 'bg-[#FF0000]',
      },
      ['Canceled']: {
        textClass: 'bg-[#FFF0F0]',
        bgClass: 'bg-[#FF0000]',
      },
    };

    const { textClass, bgClass } = statusClasses[status] || {
      textClass: 'bg-[#FFF6EC]',
      bgClass: 'bg-[#119B2D]',
    };
    return (
      <div
        className={classNames(
          textClass,
          'status_contain w-max h-max text-center py-1 px-3 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1'
        )}
      >
        <div className={classNames(bgClass, 'h-3 w-3 rounded-sm')}></div>
        <p className="!mb-0 text-xs md:text-sm">{status}</p>
      </div>
    );
  };

  const onChange = (key) => {
    navigate(routes.Transactions.url);
  };

  const NewOrderData = ({ title, value, className }) => {
    return (
      <div className={className}>
        <Text className="block text-[#6A6A6A] text-[12px] mb-1">{title}</Text>
        <Text className="block text-[#202020] text-[13px] font-semibold">
          {value}
        </Text>
      </div>
    );
  };

  let column = [
    {
      title: '',
      dataIndex: 'productImage',
      key: 'productImage',
      render: (text) => (
        <img className="w-[75px] h-[60px] object-contain" alt="" src={text} />
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Product Name</Text>,
      dataIndex: 'productName',
      key: 'productName',
      render: (text) => (
        <p
          // href={routes.BoughtOrderDetails.url}
          id="detail-productName"
          className="text-primary text-[17px] cursor-pointer"
          onClick={() => {
            navigate(
              `${routes.MarketplaceProductDetail.url
                .replace(':address', text.address)
                .replace(':name', encodeURIComponent(text.name))}`
            );
          }}
        >
          {decodeURIComponent(text.name)}
        </p>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Serial Number</Text>,
      dataIndex: 'serialNumber',
      key: 'serialNumber',
      align: 'center',
      render: (text) => (
        <div className="flex items-center justify-center">
          <EyeOutlined className="mr-2 hover:text-primaryHover cursor-pointer" />
          <p
            onClick={() => {
              navigate(
                `${routes.BoughtOrderItemDetail.url.replace(
                  ':id',
                  text.address
                )}`,
                // .replace(":chainId", text.chainId)}`,
                { state: { orderId: details.orderId, address: Id } }
              );
            }}
            className="hover:text-primaryHover cursor-pointer"
          >
            View
          </p>
        </div>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Unit Price</Text>,
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      align: 'center',
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">Quantity</Text>,
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'center',
      render: (text) => <p>{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">Amount</Text>,
      dataIndex: 'amount',
      key: 'amount',
      align: 'center',
      render: (text) => <p id="detail-amount">{text}</p>,
    },
    {
      title: 'Invoice',
      dataIndex: 'invoice',
      key: 'invoice',
      render: (text) => (
        <button>
          <Link
            to={`${routes.Invoice.url.replace(':id', routeMatch?.params?.id)}`}
            target="_blank"
          >
            <div className="flex items-center cursor-pointer hover:text-primary">
              <EyeOutlined className="mr-2" />
              <p>View</p>
            </div>
          </Link>
        </button>
      ),
    },
  ];

  if (data[0] && !data[0].serialNumber.containsSerialNumber) {
    column = column.filter((col) => col.dataIndex !== 'serialNumber');
  }

  const handleCancelOrder = async () => {
    const body = {
      paymentService: {
        address: details.order.address,
      },
      orderHash: details.order.orderHash,
      orderId: details.order.orderId,
      purchaser: details.order.purchaser,
      saleAddresses: details.order.saleAddresses,
      quantities: details.order.quantities,
      currency: details.order.currency,
      createdDate: details.order.createdDate,
    };
    let isDone = await actions.cancelSale(dispatch, body);
    if (isDone) {
      setStatus('Canceled');
    }
  };

  return (
    <div>
      {contextHolder}
      <div>
        <Breadcrumb className="text-sm ml-4 md:ml-20 mt-4 md:mt-5 mb-2">
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">Home</p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <div
              onClick={() => {
                navigate(routes.Transactions.url);
              }}
            >
              <p className="text-sm text-[#13188A] font-semibold">
                My Transactions
              </p>
            </div>
          </Breadcrumb.Item>
          <Breadcrumb.Item className="text-sm font-medium text-[#202020]">
            {`#${`${details?.order?.orderId || ''}`.substring(0, 6)}`}
          </Breadcrumb.Item>
        </Breadcrumb>

        <div className="mb-10 lg:px-10">
          <Button
            type="ghost"
            onClick={() => onChange('bought')}
            className="cursor-pointer mb-1 px-2 flex md:hidden items-center gap-2 text-sm font-semibold"
          >
            <LeftArrow /> Back
          </Button>
          {details === null ||
          isorderDetailsLoading ||
          isbuyerDetailsUpdating ? (
            <div className="h-screen flex justify-center items-center">
              <Spin
                spinning={isorderDetailsLoading || isbuyerDetailsUpdating}
                size="large"
              />
            </div>
          ) : (
            <Card className="md:p-2 mb-4 md:mb-14 md:shadow-card_shadow order_detail_card">
              <div className="flex flex-col md:flex-row md:justify-between">
                <div className="flex flex-col">
                  <div className="flex">
                    <Text className="bg-[#E9E9E9] md:bg-white py-2 px-3 w-full md:w-3.5/5 md:bg-none font-semibold text-sm md:text-lg text-primaryB flex gap-4 items-center">
                      Order Details
                    </Text>
                    <Text className="hidden md:flex mt-2">
                      {statusComponentForPayment(paid)}
                    </Text>
                  </div>
                </div>
              </div>
              <Row className="hidden md:flex my-6 justify-between bg-[#F6F6F6] p-4 pb-2 rounded">
                <OrderData
                  title="Order Number"
                  value={`#${`${details.order.orderId}`.substring(0, 6)}`}
                />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData
                  title="Buyer"
                  value={details.order.purchasersCommonName}
                />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData
                  title="Seller"
                  value={details.order.sellersCommonName}
                />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData
                  title="Currency"
                  value={details.order.currency || 'USD'}
                />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData title="Total" value={details.order.totalPrice} />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData
                  title="Date"
                  value={getStringDate(
                    details.order.createdDate,
                    US_DATE_FORMAT
                  )}
                />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <Col>
                  <Text className="block text-primaryC text-[13px] mb-2">
                    Status
                  </Text>
                  {statusComponent(status)}
                </Col>
              </Row>
              <Row className="my-2 md:hidden flex-col gap-[6px] justify-between p-4 pb-0 rounded">
                <Col span={24} className="bg-[#E9E9E9]">
                  <div className="flex justify-between items-center px-2 h-12 rounded-xl">
                    {' '}
                    <span>Invoice</span>
                    <button>
                      <Link
                        to={`${routes.Invoice.url.replace(
                          ':id',
                          routeMatch?.params?.id
                        )}`}
                        target="_blank"
                      >
                        <div className="flex items-center cursor-pointer hover:text-primary">
                          <EyeOutlined className="mr-2" />
                          <p>View</p>
                        </div>
                      </Link>
                    </button>{' '}
                  </div>
                </Col>
                <div className="flex gap-4">
                  <NewOrderData
                    className="w-2/4"
                    title="Order Number"
                    value={'#' + `${details.order.orderId}`.substring(0, 6)}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Buyer"
                    value={details.order.purchasersCommonName}
                  />
                </div>
                <div className="flex gap-4">
                  <NewOrderData
                    className="w-2/4"
                    title="Seller"
                    value={details.order.sellersCommonName}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Currency"
                    value={
                      details.order.currency ? details.order.currency : 'USD'
                    }
                  />
                </div>
                <div className="flex gap-4">
                  <NewOrderData
                    className="w-2/4"
                    title="Total"
                    value={details.order.totalPrice}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Date"
                    value={getStringDate(
                      details.order.createdDate,
                      US_DATE_FORMAT
                    )}
                  />
                </div>
                <div className="flex gap-4">
                  <NewOrderData
                    className="w-2/4"
                    title="Payment Status"
                    value={statusComponentForPayment(paid)}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Status"
                    value={statusComponent(status)}
                  />
                </div>
              </Row>
              <Row className="flex-nowrap items-center justify-between mb-2 md:mb-6 p-2">
                <div className="w-full">
                  <Text className="block text-primaryC text-[13px] mb-2">
                    Comments
                  </Text>
                  <TextArea
                    rows={2}
                    placeholder="Enter Comments"
                    value={decodeURIComponent(comment)}
                    disabled={true}
                    onChange={(event) => {
                      setcomment(event.target.value);
                    }}
                  />
                </div>
              </Row>

              <div className="hidden md:block">
                <DataTableComponent
                  columns={column}
                  data={data}
                  isLoading={false}
                  scrollX="100%"
                />
              </div>
            </Card>
          )}
          {data?.length > 0 &&
            data?.map((item) => {
              return <ResponsiveOrderDetailCard data={item} />;
            })}
        </div>
      </div>

      {message && openToastOrder('bottom')}
    </div>
  );
};

export default BoughtOrderDetails;
