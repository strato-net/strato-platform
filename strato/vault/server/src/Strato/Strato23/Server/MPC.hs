{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Handlers for the MPC (2-of-2) shard store. Vault holds one shard of a split
-- key, encrypted at rest with the same SecretBox master key as user keys. It never
-- reconstructs the key or signs — the wallet fetches its shard back and signs
-- client-side. These handlers are independent of the existing user-key flows.
module Strato.Strato23.Server.MPC where

import Blockchain.Strato.Model.Address (Address)
import Data.ByteString (ByteString)
import Data.Text (Text)
import Strato.Strato23.API.MPC
import Strato.Strato23.Crypto
import Strato.Strato23.Database.Queries (getMpcShardQuery', postMpcKeyQuery')
import Strato.Strato23.Monad

-- | Store the user's Vault shard (encrypted under the vault master key). One shard
-- per (user, identity-provider); refuses to overwrite an existing one.
postMPCKey' :: Text -> Text -> MPCKeyShare -> VaultM MPCKeyMeta
postMPCKey' userName oauthProvider (MPCKeyShare shard addr) = withSecretKey $ \key -> do
  (salt, nonce) <- newSaltAndNonce
  let encShard = encrypt key nonce shard
  created <- vaultModify $ postMpcKeyQuery' userName oauthProvider salt nonce encShard addr
  if not created
    then vaultWrapperError $ AlreadyExists ("MPC key for " <> userName <> " already exists")
    else return $ MPCKeyMeta addr

-- | Return the user's Vault shard (decrypted) so the wallet can reconstruct and
-- sign client-side.
getMPCKey' :: Text -> Text -> VaultM MPCKeyShare
getMPCKey' userName oauthProvider = withSecretKey $ \key -> do
  (_ :: ByteString, nonce, encShard, addr :: Address) <-
    toUserError ("MPC key for " <> userName <> " doesn't exist")
      . vaultQuery1
      $ getMpcShardQuery' userName oauthProvider
  case decrypt key nonce encShard of
    Nothing -> vaultWrapperError IncorrectPasswordError
    Just shard -> return $ MPCKeyShare shard addr
