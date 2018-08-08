{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.Server.Signature where

import           Servant
import           Data.Text
import           Data.List
import           Control.Monad.IO.Class
import           GHC.Generics
import           Strato.Strato23.API.Signature
import           Strato.Strato23.ECDSA.Util
import           Data.Maybe (fromJust)

import           Strato.Strato23.ECDSA.ExtendedECDSA
import           Strato.Strato23.ECDSA.ExtendedSignature
import           Strato.Strato23.ECDSA.BigWord as BW  
import           Strato.Strato23.ECDSA.Hash (hash256)
import           Strato.Strato23.ECDSA.ECDSA as HK
import           Strato.Strato23.ECDSA.Keys

data PrivateKey = PrivateKey {
  username :: String
  , address :: String
  , pk :: String
} deriving (Eq, Show, Generic)

privateKeys :: [PrivateKey]
privateKeys = 
  [ PrivateKey "tanuj500" "cb1a02b33d6fba1a226bdd8a45da4654e0f1ecd9" "5Kg1gnAjaLfKiwhhPpGS3QfRg2m6awQvaj98JCZBZQ5SuS2F15C"
  , PrivateKey  "tanuj@blockapps.net" "84bcd6278fdde4e3147717123a4602faeeee83e4" "5Kg1gnAjaLfKiwhhPpGS3QfRg2m6awQvaj98JCZBZQ5SuS2F15C"
  ]

getHash256 :: String ->  Word256
getHash256 inputStr = hash256 $ stringToBS inputStr

getPrivateKeyOfUser :: String -> PrivateKey
getPrivateKeyOfUser uname = Data.List.head [ x | x <- privateKeys, username x == uname]

getPk :: String -> PrvKey
getPk strPk= fromJust $ fromWif strPk

signatureDetails :: Maybe Text -> UserData -> Handler SignatureDetails
signatureDetails userEmail userData = do
  let emailId = fromJust userEmail
      prvKey = pk $ getPrivateKeyOfUser $ Data.Text.unpack emailId
      -- prvKey = pk $ getPrivateKeyOfUser $ "tanuj@blockapps.net"
      dataToSign = queryToSign userData
      word256 = getHash256 dataToSign
  liftIO $ print $ dataToSign
  ExtendedSignature signature' yIsOdd' <- liftIO $ HK.withSource HK.devURandom $ extSignMsg word256 $ getPk prvKey
  let r' = BW.getBigWordInteger $ HK.sigR signature'
      s' = BW.getBigWordInteger $ HK.sigS signature'
      v' = if yIsOdd' then 0x1c else 0x1b
  liftIO $ print $ BW.getBigWordInteger $ HK.sigR signature'
  liftIO $ print $  BW.getBigWordInteger $ HK.sigS signature'
  return (SignatureDetails r' s' v')
