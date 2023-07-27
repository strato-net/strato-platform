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
import Control.Arrow ((***))
import Control.DeepSeq
import Data.Binary
import qualified Data.ByteString as B
import Data.Data
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (listToMaybe, maybeToList)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
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
        transactionGasPrice :: Integer,
        transactionGasLimit :: Integer,
        transactionTo :: Address,
        transactionValue :: Integer,
        transactionData :: B.ByteString,
        transactionChainId :: Maybe Word256,
        transactionR :: Integer,
        transactionS :: Integer,
        transactionV :: Word8,
        transactionMetadata :: Maybe (Map Text Text)
      }
  | ContractCreationTX
      { transactionNonce :: Integer,
        transactionGasPrice :: Integer,
        transactionGasLimit :: Integer,
        transactionValue :: Integer,
        transactionInit :: Code,
        transactionChainId :: Maybe Word256,
        transactionR :: Integer,
        transactionS :: Integer,
        transactionV :: Word8,
        transactionMetadata :: Maybe (Map Text Text)
      }
  | PrivateHashTX
      { transactionTxHash :: Keccak256,
        transactionChainHash :: Keccak256
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
  format PrivateHashTX {transactionTxHash = h, transactionChainHash = ch} =
    CL.blue "Private Transaction Hash"
      ++ tab'
        ( "\n"
            ++ "Transaction Hash:       "
            ++ CL.yellow (format h)
            ++ "\n"
            ++ "Transaction Chain Hash: "
            ++ CL.yellow (format ch)
            ++ "\n"
        )
  format
    t@MessageTX
      { transactionNonce = n,
        transactionGasPrice = gp,
        transactionGasLimit = gl,
        transactionTo = to',
        transactionValue = v,
        transactionData = d,
        transactionChainId = cid,
        transactionMetadata = md
      } =
      CL.blue "Message Transaction"
        ++ tab'
          ( "\n"
              ++ "tNonce: "
              ++ show n
              ++ "\n"
              ++ "gasPrice: "
              ++ show gp
              ++ "\n"
              ++ "tGasLimit: "
              ++ show gl
              ++ "\n"
              ++ "to: "
              ++ format to'
              ++ "\n"
              ++ "value: "
              ++ show v
              ++ "\n"
              ++ "tData: "
              ++ ("\n" ++ format d)
              ++ "\n"
              ++ "chainId: "
              ++ formatChainId cid
              ++ "\n"
              ++ "metadata: "
              ++ show md
              ++ "\n"
              ++ "hash: "
              ++ format (hash . rlpSerialize . rlpEncode $ t)
              ++ "\n"
          )
  format
    t@ContractCreationTX
      { transactionNonce = n,
        transactionGasPrice = gp,
        transactionGasLimit = gl,
        transactionValue = v,
        transactionInit = theCode,
        transactionChainId = cid,
        transactionMetadata = md
      } =
      CL.blue "Contract Creation Transaction"
        ++ tab'
          ( "\n"
              ++ "tNonce: "
              ++ show n
              ++ "\n"
              ++ "gasPrice: "
              ++ show gp
              ++ "\n"
              ++ "tGasLimit: "
              ++ show gl
              ++ "\n"
              ++ "value: "
              ++ show v
              ++ "\n"
              ++ "tInit: "
              ++ codeToString theCode
              ++ "\n"
              ++ "chainId: "
              ++ formatChainId cid
              ++ "\n"
              ++ "metadata: "
              ++ show md
              ++ "\n"
              ++ "hash: "
              ++ format (hash . rlpSerialize . rlpEncode $ t)
              ++ "\n"
          )
      where
        codeToString (Code init') = format init'
        codeToString (PtrToCode codePtr) = "PtrToCode: " ++ format codePtr

instance RLPSerializable Transaction where
  rlpDecode (RLPArray (n : gp : gl : toAddr : val : i : vVal : rVal : sVal : xs)) =
    let (cid, md) = case xs of
          [] -> (Nothing, Nothing)
          [c] -> case c of
            (RLPArray a) -> (Nothing, Just . M.fromList $ map ((decodeUtf8 *** decodeUtf8) . rlpDecode) a)
            cid' -> (Just $ rlpDecode cid', Nothing)
          (c : (RLPArray a) : _) -> (Just $ rlpDecode c, Just . M.fromList $ map ((decodeUtf8 *** decodeUtf8) . rlpDecode) a)
          (_ : o : _) -> error $ "rlpDecode Transaction: Expected metadata to be an RLPArray, but got: " ++ show o
     in case partial of
          PrivateHashTX {} -> case cid of
            Nothing -> PrivateHashTX (unsafeCreateKeccak256FromWord256 $ rlpDecode rVal) (unsafeCreateKeccak256FromWord256 $ rlpDecode sVal)
            Just _ -> error "rlpDecode Transaction: PrivateHashTX transactions can't have a chainId"
          p@MessageTX {} ->
            p
              { transactionV = fromInteger $ rlpDecode vVal,
                transactionR = rlpDecode rVal,
                transactionS = rlpDecode sVal,
                transactionChainId = cid,
                transactionMetadata = md
              }
          p@ContractCreationTX {} ->
            p
              { transactionV = fromInteger $ rlpDecode vVal,
                transactionR = rlpDecode rVal,
                transactionS = rlpDecode sVal,
                transactionChainId = cid,
                transactionMetadata = md
              }
    where
      partial = partialRLPDecode $ RLPArray [n, gp, gl, toAddr, val, i]
  rlpDecode x = error ("rlp object has wrong format in call to rlpDecodeq: " ++ show x)

  rlpEncode t = case r of
    RLPArray (n : gp : gl : toAddr : val : i : cid) ->
      let chainId = listToMaybe cid
       in case t of
            PrivateHashTX {..} -> case cid of
              [] ->
                RLPArray
                  [ n,
                    gp,
                    gl,
                    toAddr,
                    val,
                    i,
                    RLPString "",
                    (rlpEncode $ keccak256ToWord256 transactionTxHash),
                    (rlpEncode $ keccak256ToWord256 transactionChainHash)
                  ]
              _ -> error "rlpEncode Transaction: PrivateHashTX transactions can't have a chainId"
            MessageTX {..} ->
              RLPArray $
                [ n,
                  gp,
                  gl,
                  toAddr,
                  val,
                  i,
                  rlpEncode $ toInteger transactionV,
                  rlpEncode $ transactionR,
                  rlpEncode $ transactionS
                ]
                  ++ (maybeToList chainId)
                  ++ (maybeToList $ fmap (RLPArray . map (rlpEncode . (encodeUtf8 *** encodeUtf8)) . M.toList) transactionMetadata)
            ContractCreationTX {..} ->
              RLPArray $
                [ n,
                  gp,
                  gl,
                  toAddr,
                  val,
                  i,
                  rlpEncode $ toInteger transactionV,
                  rlpEncode $ transactionR,
                  rlpEncode $ transactionS
                ]
                  ++ (maybeToList chainId)
                  ++ (maybeToList $ fmap (RLPArray . map (rlpEncode . (encodeUtf8 *** encodeUtf8)) . M.toList) transactionMetadata)
    _ -> error $ "rlpEncode Transaction: Expected RLPArray, but got: " ++ show r
    where
      r = partialRLPEncode t

instance ShortDescription Transaction where
  shortDescription t | isMessageTX t = shorten 90 $
    case (M.lookup "funcName" =<< transactionMetadata t, M.lookup "args" =<< transactionMetadata t, transactionData t) of
      (Just n, Just a, _) -> "calling " ++ format (transactionTo t) ++ "/" ++ T.unpack n ++ T.unpack a
      (_, _, "") -> "Value transfer of " ++ show (transactionValue t) ++ " to " ++ shortDescription (transactionTo t)
      _ -> "MessageTX to " ++ format (transactionTo t)
  shortDescription t = shorten 40 $
    case (M.lookup "name" =<< transactionMetadata t, M.lookup "args" =<< transactionMetadata t) of
      (Just n, Just "") -> "Create Contract " ++ T.unpack n
      (Just n, Just a) -> "Create Contract " ++ T.unpack n ++ T.unpack a
      _ -> "Create Contract"

isMessageTX :: Transaction -> Bool
isMessageTX MessageTX {} = True
isMessageTX _ = False

--partialRLP(De|En)code are used for the signing algorithm
partialRLPDecode :: RLPObject -> Transaction
partialRLPDecode (RLPArray [RLPString "", RLPString "", RLPString "", RLPString "", RLPString "", RLPString ""]) =
  -- empty strings and the number 0 rlpEncode to (RLPString "")
  PrivateHashTX
    { transactionTxHash = error "transactionTxHash not initialized in partialRLPDecode",
      transactionChainHash = error "transactionChainHash not initialized in partialRLPDecode"
    }
partialRLPDecode (RLPArray [n, gp, gl, RLPString "", val, i]) =
  --Note- Address 0 /= Address 000000....  Only Address 0 yields a ContractCreationTX
  ContractCreationTX
    { transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionValue = rlpDecode val,
      transactionInit = rlpDecode i,
      transactionChainId = error "transactionChainId not initialized in partialRLPDecode",
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode",
      transactionMetadata = error "transactionMetadata not initialized in partialRLPDecode"
    }
partialRLPDecode (RLPArray [n, gp, gl, toAddr, val, i]) =
  MessageTX
    { transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionTo = rlpDecode toAddr,
      transactionValue = rlpDecode val,
      transactionData = rlpDecode i,
      transactionChainId = error "transactionChainId not initialized in partialRLPDecode",
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode",
      transactionMetadata = error "transactionMetadata not initialized in partialRLPDecode"
    }
partialRLPDecode x = error ("rlp object has wrong format in call to partialRLPDecode: " ++ show x)

partialRLPEncode :: Transaction -> RLPObject
partialRLPEncode MessageTX {transactionNonce = n, transactionGasPrice = gp, transactionGasLimit = gl, transactionTo = to', transactionValue = v, transactionData = d, transactionChainId = cid} =
  RLPArray $
    [ rlpEncode n,
      rlpEncode gp,
      rlpEncode gl,
      rlpEncode to',
      rlpEncode v,
      rlpEncode d
    ]
      ++ (maybeToList $ fmap rlpEncode cid)
partialRLPEncode ContractCreationTX {transactionNonce = n, transactionGasPrice = gp, transactionGasLimit = gl, transactionValue = v, transactionInit = init', transactionChainId = cid} =
  RLPArray $
    [ rlpEncode n,
      rlpEncode gp,
      rlpEncode gl,
      rlpEncode (0 :: Integer),
      rlpEncode v,
      rlpEncode init'
    ]
      ++ (maybeToList $ fmap rlpEncode cid)
partialRLPEncode _ = RLPArray . map rlpEncode $ replicate 6 (0 :: Integer) -- PrivateHashTX
