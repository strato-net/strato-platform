{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.GenesisBlocks.Contracts.BitcoinBridge (
  insertBitcoinBridgeContract,
  bitcoinBridgeContract
  ) where

import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Data.Text (Text)
import Data.Text.Encoding
import Text.RawString.QQ

-- | Inserts a Certificate Registry contract into the genesis block with the BlockApps root cert as owner
-- | Accepts a list of X509 certificates, if there are any that need to be initialized at init besides root
insertBitcoinBridgeContract :: GenesisInfo -> GenesisInfo
insertBitcoinBridgeContract gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ [bitcoinAcct],
      genesisInfoCodeInfo = initialCode ++ [CodeInfo bitcoinBridgeContract (Just "BitcoinBridge")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    encodedBridge = encodeUtf8 bitcoinBridgeContract
    bitcoinAcct =
      SolidVMContractWithStorage
        0x1234567890
        509
        (SolidVMCode "BitcoinBridge" (KECCAK256.hash encodedBridge)) []

bitcoinBridgeContract :: Text
bitcoinBridgeContract =
  [r|
pragma es6;
pragma strict;

contract BitcoinBridge {
    mapping (address => uint) public record balances;
    mapping (string => uint) txidMap;
    string[] public utxoTXIDs;
    uint[] public utxoAmounts;

    constructor() {

    }

    function bridgeIn(string _txid, uint _amount) public {
        uint bal = balances[msg.sender];
        balances[msg.sender] = bal + _amount;
        utxoTXIDs.push(_txid);
        utxoAmounts.push(_amount);
        txidMap[_txid] = utxoTXIDs.length;
    }

    function bridgeOut(string _txid, uint _amount) public {
        uint bal = balances[msg.sender];
        require (_amount <= bal, "You cannot withdraw more BTCST than your balance");
        balances[msg.sender] = bal - _amount;
        utxoTXIDs[txidMap[_txid] - 1] = "";
        utxoAmounts[txidMap[_txid] - 1] = 0;
    }
}|]