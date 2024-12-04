import React, { useEffect, useRef } from 'react';
import { Typography, Spin } from 'antd';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useAuthenticateState } from '../../contexts/authentication';
import NewVaultCard from './NewVaultCard';
import { Fade } from 'react-awesome-reveal';

const { Title } = Typography;

const TrendingVaultCard = () => {
  const containerRef = useRef(null);

  const dispatch = useInventoryDispatch();
  const { isReservesLoading, reserves } = useInventoryState();
  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();

  useEffect(() => {
    actions.getAllReserve(dispatch);
  }, [dispatch, hasChecked, isAuthenticated, loginUrl]);

  return (
    <div>
      <Fade triggerOnce>
        <div className="pt-5 pr-2 md:pr-10 flex justify-between">
          <Title className="md:px-10 !text-xl md:!text-4xl !text-left">
            Available Vaults
          </Title>
        </div>
      </Fade>
      {isReservesLoading || !reserves ? (
        <div className="h-52 flex justify-center items-center">
          <Spin spinning={isReservesLoading} size="large" />
        </div>
      ) : (
        <Fade direction="right" triggerOnce>
          <div className="relative md:pl-10">
            <div
              ref={containerRef}
              className="overflow-x-auto gap-6 px-1 py-2 flex trending_cards"
            >
              {reserves.map((reserveItem) => {
                return <NewVaultCard reserveItem={reserveItem} />;
              })}
            </div>
          </div>
        </Fade>
      )}
    </div>
  );
};

export default TrendingVaultCard;
