import { Button, Input, InputNumber, Modal, Table, Tabs } from 'antd';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { actions as ethActions } from '../../contexts/eth/actions';
import { actions } from '../../contexts/inventory/actions';
import { useInventoryDispatch } from '../../contexts/inventory';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import { useAuthenticateState } from '../../contexts/authentication';
import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
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
  const [quantity, setQuantity] = useState(accountDetails?.balance || 0);
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [loader, setLoader] = useState(false);
  const ethDispatch = useEthDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const { user } = useAuthenticateState();
  const { isAddingHash, isBridgingOut } = useEthState();
  const minQuantity = new BigNumber(1).div(
    new BigNumber(10).pow(accountDetails?.decimals)
  );

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const { bridgeableTokens } = useEthState();
  
  useEffect(() => {
    const fetchBridgeableTokenss = async () => {
      await ethActions.fetchBridgeableTokens(ethDispatch);
    };

    fetchBridgeableTokenss();
  }, []);
  // Helper function to check if the value exceeds 6 decimal places
  const hasExceedPrecision = (value) => {
    if (value === undefined || value === null) return false;
    const stringValue = String(value);
    const maxDecimals = accountDetails?.decimals;
    if (stringValue.includes('.')) {
      const decimalPart = stringValue.split('.')[1];
      return decimalPart && decimalPart.length > maxDecimals;
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
            hasExceedPrecision(quantity) ||
            minQuantity.gt(quantity || 0) ||
            quantity > accountDetails?.balance
              ? 'h-auto'
              : 'h-8'
          }`}
        >
          <InputNumber
            value={quantity}
            onChange={(value) => setQuantity(value)}
            controls={false}
            className="w-full"
            status={
              minQuantity.gt(quantity || 0) ||
              hasExceedPrecision(quantity) ||
              quantity > accountDetails?.balance
                ? 'error'
                : ''
            }
          />
          {accountDetails?.balance < quantity ? (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Insufficient balance
            </div>
          ) : minQuantity.gt(quantity || 0) ? (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Amount must be greater than{' '}
              {minQuantity.toFixed(accountDetails?.decimals)}
            </div>
          ) : hasExceedPrecision(quantity) ? (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Maximum precision is {accountDetails?.decimals} decimal places
            </div>
          ) : null}
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
            minQuantity.gt(quantity || 0) ||
            hasExceedPrecision(quantity) ||
            quantity > accountDetails?.balance
              ? 'h-auto'
              : 'h-8'
          }`}
        >
          <InputNumber
            value={quantity}
            onChange={(value) => setQuantity(value)}
            controls={false}
            className="w-full"
            status={
              minQuantity.gt(quantity || 0) ||
              hasExceedPrecision(quantity) ||
              quantity > accountDetails?.balance
                ? 'error'
                : ''
            }
          />
          {accountDetails?.balance < quantity ? (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Insufficient balance
            </div>
          ) : minQuantity.gt(quantity || 0) ? (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Amount must be greater than{' '}
              {minQuantity.toFixed(accountDetails?.decimals)}
            </div>
          ) : hasExceedPrecision(quantity) ? (
            <div
              style={{ color: 'red' }}
              className="text-xs my-0.5 absolute w-full"
            >
              Maximum precision is {accountDetails?.decimals} decimal places
            </div>
          ) : null}
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
              value={quantity}
              onChange={(value) => setQuantity(value)}
              controls={false}
              className="w-full h-9"
              status={
                minQuantity.gt(quantity || 0) ||
                hasExceedPrecision(quantity) ||
                quantity > accountDetails?.balance
                  ? 'error'
                  : ''
              }
            />
            {accountDetails?.balance < quantity ? (
              <div
                style={{ color: 'red' }}
                className="text-xs my-0.5 absolute w-full"
              >
                Insufficient balance
              </div>
            ) : minQuantity.gt(quantity || 0) ? (
              <div
                style={{ color: 'red' }}
                className="text-xs my-0.5 absolute w-full"
              >
                Amount must be greater than{' '}
                {minQuantity.toFixed(accountDetails?.decimals)}
              </div>
            ) : hasExceedPrecision(quantity) ? (
              <div
                style={{ color: 'red' }}
                className="text-xs my-0.5 absolute w-full"
              >
                Maximum precision is {accountDetails?.decimals} decimal places
              </div>
            ) : null}
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
              value={quantity}
              onChange={(value) => setQuantity(value)}
              controls={false}
              className="w-full h-9"
              status={
                minQuantity.gt(quantity || 0) ||
                hasExceedPrecision(quantity) ||
                quantity > accountDetails?.balance
                  ? 'error'
                  : ''
              }
            />
            {accountDetails?.balance < quantity ? (
              <div
                style={{ color: 'red' }}
                className="text-xs my-0.5 absolute w-full"
              >
                Insufficient balance
              </div>
            ) : minQuantity.gt(quantity || 0) ? (
              <div
                style={{ color: 'red' }}
                className="text-xs my-0.5 absolute w-full"
              >
                Amount must be greater than{' '}
                {minQuantity.toFixed(accountDetails?.decimals)}
              </div>
            ) : hasExceedPrecision(quantity) ? (
              <div
                style={{ color: 'red' }}
                className="text-xs my-0.5 absolute w-full"
              >
                Maximum precision is {accountDetails?.decimals} decimal places
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <p className="text-[#202020] font-medium text-sm">
            Ethereum Wallet Address
          </p>
          <div>
            <Input
              placeholder="Ethereum Chain address"
              className="w-full h-9"
              value={ethereumAddress}
              onChange={(e) => setEthereumAddress(e.target.value)}
            />
          </div>
        </div>
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
        let tokenAddress, decimals, recipient;

        const tokenObj = bridgeableTokens?.find((tokenD) => tokenD.name.toLowerCase() === tokenName.toLowerCase())
        tokenAddress = fileServerUrl?.includes('test')
          ? tokenObj?.ethTestnetAddress  // Testnet WBTC
          : tokenObj?.ethMainnetAddress; // Mainnet WBTC
        decimals = tokenObj.decimals;
        recipient = fileServerUrl?.includes('test')
          ? tokenObj?.mercataTestnetAddress // Testnet recipient
          : tokenObj?.mercataMainnetAddress; // Mainnet recipient

        if (tokenAddress) {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
          const tokenAmount = ethers.utils.parseUnits(quantity.toString(), decimals);

          tx = await tokenContract.transfer(recipient, tokenAmount);
        } else {
          tx = await signer.sendTransaction({
            to: fileServerUrl.includes('test')
              ? '0x0E5fC82D0a9493c133370f314342eAeF70D5A1aE'
              : '0x8c458F866e603335ef179A63a2528F357732f5d5',
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
          assetAddress: accountDetails.assetAddress,
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
                  minQuantity.gt(quantity || 0) ||
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
                  minQuantity.gt(quantity || 0) ||
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
              ? `Bridge ${tokenName.replace(/st/gi, '')} to Mercata`
              : `Bridge ${tokenName.replace(/st/gi, '')} to Ethereum`
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
