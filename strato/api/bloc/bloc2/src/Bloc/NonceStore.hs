{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Shared nonce reservation for server-signed transactions.
--
-- bloc assigns nonces to the transactions it signs on a user's behalf. The
-- account's nonce in Postgres lags reality by the transactions still in
-- flight, so bloc keeps a short-lived counter per address: the next nonce to
-- hand out, expiring after a few seconds. That counter used to be an
-- in-process cache, which is correct only while exactly one strato-api
-- serves a user. It now lives in the edge Redis, reserved with one atomic
-- Lua script, so any number of API instances hand out disjoint nonces.
--
-- The script reproduces the old cache's rules exactly: the starting point is
-- the greater of the stored counter (when the caller opts in) and the nonce
-- read from Postgres; explicit nonces supplied by the caller are honored
-- and skipped over; the counter is left at one past the highest nonce used.
module Bloc.NonceStore
  ( reserveNonces,
  )
where

import Blockchain.Strato.Model.Address (Address, formatAddressWithoutColor)
import Blockchain.Strato.Model.Nonce (Nonce (..))
import Control.Monad.IO.Class (MonadIO, liftIO)
import qualified Data.ByteString.Char8 as BC
import qualified Database.Redis as Redis
import SQLM (ApiError (..))
import UnliftIO (throwIO)

-- | Reserve @count@ fresh nonces for @addr@.
--
-- * @useStored@: consult the stored counter (the parallel-submit path does;
--   the plain-submit path starts from Postgres alone, as before).
-- * @floorNonce@: the account nonce read from Postgres.
-- * @inUse@: nonces the caller already fixed explicitly; they are skipped and
--   count toward the stored counter.
--
-- Returns exactly @count@ nonces in ascending order.
reserveNonces ::
  MonadIO m =>
  Redis.Connection ->
  -- | seconds the counter stays valid after a reservation
  Int ->
  Address ->
  Bool ->
  Nonce ->
  [Nonce] ->
  Int ->
  m [Nonce]
reserveNonces conn ttlSeconds addr useStored (Nonce floorNonce) inUse count = do
  let key = BC.pack $ "nonce:" ++ formatAddressWithoutColor addr
      args =
        [ BC.pack (show (toInteger floorNonce)),
          if useStored then "1" else "0",
          BC.pack (show ttlSeconds),
          BC.pack (show count)
        ]
          ++ [BC.pack (show (toInteger n)) | Nonce n <- inUse]
  result <- liftIO . Redis.runRedis conn $ Redis.eval reserveScript [key] args
  case result of
    Left err -> throwIO . ServerError $ "nonce store unavailable: " ++ show err
    Right (assigned :: [BC.ByteString]) -> do
      let nonces = map (Nonce . fromInteger . read . BC.unpack) assigned
      if length nonces /= count
        then throwIO . ServerError $ "nonce store returned " ++ show (length nonces) ++ " nonces, expected " ++ show count
        else pure nonces

-- KEYS[1] counter key; ARGV: floor, use_stored, ttl, count, in-use nonces...
reserveScript :: BC.ByteString
reserveScript =
  BC.unlines
    [ "local key = KEYS[1]",
      "local base = tonumber(ARGV[1])",
      "local use_stored = ARGV[2] == '1'",
      "local ttl = tonumber(ARGV[3])",
      "local count = tonumber(ARGV[4])",
      "local in_use = {}",
      "local max_seen = -1",
      "for i = 5, #ARGV do",
      "  local n = tonumber(ARGV[i])",
      "  in_use[n] = true",
      "  if n > max_seen then max_seen = n end",
      "end",
      "if use_stored then",
      "  local cur = redis.call('GET', key)",
      "  if cur then",
      "    cur = tonumber(cur)",
      "    if cur > base then base = cur end",
      "  end",
      "end",
      "local assigned = {}",
      "local n = base",
      "for i = 1, count do",
      "  while in_use[n] do n = n + 1 end",
      "  assigned[#assigned + 1] = tostring(n)",
      "  if n > max_seen then max_seen = n end",
      "  n = n + 1",
      "end",
      "if max_seen >= 0 then redis.call('SET', key, tostring(max_seen + 1), 'EX', ttl) end",
      "return assigned"
    ]
