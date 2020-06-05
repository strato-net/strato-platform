{-# LANGUAGE DataKinds              #-}
{-# LANGUAGE OverloadedStrings      #-}
{-# LANGUAGE TypeOperators          #-}

module Handlers.AccountInfo (
  API,
  server
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Data.ByteString.Base16      as B16
import qualified Data.ByteString.Char8       as BC
import qualified Data.ByteString.Lazy.Char8  as BLC
import           Data.List
import           Data.Maybe
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import           Database.Persist.Postgresql
import           Numeric
import           Servant
--import           Servant.Swagger.Tags


import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Keccak256 hiding (hash)


import           Settings
import           SQLM

type API = -- Tags "section1" :> Summary "get user accounts" :> Description "Get information about user accounts" :>
  "account" :> QueryParam "address" Address
            :> QueryParam "balance" Integer
            :> QueryParam "minbalance" Integer
            :> QueryParam "maxbalance" Integer
            :> QueryParam "nonce" Integer
            :> QueryParam "minnonce" Integer
            :> QueryParam "maxnonce" Integer
            :> QueryParam "maxnumber" Integer
            :> QueryParam "code" Text
            :> QueryParam "codeHash" Keccak256
            :> QueryParam "chainid" Text
            :> Get '[JSON] [AddressStateRef']

server :: ConnectionPool -> Server API
server pool = getAccount pool

---------------------------

getAccount :: ConnectionPool ->
                  Maybe Address -> Maybe Integer -> Maybe Integer -> Maybe Integer ->
                  Maybe Integer -> Maybe Integer -> Maybe Integer -> Maybe Integer ->
                  Maybe Text -> Maybe Keccak256 -> Maybe Text ->
                  Handler [AddressStateRef']

getAccount pool 
  address balance minbalance maxbalance
  nonce minnonce maxnonce maxnumber
  code codeHash chainid
  = do
    when (and
        [
          null address, null balance, null minbalance, null maxbalance,
          null nonce, null minnonce, null maxnonce, null maxnumber,
          null code, null codeHash, null chainid
        ]) $
      throwError err400{ errBody = BLC.pack $ "Need one of: " ++ intercalate ", " accountQueryParams }

    maybeCid <-
      case chainid of
        Nothing -> return $ Just 0
        Just "main" -> return $ Just 0
        Just "all" -> return Nothing
        Just cidString -> do
          case fromHexText cidString of
            Nothing -> throwError err400{ errBody = BLC.pack $ "Malformed chainid: " ++ show chainid }
            x -> return x
    
    addrs <-
      liftIO $ runSQLM pool $ sqlQuery $ E.select . E.distinct $
              E.from $ \(accStateRef) -> do

              let
                criteria =
                  catMaybes
                  [
                    fmap (\v -> accStateRef E.^. AddressStateRefBalance E.==. E.val v) balance,
                    fmap (\v -> accStateRef E.^. AddressStateRefBalance E.>=. E.val v) minbalance,
                    fmap (\v -> accStateRef E.^. AddressStateRefBalance E.<=. E.val v) maxbalance,
                    fmap (\v -> accStateRef E.^. AddressStateRefNonce E.==. E.val v) nonce,
                    fmap (\v -> accStateRef E.^. AddressStateRefNonce E.>=. E.val v) minnonce,
                    fmap (\v -> accStateRef E.^. AddressStateRefNonce E.<=. E.val v) maxnonce,
                    fmap (\v -> accStateRef E.^. AddressStateRefAddress E.==. E.val v) address,
                    fmap (\v -> accStateRef E.^. AddressStateRefCode E.==. E.val (toCode v)) code,
                    fmap (\v -> accStateRef E.^. AddressStateRefCodeHash E.==. E.val v) codeHash
                  ] 
              
              let chainCriteria =
                    case maybeCid of
                      Just cid -> [accStateRef E.^. AddressStateRefChainId E.==. E.val cid]
                      Nothing -> []
                    
              let allCriteria = case chainCriteria of
                     [] -> [criteria]
                     _ -> map (\cc -> cc : criteria) chainCriteria

              E.where_ (foldl1 (E.||.) (map (foldl1 (E.&&.)) allCriteria))

              E.limit $ appFetchLimit

              E.orderBy [E.asc (accStateRef E.^. AddressStateRefAddress)]
              return accStateRef

    let modAccounts = nub $ addrs :: [E.Entity AddressStateRef]

    return . map asrToAsrPrime . zip (repeat "") $ (map E.entityVal modAccounts) 






accountQueryParams:: [String]
accountQueryParams = [ "address",
                       "balance",
                       "minbalance",
                       "maxbalance",
                       "nonce",
                       "minnonce",
                       "maxnonce",
                       "maxnumber",
                       "code",
                       "index",
                       "codeHash",
                       "chainid"]

fromHexText :: T.Text -> Maybe Word256
fromHexText v = 
  case readHex $ T.unpack $ v :: [(Word256,String)] of
    ((res,_):_) -> Just res
    _ -> Nothing

toCode :: Text -> BC.ByteString
toCode v = fst $ B16.decode $ BC.pack $ (T.unpack v)

