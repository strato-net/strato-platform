
module Blockchain.Threads (
  labelTheThread,
  labelTheThreadM,
  labelPeerThread,
  labelPeerThreadM,
  changeLabelStatusM,
  changeThreadStatus,
  formatThread,
  getPeersByThreads,
  countEstablishedPeers
  ) where

import Control.Monad
import Control.Monad.IO.Class
import Data.List
import Data.List.Split
import qualified Data.Map as Map
import Data.Maybe
import GHC.Conc
import GHC.Conc.Sync


labelTheThread :: MonadIO m => String -> m b -> m b
labelTheThread theLabel doit = do
  labelTheThreadM theLabel
  doit

labelTheThreadM :: MonadIO m => String -> m ()
labelTheThreadM theLabel = do
  threadId <- liftIO $ myThreadId
  liftIO $ labelThread threadId theLabel

labelPeerThreadM :: MonadIO m => String -> String -> Maybe String -> m ()
labelPeerThreadM peerStr location status = do
  labelTheThreadM $ peerStr ++ "/" ++ location ++ fromMaybe "" (fmap ("/" ++) status)

labelPeerThread :: MonadIO m => String -> String -> Maybe String -> m b -> m b
labelPeerThread peerStr location status doit = do
  labelPeerThreadM peerStr location status
  doit

changeLabelStatusM :: MonadIO m => String -> m ()
changeLabelStatusM status = liftIO myThreadId >>= flip changeThreadStatus status

-- | 'changeLabelStatusM' for another thread: a connection's handler marks its
-- Peer Manager thread once the peer has proven its key.
changeThreadStatus :: MonadIO m => ThreadId -> String -> m ()
changeThreadStatus threadId status = liftIO $ do
  currentLabel <- fromMaybe "" <$> threadLabel threadId
  let (ParsedLabel p l _) = parseLabel currentLabel
  labelThread threadId $ p ++ "/" ++ l ++ "/" ++ status

formatThread :: MonadIO m =>
                ThreadId -> m String
formatThread threadId = do
  maybeLabel <- liftIO $ threadLabel threadId
  status <- liftIO $ threadStatus threadId
  let statusString =
        case status of
          ThreadFinished -> " [ThreadFinished]"
          _ -> ""
  return $ "(" ++ show threadId ++ ") " ++ fromMaybe "" maybeLabel ++ statusString


data ParsedLabel = ParsedLabel {
  thePeer :: String,
  theLocation :: String,
  theStatus :: Maybe String
  } deriving (Show)

parseLabel :: String -> ParsedLabel
parseLabel theLabel =
  case splitOn "/" theLabel of
    [v1] -> ParsedLabel "" v1 Nothing
    [v1, v2] -> ParsedLabel v1 v2 Nothing
    (v1 : v2 : vrest) -> ParsedLabel v1 v2 (Just $ intercalate "/" vrest)
    [] -> ParsedLabel "" "" Nothing -- not sure if this is proper, but don't want to error

getPeersByThreads :: IO [(String, String)]
getPeersByThreads = do

  threadIds <- liftIO listThreads

  activeThreadIds <- filterM (fmap (/= ThreadFinished) . threadStatus) threadIds

  maybeThreadLabels <- liftIO $ sequence $ map threadLabel activeThreadIds

  let peerThreadGroups = Map.toList $ Map.fromListWith (++) $
                         [(p, [(l, s)]) | ParsedLabel p l s <- map parseLabel [ v | Just v <- maybeThreadLabels]]

  return $ map (fmap (summarizeThreadState . sort)) $ filter (isPeerLabel . fst) $ peerThreadGroups

-- | Peer threads are labelled "<host" (inbound) or ">host:port" (outbound).
-- Any other label with a slash in it, such as warp's "Warp HTTP/1.1 client"
-- on the p2p API's threads, is not a peer and must not take a connection slot.
isPeerLabel :: String -> Bool
isPeerLabel (c : _) = c == '<' || c == '>'
isPeerLabel []      = False

-- | Established peers: what the connection limit is spent on. A dial counts
-- once past the RLPx handshake, an accept once the peer's Hello has proven its
-- key. One still in its handshake is labelled otherwise and is not counted, so
-- attempts arriving together do not refuse each other.
countEstablishedPeers :: IO Int
countEstablishedPeers = length . filter ((== "CONNECTED") . snd) <$> getPeersByThreads

summarizeThreadState :: [(String, Maybe String)] -> String
summarizeThreadState [
    ("P2P Handler",Nothing),
    ("Peer Manager", maybeStatus),
    ("Peer Source",Nothing),
    ("Sequencer Source",Nothing),
    ("Timer Source",Nothing)
  ] =
  case maybeStatus of
    Nothing -> "CONNECTED"
    Just status -> status
summarizeThreadState [("Peer Manager", maybeStatus)] = fromMaybe "CONNECTED" maybeStatus
summarizeThreadState value =
  "Mangled Thread Profile: [" ++ intercalate ", " (map formatThreadInfo value) ++ "]"
  where
    formatThreadInfo (l, Nothing) = l
    formatThreadInfo (l, Just st) = l ++ "/" ++ st
