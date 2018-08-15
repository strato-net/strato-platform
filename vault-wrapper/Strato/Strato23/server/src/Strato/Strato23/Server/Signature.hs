{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Strato.Strato23.Server.Signature where

import           Crypto.Secp256k1
import qualified Data.ByteString.Base16        as B16
import qualified Data.ByteString.Char8         as C8
import           Data.Maybe                    (fromJust, fromMaybe, isNothing)
import qualified Data.Text                     as T
import           GHC.Generics
import           Strato.Strato23.Monad
import           Strato.Strato23.API.Signature
import           Strato.Strato23.API.Types
import           Strato.Strato23.Server.Utils  (word256ToByteString)

data PrivateKey = PrivateKey
  { username :: String
  , address  :: String
  , sk       :: SecKey
  } deriving (Eq, Show, Generic)

privateKeys :: [PrivateKey]
privateKeys =
  [ PrivateKey "tanuj500" "cb1a02b33d6fba1a226bdd8a45da4654e0f1ecd9" (toSecKey "00000000000000000000000000000000000000000000000000000000deadbeef")
  , PrivateKey  "tanuj@blockapps.net" "84bcd6278fdde4e3147717123a4602faeeee83e4" (toSecKey "0000000000000000000000000000000000000000000000000000000012345687")
  ]

toSecKey :: String -> SecKey
toSecKey = fromMaybe (error "toSecKey: could not decode") . secKey . fst . B16.decode . C8.pack

getPrivateKeyOfUser :: String -> PrivateKey
getPrivateKeyOfUser uname = head $ filter (\PrivateKey{..} -> uname == username) privateKeys

signatureDetails :: Maybe T.Text -> UserData -> VaultM SignatureDetails
signatureDetails userEmail (UserData (Hex msgHash)) = do
  if (isNothing userEmail)
    then vaultWrapperError $ UserError "No cookie provided"
    else do
      let emailId = fromJust userEmail
          prvKey = getPrivateKeyOfUser $ T.unpack emailId
      case msg (word256ToByteString msgHash) of
        Nothing -> vaultWrapperError $ AnError "message was not 32 bytes long"
        Just msg' -> do
          let sig = exportCompactRecSig $ signRecMsg (sk prvKey) msg'
          return $ SignatureDetails
                     (Hex $ getCompactRecSigR sig)
                     (Hex $ getCompactRecSigS sig)
                     (Hex $ getCompactRecSigV sig)
