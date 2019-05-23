{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}

--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.AddressStateDB (
  AddressState(..),
  CodePtr(..),
  blankAddressState
) where


import           Data.Default
import           Data.Maybe                         (maybeToList)

import           Control.DeepSeq
import           GHC.Generics
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>))

import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Util
import qualified Text.Colors                      as CL
import           Text.Format

data AddressState =
  AddressState{
    addressStateNonce::Integer,
    addressStateBalance::Integer,
    addressStateContractRoot::MP.StateRoot,
    addressStateCodeHash::CodePtr,
    addressStateChainId::Maybe Word256
    } deriving (Eq, Generic, Read, Show)

instance NFData AddressState

blankAddressState:: AddressState
blankAddressState = AddressState { addressStateNonce=0, addressStateBalance=0, addressStateContractRoot=MP.emptyTriePtr, addressStateCodeHash=EVMCode $ hash "" , addressStateChainId = Nothing}

instance Default AddressState where
  def = blankAddressState

instance Format AddressState where
  format a =
    CL.blue "AddressState" ++
    tab("\nnonce: " ++ showHex (addressStateNonce a) "" ++
        "\nbalance: " ++ show (toInteger $ addressStateBalance a) ++
        "\ncontractRoot: " ++ format (addressStateContractRoot a) ++
        "\ncodeHash: " ++ format (addressStateCodeHash a) ++
        "\nchainId: " ++ (show $ fmap (flip showHex "") (addressStateChainId a)))

instance RLPSerializable AddressState where
  rlpEncode a | addressStateBalance a < 0 = error $ "Error in cal to rlpEncode for AddressState: AddressState has negative balance: " ++ format a
  rlpEncode a = RLPArray $ [
    rlpEncode $ toInteger $ addressStateNonce a,
    rlpEncode $ toInteger $ addressStateBalance a,
    rlpEncode $ addressStateContractRoot a,
    rlpEncode $ addressStateCodeHash a
    ] ++ (maybeToList . fmap rlpEncode $ addressStateChainId a)

  rlpDecode (RLPArray [n, b, cr, ch, cid]) =
    AddressState {
      addressStateNonce=fromInteger $ rlpDecode n,
      addressStateBalance=fromInteger $ rlpDecode b,
      addressStateContractRoot=rlpDecode cr,
      addressStateCodeHash=rlpDecode ch,
      addressStateChainId = Just $ rlpDecode cid
      }
  rlpDecode (RLPArray [n, b, cr, ch]) =
    AddressState {
      addressStateNonce=fromInteger $ rlpDecode n,
      addressStateBalance=fromInteger $ rlpDecode b,
      addressStateContractRoot=rlpDecode cr,
      addressStateCodeHash=rlpDecode ch,
      addressStateChainId = Nothing
      }
  rlpDecode x = error $ "Missing case in rlpDecode for AddressState: " ++ show (pretty x)

instance RLPSerializable CodePtr where
  rlpEncode (EVMCode codeHash) = rlpEncode codeHash
  rlpEncode (SolidVMCode n ch) = RLPArray [RLPString "SolidVM", rlpEncode n, rlpEncode ch]

  rlpDecode (RLPArray [RLPString "SolidVM", n, ch]) = SolidVMCode (rlpDecode n) (rlpDecode ch)
  rlpDecode ch = EVMCode $ rlpDecode ch
