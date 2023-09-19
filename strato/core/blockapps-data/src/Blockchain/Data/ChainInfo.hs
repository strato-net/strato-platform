{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE StrictData #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.ChainInfo
  ( ParentChainIds (..),
    ChainInfo (..),
    UnsignedChainInfo (..),
    ChainSignature (..),
    AccountInfo (..),
    CodeInfo (..),
    isAncestorChainOf,
    getAncestorChains,
    getAncestorChainByName,
    accountExtractor,
    whoSignedThisChainInfo,
  )
where

import Blockchain.Data.RLP
import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as EC
import Control.Applicative (many)
import qualified Control.Monad.Change.Alter as A
import qualified Crypto.Secp256k1 as SEC
-- import           Blockchain.TypeLits

import Data.Aeson
import Data.Bifunctor (first)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Short as BSS
import Data.Data
import Data.Foldable
import qualified Data.JsonStream.Parser as JS
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.Set as S
import Data.Swagger hiding (Format, format, name)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import qualified Data.Vector as V
import Data.Word
import qualified GHC.Generics as GHCG
import LabeledError
import Numeric (showHex)
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import Test.QuickCheck.Instances.ByteString ()
import Test.QuickCheck.Instances.Text ()
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

newtype ParentChainIds = ParentChainIds {unParentChainIds :: Map T.Text Word256}

data CodeInfo = CodeInfo
  { codeInfoCode :: B.ByteString,
    codeInfoSource :: T.Text,
    codeInfoName :: Maybe T.Text
  }
  deriving (Show, Read, Eq, GHCG.Generic, Data)

instance Format CodeInfo where
  format CodeInfo {..} =
    unlines
      [ "CodeInfo",
        "--------",
        tab' $ "Name:   " ++ show codeInfoName,
        tab' $ "Source: " ++ show codeInfoSource,
        tab' $ "Code:   " ++ show (decodeUtf8 $ B16.encode codeInfoCode)
      ]

instance FromJSON CodeInfo where
  parseJSON (Array v) = do
    -- [a',b',c']

    let (a', b', c') = case V.toList v of
          [a, b, c] -> (a, b, c)
          _ -> error "tried to parse JSON for CodeInfo as an array with too many elements"
    a <- parseJSON a'
    b <- parseJSON b'
    c <- parseJSON c'
    return (CodeInfo (LabeledError.b16Decode "FromJSON<CodeInfo>" $ C8.pack a) b c)
  parseJSON (Object o) =
    CodeInfo
      <$> ((LabeledError.b16Decode "FromJSON<CodeInfo>" . C8.pack) <$> (o .: "code"))
      <*> o .: "src"
      <*> o .: "name"
  parseJSON x = error $ "tried to parse JSON for " ++ show x ++ " as type CodeInfo"

instance ToJSON CodeInfo where
  toJSON (CodeInfo bs s1 s2) =
    object
      [ "code" .= (C8.unpack $ B16.encode bs),
        "src" .= s1,
        "name" .= s2
      ]

instance Arbitrary CodeInfo where
  arbitrary =
    CodeInfo
      <$> arbitrary
      <*> (T.pack <$> arbitrary)
      <*> (fmap T.pack <$> arbitrary)

instance RLPSerializable CodeInfo where
  rlpEncode (CodeInfo a b Nothing) =
    RLPArray [rlpEncode a, rlpEncode $ encodeUtf8 b]
  rlpEncode (CodeInfo a b (Just c)) =
    RLPArray [rlpEncode a, rlpEncode $ encodeUtf8 b, rlpEncode $ encodeUtf8 c]
  rlpDecode (RLPArray [a, b]) = CodeInfo (rlpDecode a) (decodeUtf8 $ rlpDecode b) Nothing
  rlpDecode (RLPArray [a, b, c]) = CodeInfo (rlpDecode a) (decodeUtf8 $ rlpDecode b) (Just $ decodeUtf8 $ rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject")

data AccountInfo
  = NonContract Address Integer
  | ContractNoStorage Address Integer CodePtr
  | ContractWithStorage Address Integer CodePtr [(Word256, Word256)]
  | SolidVMContractWithStorage Address Integer CodePtr [(B.ByteString, B.ByteString)]
  deriving (Show, Eq, Read, GHCG.Generic, Data)

instance Format AccountInfo where
  format (NonContract addr nonce) =
    unlines
      [ "AccountInfo - NonContract",
        "-------------------------",
        tab' $ "Address: " ++ format addr,
        tab' $ "Nonce:   " ++ show nonce
      ]
  format (ContractNoStorage addr nonce ch) =
    unlines
      [ "AccountInfo - ContractNoStorage",
        "-------------------------",
        tab' $ "Address:   " ++ format addr,
        tab' $ "Nonce:     " ++ show nonce,
        tab' $ "Code hash: " ++ format ch
      ]
  format (ContractWithStorage addr nonce ch s) =
    unlines
      [ "AccountInfo - ContractWithStorage",
        "-------------------------",
        tab' $ "Address:   " ++ format addr,
        tab' $ "Nonce:     " ++ show nonce,
        tab' $ "Code hash: " ++ format ch,
        tab' $ "Storage:   " ++ show s
      ]
  format (SolidVMContractWithStorage addr nonce ch s) =
    unlines
      [ "AccountInfo - SolidVMContractWithStorage",
        "-------------------------",
        tab' $ "Address:   " ++ format addr,
        tab' $ "Balance:     " ++ show nonce,
        tab' $ "Code hash: " ++ format ch,
        tab' $ "Storage:   " ++ show s
      ]

instance FromJSON AccountInfo where
  parseJSON (Array v) = do
    -- (a':i':xs)

    let (a', i', xs) = case V.toList v of (a : i : xs') -> (a, i, xs'); _ -> error "parseJSON for AccountInfo as an Array failed"

    a <- parseJSON a'
    i <- parseJSON i'
    case xs of
      [] -> return $ NonContract a i
      (c' : s') -> do
        c <- parseJSON c'
        case s' of
          [] -> return $ ContractNoStorage a i c
          [x] -> do
            s <- parseJSON x
            return $ ContractWithStorage a i c s
          _ -> error "parseJSON for AccountInfo as an Array failed"
  parseJSON (Object o) = do
    a <- (o .: "address")
    b <- (o .: "balance")
    mc <- (o .:? "codeHash")
    case mc of
      Nothing -> return $ NonContract a b
      Just c -> do
        ms <- (o .:? "storage")
        case ms of
          Nothing -> return $ ContractNoStorage a b c
          Just s -> do
            return $ SolidVMContractWithStorage a b c s
  parseJSON x = error $ "parseJSON failed for AccountInfo: " ++ show x

instance ToJSON AccountInfo where
  toJSON (NonContract a b) =
    object
      [ "address" .= a,
        "balance" .= b
      ]
  toJSON (ContractNoStorage a b c) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c
      ]
  toJSON (ContractWithStorage a b c s) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c,
        "storage" .= s
      ]
  toJSON (SolidVMContractWithStorage a b c s) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c,
        "storage" .= s
      ]

instance RLPSerializable AccountInfo where
  rlpEncode (NonContract a b) = RLPArray [rlpEncode a, rlpEncode b]
  rlpEncode (ContractNoStorage a b c) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpEncode (ContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray $ map rlpEncode d]
  rlpEncode (SolidVMContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray $ map rlpEncode d]

  rlpDecode (RLPArray [a, b, c, RLPArray d]) = ContractWithStorage (rlpDecode a) (rlpDecode b) (rlpDecode c) (map rlpDecode d)
  rlpDecode (RLPArray [a, b, c]) = ContractNoStorage (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode (RLPArray [a, b]) = NonContract (rlpDecode a) (rlpDecode b)
  rlpDecode _ = error ("Error in rlpDecode for AccountInfo: bad RLPObject")

instance Arbitrary AccountInfo where
  arbitrary =
    NonContract
      <$> arbitrary
      <*> arbitrary `suchThat` (>= 0)

data ChainSignature = ChainSignature
  { chainR :: Word256,
    chainS :: Word256,
    chainV :: Word8
  }
  deriving (Eq, Show, GHCG.Generic, Data)

instance Format ChainSignature where
  format (ChainSignature r s v) =
    unlines
      [ "ChainSignature",
        "--------------",
        tab' $ "r: " ++ CL.yellow (format r),
        tab' $ "s: " ++ CL.yellow (format s),
        tab' $ "v: " ++ showHex v "0x"
      ]

instance FromJSON ChainSignature where
  parseJSON (Object o) = do
    r <- o .: "r"
    s <- o .: "s"
    v <- o .: "v"
    return $ ChainSignature r s v
  parseJSON x = error $ "couldn't parse JSON for chain signature: " ++ show x

instance ToJSON ChainSignature where
  toJSON (ChainSignature r s v) =
    object
      [ "r" .= r,
        "s" .= s,
        "v" .= v
      ]

instance RLPSerializable ChainSignature where
  rlpEncode ChainSignature {..} =
    RLPArray
      [ rlpEncode chainR,
        rlpEncode chainS,
        rlpEncode $ toInteger chainV
      ]
  rlpDecode (RLPArray [r, s, v]) =
    ChainSignature
      (rlpDecode r)
      (rlpDecode s)
      (fromInteger $ rlpDecode v)
  rlpDecode o = error $ "rlpDecode ChainSignature: Expected 3 element RLPArray, got " ++ show o

instance Arbitrary ChainSignature where
  arbitrary = genericArbitrary

data UnsignedChainInfo = UnsignedChainInfo
  { chainLabel :: T.Text,
    accountInfo :: [AccountInfo],
    codeInfo :: [CodeInfo],
    members :: ChainMembers,
    parentChains :: Map T.Text Word256,
    creationBlock :: Keccak256,
    chainNonce :: Word256,
    chainMetadata :: (M.Map T.Text T.Text)
  }
  deriving (Eq, GHCG.Generic, Data)

instance Arbitrary UnsignedChainInfo where
  arbitrary = genericArbitrary

instance ToSchema CodeInfo where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "CodeInfo")
        (mempty)

instance ToSchema AccountInfo where
  declareNamedSchema _ = return $ NamedSchema (Just "AccountInfo") byteSchema

instance ToSchema ChainSignature

instance ToSchema UnsignedChainInfo

instance ToSchema ChainInfo

instance Show UnsignedChainInfo where
  show UnsignedChainInfo {..} =
    unlines
      [ "UnsignedChainInfo",
        "-----------------",
        tab' $ "SolidString:          " ++ show chainLabel,
        tab' $ "Account info:   " ++ format accountInfo,
        tab' $ "Code info:      " ++ show (codeInfoName <$> codeInfo),
        tab' $ "Members:        " ++ show members,
        tab' $ "Parent chains:  " ++ (show $ map (first T.unpack) $ M.toList parentChains),
        tab' $ "Creation block: " ++ format creationBlock,
        tab' $ "Nonce:          " ++ CL.yellow (format chainNonce),
        tab' $ "Metadata:       " ++ show (M.keys chainMetadata)
      ]

instance Format UnsignedChainInfo where
  format = show

data ChainInfo = ChainInfo
  { chainInfo :: UnsignedChainInfo,
    chainSignature :: ChainSignature
  }
  deriving (Eq, Show, GHCG.Generic, Data)

instance Format ChainInfo where
  format ChainInfo {..} =
    unlines
      [ "ChainInfo",
        "-----------------",
        tab' $ format chainSignature,
        tab' $ format chainInfo
      ]

instance FromJSON ChainInfo where
  parseJSON (Object o) = do
    l <- o .: "label"
    as <- o .: "accountInfo"
    cs <- o .: "codeInfo"
    ms <- o .: "members"
    pc <- o .:? "parentChain"
    mPcs <- o .:? "parentChains"
    cb <- o .: "creationBlock"
    cn <- o .: "nonce"
    md <- o .: "metadata"
    sig <- o .: "signature"
    let pcs = fromMaybe M.empty mPcs <> maybe M.empty (M.singleton "parent") pc
    return $ ChainInfo (UnsignedChainInfo l as cs ms pcs cb cn md) sig
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toJSON (ChainInfo (UnsignedChainInfo cl ai ci ms pcs cb cn md) sig) =
    object
      [ "label" .= cl,
        "accountInfo" .= ai,
        "codeInfo" .= ci,
        "members" .= ms,
        "parentChains" .= pcs,
        "creationBlock" .= cb,
        "nonce" .= cn,
        "metadata" .= md,
        "signature" .= sig
      ]

instance Arbitrary ChainInfo where
  arbitrary = genericArbitrary

instance RLPSerializable UnsignedChainInfo where
  rlpEncode UnsignedChainInfo {..} =
    RLPArray
      [ rlpEncode $ encodeUtf8 chainLabel,
        RLPArray $ map rlpEncode accountInfo,
        RLPArray $ map rlpEncode codeInfo,
        rlpEncode members,
        rlpEncode parentChains,
        rlpEncode creationBlock,
        rlpEncode chainNonce,
        rlpEncode . M.mapKeys encodeUtf8 $ M.map encodeUtf8 chainMetadata
      ]
  rlpDecode (RLPArray [cl, RLPArray ai, RLPArray coi, ms, pc, cb, cn, md]) =
    UnsignedChainInfo
      (decodeUtf8 $ rlpDecode cl)
      (rlpDecode <$> ai)
      (rlpDecode <$> coi)
      (rlpDecode ms)
      (rlpDecode pc)
      (rlpDecode cb)
      (rlpDecode cn)
      (M.mapKeys decodeUtf8 . M.map decodeUtf8 $ rlpDecode md)
  rlpDecode o = error $ "rlpDecode UnsignedChainInfo: Expected 8 element RLPArray, got " ++ show o

instance RLPSerializable ChainInfo where
  rlpEncode (ChainInfo uci sig) =
    -- RLPArray xs
    let xs = case rlpEncode uci of
          RLPArray xs' -> xs'
          _ -> error "rlpEncode ChainInfo: Expected RLPArray"
     in RLPArray (xs ++ [rlpEncode sig])
  rlpDecode (RLPArray xs) =
    ChainInfo
      (rlpDecode . RLPArray $ take 8 xs)
      (rlpDecode $ xs !! 8)
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected 9 element RLPArray, got " ++ show o

isAncestorChainOf :: A.Selectable Word256 ParentChainIds m => Maybe Word256 -> Maybe Word256 -> m Bool
isAncestorChainOf Nothing _ = pure True
isAncestorChainOf (Just _) Nothing = pure False
isAncestorChainOf (Just ancestor) (Just descendent) | ancestor == descendent = pure True
isAncestorChainOf (Just ancestor) (Just descendent) = S.member ancestor <$> getAncestorChains descendent -- I don't feel like writing a more efficient function right now

getAncestorChains :: A.Selectable Word256 ParentChainIds m => Word256 -> m (S.Set Word256)
getAncestorChains cId = go cId S.empty
  where
    go chainId seen =
      if chainId `S.member` seen
        then pure seen
        else
          A.select (A.Proxy @ParentChainIds) chainId >>= \case
            Nothing -> pure seen
            Just (ParentChainIds parents) ->
              let newSeen = seen <> S.singleton chainId
               in foldrM go newSeen $ M.elems parents

getAncestorChainByName :: A.Selectable Word256 ParentChainIds m => T.Text -> Word256 -> m (Maybe Word256)
getAncestorChainByName name descendent =
  A.select (A.Proxy @ParentChainIds) descendent >>= \case
    Nothing -> pure Nothing
    Just (ParentChainIds parents) -> pure $ M.lookup name parents

accountExtractor :: JS.Parser [AccountInfo]
accountExtractor = many ("accountInfo" JS..: JS.arrayOf acctInfo)

acctInfo :: JS.Parser AccountInfo
acctInfo = JS.value

whoSignedThisChainInfo :: ChainInfo -> Maybe Address
whoSignedThisChainInfo (ChainInfo u (ChainSignature r s v)) =
  let intToBSS = BSS.toShort . word256ToBytes
      sig = EC.Signature (SEC.CompactRecSig (intToBSS r) (intToBSS s) (v - 0x1b))
      mesg = keccak256ToByteString $ rlpHash u
   in fromPublicKey <$> EC.recoverPub sig mesg
