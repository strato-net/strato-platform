import { Button, Input, InputNumber, Modal, Table, Tabs } from 'antd';
import { useState } from 'react';
import { actions as ethActions } from '../../contexts/eth/actions';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import { useAuthenticateState } from '../../contexts/authentication';
import { ethers } from 'ethers';
import { fileServerUrl } from '../../helpers/constants';

const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
  },
];

const BridgeWalletModal = ({ open, handleCancel, accountDetails, signer, tokenName}) => {
  const [quantity, setQuantity] = useState(1);
  const [ loader, setLoader ] = useState(false);
  const ethDispatch = useEthDispatch();
  const { user } = useAuthenticateState();
  const { isAddingHash } = useEthState();

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
            <p>{accountDetails.balance}</p>
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
    let tx;
    try {
      if (tokenName === "WBTC") {
        // WBTC contract address based on environment
        const wbtcAddress = fileServerUrl.includes("test")
          ? "0x29f2D40B0605204364af54EC677bD022dA425d03"
          : "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  
        // Create ERC-20 contract instance
        const wbtcContract = new ethers.Contract(wbtcAddress, ERC20_ABI, signer);
  
        // Convert quantity to smallest WBTC unit (8 decimals)
        const wbtcAmount = ethers.utils.parseUnits(quantity.toString(), 8);
  
        // Send ERC-20 token transfer
        tx = await wbtcContract.transfer(
          fileServerUrl.includes("test")
            ? "0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E"
            : "0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb",
          wbtcAmount
        );
  
        console.log("WBTC transfer transaction hash:", tx.hash);
      }else if (tokenName === "USDT") { //TODO: based on the decimal values change the value in the below conditions
        // USDT contract address based on environment
        const usdtAddress = fileServerUrl.includes("test")
          ? "0x29f2D40B0605204364af54EC677bD022dA425d03"
          : "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  
        // Create ERC-20 contract instance
        const usdtContract = new ethers.Contract(usdtAddress, ERC20_ABI, signer);
  
        // Convert quantity to smallest USDT unit (8 decimals)
        const usdtAmount = ethers.utils.parseUnits(quantity.toString(), 8);
  
        // Send ERC-20 token transfer
        tx = await usdtContract.transfer(
          fileServerUrl.includes("test")
            ? "0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E"
            : "0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb",
          usdtAmount
        );
  
      }else if (tokenName === "USDC") {
        // USDC contract address based on environment
        const usdcAddress = fileServerUrl.includes("test")
          ? "0x29f2D40B0605204364af54EC677bD022dA425d03"
          : "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  
        // Create ERC-20 contract instance
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, signer);
  
        // Convert quantity to smallest USDC unit (8 decimals)
        const usdcAmount = ethers.utils.parseUnits(quantity.toString(), 8);
  
        // Send ERC-20 token transfer
        tx = await usdcContract.transfer(
          fileServerUrl.includes("test")
            ? "0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E"
            : "0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb",
          usdcAmount
        );
  
        console.log("usdc transfer transaction hash:", tx.hash);
      }else if (tokenName === "PAXG") {
        // PAXG contract address based on environment
        const paxgAddress = fileServerUrl.includes("test")
          ? "0x29f2D40B0605204364af54EC677bD022dA425d03"
          : "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
  
        // Create ERC-20 contract instance
        const paxgContract = new ethers.Contract(paxgAddress, ERC20_ABI, signer);
  
        // Convert quantity to smallest PAXG unit (8 decimals)
        const paxgAmount = ethers.utils.parseUnits(quantity.toString(), 8);
  
        // Send ERC-20 token transfer
        tx = await paxgContract.transfer(
          fileServerUrl.includes("test")
            ? "0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E"
            : "0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb",
          paxgAmount
        );
  
        console.log("paxg transfer transaction hash:", tx.hash);
      } else {
        // ETH transfer logic (native transfer)
        tx = await signer.sendTransaction({
          to: fileServerUrl.includes("test")
            ? "0xBdAFaEBc08B94785dfE7Fc720Fbcd9aFc156454E"
            : "0x3590039Cce30da23Fe434A39dFb3365Ecec03eAb",
          value: ethers.utils.parseEther(quantity.toString()), // Convert ETH to wei
        });
  
        console.log("ETH transfer transaction hash:", tx.hash);
      }
  
      const body = {
        userAddress: user.userAddress,
        txHash: tx.hash,
        amount: quantity.toString(),
        tokenName,
      };
  
      let isDone = await ethActions.addHash(ethDispatch, body);
  
      if (isDone) {
        handleCancel();
      }
    } catch (error) {
      console.error("Transaction failed:", error);
    } finally {
      setLoader(false);
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
            loading={isAddingHash || loader}
          >
            Bridge
          </Button>
        </div>,
      ]}
    >
      <Tabs defaultActiveKey="1">
        <Tabs.TabPane tab={`Bridge ${tokenName} to Mercata`} key="1">
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
