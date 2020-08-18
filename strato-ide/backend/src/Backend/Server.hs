{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Backend.Server where

import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.Output
import           Blockchain.SolidVM
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.VMContext
import           Control.Monad.IO.Class
import           Control.Monad      (forever, void)
import           Data.Aeson         (encode, decode)
import           Data.Bifunctor     (bimap)
import qualified Data.ByteString    as B
import           Data.ByteString.Lazy (toStrict)
import qualified Data.Map.Strict as M
import           Data.Semigroup     ((<>))
import qualified Data.Text as T
import           Data.Text.Encoding (encodeUtf8)
import qualified Data.Text.IO       as T
import           Data.Time
import           Data.Time.Clock.POSIX
import qualified Network.WebSockets as WS
import           SolidVM.Solidity.Parse.File (parseSolidity)
import           Text.Parsec
import           Text.Parsec.Error
import UnliftIO

--------------------------------------------------------------------------------
import           Common.Message
--------------------------------------------------------------------------------

application :: WS.ServerApp
application pending = do
  conn <- WS.acceptRequest pending
  WS.forkPingThread conn 30
  void . runLoggingTWithLevel LevelDebug . runMemContextM . forever $ do
    msgbs <- liftIO $ WS.receiveData conn
    let msgC = decode $ WS.toLazyByteString (msgbs :: B.ByteString) :: Maybe C2S
    case msgC of
      Nothing -> liftIO $ T.putStrLn "Decoded msgC is nothing..."
      Just (C2Scompile txt) -> liftIO $ do
        T.putStrLn $ "Compiling: " <> txt
        WS.sendTextData conn . toStrict . encode $ S2CcompileResult $
          bimap toAnn (T.pack . show) $ parseSolidity txt
      Just (C2Screate CreateArgs{..}) -> do
        liftIO $ T.putStrLn $ "Creating contract: " <> contractName
        eExecResults <- UnliftIO.try $ createSolidVM contractName contractArgs contractCode
        let er = case eExecResults of
                   Left (e :: SomeException) -> Left . T.pack $ show e
                   Right e -> Right e
        liftIO $ WS.sendTextData conn . toStrict . encode $ S2CcreateResult er
      Just (C2Scall CallArgs{..}) -> do
        liftIO $ T.putStrLn $ "Calling function: " <> funcName
        eExecResults <- UnliftIO.try $ callSolidVM funcName funcArgs
        let er = case eExecResults of
                   Left (e :: SomeException) -> Left . T.pack $ show e
                   Right e -> Right e
        liftIO $ WS.sendTextData conn . toStrict . encode $ S2CcallResult er

toAnn :: ParseError -> [Ann]
toAnn pe =
  let sp = errorPos pe
      ms = errorMessages pe
      sl = sourceLine sp
      sc = sourceColumn sp
   in map (\m -> Ann sl sc (T.pack $ messageString m) True) ms

timeZero :: UTCTime
timeZero = posixSecondsToUTCTime 0

emptyBlockData :: BlockData
emptyBlockData = BlockData (unsafeCreateKeccak256FromWord256 0)
                           (unsafeCreateKeccak256FromWord256 0)
                           (Address 0)
                           MP.emptyTriePtr
                           MP.emptyTriePtr
                           MP.emptyTriePtr
                           ""
                           0
                           0
                           1000000000000000000
                           0
                           timeZero
                           ""
                           0
                           (unsafeCreateKeccak256FromWord256 0)

createSolidVM :: SolidVMBase m => T.Text -> T.Text -> T.Text -> m ExecResults
createSolidVM contractName contractArgs contractCode = do
  create (error "isRunningTests")
         (error "isHomestead")
         (error "preExistingSuicideList")
         emptyBlockData
         (error "callDepth")
         (Address 0xabcdef)
         (Address 0xabcdef)
         (error "value")
         (error "gasPrice")
         (error "availableGas")
         (Address 0xdeadbeef)
         (Code $ encodeUtf8 contractCode)
         (unsafeCreateKeccak256FromWord256 0)
         Nothing
         (Just $ M.fromList [("name", contractName), ("args", contractArgs)])

callSolidVM :: SolidVMBase m => T.Text -> T.Text -> m ExecResults
callSolidVM funcName funcArgs = do
  call (error "isRunningTests")
       (error "isHomestead")
       (error "noValueTransfer")
       (error "preExistingSuicideList")
       emptyBlockData
       (error "callDepth")
       (error "receiveAddress")
       (Address 0xdeadbeef)
       (Address 0xabcdef)
       (error "value")
       (error "gasPrice")
       (error "theData")
       (error "availableGas")
       (Address 0xabcdef)
       (unsafeCreateKeccak256FromWord256 0)
       Nothing
       (Just $ M.fromList [("funcName", funcName), ("args", funcArgs)])
