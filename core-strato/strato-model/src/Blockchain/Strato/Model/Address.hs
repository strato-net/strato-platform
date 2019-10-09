{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
module Blockchain.Strato.Model.Address
    ( Address(..),
      prvKey2Address, pubKey2Address,
      formatAddress, formatAddressWithoutColor, stringAddress,
      getNewAddress_unsafe,
      addressAsNibbleString, addressFromNibbleString,
      addressToHex, addressFromHex
    ) where

import           Control.DeepSeq
import           Control.Monad
import           Data.Data
import           Data.Maybe                           (fromMaybe)
import           Numeric
import           Test.QuickCheck                      (Arbitrary(..))

import qualified Data.Aeson                           as AS
import           Data.Aeson.Types
import qualified Data.Aeson.Encoding                  as Enc

import           Data.Binary
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Base16               as B16
import qualified Data.ByteString.Lazy                 as BL
import qualified Data.NibbleString                    as N

import           Data.Hashable
import qualified Data.Text                            as T
import           Text.Read                            (readMaybe)

import           Network.Haskoin.Crypto               hiding (Address, Word160)
import           Network.Haskoin.Internals            hiding (Address, Word160)
import qualified Text.PrettyPrint.ANSI.Leijen         as Lei
import           Text.Printf
import           Web.PathPieces
import           Web.HttpApiData

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.ExtendedWord (Word160, word160ToBytes)
import qualified Blockchain.Strato.Model.SHA          as SHA (keccak256, hash)
import           Blockchain.Strato.Model.Util
import qualified Text.Colors       as CL
import           Text.Format
import           Text.ShortDescription
import           Text.Tools                           (shorten)

import           GHC.Generics

instance RLPSerializable Address where
  rlpEncode (Address a) = RLPString $ BL.toStrict $ encode a
  rlpDecode (RLPString s) = Address $ decode $ BL.fromStrict s
  rlpDecode x             = error ("Malformed rlp object sent to rlp2Address: " ++ show x)

newtype Address = Address Word160 deriving (Eq, Read, Enum, Bounded, Ord, Generic, Data)
                                  deriving newtype (Real, Num, Integral, Hashable)

instance Show Address where
  show (Address a) = printf "%040x" a

instance PrintfArg Address where
  formatArg (Address word) = formatArg word

prvKey2Address :: PrvKey -> Address
prvKey2Address prvKey =
  Address $ fromInteger $ byteString2Integer $ SHA.keccak256 $ BL.toStrict $ encode x `BL.append` encode y
  where
    point = pubKeyPoint $ derivePubKey prvKey
    x = fromMaybe (error "getX failed in prvKey2Address") $ getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ getY point

pubKey2Address :: PubKey -> Address
pubKey2Address pubKey =
  Address $ fromInteger $ byteString2Integer $ SHA.keccak256 $ BL.toStrict $ encode x `BL.append` encode y
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

instance FromJSONKey Address where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Lei.Pretty Address where
  pretty = Lei.text . CL.yellow . formatAddress

instance Format Address where
  format = CL.yellow . formatAddress

instance ShortDescription Address where
  shortDescription x = CL.yellow . shorten 12 . padZeros 40 $ showHex x ""

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

getNewAddress_unsafe ::Address->Integer->Address
getNewAddress_unsafe a n =
    let theHash = SHA.hash $ rlpSerialize $ RLPArray [rlpEncode a, rlpEncode n]
    in decode $ BL.drop 12 $ encode theHash

addressAsNibbleString::Address->N.NibbleString
addressAsNibbleString (Address s) =
  byteString2NibbleString $ BL.toStrict $ encode s

addressFromNibbleString::N.NibbleString->Address
addressFromNibbleString = Address . decode . BL.fromStrict . nibbleString2ByteString

formatAddressWithoutColor::Address->String
formatAddressWithoutColor = formatAddress

addressToHex :: Address -> B.ByteString
addressToHex = B16.encode . BL.toStrict . encode

addressFromHex :: B.ByteString -> Either String Address
addressFromHex hex = case B16.decode hex of
                     (h, "") -> case decodeOrFail (BL.fromStrict h) of
                                  Right (_, _, a) -> return a
                                  Left (_, _, msg) -> Left $ "cannot decode address: " ++ msg
                     (_, _) -> Left $ "invalid hex address: " ++ show hex

instance Arbitrary Address where
  arbitrary = Address <$> arbitrary
