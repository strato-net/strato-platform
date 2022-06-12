{-# OPTIONS_GHC -fno-warn-orphans  #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists       #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TypeApplications      #-}

-- {-# OPTIONS -fno-warn-unused-top-binds #-}
-- {-# OPTIONS -fno-warn-unused-imports #-}

module BlockApps.Ethereum
  ( -- Number type reexports
    Hex (..)
  , Transaction (..)
  , UnsignedTransaction (..)
  , rlpHash
  ) where

import           Control.DeepSeq (NFData)
import           Data.Aeson             hiding (Array, String)
import           Data.ByteString        (ByteString)
import qualified Data.ByteString.Char8  as Char8
import           Data.Map.Strict        (Map)
import qualified Data.Map.Strict        as M
import           Data.Maybe
import           Data.RLP
import qualified Data.RLP               as RLP (RLPObject(..))
import           Data.Text              (Text)
import qualified Data.Text              as Text
import           Data.Word
import           Generic.Random
import           GHC.Generics
import           Numeric
import           Test.QuickCheck        hiding ((.&.))
import           Test.QuickCheck.Instances    ()
import           Text.Read              hiding (String)
import           Text.Read.Lex

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256   hiding (rlpHash)
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Wei

newtype Hex n = Hex { unHex :: n } deriving (Eq, Generic, Ord)

instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex (toInteger n) ""

instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (const readHexP)
  --I'm not sure what `d` precision parameter is used for

instance Num n => FromJSON (Hex n) where
  parseJSON value = do
    string <- parseJSON value
    case fmap fromInteger (readMaybe ("0x" ++ string)) of
      Nothing -> fail $ "not hex encoded: " ++ string
      Just n  -> return $ Hex n

instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show

instance Arbitrary x => Arbitrary (Hex x) where
  arbitrary = genericArbitrary uniform


instance RLPEncodable CodePtr where
  rlpEncode (EVMCode codeHash) = rlpEncode codeHash
  rlpEncode (SolidVMCode n ch) = RLP.Array [RLP.String $ Char8.pack "SolidVM"
                                           , rlpEncode n
                                           , rlpEncode ch
                                           ]
  rlpEncode (CodeAtAccount a n) = RLP.Array [RLP.String $ Char8.pack "AtAccount"
                                            , rlpEncode a
                                            , rlpEncode n
                                            ]

  rlpDecode (RLP.Array [RLP.String "SolidVM", n, ch]) = SolidVMCode <$> rlpDecode n <*> rlpDecode ch
  rlpDecode (RLP.Array [RLP.String "AtAccount", a, n]) = CodeAtAccount <$> rlpDecode a <*> rlpDecode n
  rlpDecode ch = EVMCode <$> rlpDecode ch

instance RLPEncodable Code where
  rlpEncode (Code cb) = rlpEncode cb
  rlpEncode (PtrToCode cp) = RLP.Array [rlpEncode cp]

  rlpDecode (RLP.Array [x]) = PtrToCode <$> rlpDecode x
  rlpDecode x = Code <$> rlpDecode x

--------------------------------------------------------------------------------

data Transaction = Transaction
  { transactionNonce      :: Nonce
  , transactionGasPrice   :: Wei
  , transactionGasLimit   :: Gas
  , transactionTo         :: Maybe Address
  , transactionValue      :: Wei
  , transactionInitOrData :: Code
  , transactionChainId    :: Maybe ChainId
  , transactionV          :: Word8
  , transactionR          :: Word256
  , transactionS          :: Word256
  , transactionMetadata   :: Maybe (Map Text Text)
  } deriving (Eq,Show,Generic, NFData)

instance RLPEncodable Text where
  rlpEncode = rlpEncode . Text.unpack
  rlpDecode = fmap Text.pack . rlpDecode

instance (Ord k, RLPEncodable k, RLPEncodable v) => RLPEncodable (Map k v) where
  rlpEncode = rlpEncode . M.toList
  rlpDecode = fmap M.fromList <$> rlpDecode

instance RLPEncodable Transaction where
  rlpEncode Transaction{..} = Array $
    [ rlpEncode transactionNonce
    , rlpEncode transactionGasPrice
    , rlpEncode transactionGasLimit
    , rlpEncode transactionTo
    , rlpEncode transactionValue
    , rlpEncode transactionInitOrData
    , rlpEncode transactionV
    , rlpEncode transactionR
    , rlpEncode transactionS
    ] ++ (case transactionChainId of
            Nothing -> []
            Just cid -> [rlpEncode cid])
      ++ (case transactionMetadata of
            Nothing -> []
            Just md -> [rlpEncode md])
  rlpDecode (Array (n:gp:gl:to':va:iod:v':r':s':rest)) =
    let (cid,md) = case rest of
          [] -> (Right Nothing, Right Nothing)
          [c] -> case c of
            a@(Array _) -> (Right Nothing, Just <$> rlpDecode a)
            cid' -> (Just <$> rlpDecode cid', Right Nothing)
          (c:m:_) -> (Just <$> rlpDecode c, Just <$> rlpDecode m)
     in Transaction
          <$> rlpDecode n
          <*> rlpDecode gp
          <*> rlpDecode gl
          <*> rlpDecode to'
          <*> rlpDecode va
          <*> rlpDecode iod
          <*> cid
          <*> rlpDecode v'
          <*> rlpDecode r'
          <*> rlpDecode s'
          <*> md
  rlpDecode x = Left $ "rlpDecode Transaction: Got " ++ show x

data UnsignedTransaction = UnsignedTransaction
  { unsignedTransactionNonce      :: Nonce
  , unsignedTransactionGasPrice   :: Wei
  , unsignedTransactionGasLimit   :: Gas
  , unsignedTransactionTo         :: Maybe Address
  , unsignedTransactionValue      :: Wei
  , unsignedTransactionInitOrData :: Code
  , unsignedTransactionChainId    :: Maybe ChainId
  } deriving (Eq,Show,Generic)

instance Arbitrary UnsignedTransaction where
  arbitrary = genericArbitrary uniform

instance RLPEncodable UnsignedTransaction where
  rlpEncode UnsignedTransaction{..} = Array $
    [ rlpEncode unsignedTransactionNonce
    , rlpEncode unsignedTransactionGasPrice
    , rlpEncode unsignedTransactionGasLimit
    , rlpEncode unsignedTransactionTo
    , rlpEncode unsignedTransactionValue
    , rlpEncode unsignedTransactionInitOrData
    ] ++ (maybeToList $ fmap rlpEncode unsignedTransactionChainId)
  rlpDecode (Array (n:gp:gl:to':va:iod:rest)) =
    UnsignedTransaction
      <$> rlpDecode n
      <*> rlpDecode gp
      <*> rlpDecode gl
      <*> rlpDecode to'
      <*> rlpDecode va
      <*> rlpDecode iod
      <*> (case rest of
             [] -> pure Nothing
             [cid] -> Just <$> rlpDecode cid
             x -> Left $ "rlpDecode UnsignedTransaction: Too many entries, got: " ++ show x)
  rlpDecode x = Left $ "rlpDecode UnsignedTransaction: Got " ++ show x

rlpHash :: RLPEncodable x => x -> ByteString
rlpHash
  = keccak256ToByteString
  . hash
  . packRLP
  . rlpEncode
