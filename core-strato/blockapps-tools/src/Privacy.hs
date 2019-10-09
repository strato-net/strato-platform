{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE FlexibleContexts   #-}
{-# LANGUAGE FlexibleInstances  #-}
{-# LANGUAGE LambdaCase         #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings  #-}
{-# LANGUAGE RecordWildCards    #-}
{-# LANGUAGE TypeApplications   #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Privacy where

import           Control.Monad
import           Control.Monad.Change.Modify     (Accessible(..))
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource

import           Data.Aeson                      hiding (encode)
import qualified Data.Aeson                      as Ae (encode)
import           Data.Binary
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy            as BL
import           Data.Data
import           Data.Default
import           Data.List                       (intersperse)
import           Data.Maybe
import qualified Data.Text                       as T
import           Data.Text.Encoding              (decodeUtf8, encodeUtf8)
import           Data.Traversable                (for)
import qualified Database.LevelDB                as DB

import           Text.Format
import           Text.Read                       (readMaybe)

import           Blockchain.Constants
import           Blockchain.Privacy.Monad
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Monad
import           Blockchain.Strato.Model.SHA

minBoundP :: Bounded a => Proxy a -> a
minBoundP _ = minBound

maxBoundP :: Bounded a => Proxy a -> a
maxBoundP _ = maxBound

showAll :: (Bounded a, Enum a, Show a) => Proxy a -> String
showAll p = showAllDelimited p " "

showAllDelimited :: (Bounded a, Enum a, Show a) => Proxy a -> String -> String
showAllDelimited p delimiter = concat . intersperse delimiter $ map show [minBoundP p..maxBoundP p]

errGetFlagRequirement :: String
errGetFlagRequirement = "--key is required when using -o get"

errPutFlagRequirement :: String
errPutFlagRequirement = "--key and --value are required when using -o put"

--privacyUsage :: [String]
--privacyUsage =
--    [ "queryStrato privacy -r,--registry REGISTRY -o,--operation "
--      ++ showAllDelimited (Proxy @Operation) "|"
--      ++ " [-k,--key Key] [-v, --value Value] [-j,--json]"
--    , ""
--    , "Notes:"
--    , "   * " ++ errPutFlagRequirement
--    , ""
--    , "Flags:"
--    , "  -r --registry=REGISTRY  The registry on which to operate. One of: " ++ showAll (Proxy @Registry)
--    , "  -o --operation=OP       The operation to perform. One of: " ++ showAll (Proxy @Operation)
--    , "  -k --key=Key            If -o get or -o put is specified, the key on which to operate."
--    , "  -v --value=Value        If -o put is specified, the value to which to set the key."
--    , "  -j --json               Flag to optionally return data in JSON (put requires input to be JSON)"
--    , ""
--    , "Common flags:"
--    , "  -? --help             Display a significantly less useful help message"
--    , "  -V --version          Print version information"
--    ]

data Collector a = Collector { keyStart :: Int, keyCount :: Int, keys :: [a] }

newCollector :: Int -> Int -> Collector a
newCollector s c = Collector s c []

getSomeKeysInNamespace :: ( HasNamespace a
                          , Binary (NSKey a)
                          , Accessible DB.DB m
                          , MonadIO m
                          , MonadResource m
                          )
                       => Proxy a -> Int -> Int -> m [NSKey a]
getSomeKeysInNamespace p' start' count' | start' <= 0 = return []
                                        | count' <= 0 = return []
                                        | otherwise = do
  db <- access Proxy
  i <- DB.iterOpen db def
  DB.iterLast i
  valid <- DB.iterValid i
  if valid
    then getKeysInNamespace' p' i $ newCollector start' count'
    else return []
  where
    getKeysInNamespace' :: ( HasNamespace a
                           , Binary (NSKey a)
                           , MonadIO m
                           , MonadResource m
                           )
                        => Proxy a -> DB.Iterator -> Collector (NSKey a) -> m [NSKey a]
    getKeysInNamespace' p i c | keyCount c <= 0 = return $ keys c
                              | otherwise = do
      mkey <- join . fmap (fromNamespace p . BL.fromStrict) <$> DB.iterKey i
      let c' = case mkey of
            Nothing  -> c
            Just key -> if keyStart c == 0
                          then c { keyCount = keyCount c - 1
                                 , keys =  key : keys c
                                 }
                          else c {keyStart = keyStart c - 1}
      DB.iterPrev i
      v <- DB.iterValid i
      if v
        then getKeysInNamespace' p i c'
        else return $ keys c'

getAllKeysInNamespace :: ( HasNamespace a
                         , Binary (NSKey a)
                         , MonadResource m
                         , Accessible DB.DB m
                         )
                      => Proxy a -> m [NSKey a]
getAllKeysInNamespace p = getSomeKeysInNamespace p 0 maxBound

strBStr :: String -> B.ByteString
strBStr = encodeUtf8 . T.pack

strInt :: Int -> Maybe String -> Int
strInt n mstr = fromMaybe n $ readMaybe =<< mstr

handleKeys :: Proxy a
           -> Maybe String
           -> Maybe String
           -> Bool
           -> IO String
handleKeys _ _ _ _ = error "handleKeys: not implemented"

handleGet :: (HasNamespace a, Binary a) => Proxy a -> NSKey a -> IO (Maybe a)
handleGet p k = doit (lookupInLDB p k)

handlePut :: (HasNamespace a, Binary a) -- Read (NSKey a), FromJSON (NSKey a), Read a, FromJSON a)
          => Proxy a -> NSKey a -> a -> IO ()
handlePut p k v = void $ doit (insertInLDB p k v)
      --Left str -> return str
      --Right b -> "Done" <$ doit (insertInLDB p k b)

handleDelete :: (HasNamespace a) --, Read (NSKey a), FromJSON (NSKey a))
             => Proxy a -> NSKey a -> IO String
handleDelete p k = "Done" <$ doit (deleteInLDB p k)

--nsKeyFromJSON :: (HasNamespace a, FromJSON (NSKey a)) => Proxy a -> String -> Either String (NSKey a)
--nsKeyFromJSON p str = case fromJSON str

instance Accessible DB.DB (ReaderT DB.DB (ResourceT IO)) where
  access _ = ask

doit :: ReaderT DB.DB (ResourceT IO) a -> IO a
doit f = DB.runResourceT $ do
    sdb <- DB.open (".ethereumH/" ++ sequencerDependentBlockDBPath)
           DB.defaultOptions{DB.cacheSize=1024}
    runReaderT f sdb

getPrivacy :: String -> String -> Bool -> IO String
getPrivacy registry key js = case registry of
  'b':_ -> maybe "Not found" (if js then jsEncode Proxy . obToObPrime else format) <$> handleGet (Proxy @OutputBlock) (SHA $ read key)
  't':_ -> maybe "Not found" (if js then jsEncode Proxy . otxToOtxPrime else format) <$> handleGet (Proxy @OutputTx) (SHA $ read key)
  'h':_ -> maybe "Not found" (if js then jsEncode Proxy else format) <$> handleGet (Proxy @ChainHashEntry) (SHA $ read key)
  'i':_ -> maybe "Not found" (if js then jsEncode Proxy else format) <$> handleGet (Proxy @ChainIdEntry) (read key)
  _ -> return "Registry not found. Expected one of: block, tx, hash, id"
  where jsEncode _ = T.unpack . decodeUtf8 . BL.toStrict . Ae.encode

putPrivacy :: String -> String -> String -> Bool -> IO String
putPrivacy registry key value _ = case registry of
  'b':_ -> fmap (either id (const "Success")) . for (fmap obPrimeToOb . eitherDecode' . BL.fromStrict $ strBStr value) $ handlePut (Proxy @OutputBlock) (read key)
  't':_ -> fmap (either id (const "Success")) . for (fmap otxPrimeToOtx . eitherDecode' . BL.fromStrict $ strBStr value) $ handlePut (Proxy @OutputTx) (read key)
  'h':_ -> fmap (either id ((const "Success"))) . for (eitherDecode' . BL.fromStrict $ strBStr value) $ handlePut (Proxy @ChainHashEntry) (read key)
  'i':_ -> fmap (either id ((const "Success"))) . for (eitherDecode' . BL.fromStrict $ strBStr value) $ handlePut (Proxy @ChainIdEntry) (read key)
  _ -> return "Registry not found. Expected one of: block, tx, hash, id"
