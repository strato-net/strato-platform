import { Button, Spin, Typography } from 'antd';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import routes from '../../helpers/routes';
import { REDEMPTION_STATUS } from '../../helpers/constants';
import classNames from 'classnames';

export const ResponsiveRedemptionsCard = ({ data, isLoading, category }) => {
  const navigate = useNavigate();

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
      <div className="flex justify-center">
        <div
          className={classNames(
            textClass,
            'w-full py-1 rounded-xl flex items-center gap-1 p-3'
          )}
        >
          <div
            className={classNames(
              bgClass,
              'flex justify-center h-3 w-3 rounded-sm'
            )}
          ></div>
          <span>{REDEMPTION_STATUS[status]}</span>
        </div>
      </div>
    );
  };

  return (
    <Spin
      wrapperClassName="orders_responsive_cards"
      spinning={isLoading}
      size="large"
    >
      {data.length > 0 ? (
        data.map((item) => {
          return (
            <div className="z-40 border border-[#E9E9E9] w-full rounded-md flex flex-col justify-center items-center gap-3 pb-4">
              <div
                className={`p-2 px-4 w-full flex justify-between bg-[#E9E9E9]`}
              >
                <Typography>Redemption Number</Typography>
                <Typography
                  onClick={() => {
                    if (category === 'outgoing') {
                      navigate(
                        routes.RedemptionsOutgoingDetails.url
                          .replace(':id', item.key)
                          .replace(':redemptionService', item.redemptionService)
                      );
                    } else {
                      navigate(
                        routes.RedemptionsIncomingDetails.url
                          .replace(':id', item.key)
                          .replace(':redemptionService', item.redemptionService)
                      );
                    }
                  }}
                  className={`text-[#13188A] cursor-pointer`}
                >
                  #{item.key}
                </Typography>
              </div>
              <div className={`p-2 px-4 w-full flex justify-between`}>
                <Typography>
                  {category === 'outgoing' ? 'Issuer' : 'Requestor'}
                </Typography>
                <Typography>
                  {category === 'outgoing' ? item.issuer : item.requestor}
                </Typography>
              </div>
              <div className={`p-2 px-4 w-full flex justify-between`}>
                <Typography>Asset Name</Typography>
                <Typography className={`text-[#202020]`}>
                  {item.assetName}
                </Typography>
              </div>
              <div className={`p-2 px-4 w-full flex justify-between`}>
                <Typography>Date</Typography>
                <Typography className={`text-[#202020]`}>
                  {item?.redemptionDate || 'N/A'}
                </Typography>
              </div>
              <div className={`p-2 px-4 w-full flex justify-between`}>
                <Typography>Status</Typography>
                <Typography>{statusComponent(item?.status)}</Typography>
              </div>
              <Button
                onClick={() => {
                  if (category === 'outgoing') {
                    navigate(
                      routes.RedemptionsOutgoingDetails.url
                        .replace(':id', item.key)
                        .replace(':redemptionService', item.redemptionService)
                    );
                  } else {
                    navigate(
                      routes.RedemptionsIncomingDetails.url
                        .replace(':id', item.key)
                        .replace(':redemptionService', item.redemptionService)
                    );
                  }
                }}
                className="w-1/3 text-blue border-blue cursor-pointer"
                size="middle"
              >
                More
              </Button>
            </div>
          );
        })
      ) : (
        <Typography className="text-center text-lg m-6 font-semibold">
          No data
        </Typography>
      )}
    </Spin>
  );
};
