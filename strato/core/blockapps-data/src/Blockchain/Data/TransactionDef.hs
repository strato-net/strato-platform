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
import GHC.Generics hiding (to)
import qualified Text.Colors as CL
import Text.Format
import Text.ShortDescription
import Text.Tools (shorten, tab')

derivePersistField "Transaction"

data Transaction
  = MessageTX
      { nonce :: Integer,
        gasLimit :: Integer,
        to :: Address,
        funcName :: Text,
        args :: [Text],
        network :: Text,
        chainId :: Maybe Integer,
        r :: Integer,
        s :: Integer,
        v :: Word8
      }
  | ContractCreationTX
      { nonce :: Integer,
        gasLimit :: Integer,
        contractName :: Text,
        args :: [Text],
        network :: Text,
        code :: Code,
        chainId :: Maybe Integer,
        r :: Integer,
        s :: Integer,
        v :: Word8
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
              ++ show nonce
              ++ "\n"
              ++ "tGasLimit: "
              ++ show gasLimit
              ++ "\n"
              ++ "to: "
              ++ format to
              ++ "\n"
              ++ "tFuncName: "
              ++ ("\n" ++ format funcName)
              ++ "\n"
              ++ "params: "
              ++ format args
              ++ "\n"
              ++ "network: "
              ++ format network
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
              ++ show nonce
              ++ "\n"
              ++ "tGasLimit: "
              ++ show gasLimit
              ++ "\n"
              ++ "ContractName: "
              ++ show contractName
              ++ "\n"
              ++ "tArgs: "
              ++ show args
              ++ "\n"
              ++ "tNetwork: "
              ++ show network
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
              { v = fromInteger $ rlpDecode vVal,
                r = rlpDecode rVal,
                s = rlpDecode sVal
              }
          p@ContractCreationTX {} ->
            p
              { v = fromInteger $ rlpDecode vVal,
                r = rlpDecode rVal,
                s = rlpDecode sVal
              }
    where
      partial = partialRLPDecode $ RLPArray [txType, arg2, arg3, arg4, arg5, arg6, arg7]
  rlpDecode x = error ("rlp object has wrong format in call to rlpDecodeq: " ++ show x)

  rlpEncode t =
    case partialRLPEncode t of
      RLPArray items ->
        RLPArray $ items ++
        [
          rlpEncode $ toInteger (v t),
          rlpEncode (r t),
          rlpEncode (s t)
        ]
      v -> error $ "rlpEncode Transaction: Expected RLPArray, but got: " ++ show v

instance ShortDescription Transaction where
  shortDescription MessageTX {..} = shorten 90 $
    "calling " ++ format to ++ "/" ++ T.unpack funcName ++  "(" ++ intercalate "," (map format args) ++ ")"
  shortDescription ContractCreationTX {..} = shorten 40 $
    "Create Contract " ++ T.unpack contractName ++ "(" ++ intercalate "," (map format args) ++ ")"

isMessageTX :: Transaction -> Bool
isMessageTX MessageTX {} = True
isMessageTX _ = False

--partialRLP(De|En)code are used for the signing algorithm
partialRLPDecode :: RLPObject -> Transaction
partialRLPDecode (RLPArray [RLPScalar 1, n, gl, cName, ags, net, cd]) =
  --Note- Address 0 /= Address 000000....  Only Address 0 yields a ContractCreationTX
  ContractCreationTX
    { nonce = rlpDecode n,
      gasLimit = rlpDecode gl,
      contractName = rlpDecode cName,
      args = rlpDecode ags,
      network = rlpDecode net,
      code = rlpDecode cd,
      chainId = Nothing,
      r = error "r not initialized in partialRLPDecode",
      s = error "s not initialized in partialRLPDecode",
      v = error "v not initialized in partialRLPDecode"
    }
partialRLPDecode (RLPArray [RLPScalar 2, n, gl, toAddr, fn, ags, net]) =
  MessageTX
    { nonce = rlpDecode n,
      gasLimit = rlpDecode gl,
      to = rlpDecode toAddr,
      funcName = rlpDecode fn,
      args = rlpDecode ags,
      network = rlpDecode net,
      chainId = Nothing,
      r = error "r not initialized in partialRLPDecode",
      s = error "s not initialized in partialRLPDecode",
      v = error "v not initialized in partialRLPDecode"
    }
partialRLPDecode x = error ("rlp object has wrong format in call to partialRLPDecode: " ++ show x)

partialRLPEncode :: Transaction -> RLPObject
partialRLPEncode MessageTX {..} =
  RLPArray $
    [ rlpEncode (2::Integer),
      rlpEncode nonce,
      rlpEncode gasLimit,
      rlpEncode to,
      rlpEncode funcName,
      rlpEncode args,
      rlpEncode network
    ]
partialRLPEncode ContractCreationTX {..} =
  RLPArray $
    [ rlpEncode (1::Integer),
      rlpEncode nonce,
      rlpEncode gasLimit,
      rlpEncode contractName,
      rlpEncode args,
      rlpEncode network,
      rlpEncode code
    ]
