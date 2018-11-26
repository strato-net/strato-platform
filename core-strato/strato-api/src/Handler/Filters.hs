module Handler.Filters where

import qualified Database.Esqueleto          as E

import qualified Data.Text                   as T
import qualified Data.Text.Encoding          as T
import qualified Prelude                     as P

import           Data.Binary                 as Bin
import           Data.ByteString.Base16      as B16
import qualified Data.ByteString.Char8       as BS8
import qualified Data.ByteString.Lazy        as BS
import           Database.Persist
import           Database.Persist.Postgresql
import           Numeric

import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Util

import           Control.Monad
import           Data.Set

import           Import

sortToOrderBy :: (E.Esqueleto query expr backend, PersistField a)
            => Maybe Text -> expr (E.Value a) -> (expr E.OrderBy)
sortToOrderBy (Just "asc")  x = E.asc  x
sortToOrderBy (Just "desc") x = E.desc x
sortToOrderBy _             x = E.asc  x

blockQueryParams:: [Text]
blockQueryParams = [ "txaddress",
                     "coinbase",
                     "address",
                     "blockid",
                     "hash",
                     "mindiff",
                     "maxdiff",
                     "diff",
                     "gasused",
                     "mingasused",
                     "maxgasused",
                     "gaslim",
                     "mingaslim",
                     "maxgaslim",
                     "number",
                     "minnumber",
                     "maxnumber",
                     "index",
                     "chainid"]

-- todo: eliminate the Entity Block from this function
getBlkFilter :: (E.Esqueleto query expr backend) => (expr (Entity BlockDataRef), expr (Entity AddressStateRef), expr (Entity RawTransaction))-> (Text, Text) -> expr (E.Value Bool)

getBlkFilter  _                               ("page", _)    = E.val True
getBlkFilter  _                               ("index", _)    = E.val True
getBlkFilter  _                               ("raw", _)    = E.val True
getBlkFilter  _                               ("next", _)    = E.val True
getBlkFilter  _                               ("prev", _)    = E.val True
getBlkFilter  _                               ("appname", _) = E.val True
getBlkFilter (bdRef, _, _)                 ("ntx", v)    = bdRef E.^. BlockDataRefNumber E.==. E.val (toInteger' v)

getBlkFilter (bdRef, _, _)                 ("number", v)    = bdRef E.^. BlockDataRefNumber E.==. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("minnumber", v)    = bdRef E.^. BlockDataRefNumber E.>=. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("maxnumber", v)    = bdRef E.^. BlockDataRefNumber E.<=. E.val (toInteger' v)

getBlkFilter (bdRef, _, _)                 ("gaslim", v)    = bdRef E.^. BlockDataRefGasLimit E.==. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("mingaslim", v) = bdRef E.^. BlockDataRefGasLimit E.>=. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("maxgaslim", v) = bdRef E.^. BlockDataRefGasLimit E.<=. E.val (toInteger' v)

getBlkFilter (bdRef, _, _)                 ("gasused", v)    = bdRef E.^. BlockDataRefGasUsed E.==. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("mingasused", v) = bdRef E.^. BlockDataRefGasUsed E.>=. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("maxgasused", v) = bdRef E.^. BlockDataRefGasUsed E.<=. E.val (toInteger' v)

getBlkFilter (bdRef, _, _)                 ("diff", v)      = bdRef E.^. BlockDataRefDifficulty E.==. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("mindiff", v)   = bdRef E.^. BlockDataRefDifficulty E.>=. E.val (toInteger' v)
getBlkFilter (bdRef, _, _)                 ("maxdiff", v)   = bdRef E.^. BlockDataRefDifficulty E.<=. E.val (toInteger' v)

-- getBlkFilter (bdRef, accStateRef, rawTX, blk) ("time", v)      = bdRef E.^. BlockDataRefTimestamp E.==. E.val (stringToDate v)
-- getBlkFilter (bdRef, accStateRef, rawTX, blk) ("mintime", v)   = bdRef E.^. BlockDataRefTimestamp E.>=. E.val (stringToDate v)
-- getBlkFilter (bdRef, accStateRef, rawTX, blk) ("maxtime", v)   = bdRef E.^. BlockDataRefTimestamp E.<=. E.val (stringToDate v)

getBlkFilter (_, _, rawTX) ("txaddress", v) = (rawTX E.^. RawTransactionFromAddress E.==. E.val (toAddr v))
                                                 E.||. (rawTX E.^. RawTransactionToAddress E.==. E.val (Just (toAddr v)))

getBlkFilter (bdRef, _, _) ("coinbase", v)  = bdRef E.^. BlockDataRefCoinbase E.==. E.val (toAddr v)
getBlkFilter (_, accStateRef, _) ("address", v)   = accStateRef E.^. AddressStateRefAddress E.==. E.val (toAddr v)
getBlkFilter (bdRef, _, _) ("blockid", v)   = bdRef E.^. BlockDataRefId E.==. E.val (toBlockDataRefId v)
getBlkFilter (bdRef, _, _) ("hash", v)   = (bdRef E.^. BlockDataRefHash E.==. E.val (toSHA v) )


getBlkFilter _ _ = P.undefined ("no match in getBlkFilter"::String)



accountQueryParams:: [Text]
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


getAccFilter :: (E.Esqueleto query expr backend) => (expr (Entity AddressStateRef))-> (Text, Text) -> expr (E.Value Bool)
getAccFilter  _            ("page", _)       =  E.val True
getAccFilter  _            ("index", _)      =  E.val True
getAccFilter  _            ("raw", _)        =  E.val True
getAccFilter  _            ("next", _)       =  E.val True
getAccFilter  _            ("prev", _)       =  E.val True
getAccFilter  _            ("appname", _)    =  E.val True

getAccFilter (accStateRef) ("balance", v)    = accStateRef E.^. AddressStateRefBalance E.==. E.val (toInteger' v)
getAccFilter (accStateRef) ("minbalance", v) = accStateRef E.^. AddressStateRefBalance E.>=. E.val (toInteger' v)
getAccFilter (accStateRef) ("maxbalance", v) = accStateRef E.^. AddressStateRefBalance E.<=. E.val (toInteger' v)

getAccFilter (accStateRef) ("nonce", v)      = accStateRef E.^. AddressStateRefNonce E.==. E.val (toInteger' v)
getAccFilter (accStateRef) ("minnonce", v)   = accStateRef E.^. AddressStateRefNonce E.>=. E.val (toInteger' v)
getAccFilter (accStateRef) ("maxnonce", v)   = accStateRef E.^. AddressStateRefNonce E.<=. E.val (toInteger' v)

getAccFilter (accStateRef) ("address", v)    = accStateRef E.^. AddressStateRefAddress E.==. E.val (toAddr v)

getAccFilter (accStateRef) ("code", v)       = accStateRef E.^. AddressStateRefCode E.==. E.val (toCode v)
getAccFilter (accStateRef) ("codeHash", v)   = accStateRef E.^. AddressStateRefCodeHash E.==. E.val (toSHA v)
getAccFilter (accStateRef) ("chainid", v)    = ((accStateRef E.^. AddressStateRefChainId) E.==. (E.just $ E.val (fromHexText v)))

getAccFilter _             _                 = P.undefined ("no match in getAccFilter"::String)

transactionQueryParams:: [Text]
transactionQueryParams = [ "address",
                           "from",
                           "to",
                           "hash",
                           "gasprice",
                           "mingasprice",
                           "maxgasprice",
                           "gaslimit",
                           "mingaslimit",
                           "maxgaslimit",
                           "value",
                           "minvalue",
                           "maxvalue",
                           "blocknumber",
                           "index",
                           "rejected",
                           "chainid"]

getTransFilter :: (E.Esqueleto query expr backend) => (expr (Entity RawTransaction))-> (Text, Text) -> expr (E.Value Bool)
getTransFilter  _          ("rejected", _)     = E.val True
getTransFilter  _          ("page", _)         = E.val True
getTransFilter  _          ("index", _)        = E.val True
getTransFilter  _          ("raw", _)          = E.val True
getTransFilter  _          ("next", _)         = E.val True
getTransFilter  _          ("prev", _)         = E.val True
getTransFilter  _          ("appname", _)      = E.val True
getTransFilter  _          ("sortby", _)       = E.val True

getTransFilter (rawTx)     ("address", v)      = rawTx E.^. RawTransactionFromAddress E.==. E.val (toAddr v) E.||. rawTx E.^. RawTransactionToAddress E.==. E.val (Just (toAddr v))
getTransFilter (rawTx)     ("from", v)         = rawTx E.^. RawTransactionFromAddress E.==. E.val (toAddr v)
getTransFilter (rawTx)     ("to", v)           = rawTx E.^. RawTransactionToAddress E.==. E.val (Just (toAddr v))
getTransFilter (rawTx)     ("hash", v)         = rawTx E.^. RawTransactionTxHash  E.==. E.val (toSHA v)

--getTransFilter (rawTx)     ("type", "Contract") = (rawTx E.^. RawTransactionToAddress E.==. (E.val "")) E.&&. (RawTransactionCodeOrData E.!=. (E.val ""))

getTransFilter (rawTx)     ("gasprice", v)     = rawTx E.^. RawTransactionGasPrice E.==. E.val (toInteger' v)
getTransFilter (rawTx)     ("mingasprice", v)  = rawTx E.^. RawTransactionGasPrice E.>=. E.val (toInteger' v)
getTransFilter (rawTx)     ("maxgasprice", v)  = rawTx E.^. RawTransactionGasPrice E.<=. E.val (toInteger' v)

getTransFilter (rawTx)     ("gaslimit", v)     = rawTx E.^. RawTransactionGasLimit E.==. E.val (toInteger' v)
getTransFilter (rawTx)     ("mingaslimit", v)  = rawTx E.^. RawTransactionGasLimit E.>=. E.val (toInteger' v)
getTransFilter (rawTx)     ("maxgaslimit", v)  = rawTx E.^. RawTransactionGasLimit E.<=. E.val (toInteger' v)

getTransFilter (rawTx)     ("value", v)        = rawTx E.^. RawTransactionValue E.==. E.val (toInteger' v)
getTransFilter (rawTx)     ("minvalue", v)     = rawTx E.^. RawTransactionValue E.>=. E.val (toInteger' v)
getTransFilter (rawTx)     ("maxvalue", v)     = rawTx E.^. RawTransactionValue E.<=. E.val (toInteger' v)

getTransFilter (rawTx)     ("blocknumber", v)  = rawTx E.^. RawTransactionBlockNumber E.==. E.val (P.read $ T.unpack v :: Int)
getTransFilter (rawTx)     ("chainid", v)      = ((rawTx E.^. RawTransactionChainId) E.==. E.val (fromHexText v))
getTransFilter _           _                   = P.undefined ("no match in getTransFilter"::String)

getStorageFilter :: (E.Esqueleto query expr backend) => (expr (Entity Storage), expr (Entity AddressStateRef)) -> (Text, Text) -> expr (E.Value Bool)
getStorageFilter _ ("page",_)  = E.val True
getStorageFilter _ ("index",_) = E.val True
getStorageFilter (storage,_) ("key", v)
  = storage E.^. StorageKey E.==. E.val (P.fromIntegral (toInteger' v) :: Word256)
getStorageFilter (storage,_) ("minkey", v)
  = storage E.^. StorageKey E.>=. E.val (P.fromIntegral (toInteger' v) :: Word256)
getStorageFilter (storage,_) ("maxkey", v)
  = storage E.^. StorageKey E.<=. E.val (P.fromIntegral (toInteger' v) :: Word256)
getStorageFilter (storage,_) ("keystring", v)
  = storage E.^. StorageKey E.==. E.val (Bin.decode $ BS.fromStrict $ T.encodeUtf8 v :: Word256)
getStorageFilter (storage,_) ("keyhex", v)
  = storage E.^. StorageKey E.==. E.val (fromHexText v)
getStorageFilter (storage,_) ("value", v)
  = storage E.^. StorageValue E.==. E.val (P.fromIntegral (toInteger' v) :: Word256)
getStorageFilter (storage,_) ("minvalue", v)
  = storage E.^. StorageValue E.>=. E.val (P.fromIntegral (toInteger' v) :: Word256)
getStorageFilter (storage,_) ("maxvalue", v)
  = storage E.^. StorageValue E.<=. E.val (P.fromIntegral (toInteger' v) :: Word256)
getStorageFilter (storage,_) ("valuestring", v)
  = storage E.^. StorageValue E.==. E.val (Bin.decode $ BS.fromStrict $ T.encodeUtf8 v :: Word256)
getStorageFilter (storage,_) ("addressid", v)
  = storage E.^. StorageAddressStateRefId E.==. E.val (toAddrId v)
getStorageFilter (_,addrStRef) ("address", v)      -- Note: a join is done in StorageInfo
  = addrStRef E.^. AddressStateRefAddress E.==. E.val (toAddr v)
getStorageFilter (_,addrStRef) ("chainid", v)
  = ((addrStRef E.^. AddressStateRefChainId) E.==. (E.just $ E.val (fromHexText v)))

getStorageFilter _           _                   = P.undefined ("no match in getStorageFilter"::String)

getLogFilter :: (E.Esqueleto query expr backend) => expr (Entity LogDB) -> (Text, Text) -> expr (E.Value Bool)
getLogFilter _ ("index",_) = E.val True         -- indexes are intercepted in handlers. We should probably deal with them here in the future
getLogFilter log' ("address",v) = log' E.^. LogDBAddress E.==. E.val (toAddr v)
getLogFilter log' ("hash",v) = log' E.^. LogDBTransactionHash  E.==. E.val ( SHA . fromIntegral . byteString2Integer . fst. B16.decode $ T.encodeUtf8 $ v )
getLogFilter _           _  = P.undefined ("no match in getLogFilter"::String)

toAddrId :: Text -> Key AddressStateRef
toAddrId = toId

toBlockDataRefId :: Text -> Key BlockDataRef
toBlockDataRefId = toId

toId :: ToBackendKey SqlBackend record => Text -> Key record
toId v = toSqlKey (fromIntegral $ (toInteger' v) )

toAddr :: Text -> Address
toAddr v = Address wd160
  where ((wd160, _):_) = readHex $ T.unpack $ v :: [(Word160,String)]

toInteger' :: Text -> Integer
toInteger' v = P.read $ T.unpack v

toSHA :: Text -> SHA
toSHA v = SHA . fromIntegral . byteString2Integer . fst. B16.decode $ T.encodeUtf8 $ v

toCode :: Text -> ByteString
toCode v = fst $ B16.decode $ BS8.pack $ (T.unpack v)

extractValue :: String -> [(Text, Text)] -> String -> Maybe String
extractValue name ts zero = Control.Monad.foldM toFold zero (P.map selectPage ts)
     where
       toFold :: String -> Maybe String -> Maybe String
       toFold n Nothing  = Just n
       toFold n (Just m) = Just (P.maximum [n, m])
       selectPage :: (Text, Text) -> Maybe String
       selectPage (s, v) | T.unpack s == name = Just $ T.unpack v
                         | otherwise = Nothing

fromHexText :: T.Text -> Word256
fromHexText v = res
  where ((res,_):_) = readHex $ T.unpack $ v :: [(Word256,String)]

extractHash :: String -> [(Text, Text)] ->  Maybe String
extractHash _ _ = Just ""

extractPage :: String -> [(Text, Text)] -> Maybe Integer
extractPage name ts = extractPage' 0 name ts

extractPage' :: Integer -> String -> [(Text, Text)] -> Maybe Integer
extractPage' i name ts = Control.Monad.foldM toFold i (P.map selectPage ts)
     where
       toFold :: Integer -> Maybe Integer -> Maybe Integer
       toFold n Nothing  = Just n
       toFold n (Just m) = Just (P.maximum [n, m])
       selectPage :: (Text, Text) -> Maybe Integer
       selectPage (s, v) | T.unpack s == name = Just (toInteger' v)
                         | otherwise = Nothing

toParam :: (Text,Text) -> Param
toParam a = Param a

fromParam :: Param -> (Text,Text)
fromParam (Param a) = a

data Param = Param (Text,Text)
instance Eq Param where
  Param a == Param b = fst a == fst b
instance Ord Param where
  (Param a) `compare` (Param b) = (fst a) `compare` (fst b)

appendIndex :: [(Text, Text)] -> [(Text,Text)] -- this sould be using URL encoding code from Yesod
appendIndex l = P.map fromParam (Data.Set.toList $ Data.Set.insert (toParam ("index", "")) $ Data.Set.fromList $ P.map toParam l)

extraFilter :: (Text,Text) -> Text -> (Text,Text)
extraFilter ("index", _) v' = ("index", v')
extraFilter (a,b) _'        = (a,b)

getBlockNum :: Block -> Integer
getBlockNum (Block (BlockData _ _ (Address _) _ _ _ _ _ num _ _ _ _ _ _) _ _) = num

getTxNum :: RawTransaction -> Int
getTxNum (RawTransaction _ (Address _) _ _ _ _ _ _ _ _ _ _ _ bn _ _) = bn

-- probably need to pad here
getAccNum :: AddressStateRef -> String
getAccNum (AddressStateRef (Address x) _ _ _ _ _ _ _) = (showHex x "")

if' :: Bool -> a -> b -> Either a b
if' x a b = if x == True then Left a else Right b
