{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Data.TransactionDef
  ( Transaction (..),
    isMessageTX,
    partialRLPEncode,
    partialRLPDecode,
    formatChainId,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Binary
import Data.Data
import Data.List
import Data.Text (Text)
import qualified Data.Text as T
import Database.Persist.TH
import GHC.Generics
import qualified Text.Colors as CL
import Text.Format
import Text.ShortDescription
import Text.Tools (shorten, tab')

derivePersistField "Transaction"

data Transaction
  = MessageTX
      { transactionNonce :: Integer,
        transactionGasLimit :: Integer,
        transactionTo :: Address,
        transactionFuncName :: Text,
        transactionArgs :: [Text],
        transactionNetwork :: Text,
        transactionR :: Integer,
        transactionS :: Integer,
        transactionV :: Word8
      }
  | ContractCreationTX
      { transactionNonce :: Integer,
        transactionGasLimit :: Integer,
        transactionContractName :: Text,
        transactionArgs :: [Text],
        transactionNetwork :: Text,
        transactionCode :: Code,
        transactionR :: Integer,
        transactionS :: Integer,
        transactionV :: Word8
      }
  deriving (Show, Read, Eq, Ord, Generic, Data, NFData)

instance Binary Transaction where
  put = put . rlpSerialize . rlpEncode
  get = (rlpDecode . rlpDeserialize) <$> get

formatChainId :: Maybe Word256 -> String
formatChainId = \case
  Nothing -> "<main chain>"
  Just cid -> CL.yellow $ format cid

instance Format Transaction where
  format
    t@MessageTX{..} =
      CL.blue "Message Transaction"
        ++ tab'
          ( "\n"
              ++ "tNonce: "
              ++ show transactionNonce
              ++ "\n"
              ++ "tGasLimit: "
              ++ show transactionGasLimit
              ++ "\n"
              ++ "to: "
              ++ format transactionTo
              ++ "\n"
              ++ "tFuncName: "
              ++ ("\n" ++ format transactionFuncName)
              ++ "\n"
              ++ "params: "
              ++ format transactionArgs
              ++ "\n"
              ++ "network: "
              ++ format transactionNetwork
              ++ "\n"
              ++ "hash: "
              ++ format (hash . rlpSerialize . rlpEncode $ t)
              ++ "\n"
          )
  format
    t@ContractCreationTX{..} =
      CL.blue "Contract Creation Transaction"
        ++ tab'
          ( "\n"
              ++ "tNonce: "
              ++ show transactionNonce
              ++ "\n"
              ++ "tGasLimit: "
              ++ show transactionGasLimit
              ++ "\n"
              ++ "ContractName: "
              ++ show transactionContractName
              ++ "\n"
              ++ "tArgs: "
              ++ show transactionArgs
              ++ "\n"
              ++ "tNetwork: "
              ++ show transactionNetwork
              ++ "\n"
              ++ "hash: "
              ++ format (hash . rlpSerialize . rlpEncode $ t)
              ++ "\n"
          )

instance RLPSerializable Transaction where
  rlpDecode (RLPArray [txType, arg2, arg3, arg4, arg5, arg6, arg7, vVal, rVal, sVal]) =
    case partial of
          p@MessageTX {} ->
            p
              { transactionV = fromInteger $ rlpDecode vVal,
                transactionR = rlpDecode rVal,
                transactionS = rlpDecode sVal
              }
          p@ContractCreationTX {} ->
            p
              { transactionV = fromInteger $ rlpDecode vVal,
                transactionR = rlpDecode rVal,
                transactionS = rlpDecode sVal
              }
    where
      partial = partialRLPDecode $ RLPArray [txType, arg2, arg3, arg4, arg5, arg6, arg7]
  rlpDecode x = error ("rlp object has wrong format in call to rlpDecodeq: " ++ show x)

  rlpEncode t =
    case partialRLPEncode t of
      RLPArray items ->
        RLPArray $ items ++
        [
          rlpEncode $ toInteger (transactionV t),
          rlpEncode (transactionR t),
          rlpEncode (transactionS t)
        ]
      v -> error $ "rlpEncode Transaction: Expected RLPArray, but got: " ++ show v

instance ShortDescription Transaction where
  shortDescription MessageTX {..} = shorten 90 $
    "calling " ++ format transactionTo ++ "/" ++ T.unpack transactionFuncName ++  "(" ++ intercalate "," (map format transactionArgs) ++ ")"
  shortDescription ContractCreationTX {..} = shorten 40 $
    "Create Contract " ++ T.unpack transactionContractName ++ "(" ++ intercalate "," (map format transactionArgs) ++ ")"

isMessageTX :: Transaction -> Bool
isMessageTX MessageTX {} = True
isMessageTX _ = False

--partialRLP(De|En)code are used for the signing algorithm
partialRLPDecode :: RLPObject -> Transaction
partialRLPDecode (RLPArray [RLPScalar 1, n, gl, contractName, args, network, code]) =
  --Note- Address 0 /= Address 000000....  Only Address 0 yields a ContractCreationTX
  ContractCreationTX
    { transactionNonce = rlpDecode n,
      transactionGasLimit = rlpDecode gl,
      transactionContractName = rlpDecode contractName,
      transactionArgs = rlpDecode args,
      transactionNetwork = rlpDecode network,
      transactionCode = rlpDecode code,
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
    }
partialRLPDecode (RLPArray [RLPScalar 2, n, gl, toAddr, funcName, args, network]) =
  MessageTX
    { transactionNonce = rlpDecode n,
      transactionGasLimit = rlpDecode gl,
      transactionTo = rlpDecode toAddr,
      transactionFuncName = rlpDecode funcName,
      transactionArgs = rlpDecode args,
      transactionNetwork = rlpDecode network,
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
    }
partialRLPDecode x = error ("rlp object has wrong format in call to partialRLPDecode: " ++ show x)

partialRLPEncode :: Transaction -> RLPObject
partialRLPEncode MessageTX {..} =
  RLPArray $
    [ rlpEncode (2::Integer),
      rlpEncode transactionNonce,
      rlpEncode transactionGasLimit,
      rlpEncode transactionTo,
      rlpEncode transactionFuncName,
      rlpEncode transactionArgs,
      rlpEncode transactionNetwork
    ]
partialRLPEncode ContractCreationTX {..} =
  RLPArray $
    [ rlpEncode (1::Integer),
      rlpEncode transactionNonce,
      rlpEncode transactionGasLimit,
      rlpEncode transactionContractName,
      rlpEncode transactionArgs,
      rlpEncode transactionNetwork,
      rlpEncode transactionCode
    ]
