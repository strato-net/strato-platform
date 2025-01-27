import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Radio, notification, Spin } from 'antd';
import { actions } from '../../contexts/issuerStatus/actions';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useIssuerStatusState,
  useIssuerStatusDispatch,
} from '../../contexts/issuerStatus';
import {
  useInventoryState,
  useInventoryDispatch,
} from '../../contexts/inventory';
import { Images } from '../../images';

const logo = <img src={Images.cata} alt={''} title={''} className="w-4 h-4" />;
const USDSTIcon = (
  <img src={Images.USDST} alt={''} title={''} className="w-4 h-4" />
);

export default function AuthorizeIssuer() {
  const { changingIssuerStatus, changingAdminStatus, success, message } =
    useIssuerStatusState();
  const { reserves, isReservesLoading } = useInventoryState();
  const inventoryDispatch = useInventoryDispatch();
  const dispatch = useIssuerStatusDispatch();

  const [totalTvl, setTotalTvl] = useState(0);
  const [totalCataRewards, setTotalCataRewards] = useState(0);
  const onFinish = async (values) => {
    const { commonName, setStatusTo } = values;
    if (setStatusTo === 'Authorized') {
      await actions.authorizeIssuer(dispatch, { commonName });
    } else {
      await actions.deauthorizeIssuer(dispatch, { commonName });
    }
  };
  const onFinishAdmin = async (values) => {
    const { commonName, setStatusTo } = values;
    if (setStatusTo === 'Add') {
      await actions.modifyAdmin(dispatch, { commonName, b: true });
    } else {
      await actions.modifyAdmin(dispatch, { commonName, b: false });
    }
  };

  const [api, contextHolder] = notification.useNotification();
  const openToast = (placement) => {
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

  useEffect(() => {
    if (reserves && reserves.length > 0) {
      const totalTvl = reserves.reduce(
        (sum, reserve) => sum + (reserve.tvl || 0),
        0
      );

      const totalCataRewards = reserves.reduce(
        (sum, reserve) => sum + (reserve.totalCataRewardIssued || 0),
        0
      );

      setTotalTvl(Math.floor(totalTvl));
      setTotalCataRewards(Math.floor(totalCataRewards));
    } else {
      inventoryActions.getAllReserve(inventoryDispatch);
    }
  }, [reserves]);

  return (
    <>
      {contextHolder}
      <div className="flex flex-col items-center justify-center">
        <h2 className="text-xl mb-4">Reserve Status</h2>
        <Spin spinning={isReservesLoading && !reserves} tip="Loading...">
          <div>
            <p>
              <span className="font-bold">Total TVL:</span> $
              {totalTvl.toLocaleString('en-US', {
                maximumFractionDigits: 2,
                minimumFractionDigits: 0,
              })}
            </p>
            <p className="flex items-center">
              <span className="font-bold">Total CATA Rewards Issued:</span>
              &nbsp;{logo} &nbsp;
              {totalCataRewards.toLocaleString('en-US', {
                maximumFractionDigits: 4,
                minimumFractionDigits: 0,
              })}{' '}
              ($
              {(totalCataRewards / 10).toLocaleString('en-US', {
                maximumFractionDigits: 2,
                minimumFractionDigits: 0,
              })}
              )
            </p>
            <p>
              <span className="font-bold">Reserve Count:</span>{' '}
              {reserves?.length}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 justify-center mt-4">
            {reserves &&
              reserves.map((reserve, index) => (
                <div
                  key={index}
                  className="reserve-item p-4 border rounded shadow-md max-w-70"
                >
                  <h3 className="font-bold text-lg mb-2">
                    Reserve: {reserve.name}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="font-bold">APY:</div>
                    <div>{reserve.cataAPYRate}%</div>
                    <div className="font-bold">Rewards Issued:</div>
                    <div className="flex items-center">
                      {logo} &nbsp;
                      {reserve.totalCataRewardIssued?.toLocaleString('en-US', {
                        maximumFractionDigits: 4,
                        minimumFractionDigits: 0,
                      })}{' '}
                      ($
                      {(reserve.totalCataRewardIssued / 10).toLocaleString(
                        'en-US',
                        {
                          maximumFractionDigits: 2,
                          minimumFractionDigits: 0,
                        }
                      )}
                      )
                    </div>
                    <div className="font-bold">TVL:</div>
                    <div>
                      $
                      {reserve.tvl?.toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: 0,
                      })}
                    </div>
                    <div className="font-bold">CATA Balance:</div>
                    <div className="flex flex-col">
                      <div className="flex items-center">
                        {logo} &nbsp;
                        {(
                          reserve.cataTokenObject?.quantity /
                          10 ** 18
                        ).toLocaleString('en-US', {
                          maximumFractionDigits: 4,
                          minimumFractionDigits: 0,
                        })}
                      </div>
                      <div>
                        ($
                        {(
                          reserve.cataTokenObject?.quantity /
                          10 ** 18 /
                          10
                        ).toLocaleString('en-US', {
                          maximumFractionDigits: 2,
                          minimumFractionDigits: 0,
                        })}
                        )
                      </div>
                    </div>
                    <div className="font-bold">USDST Balance:</div>
                    <div className="flex flex-col">
                      <div className="flex items-center">
                        {USDSTIcon} &nbsp;
                        {(
                          reserve?.USDSTTokenObject?.quantity /
                          10 ** 18
                        )?.toLocaleString('en-US', {
                          maximumFractionDigits: 2,
                          minimumFractionDigits: 0,
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Spin>
      </div>

      <Form
        onFinish={onFinish}
        style={{
          padding: '5%',
          margin: 'auto',
          maxWidth: '50em',
        }}
      >
        <p className="text-base md:text-l lg:text-2xl font-bold lg:font-semibold leading-9">
          Change Issuer's Authorization Status
        </p>
        <Form.Item label="Username" name="commonName">
          <Input />
        </Form.Item>
        <Form.Item label="Set issuer status to" name="setStatusTo">
          <Radio.Group>
            <Radio.Button value="Authorized">Authorized</Radio.Button>
            <Radio.Button value="Deauthorized">Deauthorized</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={changingIssuerStatus}>
          Change Issuer Status
        </Button>
      </Form>

      <Form
        onFinish={onFinishAdmin}
        style={{
          padding: '5%',
          margin: 'auto',
          maxWidth: '50em',
        }}
      >
        <p className="text-base md:text-l lg:text-2xl font-bold lg:font-semibold leading-9">
          Add or Remove an Issuer Approver
        </p>
        <Form.Item label="Username" name="commonName">
          <Input />
        </Form.Item>
        <Form.Item label="Action" name="setStatusTo">
          <Radio.Group>
            <Radio.Button value="Add">Add</Radio.Button>
            <Radio.Button value="Remove">Remove</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={changingAdminStatus}>
          Change Issuer Approver Status
        </Button>
      </Form>
      {message && openToast('bottom')}
    </>
  );
}
