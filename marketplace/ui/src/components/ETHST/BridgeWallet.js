import { Button, Input, InputNumber, Modal, Table, Tabs } from 'antd';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { actions as ethActions } from '../../contexts/eth/actions';
import { actions } from '../../contexts/inventory/actions';
import { useInventoryDispatch } from '../../contexts/inventory';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import { useAuthenticateState } from '../../contexts/authentication';
import { ethers } from 'ethers';
import { fileServerUrl } from '../../helpers/constants';

const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
];

const BridgeWalletModal = ({
  open,
  handleCancel,
  accountDetails,
  signer,
  tokenName,
  tabKey = '1',
  pageDetails,
}) => {
  const [quantity, setQuantity] = useState(accountDetails?.balance || 1);
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [loader, setLoader] = useState(false);
  const ethDispatch = useEthDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const { user } = useAuthenticateState();
  const { isAddingHash, isBridgingOut } = useEthState();

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  // Helper function to check if the value exceeds 6 decimal places
  const hasExceedPrecision = (value) => {
    if (value === undefined || value === null) return false;
    const stringValue = String(value);
    if (stringValue.includes('.')) {
      const decimalPart = stringValue.split('.')[1];
      return decimalPart && decimalPart.length > 6;
    }
    return false;
  };

  const ethToMercataColumns = [
    {
      title: `${tokenName} Available`,
      dataIndex: 'balance',
      align: 'center',
    },
    {
      title: 'Set Quantity',
      align: 'center',
      render: () => (
        <div
          className={`${
            quantity <= 0 || hasExceedPrecision(quantity) ? 'h-auto' : 'h-8'
          }`}
        >
          <InputNumber
            value={quantity}
            onChange={(value) => setQuantity(value)}
            controls={false}
            className="w-full"
            status={
              quantity < 1 / 1e6 || hasExceedPrecision(quantity) ? 'error' : ''
            }
          />
          {quantity < 1 / 1e6 && (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Amount must be greater than 0.000001
            </div>
          )}
          {hasExceedPrecision(quantity) && (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Maximum precision is 6 decimal places
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Wallet Address',
      dataIndex: 'walletAddress',
      align: 'center',
      render: (_, record) => (
        <Input disabled={true} value={record.walletAddress} />
      ),
    },
  ];

  const mercataToEthColumns = [
    {
      title: `${tokenName} Available`,
      dataIndex: 'balance',
      align: 'center',
    },
    {
      title: 'Set Quantity',
      align: 'center',
      render: () => (
        <div
          className={`${
            quantity <= 0 || hasExceedPrecision(quantity) ? 'h-auto' : 'h-8'
          }`}
        >
          <InputNumber
            value={quantity}
            onChange={(value) => setQuantity(value)}
            controls={false}
            className="w-full"
            status={
              quantity < 1 / 1e6 || hasExceedPrecision(quantity) ? 'error' : ''
            }
          />
          {quantity < 1 / 1e6 && (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Amount must be greater than 0.000001
            </div>
          )}
          {hasExceedPrecision(quantity) && (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Maximum precision is 6 decimal places
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Ethereum Wallet Address',
      dataIndex: 'walletAddress',
      align: 'center',
      render: () => (
        <Input
          placeholder="Ethereum Chain address"
          value={ethereumAddress}
          onChange={(e) => setEthereumAddress(e.target.value)}
        />
      ),
    },
  ];

  const ethToMercata = () => (
    <>
      <div className="head hidden md:block">
        <Table
          columns={ethToMercataColumns}
          dataSource={[accountDetails]}
          pagination={false}
        />
      </div>
      <div className="flex flex-col gap-[18px] md:hidden">
        <div>
          {' '}
          <p className="text-[#202020] font-medium text-sm">
            {tokenName} Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p> {accountDetails.balance} </p>
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Set Quantity</p>
          <div>
            <InputNumber
              className="w-full h-9"
              value={quantity}
              onChange={(value) => setQuantity(value)}
            />
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">Wallet Address</p>
          <div>
            <Input
              className="w-full h-9"
              disabled={true}
              value={accountDetails.walletAddress}
            />
          </div>
        </div>
      </div>
    </>
  );

  const mercataToEth = () => (
    <>
      <div className="head hidden md:block">
        <Table
          columns={mercataToEthColumns}
          dataSource={[accountDetails]}
          pagination={false}
        />
      </div>
    </>
  );

  /**
   * Refresh the inventory and reserve data after a successful stake/unstake action.
   */
  const refreshDataAfterAction = async () => {
    if (
      queryParams.get('st') === 'true' ||
      window.location.pathname === '/stake'
    ) {
      await actions.fetchInventory(
        inventoryDispatch,
        pageDetails.limit,
        pageDetails.offset,
        '',
        pageDetails.categoryName,
        pageDetails.reserves.map((reserve) => reserve.assetRootAddress)
      );
      await actions.getAllReserve(inventoryDispatch);
      await actions.getUserCataRewards(inventoryDispatch);
    } else {
      await actions.fetchInventory(
        inventoryDispatch,
        pageDetails.limit,
        pageDetails.offset,
        '',
        pageDetails.categoryName,
        ''
      );
    }
  };

  const handleSubmit = async () => {
    setLoader(true);
    let tx;
    let isDone;
    try {
      // Use tabKey (or any external control) to determine which bridging logic to run.
      if (tabKey === '1') {
        // Bridge In (Eth -> Mercata)
        if (tokenName === 'WBTC') {
          const wbtcAddress = fileServerUrl.includes('test')
            ? '0x29f2D40B0605204364af54EC677bD022dA425d03'
            : '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';

          const wbtcContract = new ethers.Contract(
            wbtcAddress,
            ERC20_ABI,
            signer
          );
          const wbtcAmount = ethers.utils.parseUnits(quantity.toString(), 8);
          tx = await wbtcContract.transfer(
            fileServerUrl.includes('test')
              ? '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E'
              : '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb',
            wbtcAmount
          );
        } else {
          tx = await signer.sendTransaction({
            to: fileServerUrl.includes('test')
              ? '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E'
              : '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb',
            value: ethers.utils.parseEther(quantity.toString()),
          });
        }
        await tx.wait();
        const body = {
          userAddress: user.userAddress,
          txHash: tx.hash,
          amount: quantity.toString(),
          tokenName,
        };
        isDone = await ethActions.addHash(ethDispatch, body);
      } else {
        // Bridge Out (Mercata -> Eth)
        if (!ethereumAddress && !accountDetails.assetRootAddress) {
          throw new Error(
            'Please provide a valid Ethereum address for bridging out.'
          );
        }
        const body = {
          quantity: ethers.utils
            .parseUnits(quantity.toString(), accountDetails.decimals)
            .toString(),
          quantityNumber: quantity,
          externalChainWalletAddress: ethereumAddress,
          tokenAssetRootAddress: accountDetails.assetRootAddress,
          tokenName,
        };
        isDone = await ethActions.bridgeOut(ethDispatch, body);
      }
      if (isDone && tabKey != '1') {
        refreshDataAfterAction();
      }
    } catch (error) {
      ethActions.setMessage(ethDispatch, error.code);
      console.error('Transaction failed:', error);
    } finally {
      setLoader(false);
      handleCancel();
    }
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      width={1000}
      footer={[
        <>
          <div className="md:flex justify-between items-center w-full hidden">
            {tabKey === '1' && (
              <div className="max-w-[60%] text-left">
                <p className="text-xs">
                  <b>Note:</b> Bridged tokens will be automatically staked in
                  the app. Please allow a few minutes for the staking process to
                  complete after bridging.
                </p>
              </div>
            )}

            <div className={tabKey !== '1' ? 'w-full' : ''}>
              <Button
                type="primary"
                className="w-32 h-9"
                onClick={handleSubmit}
                disabled={
                  quantity < 1 / 1e6 ||
                  quantity > accountDetails.balance ||
                  hasExceedPrecision(quantity)
                }
                loading={isAddingHash || loader || isBridgingOut}
              >
                Bridge
              </Button>
            </div>
          </div>
          <div className="md:hidden">
            <div className="w-full flex justify-center mt-8">
              <Button
                type="primary"
                className="w-full h-9"
                onClick={handleSubmit}
                disabled={
                  quantity < 1 / 1e6 ||
                  quantity > accountDetails.balance ||
                  hasExceedPrecision(quantity)
                }
                loading={isAddingHash || loader || isBridgingOut}
              >
                Bridge
              </Button>
            </div>
            {tabKey === '1' && (
              <div className="w-full text-left mt-4">
                <p className="text-xs">
                  <b>Note:</b> Bridged tokens will be automatically staked in
                  the app. Please allow a few minutes for the staking process to
                  complete after bridging.
                </p>
              </div>
            )}
          </div>
        </>,
      ]}
    >
      <Tabs activeKey="1">
        <Tabs.TabPane
          tab={
            tabKey === '1'
              ? `Bridge ${tokenName} to Mercata`
              : `Bridge ${tokenName} to Ethereum`
          }
          key="1"
        >
          {tabKey === '1' ? ethToMercata() : mercataToEth()}
        </Tabs.TabPane>
      </Tabs>
    </Modal>
  );
};

export default BridgeWalletModal;
