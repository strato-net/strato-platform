{-# LANGUAGE OverloadedStrings #-}

module EthereumTransaction
  ( EthereumTransaction (..),
    decodeEthereumRLP,
    recoverEthereumSender,
    verifyEthereumSignature,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord (word256ToBytes)
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as EC
import qualified Crypto.Secp256k1 as SEC
import qualified Data.ByteString as B
import qualified Data.ByteString.Short as BSS
import Data.Maybe

data EthereumTransaction = EthereumTransaction
  { ethNonce :: Integer,
    ethGasPrice :: Maybe Integer,
    ethMaxFeePerGas :: Maybe Integer,
    ethMaxPriorityFeePerGas :: Maybe Integer,
    ethGasLimit :: Integer,
    ethTo :: Maybe Address,
    ethValue :: Integer,
    ethData :: B.ByteString,
    ethAccessList :: Maybe [AccessListItem],
    ethChainId :: Maybe Integer,
    ethV :: Integer,
    ethR :: Integer,
    ethS :: Integer
  }
  deriving (Show, Eq)

data AccessListItem = AccessListItem
  { accessListAddress :: Address,
    accessListStorageKeys :: [B.ByteString]
  }
  deriving (Show, Eq)

decodeEthereumRLP :: B.ByteString -> Either String EthereumTransaction
decodeEthereumRLP rawBytes
  | B.null rawBytes = Left "Empty transaction data"
  | otherwise = do
      rlpObj <- case rlpDeserializeEither rawBytes of
        Right obj -> Right obj
        Left err -> Left $ "Invalid RLP: " ++ err
      parseEthereumTransaction rlpObj

parseEthereumTransaction :: RLPObject -> Either String EthereumTransaction
parseEthereumTransaction (RLPArray items) =
  case length items of
    9 -> parseLegacyTransaction items
    12 -> 
      -- Check first element to distinguish EIP-155 (no tx type) from EIP-2930 (tx type = 1)
      case items of
        (txType:_) | rlpDecode txType == (1 :: Integer) -> parseEIP2930Transaction items
        _ -> parseEIP155Transaction items
    13 -> parseEIP1559Transaction items
    n -> Left $ "Unsupported transaction format: expected 9, 12, or 13 items, got " ++ show n
parseEthereumTransaction _ = Left "Transaction must be an RLP array"

parseLegacyTransaction :: [RLPObject] -> Either String EthereumTransaction
parseLegacyTransaction [nonce, gasPrice, gasLimit, to, value, data_, v, r, s] =
  Right $
    EthereumTransaction
      { ethNonce = rlpDecode nonce,
        ethGasPrice = Just $ rlpDecode gasPrice,
        ethMaxFeePerGas = Nothing,
        ethMaxPriorityFeePerGas = Nothing,
        ethGasLimit = rlpDecode gasLimit,
        ethTo = decodeMaybeAddress to,
        ethValue = rlpDecode value,
        ethData = rlpDecode data_,
        ethAccessList = Nothing,
        ethChainId = Nothing,
        ethV = rlpDecode v,
        ethR = rlpDecode r,
        ethS = rlpDecode s
      }
parseLegacyTransaction _ = Left "Invalid legacy transaction format"

parseEIP155Transaction :: [RLPObject] -> Either String EthereumTransaction
parseEIP155Transaction [nonce, gasPrice, gasLimit, to, value, data_, chainId, _zero1, _zero2, v, r, s] =
  let vVal = rlpDecode v
      chainIdVal = rlpDecode chainId
      -- EIP-155: v = chainId * 2 + 35 or chainId * 2 + 36
      -- The recovery ID is (v - 35) mod 2
      actualV = if vVal >= 35 then (vVal - 35) `mod` 2 + 27 else vVal
   in Right $
        EthereumTransaction
          { ethNonce = rlpDecode nonce,
            ethGasPrice = Just $ rlpDecode gasPrice,
            ethMaxFeePerGas = Nothing,
            ethMaxPriorityFeePerGas = Nothing,
            ethGasLimit = rlpDecode gasLimit,
            ethTo = decodeMaybeAddress to,
            ethValue = rlpDecode value,
            ethData = rlpDecode data_,
            ethAccessList = Nothing,
            ethChainId = Just chainIdVal,
            ethV = actualV,
            ethR = rlpDecode r,
            ethS = rlpDecode s
          }
parseEIP155Transaction _ = Left "Invalid EIP-155 transaction format"

parseEIP2930Transaction :: [RLPObject] -> Either String EthereumTransaction
parseEIP2930Transaction items =
  case items of
    [txType, chainId, nonce, gasPrice, gasLimit, to, value, data_, accessList, v, r, s] ->
      let txTypeVal = rlpDecode txType :: Integer
       in if txTypeVal == 1
            then Right $
                  EthereumTransaction
                    { ethNonce = rlpDecode nonce,
                      ethGasPrice = Just $ rlpDecode gasPrice,
                      ethMaxFeePerGas = Nothing,
                      ethMaxPriorityFeePerGas = Nothing,
                      ethGasLimit = rlpDecode gasLimit,
                      ethTo = decodeMaybeAddress to,
                      ethValue = rlpDecode value,
                      ethData = rlpDecode data_,
                      ethAccessList = decodeAccessList accessList,
                      ethChainId = Just $ rlpDecode chainId,
                      ethV = rlpDecode v,
                      ethR = rlpDecode r,
                      ethS = rlpDecode s
                    }
            else Left $ "Invalid EIP-2930 transaction type: " ++ show txTypeVal
    _ -> Left "Invalid EIP-2930 transaction format"

parseEIP1559Transaction :: [RLPObject] -> Either String EthereumTransaction
parseEIP1559Transaction items =
  case items of
    [txType, chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data_, accessList, v, r, s] ->
      let txTypeVal = rlpDecode txType :: Integer
       in if txTypeVal == 2
            then Right $
                  EthereumTransaction
                    { ethNonce = rlpDecode nonce,
                      ethGasPrice = Nothing,
                      ethMaxFeePerGas = Just $ rlpDecode maxFeePerGas,
                      ethMaxPriorityFeePerGas = Just $ rlpDecode maxPriorityFeePerGas,
                      ethGasLimit = rlpDecode gasLimit,
                      ethTo = decodeMaybeAddress to,
                      ethValue = rlpDecode value,
                      ethData = rlpDecode data_,
                      ethAccessList = decodeAccessList accessList,
                      ethChainId = Just $ rlpDecode chainId,
                      ethV = rlpDecode v,
                      ethR = rlpDecode r,
                      ethS = rlpDecode s
                    }
            else Left $ "Invalid EIP-1559 transaction type: " ++ show txTypeVal
    _ -> Left "Invalid EIP-1559 transaction format"

decodeMaybeAddress :: RLPObject -> Maybe Address
decodeMaybeAddress (RLPString bs) | B.null bs = Nothing
decodeMaybeAddress (RLPString bs) = 
  case rlpDecode (RLPString bs) of
    addr -> Just addr
decodeMaybeAddress _ = Nothing

decodeAccessList :: RLPObject -> Maybe [AccessListItem]
decodeAccessList (RLPArray items) = Just $ map decodeAccessListItem items
decodeAccessList _ = Nothing

decodeAccessListItem :: RLPObject -> AccessListItem
decodeAccessListItem (RLPArray [addr, storageKeys]) =
  AccessListItem
    { accessListAddress = rlpDecode addr,
      accessListStorageKeys = map rlpDecode $ case storageKeys of
        RLPArray keys -> keys
        _ -> []
    }
decodeAccessListItem _ = error "Invalid access list item format"

recoverEthereumSender :: EthereumTransaction -> Maybe Address
recoverEthereumSender tx = do
  let msgHash = computeEthereumTxHash tx
      sig = createEthereumSignature tx
  pubKey <- EC.recoverPub sig msgHash
  return $ fromPublicKey pubKey

verifyEthereumSignature :: EthereumTransaction -> Bool
verifyEthereumSignature tx = isJust $ recoverEthereumSender tx

computeEthereumTxHash :: EthereumTransaction -> B.ByteString
computeEthereumTxHash tx =
  let unsignedTx = rlpEncodeEthereumTx tx
      serialized = rlpSerialize unsignedTx
   in keccak256ToByteString $ hash serialized

rlpEncodeEthereumTx :: EthereumTransaction -> RLPObject
rlpEncodeEthereumTx tx =
  case (ethChainId tx, ethAccessList tx) of
    (Nothing, Nothing) ->
      RLPArray
        [ rlpEncode $ ethNonce tx,
          rlpEncode $ fromMaybe 0 $ ethGasPrice tx,
          rlpEncode $ ethGasLimit tx,
          rlpEncodeMaybeAddress $ ethTo tx,
          rlpEncode $ ethValue tx,
          rlpEncode $ ethData tx
        ]
    (Just chainId, Nothing) ->
      RLPArray
        [ rlpEncode $ ethNonce tx,
          rlpEncode $ fromMaybe 0 $ ethGasPrice tx,
          rlpEncode $ ethGasLimit tx,
          rlpEncodeMaybeAddress $ ethTo tx,
          rlpEncode $ ethValue tx,
          rlpEncode $ ethData tx,
          rlpEncode chainId,
          rlpEncode (0 :: Integer),
          rlpEncode (0 :: Integer)
        ]
    (Just chainId, Just _) ->
      let isEIP1559 = isJust (ethMaxFeePerGas tx)
          txType = if isEIP1559 then (2 :: Integer) else (1 :: Integer)
          maxPriorityFee = fromMaybe 0 $ ethMaxPriorityFeePerGas tx
          maxFee = fromMaybe 0 $ ethMaxFeePerGas tx
          gasPrice = fromMaybe 0 $ ethGasPrice tx
       in RLPArray
            [ rlpEncode txType,
              rlpEncode chainId,
              rlpEncode $ ethNonce tx,
              rlpEncode $ if isEIP1559 then maxPriorityFee else gasPrice,
              rlpEncode $ if isEIP1559 then maxFee else gasPrice,
              rlpEncode $ ethGasLimit tx,
              rlpEncodeMaybeAddress $ ethTo tx,
              rlpEncode $ ethValue tx,
              rlpEncode $ ethData tx,
              rlpEncodeAccessList $ ethAccessList tx
            ]
    _ -> error "Invalid transaction combination"

rlpEncodeMaybeAddress :: Maybe Address -> RLPObject
rlpEncodeMaybeAddress Nothing = RLPString B.empty
rlpEncodeMaybeAddress (Just addr) = rlpEncode addr

rlpEncodeAccessList :: Maybe [AccessListItem] -> RLPObject
rlpEncodeAccessList Nothing = RLPArray []
rlpEncodeAccessList (Just items) = RLPArray $ map rlpEncodeAccessListItem items

rlpEncodeAccessListItem :: AccessListItem -> RLPObject
rlpEncodeAccessListItem item =
  RLPArray
    [ rlpEncode $ accessListAddress item,
      RLPArray $ map rlpEncode $ accessListStorageKeys item
    ]

createEthereumSignature :: EthereumTransaction -> EC.Signature
createEthereumSignature tx =
  let r = intToBSS $ ethR tx
      s = intToBSS $ ethS tx
      v = ethV tx :: Integer
      -- Convert Ethereum V to secp256k1 recovery ID
      -- Legacy: V is 27 or 28, recovery ID is V - 27 (0 or 1)
      -- EIP-155: V is chainId*2 + 35 or chainId*2 + 36, recovery ID is (V - 35) mod 2
      v' = if v >= 35 then fromIntegral ((v - 35) `mod` 2) else if v >= 27 then fromIntegral (v - 27) else fromIntegral v
      compactSig = SEC.CompactRecSig r s v'
   in EC.Signature compactSig

intToBSS :: Integer -> BSS.ShortByteString
intToBSS n = BSS.toShort $ word256ToBytes $ fromInteger n

