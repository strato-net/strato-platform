import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Breadcrumb,
  Typography,
  Divider,
  Input,
  Spin,
  notification,
} from 'antd';
import { useMatch } from 'react-router-dom';
import { actions } from '../../contexts/redemption/actions';
import {
  useRedemptionDispatch,
  useRedemptionState,
} from '../../contexts/redemption';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import routes from '../../helpers/routes';
import { REDEMPTION_STATUS } from '../../helpers/constants';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import DataTableComponent from '../DataTableComponent';
import ClickableCell from '../ClickableCell';

const RedemptionsOutgoingDetails = ({ user }) => {
  const [id, setId] = useState(undefined);
  const [redemptionService, setRedemptionService] = useState(undefined);
  const dispatch = useRedemptionDispatch();
  const { Text } = Typography;
  const { TextArea } = Input;
  const [api, contextHolder] = notification.useNotification();
  const { redemption, isFetchingRedemptionDetails } = useRedemptionState();
  const inventoryDispatch = useInventoryDispatch();
  let { inventoryDetails, isInventoryDetailsLoading } = useInventoryState();
  const navigate = useNavigate();

  const routeMatch = useMatch({
    path: routes.RedemptionsOutgoingDetails.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.id);
    setRedemptionService(routeMatch?.params?.redemptionService);
  }, [routeMatch]);

  useEffect(() => {
    if (id !== undefined && redemptionService !== undefined) {
      const getData = async () => {
        await actions.fetchRedemptionDetail(dispatch, redemptionService, id);
      };
      getData();
    }
  }, [id, redemptionService, dispatch]);

  useEffect(() => {
    if (redemption && user) {
      if (redemption.ownerCommonName !== user.commonName) {
        navigate(routes.Marketplace.url);
        return;
      }
      const fetchAsset = async () => {
        await inventoryActions.fetchInventoryDetail(
          inventoryDispatch,
          redemption.assetAddresses[0]
        );
      };
      fetchAsset();
    }
  }, [redemption, inventoryDispatch, user]);

  const OrderData = ({ title, value }) => {
    return (
      <Col>
        <Text className="flex flex-col items-center text-[#6A6A6A] text-[13px] mb-2">
          {title}
        </Text>
        <Text className="flex flex-col items-center text-[#202020] text-[17px] font-semibold">
          {value}
        </Text>
      </Col>
    );
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

  const statusComponent = (status) => {
    const statusClasses = {
      [REDEMPTION_STATUS.PENDING]: {
        textClass: 'bg-[#FF8C0033]',
        bgClass: 'bg-[#FF8C00]',
      },
      [REDEMPTION_STATUS.REJECTED]: {
        textClass: 'bg-[#FFF0F0]',
        bgClass: 'bg-[#FF0000]',
      },
      [REDEMPTION_STATUS.FULFILLED]: {
        textClass: 'bg-[#119B2D33]',
        bgClass: 'bg-[#119B2D]',
      },
    };

    const { textClass, bgClass } = statusClasses[status] || {};
    return (
      <div
        className={classNames(
          textClass,
          'status_contain w-max text-center py-1 px-2 rounded-md md:rounded-xl flex justify-start items-center gap-1 p-1'
        )}
      >
        <div className={classNames(bgClass, 'h-3 w-3 rounded-sm')}></div>
        <p className="!mb-0 text-[11px] md:text-sm">
          {REDEMPTION_STATUS[status]}
        </p>
      </div>
    );
  };

  inventoryDetails = {
    ...inventoryDetails,
    images:
      inventoryDetails &&
      Array.isArray(inventoryDetails['BlockApps-Mercata-Asset-images'])
        ? inventoryDetails['BlockApps-Mercata-Asset-images'][0].value
        : [],
  };

  let column = [
    {
      title: '',
      dataIndex: 'images',
      key: 'images',
      render: (text) => (
        <img className="w-[75px] h-[60px] object-contain" alt="" src={text} />
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Product Name</Text>,
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <p
          className="text-primary text-[17px] cursor-pointer"
          onClick={() => {
            navigate(
              `${routes.MarketplaceProductDetail.url.replace(':address', record.address).replace(':name', encodeURIComponent(record.name))}`
            );
          }}
        >
          {decodeURIComponent(record?.name)}
        </p>
      ),
    },
    {
      title: <Text className="text-primaryC text-[13px]">Quantity</Text>,
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'center',
      render: (text) => <p>{text}</p>,
    },
  ];

  return (
    <div>
      {contextHolder}
      {redemption === undefined ||
      inventoryDetails == undefined ||
      isFetchingRedemptionDetails ||
      isInventoryDetailsLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isFetchingRedemptionDetails} size="large" />
        </div>
      ) : (
        <div>
          <Breadcrumb className="text-sm ml-4 md:ml-20  mt-0 md:mt-5 mb-2">
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-primary font-semibold">Home</p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <div
                onClick={() => {
                  navigate(routes.Transactions.url);
                }}
              >
                <p className="text-sm text-primary font-semibold">
                  My Transactions
                </p>
              </div>
            </Breadcrumb.Item>
            <Breadcrumb.Item className="text-sm text-[#202020] font-medium">
              {redemption.redemption_id}
            </Breadcrumb.Item>
          </Breadcrumb>
          <div className="mb-10 lg:px-10">
            <Card className="md:p-2 mb-4 md:mb-14 md:shadow-card_shadow order_detail_card">
              <div className="flex flex-col md:flex-row md:justify-between">
                <div className="flex flex-col">
                  <div className="flex">
                    <Text className="bg-[#E9E9E9] md:bg-white py-2 px-3 w-full md:bg-none font-semibold text-sm md:text-lg text-primaryB flex gap-4 items-center">
                      Redemption Details
                    </Text>
                  </div>
                </div>
              </div>
              <Row className="hidden md:flex my-6 justify-between bg-[#F6F6F6] py-4 px-12 rounded">
                <OrderData
                  title="Redemption Number"
                  value={`#${redemption.redemption_id}`}
                />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData title="Issuer" value={redemption.issuerCommonName} />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData title="Quantity" value={redemption.quantity} />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData title="Date" value={redemption.createdDate} />
                <Divider type="vertical" className="h-14 bg-secondryD" />
                <OrderData
                  title="Status"
                  value={statusComponent(redemption.status)}
                />
              </Row>
              <Row className="my-2 md:hidden flex-col gap-[6px] justify-between p-4 rounded">
                <div className="flex gap-4">
                  <NewOrderData
                    className="w-2/4"
                    title="Redemption Number"
                    value={'#' + redemption.redemption_id}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Issuer"
                    value={redemption.issuerCommonName}
                  />
                </div>
                <div className="flex gap-4">
                  <NewOrderData
                    className="w-2/4"
                    title="Requestor"
                    value={redemption.ownerCommonName}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Asset Name"
                    value={redemption.assetName}
                  />
                </div>
                <div className="flex justify-between mobile_order_detail_card">
                  <NewOrderData
                    className="w-2/4"
                    title="Date"
                    value={redemption.createdDate}
                  />
                  <NewOrderData
                    className="w-2/4"
                    title="Status"
                    value={statusComponent(redemption.status)}
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
                    value={redemption.issuerComments}
                    disabled
                  />
                </div>
              </Row>
              <div className="md:block hidden">
                <DataTableComponent
                  columns={column}
                  data={[inventoryDetails]}
                  scrollX="100%"
                  isLoading={isInventoryDetailsLoading}
                />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default RedemptionsOutgoingDetails;
