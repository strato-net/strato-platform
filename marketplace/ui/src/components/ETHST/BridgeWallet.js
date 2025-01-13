import { Button, Input, InputNumber, Modal, Table, Tabs } from 'antd';
import { useState } from 'react';
import { actions as ethActions } from '../../contexts/eth/actions';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import { useAuthenticateState } from '../../contexts/authentication';
import { ethers } from 'ethers';
import { fileServerUrl } from '../../helpers/constants';

const BridgeWalletModal = ({ open, handleCancel, accountDetails, signer }) => {
  const [quantity, setQuantity] = useState(1);
  const [ loader, setLoader ] = useState(false);
  const ethDispatch = useEthDispatch();
  const { user } = useAuthenticateState();
  const { isAddingHash } = useEthState();

  const ethToMercataColumns = [
    {
      title: 'ETH Available',
      dataIndex: 'ethBalance',
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

  const ethToBaseColumns = [
    {
      title: 'ETHST Available',
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

  const ethToMercata = () => (
    <>
      <div className="head hidden md:block">
        <Table
          columns={ethToMercataColumns}
          dataSource={[accountDetails]}
          pagination={false}
        />
      </div>
      <div className="flex flex-col gap-[18px] md:hidden mt-2">
        <div>
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p>{accountDetails.ethBalance}</p>
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
          <p className="text-[#202020] font-medium text-sm">
            Base Wallet Address
          </p>
          <Input
            placeholder="Base Chain address"
            value={accountDetails.walletAddress}
            disabled={true}
          />
        </div>
      </div>
    </>
  );

  const ethToBase = () => (
    <>
      <div className="head hidden md:block">
        <Table
          columns={ethToBaseColumns}
          dataSource={[accountDetails]}
          pagination={false}
        />
      </div>
      <div className="flex flex-col gap-[18px] md:hidden mt-5">
        <div>
          <p className="text-[#202020] font-medium text-sm">
            Quantity Available
          </p>
          <div className="border border-[#d9d9d9] h-[42px] rounded-md flex items-center justify-center">
            <p>10</p>
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
          <p className="text-[#202020] font-medium text-sm">
            Base Wallet Address
          </p>
          <Input placeholder="Base Chain address" />
        </div>
      </div>
    </>
  );

  const handleSubmit = async () => {
    setLoader(true);
    const tx = await signer.sendTransaction({
      to: fileServerUrl.includes('test')
        ? '0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E'
        : '0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb',
      value: ethers.utils.parseEther(quantity.toString()),
    });

    const body = {
      userAddress: user.userAddress,
      txHash: tx.hash,
      amount: quantity.toString(),
    };

    let isDone = await ethActions.addHash(ethDispatch, body);

    if (isDone) {
      handleCancel();
    }
    setLoader(false);
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
            loading={isAddingHash || loader}
          >
            Bridge
          </Button>
        </div>,
      ]}
    >
      <Tabs defaultActiveKey="1">
        <Tabs.TabPane tab="Bridge ETH to Mercata" key="1">
          {ethToMercata()}
        </Tabs.TabPane>
        {/* <Tabs.TabPane tab="Bridge ETH to Base" key="2">
          {ethToBase()}
        </Tabs.TabPane> */}
      </Tabs>
    </Modal>
  );
};

export default BridgeWalletModal;
