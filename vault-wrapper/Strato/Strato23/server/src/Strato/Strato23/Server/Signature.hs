{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.Server.Signature where

import           Control.Monad.IO.Class
import           Crypto.Secp256k1
import qualified Data.ByteString.Base16        as B16
import qualified Data.ByteString.Char8         as C8
import qualified Data.ByteString.Lazy.Char8    as Lazy.Char8
import           Data.Maybe                    (fromJust, fromMaybe, isNothing)
import           Data.List
import           Data.Text
import           GHC.Generics
import           Servant
import           Strato.Strato23.API.Signature

data PrivateKey = PrivateKey
  { username :: String
  , address  :: String
  , secKey   :: SecKey
  } deriving (Eq, Show, Generic)

privateKeys :: [PrivateKey]
privateKeys =
  [ PrivateKey "tanuj500" "cb1a02b33d6fba1a226bdd8a45da4654e0f1ecd9" (toSecKey "00000000000000000000000000000000000000000000000000000000deadbeef")
  , PrivateKey  "tanuj@blockapps.net" "84bcd6278fdde4e3147717123a4602faeeee83e4" (toSecKey "0000000000000000000000000000000000000000000000000000000012345687")
  ]

toSecKey :: String -> SecKey
toSecKey = fromMaybe (error "toSecKey: could not decode") . secKey . fst . B16.decode . C8.pack

getHash256 :: String ->  Word256
getHash256 inputStr = hash256 $ stringToBS inputStr

getPrivateKeyOfUser :: String -> PrivateKey
getPrivateKeyOfUser = head . flip filter privateKeys . (== username)

signatureDetails :: Maybe Text -> UserData -> Handler SignatureDetails
signatureDetails userEmail (UserData queryToSig) = do
  if  (Data.List.null queryToSig)
    then throwError err400 { errBody = Lazy.Char8.pack "msgHash not found" }
    else if (isNothing userEmail)
        then throwError err404 { errBody = Lazy.Char8.pack "No cookie provided" }
        else do
          let emailId = fromJust userEmail
              prvKey = pk $ getPrivateKeyOfUser $ Data.Text.unpack emailId
              -- prvKey = pk $ getPrivateKeyOfUser $ "tanuj@blockapps.net"
              dataToSign = queryToSig
              word256 = getHash256 dataToSign
          case msg word256 of
            Nothing -> throwError err500 "msgHash was not 32 bytes long"
            Just msg' -> do
              let CompactRecSig{..} = exportCompactRecSig . signRecMsg msg' $ secKey prvKey
              return (SignatureDetails getCompactRecSigR getCompactRecSigS getCompactRecSigV)
