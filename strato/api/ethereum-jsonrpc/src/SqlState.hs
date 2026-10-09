{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

-- | State reads served from the SQL state mirror instead of the consensus VM.
--
-- strato-indexer mirrors every account (address_state_ref) and every SolidVM
-- storage slot (storage, keyed by 'StoragePath') into Postgres, and strato-api
-- serves those tables. Answering eth_getBalance and eth_getStorageAt from them
-- takes the two highest-volume wallet calls off the vm_tasks queue, so they no
-- longer compete with block execution on vm-runner and can be served by an
-- API-role node that has no broker at all.
--
-- The mirror is latest-only: block tags are accepted for wire compatibility but
-- always resolve to the newest indexed block.
module SqlState
  ( NativeBalance (..),
    nativeBalanceFromSql,
    storageAtFromSql,
    basicValueToWord,
    AccountKind (..),
    accountKind,
  )
where

import Blockchain.Data.DataDefs (AddressStateRef (..))
import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (contractsConfig, nativeTokenAddress, nativeTokenBalancesField)
import Blockchain.Model.JsonBlock (AddressStateRef' (..))
import Blockchain.Strato.Model.Address (Address (..))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Char (isHexDigit)
import Data.IORef
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import qualified Handlers.AccountInfo as Accounts
import qualified Handlers.Storage as Storage
import LocalApi (formatClientError, runLocal)
import Numeric (showHex)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..), parsePath)
import System.IO.Unsafe (unsafePerformIO)

-- | What the mirror knows about an address.
data AccountKind
  = NoAccount
  | ExternallyOwnedAccount
  | -- | Has a contract name, so its storage is SolidVM paths in the mirror.
    SolidVMContract
  | -- | Has code but no contract name: EVM storage is not mirrored (EVMDiff
    -- is skipped by the statediff writer).
    EvmContract
  deriving (Eq, Show)

accountKind :: Address -> IO (Either String AccountKind)
accountKind addr = do
  r <- runLocal $ Accounts.getAccountsFilter Accounts.accountsFilterParams {Accounts._qaAddress = Just addr}
  return $ case r of
    Left e -> Left $ "account lookup failed: " ++ T.unpack (formatClientError e)
    Right [] -> Right NoAccount
    Right (AddressStateRef' a : _)
      | Just cn <- addressStateRefContractName a, not (null cn) -> Right SolidVMContract
      | Just _ <- addressStateRefCodeHash a -> Right EvmContract
      | otherwise -> Right ExternallyOwnedAccount

accountBalance :: Address -> IO (Either String Integer)
accountBalance addr = do
  r <- runLocal $ Accounts.getAccountsFilter Accounts.accountsFilterParams {Accounts._qaAddress = Just addr}
  return $ case r of
    Left e -> Left $ "account lookup failed: " ++ T.unpack (formatClientError e)
    Right [] -> Right 0
    Right (AddressStateRef' a : _) -> Right (addressStateRefBalance a)

-- | Whether the configured native token is a SolidVM contract, resolved once:
-- a deployed contract never changes kind. 'NoAccount' is not cached so a token
-- deployed after the RPC server started is picked up on the next call.
{-# NOINLINE nativeTokenKindRef #-}
nativeTokenKindRef :: IORef (Maybe AccountKind)
nativeTokenKindRef = unsafePerformIO $ newIORef Nothing

nativeTokenKind :: IO (Either String AccountKind)
nativeTokenKind =
  readIORef nativeTokenKindRef >>= \case
    Just k -> return $ Right k
    Nothing -> do
      r <- accountKind (nativeTokenAddress $ contractsConfig ethConf)
      case r of
        Right k | k `elem` [SolidVMContract, EvmContract] -> writeIORef nativeTokenKindRef (Just k)
        _ -> return ()
      return r

balancesField :: B.ByteString
balancesField = BC.pack . fromMaybe "_balances" . nativeTokenBalancesField $ contractsConfig ethConf

-- | The mirror row for @<balancesField>[<address>]@ on the native token; SolidVM
-- renders address mapping keys as 40 lowercase hex digits without 0x.
balancePath :: Address -> StoragePath
balancePath addr = StoragePath [Field balancesField, Index (BC.pack $ show addr)]

data NativeBalance
  = -- | Served from the mirror.
    NativeBalance Integer
  | -- | The mirror cannot answer (with the reason); the caller falls back to
    -- the VM round trip so behaviour is unchanged on chains the mirror does
    -- not cover.
    NativeBalanceUnavailable String
  deriving (Show)

-- | eth_getBalance from the SQL mirror. With no native token configured the
-- account's own balance column is the answer; with a SolidVM token, its
-- balances mapping row (a missing row is a zero balance).
nativeBalanceFromSql :: Address -> IO NativeBalance
nativeBalanceFromSql addr
  | nativeAddr == Address 0 = either NativeBalanceUnavailable NativeBalance <$> accountBalance addr
  | otherwise =
      nativeTokenKind >>= \case
        Left e -> return $ NativeBalanceUnavailable e
        Right SolidVMContract -> do
          r <- runLocal $ Storage.getStorageClient Storage.storageFilterParams
            { Storage.qsAddress = Just nativeAddr
            , Storage.qsKey = Just (balancePath addr)
            , Storage.qsLimit = Just 1
            }
          return $ case r of
            Left e -> NativeBalanceUnavailable $ "storage lookup failed: " ++ T.unpack (formatClientError e)
            Right [] -> NativeBalance 0
            Right (row : _) -> case Storage.value row of
              BInteger n -> NativeBalance n
              BDefault -> NativeBalance 0
              other -> NativeBalanceUnavailable $ "unexpected balance value in mirror: " ++ show other
        Right EvmContract -> return $ NativeBalanceUnavailable "native token is an EVM contract; its storage is not mirrored"
        Right k -> return $ NativeBalanceUnavailable $ "native token is not a contract in the mirror: " ++ show k
  where
    nativeAddr = nativeTokenAddress $ contractsConfig ethConf

zeroWord :: String
zeroWord = "0x" ++ replicate 64 '0'

padWord :: String -> String
padWord hex = "0x" ++ replicate (64 - length hex) '0' ++ hex

-- | A SolidVM value as the 32-byte word eth_getStorageAt callers expect.
-- Scalars are right-aligned like the EVM would store them; unbounded values
-- (strings, bytes, decimals) are returned as their raw bytes, which may be
-- longer or shorter than a word.
basicValueToWord :: BasicValue -> String
basicValueToWord = \case
  BInteger n
    | n >= 0 -> padWord (showHex n "")
    | otherwise -> padWord (showHex (n + 2 ^ (256 :: Int)) "")
  BBool True -> padWord "1"
  BBool False -> zeroWord
  BAddress a -> padWord (show a)
  BContract _ a -> padWord (show a)
  BEnumVal _ _ w -> padWord (showHex w "")
  BString s -> "0x" ++ BC.unpack (B16.encode s)
  BBytes s -> "0x" ++ BC.unpack (B16.encode s)
  BDecimal s -> "0x" ++ BC.unpack (B16.encode s)
  BDefault -> zeroWord

-- | An EVM-style slot key: 0x followed by up to 64 hex digits.
isSlotKey :: String -> Bool
isSlotKey ('0' : 'x' : rest) = not (null rest) && length rest <= 64 && all isHexDigit rest
isSlotKey _ = False

-- | eth_getStorageAt from the SQL mirror. The key is either an EVM slot
-- (0x-hex) or, as a STRATO extension, a SolidVM storage path such as
-- @_balances[00..ab]@ or @owner@. SolidVM contracts have no numbered slots,
-- so a slot key on one reads as empty (the answer EIP-1967 proxy probes and
-- similar tooling expect), and a missing path is an empty word too.
storageAtFromSql :: Address -> String -> IO (Either String String)
storageAtFromSql addr key =
  accountKind addr >>= \case
    Left e -> return $ Left e
    Right NoAccount -> return $ Right zeroWord
    Right ExternallyOwnedAccount -> return $ Right zeroWord
    Right EvmContract -> return $ Left "EVM contract storage is not mirrored to SQL; eth_getStorageAt serves SolidVM contracts only"
    Right SolidVMContract
      | isSlotKey key -> return $ Right zeroWord
      | otherwise -> case parsePath (BC.pack key) of
          Left err -> return $ Left $ "key is neither a 0x slot nor a SolidVM storage path: " ++ err
          Right path -> do
            r <- runLocal $ Storage.getStorageClient Storage.storageFilterParams
              { Storage.qsAddress = Just addr
              , Storage.qsKey = Just path
              , Storage.qsLimit = Just 1
              }
            return $ case r of
              Left e -> Left $ "storage lookup failed: " ++ T.unpack (formatClientError e)
              Right [] -> Right zeroWord
              Right (row : _) -> Right $ basicValueToWord (Storage.value row)
