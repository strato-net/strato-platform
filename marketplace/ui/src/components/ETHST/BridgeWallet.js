import { Button, Input, InputNumber, Modal, Table, Tabs } from 'antd';
import { useState } from 'react';
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
  inventorypageDetails,
}) => {
  const [quantity, setQuantity] = useState(accountDetails?.balance || 1);
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [loader, setLoader] = useState(false);
  const ethDispatch = useEthDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const { user } = useAuthenticateState();
  const { isAddingHash, isBridgingOut } = useEthState();

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
        await actions.fetchInventory(
          inventoryDispatch,
          inventorypageDetails.limit,
          inventorypageDetails.offset,
          '',
          inventorypageDetails.categoryName,
          ''
        );
      }
    } catch (error) {
      ethActions.setMessage(ethDispatch, error.code);
      console.error("Transaction failed:", error);
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
        <div className="flex justify-center md:block">
          <Button
            type="primary"
            className="w-32 h-9"
            onClick={handleSubmit}
            disabled={quantity <= 0 || quantity > accountDetails.balance}
            loading={isAddingHash || loader || isBridgingOut}
          >
            Bridge
          </Button>
        </div>,
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
