{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Data.Enode
  ( Enode (..),
    IPAddress (..),
    OrgId (..),
    ChainTxsInBlock (..),
    IPChains (..),
    OrgIdChains (..),
    showEnode,
    readEnode,
    showIP,
    readIP,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Aeson
import Data.Binary
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Data
import Data.Default
import Data.List
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Swagger hiding (Format, format)
import qualified Data.Text as T
import Database.Persist.Sql
import qualified GHC.Generics as GHCG
import qualified LabeledError
import Network.Socket
import Test.QuickCheck (suchThat, vectorOf)
import Test.QuickCheck.Arbitrary
import Test.QuickCheck.Arbitrary.Generic
import Test.QuickCheck.Instances.ByteString ()
import Text.Regex

newtype IPAddress = IPv4 HostAddress deriving (Show, Read, Eq, Ord, GHCG.Generic, NFData, Binary, Data)

instance RLPSerializable IPAddress where
  rlpEncode (IPv4 addy) = rlpEncode $ toInteger addy
  rlpDecode x = IPv4 (fromInteger $ rlpDecode x)

instance Arbitrary IPAddress where
  arbitrary = genericArbitrary

newtype OrgId = OrgId {unOrgId :: B.ByteString} deriving (Show, Read, Eq, Ord, GHCG.Generic, NFData, Binary, Data)

instance RLPSerializable OrgId where
  rlpEncode (OrgId bs) = rlpEncode bs
  rlpDecode = OrgId . rlpDecode

instance ToSchema OrgId where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "OrgId")
        (mempty)

instance Arbitrary OrgId where
  arbitrary = genericArbitrary

instance ToSchema IPAddress

data Enode = Enode
  { pubKey :: OrgId,
    ipAddress :: IPAddress,
    tcpPort :: Int,
    udpPort :: Maybe Int
  }
  deriving (Show, Read, Eq, Ord, GHCG.Generic, NFData, Binary, Data)

instance ToSchema Enode

newtype ChainTxsInBlock = ChainTxsInBlock {unChainTxsInBlock :: M.Map Word256 [Keccak256]} deriving (Eq)

newtype IPChains = IPChains {unIPChains :: S.Set Word256} deriving (Eq)

newtype OrgIdChains = OrgIdChains {unOrgIdChains :: S.Set Word256} deriving (Eq)

instance Default ChainTxsInBlock where def = ChainTxsInBlock M.empty

instance Default IPChains where def = IPChains S.empty

instance Default OrgIdChains where def = OrgIdChains S.empty

instance RLPSerializable Enode where
  rlpEncode (Enode pk ip tp up) =
    RLPArray [rlpEncode pk, rlpEncode ip, rlpEncode $ toInteger tp, rlpEncode (toInteger <$> up)]

  rlpDecode (RLPArray [a, b, c, d]) =
    Enode (rlpDecode a) (rlpDecode b) (fromInteger $ rlpDecode c) (fromInteger <$> (rlpDecode d))
  rlpDecode _ = error "error in rlpDecode for Enode type: bad RLPObject"

instance FromJSON Enode where
  parseJSON (String str) =
    case readEnodeOrFail $ T.unpack str of
      Left e -> fail e
      Right val -> return val
  parseJSON x = fail $ "could not parse JSON for Enode: " ++ show x

instance ToJSON Enode where
  toJSON enode = String (T.pack $ showEnode enode)

instance Arbitrary Enode where
  arbitrary =
    Enode
      <$> (OrgId . B.pack <$> vectorOf 64 arbitrary)
      <*> arbitrary
      <*> arbitrary `suchThat` (>= 0)
      <*> (arbitrary `suchThat` maybe True (>= 0))

-- replacements for show/read for IPAddress and Enode, because implementing read is a nightmare
showIP :: IPAddress -> String
showIP (IPv4 addy) =
  let b3 = (addy `shiftR` 24) .&. 0xff
      b2 = (addy `shiftR` 16) .&. 0xff
      b1 = (addy `shiftR` 8) .&. 0xff
      b0 = addy .&. 0xff
   in concat . intersperse "." . map show $ [b3, b2, b1, b0]

readIP :: String -> IPAddress
readIP input =
  let (b3, temp) = break (== '.') input
      s0 = dropWhile (== '.') temp
      (b2, temp2) = break (== '.') s0
      s1 = dropWhile (== '.') temp2
      (b1, temp3) = break (== '.') s1
      b0 = dropWhile (== '.') temp3

      addy =
        ( (LabeledError.read "Enode/readIP1" b0) + (((LabeledError.read "Enode/readIP2" b1) .&. 0xff) `shiftL` 8) + (((LabeledError.read "Enode/readIP3" b2) .&. 0xff) `shiftL` 16)
            + (((LabeledError.read "Enode/readIP3" b3) .&. 0xff) `shiftL` 24)
        )
   in (IPv4 addy)

readEitherIP :: String -> Either String IPAddress
readEitherIP input =
  let (b3, temp) = break (== '.') input
      s0 = dropWhile (== '.') temp
      (b2, temp2) = break (== '.') s0
      s1 = dropWhile (== '.') temp2
      (b1, temp3) = break (== '.') s1
      b0 = dropWhile (== '.') temp3
      msg i = "Enode/readIP" ++ i ++ ": IP addresses must be in valid IPv4 form"
      addy = do
        b0' <- LabeledError.readEither (msg "0") b0
        b1' <- LabeledError.readEither (msg "1") b1
        b2' <- LabeledError.readEither (msg "2") b2
        b3' <- LabeledError.readEither (msg "3") b3
        pure $
          b0'
            + ((b1' .&. 0xff) `shiftL` 8)
            + ((b2' .&. 0xff) `shiftL` 16)
            + ((b3' .&. 0xff) `shiftL` 24)
   in IPv4 <$> addy

showEnode :: Enode -> String
showEnode (Enode (OrgId pk) ip tp up) =
  "enode://"
    ++ (C8.unpack $ B16.encode pk)
    ++ "@"
    ++ (showIP ip)
    ++ ":"
    ++ (show tp)
    ++ uPort
  where
    uPort =
      case up of
        Nothing -> ""
        Just x -> "?discport=" ++ show x

readEnode :: String -> Enode
readEnode input =
  case readEnodeOrFail input of
    Left e -> error e
    Right val -> val

readEnodeOrFail :: String -> Either String Enode
readEnodeOrFail input =
  case matchRegex (mkRegex "^enode://([0-9a-f]+)@([^:]+)\\:([0-9]+)(\\?discport=([0-9]+))?$") input of
    Nothing -> Left $ "enode is in the wrong format: " ++ input
    Just [pubkey', ip, port', _, discport] -> do
      let publen = length pubkey'
          pubkey =
            if publen >= 128
              then pubkey'
              else replicate (128 - publen) '0' <> pubkey'
      orgId <-
        case B16.decode $ C8.pack pubkey of
          Right oId -> pure $ OrgId oId
          _ -> Left $ "Failed on parsing OrdId: " ++ pubkey
      ipAddr <- readEitherIP ip
      tcp <- LabeledError.readEither "Enode/readEnodeOrFail" port'
      udp <- case discport of
        "" -> pure Nothing
        _ -> Just <$> LabeledError.readEither "Enode/readEnodeOrFail" discport
      pure $ Enode orgId ipAddr tcp udp
    _ -> error "internal error in 'readEnodeOrFail': regex returned with wrong number of matches"

instance PersistFieldSql Enode where
  sqlType _ = SqlString

instance PersistField Enode where
  toPersistValue = PersistText . T.pack . showEnode
  fromPersistValue (PersistText t) =
    case readEnodeOrFail $ T.unpack t of
      Left e -> Left $ T.pack e
      Right val -> return val
  fromPersistValue x = Left . T.pack $ "PersistField Enode: expected PersistText: " ++ show x
