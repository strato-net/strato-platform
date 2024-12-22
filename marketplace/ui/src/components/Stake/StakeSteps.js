import React from 'react';
import { useAuthenticateState } from '../../contexts/authentication';

const StakeSteps = () => {
  const { loginUrl } = useAuthenticateState();

  return (
    <div className="bg-[#f3f4f6] p-6 rounded-md">
      <h2 className="text-center text-2xl font-semibold mb-8">
        How to stake RWAs in 4 simple steps
      </h2>
      <div className="relative flex flex-col md:flex-row items-center md:justify-between">
        {/* Green Line Connecting Circles */}
        <div
          className="absolute hidden md:block h-1 z-0"
          style={{
            backgroundColor: '#84cc16',
            top: '15%',
            transform: 'translateY(-50%)',
            left: 'calc(12.5% + 20px)',
            right: 'calc(12.5% + 20px)',
          }}
        ></div>

        {/* Step 1 */}
        <div className="flex flex-col items-center z-10 relative md:w-1/4">
          <div
            className="w-12 h-12 flex items-center justify-center rounded-full text-lg font-bold"
            style={{
              backgroundColor: '#84cc16',
              color: '#ffffff',
            }}
          >
            1
          </div>
          <div className="flex flex-col justify-start items-center h-32 mt-4">
            <h3 className="text-lg font-semibold text-center">
              Create an account
            </h3>
            <p
              className="text-center mt-2 text-sm"
              style={{ color: '#4b5563' }}
            >
              <a
                href={loginUrl}
                style={{
                  color: '#84cc16',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                Sign up
              </a>{' '}
              for a Mercata account.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex flex-col items-center z-10 relative md:w-1/4">
          <div
            className="w-12 h-12 flex items-center justify-center rounded-full text-lg font-bold"
            style={{
              backgroundColor: '#84cc16',
              color: '#ffffff',
            }}
          >
            2
          </div>
          <div className="flex flex-col justify-start items-center h-32 mt-4">
            <h3 className="text-lg font-semibold text-center">Buy</h3>
            <p
              className="text-center mt-2 text-sm"
              style={{ color: '#4b5563' }}
            >
              Purchase securely vaulted gold and silver assets to begin staking!
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex flex-col items-center z-10 relative md:w-1/4">
          <div
            className="w-12 h-12 flex items-center justify-center rounded-full text-lg font-bold"
            style={{
              backgroundColor: '#84cc16',
              color: '#ffffff',
            }}
          >
            3
          </div>
          <div className="flex flex-col justify-start items-center h-32 mt-4">
            <h3 className="text-lg font-semibold text-center">
              Stake and Earn
            </h3>
            <p
              className="text-center mt-2 text-sm"
              style={{ color: '#4b5563' }}
            >
              Stake your gold and silver assets and begin earning daily rewards
              in the form of CATA, our governance token (Est. APY 10%).
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="flex flex-col items-center z-10 relative md:w-1/4">
          <div
            className="w-12 h-12 flex items-center justify-center rounded-full text-lg font-bold"
            style={{
              backgroundColor: '#84cc16',
              color: '#ffffff',
            }}
          >
            4
          </div>
          <div className="flex flex-col justify-start items-center h-32 mt-4">
            <h3 className="text-lg font-semibold text-center">Borrow</h3>
            <p
              className="text-center mt-2 text-sm"
              style={{ color: '#4b5563' }}
            >
              Borrow (interest-free for a limited time!) USDST up to 50% of the
              market value of your staked assets.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StakeSteps;
