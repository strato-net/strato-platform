import { Button, Input, InputNumber, Modal, Table, Tabs } from 'antd';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { actions as ethActions } from '../../contexts/eth/actions';
import { actions } from '../../contexts/inventory/actions';
import { useInventoryDispatch } from '../../contexts/inventory';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import { useAuthenticateState } from '../../contexts/authentication';
import { ethers } from 'ethers';
import { fileServerUrl } from '../../helpers/constants';

const tokensArray = [
  {
    name: 'WBTCST',
    ethTestnetAddress: '0x29f2D40B0605204364af54EC677bD022dA425d03',
    ethMainnetAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    decimals: 8,
    mercataTestnetAddress: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E',
    mercataMainnetAddress: '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb'
  },
  {
    name: 'USDTST',
    ethTestnetAddress: '0xAF0F6e8b0Dc5c913bbF4d14c22B4E78Dd14310B6',
    ethMainnetAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    mercataTestnetAddress: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E',
    mercataMainnetAddress: '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb'
  },
  {
    name: 'USDCST',
    ethTestnetAddress: '0x16dA4541aD1807f4443d92D26044C1147406EB80',
    ethMainnetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    mercataTestnetAddress: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E',
    mercataMainnetAddress: '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb'
  },
  {
    name: 'PAXGST',
    ethTestnetAddress: '0x58724DEc334608b375D5e2914FCAc156E019B4D5',
    ethMainnetAddress: '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
    decimals: 18,
    mercataTestnetAddress: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E',
    mercataMainnetAddress: '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb'
  },
  {
    name: 'ETHST',
    mercataTestnetAddress: '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E',
    mercataMainnetAddress: '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb'
  }
]

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

  const { bridgeableTokens } = useEthState();
  
  useEffect(() => {
    const fetchBridgeableTokenss = async () => {
      await ethActions.fetchBridgeableTokens(ethDispatch);
    };

    fetchBridgeableTokenss();
  }, []);

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
        <InputNumber
          value={quantity}
          onChange={(value) => setQuantity(value)}
        />
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
        <InputNumber
          value={quantity}
          onChange={(value) => setQuantity(value)}
        />
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
        let tokenAddress, decimals, recipient;

        const tokenObj = bridgeableTokens.find((tokenD) => tokenD.name === tokenName)
        tokenAddress = fileServerUrl?.includes('test')
          ? tokenObj.ethTestnetAddress  // Testnet WBTC
          : tokenObj.ethMainnetAddress; // Mainnet WBTC
        decimals = tokenObj.decimals;
        recipient = fileServerUrl?.includes('test')
          ? tokenObj.mercataTestnetAddress // Testnet recipient
          : tokenObj.mercataMainnetAddress; // Mainnet recipient

        if (tokenAddress) {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
          const tokenAmount = ethers.utils.parseUnits(quantity.toString(), decimals);

          tx = await tokenContract.transfer(recipient, tokenAmount);
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
            <div className="max-w-[60%] text-left">
              <p className="text-xs">
                <b>Note:</b> Bridged tokens will be automatically staked in the
                app. Please allow a few minutes for the staking process to
                complete after bridging.
              </p>
            </div>

            <div>
              <Button
                type="primary"
                className="w-32 h-9"
                onClick={handleSubmit}
                disabled={quantity <= 0 || quantity > accountDetails.balance}
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
                disabled={quantity <= 0 || quantity > accountDetails.balance}
                loading={isAddingHash || loader || isBridgingOut}
              >
                Bridge
              </Button>
            </div>
            <div className="w-full text-left mt-4">
              <p className="text-xs">
                <b>Note:</b> Bridged tokens will be automatically staked in the
                app. Please allow a few minutes for the staking process to
                complete after bridging.
              </p>
            </div>
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
