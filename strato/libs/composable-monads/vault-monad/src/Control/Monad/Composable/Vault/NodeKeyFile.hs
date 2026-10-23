{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | The node key file of a @--localKey@ validator: a secp256k1 private key
-- in the standard @EC PRIVATE KEY@ PEM form (RFC 5915), unencrypted, the
-- file @openssl ecparam -name secp256k1 -genkey -noout@ writes and
-- @openssl ec@ reads (without @-noout@ openssl puts an @EC PARAMETERS@ block
-- in front; that is skipped). One module owns the format, so strato-setup
-- (which writes it) and the processes (which read it) cannot drift apart.
--
-- Operators may also supply the key as 64 hex characters; 'parseNodeKey'
-- takes either form.
module Control.Monad.Composable.Vault.NodeKeyFile
  ( parseNodeKey
  , parseNodeKeyPem
  , parseNodeKeyHex
  , renderNodeKeyPem
  , readNodeKeyFile
  ) where

import Blockchain.Strato.Model.Secp256k1 (PrivateKey, derivePublicKey, exportPrivateKey, exportPublicKey, importPrivateKey)
import Control.Exception (IOException, try)
import Control.Monad (unless, when)
import Data.ASN1.BinaryEncoding (DER (..))
import Data.ASN1.BitArray (bitArrayGetData, toBitArray)
import Data.ASN1.Encoding (decodeASN1', encodeASN1')
import Data.ASN1.Types
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Char (isSpace, toLower)
import Data.List (intercalate)
import Data.PEM (PEM (..), pemParseBS, pemWriteBS)

-- | A node key as an operator supplies it: a PEM block, or 64 hex characters
-- (an optional @0x@ prefix and surrounding whitespace are allowed).
parseNodeKey :: ByteString -> Either String PrivateKey
parseNodeKey bs
  | "-----BEGIN" `B.isInfixOf` bs = parseNodeKeyPem bs
  | otherwise = parseNodeKeyHex bs

parseNodeKeyHex :: ByteString -> Either String PrivateKey
parseNodeKeyHex raw =
  case B16.decode digits of
    Left _ -> Left "not hex: expected 64 hex characters or a PEM block"
    Right bytes
      | B.length bytes /= 32 -> Left $ "expected 32 bytes (64 hex characters), got " ++ show (B.length bytes)
      | otherwise -> importScalar bytes
  where
    trimmed = C8.filter (not . isSpace) raw
    digits
      | C8.map toLower (B.take 2 trimmed) == "0x" = B.drop 2 trimmed
      | otherwise = trimmed

-- | An @EC PRIVATE KEY@ (RFC 5915) or PKCS#8 @PRIVATE KEY@ PEM block holding
-- a secp256k1 key; other blocks in the file (openssl's @EC PARAMETERS@) are
-- skipped. The curve must be named, and named secp256k1: a key that does not
-- say its curve, or carries explicit curve parameters, is refused rather than
-- read as a secp256k1 scalar it may not be. A public key in the file must
-- match the private key. Passphrase-protected PEM is refused: the validator
-- restarts unattended, so there is nobody to type the passphrase.
parseNodeKeyPem :: ByteString -> Either String PrivateKey
parseNodeKeyPem bs = do
  -- The legacy OpenSSL encryption headers (Proc-Type / DEK-Info) are checked
  -- on the text: the pem package does not parse RFC 1421 headers and would
  -- report them as bad base64.
  when (any (`B.isInfixOf` bs) ["Proc-Type: 4,ENCRYPTED", "DEK-Info:", "-----BEGIN ENCRYPTED PRIVATE KEY-----"]) $
    Left "passphrase-protected PEM is not supported (the validator restarts unattended); decrypt it first: openssl ec -in key.pem -out plain.pem"
  pems <- either (Left . ("not a PEM file: " ++)) Right (pemParseBS bs)
  when (null pems) $ Left "no PEM block found"
  (pem, decoder) <- case [(p, d) | p <- pems, Just d <- [decoderFor (pemName p)]] of
    (found : _) -> Right found
    [] -> Left $ "no private key block found (got " ++ intercalate ", " (map (show . pemName) pems)
            ++ "); expected EC PRIVATE KEY (openssl ecparam -name secp256k1 -genkey -noout) or PRIVATE KEY (PKCS#8)"
  decodeDer (pemContent pem) >>= decoder
  where
    decoderFor "EC PRIVATE KEY" = Just (ecPrivateKey False)
    decoderFor "PRIVATE KEY" = Just pkcs8PrivateKey
    decoderFor _ = Nothing

decodeDer :: ByteString -> Either String [ASN1]
decodeDer = either (Left . ("invalid DER: " ++) . show) Right . decodeASN1' DER

-- RFC 5915: SEQUENCE { version 1, privateKey OCTET STRING,
-- parameters [0] OID OPTIONAL, publicKey [1] BIT STRING OPTIONAL }.
-- @curveNamed@: the enclosing PKCS#8 header already named secp256k1.
ecPrivateKey :: Bool -> [ASN1] -> Either String PrivateKey
ecPrivateKey curveNamed (Start Sequence : IntVal 1 : OctetString priv : rest) = do
  namedHere <- curveParameters rest
  unless (curveNamed || namedHere) $
    Left "the key does not name its curve; expected a named-curve secp256k1 key (openssl ecparam -name secp256k1 -genkey -noout)"
  key <- importScalar priv
  checkPublicKey key rest
  return key
ecPrivateKey _ _ = Left "not an EC private key structure (RFC 5915)"

-- The [0] parameters, if present: True when they name secp256k1.
curveParameters :: [ASN1] -> Either String Bool
curveParameters rest = case dropWhile (/= Start (Container Context 0)) rest of
  _ : OID oid : _ -> checkNamedCurve oid >> Right True
  _ : Start Sequence : _ -> Left "explicit curve parameters are not supported; use a named curve (openssl ecparam -name secp256k1 -genkey -noout, or convert with openssl ec -param_enc named_curve)"
  _ : _ -> Left "unexpected curve parameters in the key"
  [] -> Right False

-- The [1] public key, if present, must be this private key's.
checkPublicKey :: PrivateKey -> [ASN1] -> Either String ()
checkPublicKey key rest = case dropWhile (/= Start (Container Context 1)) rest of
  _ : BitString bits : _
    | bitArrayGetData bits `elem` [exportPublicKey False pub, exportPublicKey True pub] -> Right ()
    | otherwise -> Left "the public key in the file does not belong to its private key: the file is corrupted or was edited"
  _ -> Right ()
  where
    pub = derivePublicKey key

-- PKCS#8: SEQUENCE { version 0, SEQUENCE { id-ecPublicKey, curve OID },
-- OCTET STRING (the RFC 5915 structure) }
pkcs8PrivateKey :: [ASN1] -> Either String PrivateKey
pkcs8PrivateKey (Start Sequence : IntVal 0 : Start Sequence : OID alg : rest)
  | alg /= ecPublicKeyOid = Left $ "not an EC key: PKCS#8 algorithm " ++ showOid alg ++ " is not id-ecPublicKey"
  | otherwise = case rest of
      OID curve : End Sequence : OctetString inner : _ -> checkNamedCurve curve >> decodeDer inner >>= ecPrivateKey True
      End Sequence : OctetString inner : _ -> decodeDer inner >>= ecPrivateKey False
      Start Sequence : _ -> Left "explicit curve parameters are not supported; use a named curve (openssl ecparam -name secp256k1 -genkey -noout)"
      _ -> Left "unexpected PKCS#8 private key structure"
pkcs8PrivateKey _ = Left "not a PKCS#8 private key structure"

checkNamedCurve :: [Integer] -> Either String ()
checkNamedCurve oid
  | oid /= secp256k1Oid = Left $ "curve " ++ showOid oid ++ " is not secp256k1; generate the key with: openssl ecparam -name secp256k1 -genkey -noout -out node_key.pem"
  | otherwise = Right ()

-- The scalar is 32 bytes (SEC1); a shorter encoding has had leading zeros
-- stripped and is padded back.
importScalar :: ByteString -> Either String PrivateKey
importScalar bytes
  | B.length bytes > 32 = Left $ "private key is " ++ show (B.length bytes) ++ " bytes, expected 32"
  | otherwise =
      maybe (Left "not a valid secp256k1 private key (zero, or not below the curve order)") Right $
        importPrivateKey (B.replicate (32 - B.length bytes) 0 <> bytes)

-- | The PEM text for a key, byte for byte what @openssl ecparam -genkey
-- -noout@ writes: RFC 5915 with the named curve and the uncompressed public
-- key.
renderNodeKeyPem :: PrivateKey -> ByteString
renderNodeKeyPem key =
  pemWriteBS PEM
    { pemName = "EC PRIVATE KEY"
    , pemHeader = []
    , pemContent = encodeASN1' DER
        [ Start Sequence
        , IntVal 1
        , OctetString (exportPrivateKey key)
        , Start (Container Context 0), OID secp256k1Oid, End (Container Context 0)
        , Start (Container Context 1), BitString (toBitArray (exportPublicKey False (derivePublicKey key)) 0), End (Container Context 1)
        , End Sequence
        ]
    }

-- | The key in the file, or why it cannot be used (the message names the
-- file). Nothing is written or changed.
readNodeKeyFile :: FilePath -> IO (Either String PrivateKey)
readNodeKeyFile path = do
  r <- try (B.readFile path)
  return $ case r of
    Left (e :: IOException) -> Left $ "cannot read " ++ path ++ ": " ++ show e
    Right bytes -> either (Left . ((path ++ ": ") ++)) Right (parseNodeKey bytes)

secp256k1Oid, ecPublicKeyOid :: [Integer]
secp256k1Oid = [1, 3, 132, 0, 10]
ecPublicKeyOid = [1, 2, 840, 10045, 2, 1]

showOid :: [Integer] -> String
showOid = concatMap (\(i, n) -> (if i == (0 :: Int) then "" else ".") ++ show n) . zip [0 ..]
