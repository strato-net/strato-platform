{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.Server.Signature where

import           Servant
import           Data.Text
import           Data.List
import           Control.Monad.IO.Class
import           GHC.Generics
import           Strato.Strato23.API.Signature

data PrivateKeys = PrivateKeys {
  username :: String
  , address :: String
  , pk :: String
} deriving (Eq, Show, Generic)

privateKeys :: [PrivateKeys]
privateKeys = 
  [ PrivateKeys "tanuj500" "cb1a02b33d6fba1a226bdd8a45da4654e0f1ecd9" "2b08d6c336ba8c50b683af14d8fbfb9c39865fc5bc31cf286e9f42d66af50c6d"
  , PrivateKeys  "tanuj@blockapps.net" "84bcd6278fdde4e3147717123a4602faeeee83e4" "0e478b3c31d6c3fda608610b640572ff308de42e1ed98628ccdb26f842109629"
  ]

getPrivateKeyOfUser :: String -> PrivateKeys
getPrivateKeyOfUser uname = Data.List.head [ x | x <- privateKeys, username x == uname]

signatureDetails :: Maybe Text -> Handler SignatureDetails
signatureDetails x = do
  case x of
    Just email -> (liftIO $ print $ getPrivateKeyOfUser $ Data.Text.unpack $ email)
    Nothing ->  (liftIO $ print x)

  return (SignatureDetails "12438971348519879" "21897342723782789" "28" x)