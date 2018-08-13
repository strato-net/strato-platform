{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.Server.Signature where

import           Servant
import           Data.Text
import           Data.List
import           Control.Monad.IO.Class
import           GHC.Generics
import           Strato.Strato23.API.Signature
import           Strato.Strato23.ECDSA.Util
import           Data.Maybe (fromJust, isNothing)

import           Strato.Strato23.ECDSA.ExtendedECDSA
import           Strato.Strato23.ECDSA.ExtendedSignature
import           Strato.Strato23.ECDSA.BigWord as BW  
import           Strato.Strato23.ECDSA.Hash (hash256)
import           Strato.Strato23.ECDSA.ECDSA as HK
import           Strato.Strato23.ECDSA.Keys
import qualified Data.ByteString.Lazy.Char8         as Lazy.Char8

data PrivateKey = PrivateKey {
  username :: String
  , address :: String
  , pk :: String
} deriving (Eq, Show, Generic)

privateKeys :: [PrivateKey]
privateKeys = 
  [ PrivateKey "tanuj500" "cb1a02b33d6fba1a226bdd8a45da4654e0f1ecd9" "5Kg1gnAjaLfKiwhhPpGS3QfRg2m6awQvaj98JCZBZQ5SuS2F15C"
  , PrivateKey  "tanuj@blockapps.net" "84bcd6278fdde4e3147717123a4602faeeee83e4" "5HvaLAxPMej789DdFwgbvr6TqDo17jixKQwCKY4zZxnUy5p2i9x"
  ]

getHash256 :: String ->  Word256
getHash256 inputStr = hash256 $ stringToBS inputStr

getPrivateKeyOfUser :: String -> PrivateKey
getPrivateKeyOfUser uname = Data.List.head [ x | x <- privateKeys, username x == uname]

getPk :: String -> PrvKey
getPk strPk= fromJust $ fromWif strPk

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
          ExtendedSignature signature' yIsOdd' <- liftIO $ HK.withSource HK.devURandom $ extSignMsg word256 $ getPk prvKey
          let r' = bsToHex $ integerToBS $ BW.getBigWordInteger $ HK.sigR signature'
              s' = bsToHex $ integerToBS $ BW.getBigWordInteger $ HK.sigS signature'
              v' = bsToHex $ integerToBS $ if yIsOdd' then 0x1c else 0x1b
          return (SignatureDetails r' s' v')
