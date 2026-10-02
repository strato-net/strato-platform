{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Shared nonce reservation for server-signed transactions.
--
-- bloc assigns nonces to the transactions it signs on a user's behalf. The
-- account's nonce in Postgres lags reality by the transactions still in
-- flight, so bloc keeps a short-lived counter per address: the next nonce to
-- hand out, expiring after a few seconds. The counter is a row in the eth
-- database's @nonce_counter@ table on the writer, reserved under a row lock,
-- so any number of API instances hand out disjoint nonces without any state
-- of their own: the writer is the one thing every instance already shares.
--
-- The rules are those of the original in-process cache: the starting point
-- is the greater of the stored counter (when the caller opts in and it has
-- not expired) and the nonce read from Postgres; explicit nonces supplied by
-- the caller are honored and skipped over; the counter is left at one past
-- the highest nonce used.
module Bloc.NonceStore
  ( reserveNonces,
    ensureNonceCounterTable,
  )
where

import Blockchain.DB.SQLDB (HasSQLDB, SQLDB (..), sqlQueryWriter)
import Blockchain.Strato.Model.Address (Address, formatAddressWithoutColor)
import Blockchain.Strato.Model.Nonce (Nonce (..))
import Control.Monad (when)
import Control.Monad.IO.Class (MonadIO)
import Control.Monad.Trans.Resource (runResourceT)
import qualified Data.Set as Set
import qualified Data.Text as T
import Database.Persist.Sql (PersistValue (..), Single (..), SqlPersistT, rawExecute, rawSql, runSqlPool)

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
  HasSQLDB m =>
  -- | seconds the counter stays valid after a reservation
  Int ->
  Address ->
  Bool ->
  Nonce ->
  [Nonce] ->
  Int ->
  m [Nonce]
reserveNonces ttlSeconds addr useStored (Nonce floorNonce) inUse count = sqlQueryWriter $ do
  let key = PersistText . T.pack $ formatAddressWithoutColor addr
  -- One row per address; the FOR UPDATE below serializes concurrent
  -- reservations for the same address across every API instance.
  rawExecute
    "INSERT INTO nonce_counter (address, next_nonce, expires_at) VALUES (?, 0, now()) ON CONFLICT (address) DO NOTHING"
    [key]
  rows <- selectCounter key
  let stored = case rows of
        [(Single n, Single live)] | live -> Just (read (T.unpack n) :: Integer)
        _ -> Nothing
      base0 = toInteger floorNonce
      base = if useStored then maybe base0 (max base0) stored else base0
      used = Set.fromList [toInteger n | Nonce n <- inUse]
      pick _ 0 acc = reverse acc
      pick n k acc
        | Set.member n used = pick (n + 1) k acc
        | otherwise = pick (n + 1) (k - 1 :: Int) (n : acc)
      assigned = pick base count []
      maxSeen = maximum ((-1) : Set.toList used ++ assigned)
  when (maxSeen >= 0) $
    rawExecute
      "UPDATE nonce_counter SET next_nonce = ?, expires_at = now() + make_interval(secs => ?) WHERE address = ?"
      [PersistText (T.pack (show (maxSeen + 1))), PersistInt64 (fromIntegral ttlSeconds), key]
  pure $ map (Nonce . fromInteger) assigned

-- | The counter row, locked for the rest of the transaction: (next nonce, still valid).
selectCounter :: MonadIO n => PersistValue -> SqlPersistT n [(Single T.Text, Single Bool)]
selectCounter key =
  rawSql
    "SELECT next_nonce::text, (expires_at > now()) FROM nonce_counter WHERE address = ? FOR UPDATE"
    [key]

-- | Create the counter table on the writer if it is missing (API startup).
ensureNonceCounterTable :: SQLDB -> IO ()
ensureNonceCounterTable db =
  runResourceT $
    flip runSqlPool (sqlWriterPool db) $
      rawExecute
        "CREATE TABLE IF NOT EXISTS nonce_counter (address text PRIMARY KEY, next_nonce numeric NOT NULL, expires_at timestamptz NOT NULL)"
        []
