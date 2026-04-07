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
    ethVToRecoveryId,
    ethVToChainId,
    toEthV,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
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
  | EthereumTX
      { nonce :: Integer,
        gasPrice :: Integer,
        gasLimit :: Integer,
        ethTo :: Maybe Address,
        value :: Integer,
        txData :: B.ByteString,
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
  format
    t@EthereumTX{..} =
      CL.blue "Ethereum Transaction"
        ++ tab'
          ( "\n"
              ++ "nonce: "
              ++ show nonce
              ++ "\n"
              ++ "gasPrice: "
              ++ show gasPrice
              ++ "\n"
              ++ "gasLimit: "
              ++ show gasLimit
              ++ "\n"
              ++ "to: "
              ++ maybe "(contract creation)" format ethTo
              ++ "\n"
              ++ "value: "
              ++ show value
              ++ "\n"
              ++ "data: 0x"
              ++ show (B16.encode txData)
              ++ "\n"
              ++ "hash: "
              ++ format (hash . rlpSerialize . rlpEncode $ t)
              ++ "\n"
          )

-- EIP-155: v = chainId * 2 + 35 + recoveryId; pre-EIP-155: v = 27 + recoveryId
ethVToRecoveryId :: Integer -> Word8
ethVToRecoveryId rawV
  | rawV == 0 || rawV == 1   = fromInteger rawV
  | rawV == 27 || rawV == 28  = fromInteger (rawV - 27)
  | rawV >= 35             = fromInteger ((rawV - 35) `mod` 2)
  | otherwise           = error $ "invalid Ethereum v value: " ++ show rawV

ethVToChainId :: Integer -> Maybe Integer
ethVToChainId rawV
  | rawV == 27 || rawV == 28 = Nothing
  | rawV >= 35            = Just ((rawV - 35) `div` 2)
  | otherwise          = Nothing

toEthV :: Word8 -> Maybe Integer -> Integer
toEthV recId Nothing = 27 + toInteger recId
toEthV recId (Just cid) = cid * 2 + 35 + toInteger recId

instance RLPSerializable Transaction where
  -- 10 fields: STRATO format (MessageTX or ContractCreationTX)
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
          _ -> error "rlpDecode Transaction: unexpected partial decode result"
    where
      partial = partialRLPDecode $ RLPArray [txType, arg2, arg3, arg4, arg5, arg6, arg7]
  -- 9 fields: Ethereum legacy format
  rlpDecode (RLPArray [n, gp, gl, toAddr, val, dat, vVal, rVal, sVal]) =
    let rawV = rlpDecode vVal :: Integer
    in EthereumTX
      { nonce = rlpDecode n,
        gasPrice = rlpDecode gp,
        gasLimit = rlpDecode gl,
        ethTo = case toAddr of
          RLPString "" -> Nothing
          _            -> Just (rlpDecode toAddr),
        value = rlpDecode val,
        txData = rlpDecode dat,
        chainId = ethVToChainId rawV,
        r = rlpDecode rVal,
        s = rlpDecode sVal,
        v = ethVToRecoveryId rawV
      }
  rlpDecode x = error ("rlp object has wrong format in call to rlpDecode: " ++ show x)

  rlpEncode t@EthereumTX{..} =
    case partialRLPEncode t of
      RLPArray items ->
        RLPArray $ items ++
        [ rlpEncode (toEthV v chainId),
          rlpEncode r,
          rlpEncode s
        ]
      x -> error $ "rlpEncode Transaction: Expected RLPArray, but got: " ++ show x
  rlpEncode t =
    case partialRLPEncode t of
      RLPArray items ->
        RLPArray $ items ++
        [
          rlpEncode $ toInteger (v t),
          rlpEncode (r t),
          rlpEncode (s t)
        ]
      x -> error $ "rlpEncode Transaction: Expected RLPArray, but got: " ++ show x

instance ShortDescription Transaction where
  shortDescription MessageTX {..} = shorten 90 $
    "calling " ++ format to ++ "/" ++ T.unpack funcName ++  "(" ++ intercalate "," (map format args) ++ ")"
  shortDescription ContractCreationTX {..} = shorten 40 $
    "Create Contract " ++ T.unpack contractName ++ "(" ++ intercalate "," (map format args) ++ ")"
  shortDescription EthereumTX {..} = shorten 90 $
    "eth tx " ++ maybe "(create)" format ethTo ++ " value=" ++ show value ++ " data=" ++ show (B.length txData) ++ "b"

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
partialRLPEncode EthereumTX {..} =
  RLPArray $
    [ rlpEncode nonce,
      rlpEncode gasPrice,
      rlpEncode gasLimit,
      maybe (RLPString "") rlpEncode ethTo,
      rlpEncode value,
      rlpEncode txData
    ]
