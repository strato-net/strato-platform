{-# LANGUAGE OverloadedStrings #-}

module Strato.Strato23.Server.Key where

import           Control.Monad.IO.Class           (liftIO)
import           Crypto.Random.Entropy
import           Crypto.Secp256k1
import qualified Data.ByteString                  as BS
import           Data.Maybe                       (fromMaybe)
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Monad
import           Strato.Strato23.Database.Queries (postUserKeyQuery)

newSecKey :: IO SecKey
newSecKey = fromMaybe err . secKey <$> getEntropy 32
  where
    err = error "could not generate secret key"

deriveAddress :: SecKey -> Address
deriveAddress = keccak256Address . BS.drop 1 . exportPubKey False . derivePubKey

postKey :: Maybe Text -> Maybe Text -> VaultM Address
postKey mUserUniqueName mUserId = case (mUserUniqueName, mUserId) of
  (Nothing, _) -> vaultWrapperError $ UserError "No cookie provided"
  (Just _, Nothing) -> vaultWrapperError $ UserError "No user ID provided"
  (Just userName, Just _) -> do
    pKey <- liftIO newSecKey
    _ <- vaultTransaction
       . toUserError ("User " <> userName <> " already exists")
       . vaultModify
       . postUserKeyQuery userName
       $ getSecKey pKey
    return $ deriveAddress pKey
