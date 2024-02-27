
module Blockchain.Threads (
  labelTheThread,
  labelTheThreadM,
  changeLabelStatusM,
  formatThread,
  getPeersByThreads
  ) where

import Control.Monad.IO.Class
import Data.List
import qualified Data.Map as Map
import Data.Maybe
import GHC.Conc
import GHC.Conc.Sync


labelTheThread :: MonadIO m => String -> m b -> m b
labelTheThread theLabel doit = do
  threadId <- liftIO $ myThreadId
  liftIO $ labelThread threadId theLabel
  doit

labelTheThreadM :: MonadIO m => String -> m ()
labelTheThreadM theLabel = do
  threadId <- liftIO $ myThreadId
  liftIO $ labelThread threadId theLabel

changeLabelStatusM :: MonadIO m => String -> m ()
changeLabelStatusM status = do
  myCurrentLabel <- liftIO $ fmap (fromMaybe "") $ threadLabel =<< myThreadId
  let myPeerStr = fst $ parseLabel myCurrentLabel
  threadId <- liftIO $ myThreadId
  liftIO $ labelThread threadId $ myPeerStr ++ "/" ++ status


formatThread :: MonadIO m =>
                ThreadId -> m String
formatThread threadId = do
  maybeLabel <- liftIO $ threadLabel threadId
  return $ "(" ++ show threadId ++ ") " ++ fromMaybe "" maybeLabel
  

parseLabel :: String -> (String, String)
parseLabel theLabel =
  case break (== '/') theLabel of
    (label, "") -> ("", label)
    (peer, '/':rest) -> (peer, rest)
    _ -> error "error in parseLabel, this should never be hit"

getPeersByThreads :: IO [(String, String)]
getPeersByThreads = do

  threadIds <- liftIO listThreads

  maybeThreadLabels <- liftIO $ sequence $ map threadLabel threadIds

  return $ map (fmap (summarizeThreadState . sort)) $ filter ((/= "") . fst) $ Map.toList $ Map.fromListWith (++) $ map (fmap (:[]) . parseLabel . fromMaybe "") maybeThreadLabels

summarizeThreadState :: [String] -> String
summarizeThreadState ["handleMsgClientConduit","peerSourceConduit","runPeer","seqEventSource","timerSource"] = "CONNECTED"
summarizeThreadState [v] | "runPeer disconnecting" `isPrefixOf` v =
                           let (_, reason) = break (==':') v
                           in "DISCONNECTING" ++ reason
summarizeThreadState value = "Mangled Thread Profile: " ++ show value

