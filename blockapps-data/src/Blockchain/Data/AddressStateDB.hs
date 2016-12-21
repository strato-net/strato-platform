{-# LANGUAGE OverloadedStrings #-}

--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.AddressStateDB (
  AddressState(..),
  blankAddressState
) where 

import qualified Blockchain.Colors as CL

import Blockchain.Format
import Blockchain.Data.RLP
import Blockchain.SHA
import Blockchain.Util
import Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia as MP

import Numeric
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>))

blankAddressState:: AddressState
blankAddressState = AddressState { addressStateNonce=0, addressStateBalance=0, addressStateContractRoot=MP.emptyTriePtr, addressStateCodeHash=hash "" }


instance Format AddressState where
  format a =
    CL.blue "AddressState" ++
    tab("\nnonce: " ++ showHex (addressStateNonce a) "" ++
        "\nbalance: " ++ show (toInteger $ addressStateBalance a) ++ 
        "\ncontractRoot: " ++ format (addressStateContractRoot a) ++
        "\ncodeHash: " ++ format (addressStateCodeHash a))
  
instance RLPSerializable AddressState where
  rlpEncode a | addressStateBalance a < 0 = error $ "Error in cal to rlpEncode for AddressState: AddressState has negative balance: " ++ format a
  rlpEncode a = RLPArray [
    rlpEncode $ toInteger $ addressStateNonce a,
    rlpEncode $ toInteger $ addressStateBalance a,
    rlpEncode $ addressStateContractRoot a,
    rlpEncode $ addressStateCodeHash a
                ]

  rlpDecode (RLPArray [n, b, cr, ch]) =
    AddressState {
      addressStateNonce=fromInteger $ rlpDecode n,
      addressStateBalance=fromInteger $ rlpDecode b,
      addressStateContractRoot=rlpDecode cr,
      addressStateCodeHash=rlpDecode ch
      } 
  rlpDecode x = error $ "Missing case in rlpDecode for AddressState: " ++ show (pretty x)

