{-# LANGUAGE OverloadedStrings #-}

module State (
  doit
  ) where

import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import Data.Default
import qualified Database.LevelDB as DB
import System.FilePath

import qualified Data.NibbleString as N
import Blockchain.Data.RLP

import qualified Blockchain.Colors as CL
import Blockchain.Constants
import Blockchain.Data.AddressStateDB
import Blockchain.Format
import qualified Blockchain.Database.MerklePatricia.Internal as MP

import Util

nibbleStringToByteString::N.NibbleString->B.ByteString
nibbleStringToByteString (N.EvenNibbleString x) = x
nibbleStringToByteString _ = error "nibbleStringToByteString called for Odd length nibblestring"

showVals::DB.DB->MP.StateRoot->ResourceT IO ()
showVals sdb sr = do
  db <- DB.open (".ethereumH" </> "hash") def
    

  kvs <- MP.unsafeGetKeyVals MP.MPDB{MP.ldb=sdb, MP.stateRoot=sr} ""
  liftIO $ putStrLn $ "Number of items: " ++ show (length kvs) ++ "\n------------------------"
  forM_ (filter (isNecessary . fst ) kvs) $ \(key, val) -> do
    unhashed <- DB.get db def $ nibbleStringToByteString key
    let keyShowVal =
          case unhashed of
            Nothing -> error "missing value in unhash table"
            Just x -> CL.yellow $ format x
    liftIO $ putStrLn $
      keyShowVal
      ++ ":"
      ++ tab ("\n" ++ format (rlpDecode $ rlpDeserialize $ rlpDecode val::AddressState))
      ++ "\n----------------------------"

doit::String->MP.StateRoot->IO()
doit theType sr = do
  DB.runResourceT $ do
    --sdb <- DB.open (homeDir </> ".ethereum" </> "chaindata")
    sdb <- DB.open (dbDir theType ++ stateDBPath)
           DB.defaultOptions{DB.cacheSize=1024}
           
    showVals sdb sr

isNecessary::N.NibbleString->Bool
isNecessary "1a26338f0d905e295fccb71fa9ea849ffa12aaf4" = False
isNecessary "2ef47100e0787b915105fd5e3f4ff6752079d5cb" = False
isNecessary "6c386a4b26f73c802f34673f7248bb118f97424a" = False
isNecessary "b9c015918bdaba24b4ff057a92a3873d6eb201be" = False
isNecessary "cd2a3d9f938e13cd947ec05abc7fe734df8dd826" = False
isNecessary "e4157b34ea9615cfbde6b4fda419828124b70c78" = False
isNecessary "e6716f9544a56c530d868e4bfbacb172315bdead" = False

isNecessary "dbdbdb2cbd23b783741e8d7fcf51e459b497e4a6" = False
isNecessary "b0afc46d9ce366d06ab4952ca27db1d9557ae9fd" = False
isNecessary "f6b1e9dc460d4d62cc22ec5f987d726929c0f9f0" = False
isNecessary "cc45122d8b7fa0b1eaa6b29e0fb561422a9239d0" = False
isNecessary "b7576e9d314df41ec5506494293afb1bd5d3f65d" = False

isNecessary _ = True






                      
