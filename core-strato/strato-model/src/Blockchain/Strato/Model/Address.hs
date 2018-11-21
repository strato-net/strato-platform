{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
module Blockchain.Strato.Model.Address
    ( Address(..),
      prvKey2Address, pubKey2Address,
      formatAddress, stringAddress
    ) where

import           Control.DeepSeq
import           Control.Monad
import qualified Data.Hashable                        as DH
import           Data.Maybe                           (fromMaybe)
import           Numeric

import           Blockchain.Data.RLP
import qualified Blockchain.Strato.Model.Colors       as CL
import           Blockchain.Strato.Model.Format
import           Blockchain.Strato.Model.ExtendedWord (Word160, word160ToBytes)
import           Blockchain.Strato.Model.SHA          (keccak256)
import           Blockchain.Strato.Model.Util

import qualified Data.Aeson                           as AS
import           Data.Aeson.Types
import qualified Data.Aeson.Encoding                  as Enc

import           Data.Binary
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Lazy                 as BL

import qualified Data.Text                            as T
import           Text.Read                            (readMaybe)

import           Network.Haskoin.Crypto               hiding (Address, Word160)
import           Network.Haskoin.Internals            hiding (Address, Word160)
-- import           Text.PrettyPrint.ANSI.Leijen         hiding ((<$>))
import qualified Text.PrettyPrint.ANSI.Leijen         as Lei
import           Text.Printf
import           Web.PathPieces
import           Web.HttpApiData

import           GHC.Generics

instance RLPSerializable Address where
  rlpEncode (Address a) = RLPString $ BL.toStrict $ encode a
  rlpDecode (RLPString s) = Address $ decode $ BL.fromStrict s
  rlpDecode x             = error ("Malformed rlp object sent to rlp2Address: " ++ show x)

newtype Address = Address Word160
  deriving (Show, Eq, Read, Enum, Real, Bounded, Num, Ord, Generic, Integral, DH.Hashable)

instance PrintfArg Address where
  formatArg (Address word) = formatArg word

prvKey2Address :: PrvKey -> Address
prvKey2Address prvKey =
  Address $ fromInteger $ byteString2Integer $ keccak256 $ BL.toStrict $ encode x `BL.append` encode y
  --B16.encode $ hash 256 $ BL.toStrict $ encode x `BL.append` encode y
  where
    point = pubKeyPoint $ derivePubKey prvKey
    x = fromMaybe (error "getX failed in prvKey2Address") $ getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ getY point

pubKey2Address :: PubKey -> Address
pubKey2Address pubKey =
  Address $ fromInteger $ byteString2Integer $ keccak256 $ BL.toStrict $ encode x `BL.append` encode y
  --B16.encode $ hash 256 $ BL.toStrict $ encode x `BL.append` encode y
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ getY point
    point = pubKeyPoint pubKey

{-
 Was necessary to make Address a primary key - which we no longer do (but rather index on the address field).
 May remove in the future
-}
instance PathPiece Address where
  toPathPiece (Address x) = T.pack $ showHex  (fromIntegral $ x :: Integer) ""
  fromPathPiece t = Just (Address wd160)
    where
      ((wd160, _):_) = readHex $ T.unpack $ t ::  [(Word160,String)]


formatAddress :: Address -> String
formatAddress (Address x) = padZeros 40 $ showHex x ""

{-
 make into a string rather than an object
-}
instance AS.ToJSON Address where
  toJSON = String . T.pack . formatAddress

instance AS.ToJSONKey Address where
  toJSONKey = ToJSONKeyText f (Enc.text . f)
          where f = T.pack . formatAddress

instance AS.FromJSON Address where
  parseJSON (String s) = pure $ Address $ fst $ head $ readHex $ drop0x $ T.unpack s
    where drop0x ('0':'x':cs) = cs
          drop0x ('0':'X':cs) = cs
          drop0x cs = cs
  parseJSON x = typeMismatch "Address" x

instance Lei.Pretty Address where
  pretty = Lei.text . CL.yellow . formatAddress

instance Format Address where
  format = CL.yellow . formatAddress

instance Binary Address where
  put (Address x) = sequence_ $ fmap put $ word160ToBytes $ fromIntegral x
  get = do
    bytes <- replicateM 20 get
    let byteString = B.pack bytes
    return (Address $ fromInteger $ byteString2Integer byteString)

stringAddress :: String -> Maybe Address
stringAddress string = Address . fromInteger <$> readMaybe ("0x" ++ string)

instance ToHttpApiData Address where
  toUrlPiece = T.pack . formatAddress

instance NFData Address
