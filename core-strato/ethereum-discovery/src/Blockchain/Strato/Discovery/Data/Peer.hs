{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE NoDeriveAnyClass           #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Blockchain.Strato.Discovery.Data.Peer
  ( module Blockchain.Strato.Discovery.Metrics
  , module Blockchain.Strato.Discovery.Data.Peer
  ) where

import           Control.Exception
import           Crypto.Types.PubKey.ECC
import qualified Data.Text                    as T
import           Data.Time
import           Data.Time.Clock.POSIX
import qualified Database.Persist.Postgresql  as SQL
import           Database.Persist.TH
import           Network.URI                  (URI (..), URIAuth (..))
import qualified Network.URI                  as URI


import           Blockchain.Data.Enode
import           Blockchain.Data.PersistTypes ()
import           Blockchain.Data.PubKey
import           Blockchain.DB.SQLDB          (withGlobalSQLPool)
import           Blockchain.MiscJSON          ()
import           Blockchain.SHA
import           Blockchain.Strato.Discovery.Metrics

share [mkPersist sqlSettings, mkMigrate "migrateAll"] [persistLowerCase|
PPeer
    pubkey Point Maybe
    ip T.Text
    tcpPort Int
    udpPort Int
    numSessions Int
    lastMsg T.Text
    lastMsgTime UTCTime
    enableTime UTCTime
    udpEnableTime UTCTime
    lastTotalDifficulty Integer
    lastBestBlockHash SHA
    bondState Int
    activeState Int
    version T.Text
    nextDisableWindowSeconds Int default=5
    disableExpiration UTCTime default=now()
    ~enode Enode Maybe
    deriving Show Read Eq
|]

pPeerString :: PPeer -> String
pPeerString PPeer{..} = T.unpack pPeerIp ++ ":" ++ show pPeerTcpPort

jamshidBirth::UTCTime
jamshidBirth = posixSecondsToUTCTime 0

createPeer :: String -> Either String PPeer
createPeer peerString = buildPeer <$> parseEnode peerString

-- TODO(tim): Reenable port selection
buildPeer :: (Maybe String, String, Int) -> PPeer
buildPeer (pubkeyMaybe, ip, _) =
  let peer = PPeer {
        pPeerPubkey = stringToPoint <$> pubkeyMaybe,
        pPeerIp = T.pack ip,
        pPeerUdpPort = 30303, --TODO think about this....  Should the UDP port be the same as the TCP port by default?
        pPeerTcpPort = 30303,
        pPeerNumSessions = 0,
        pPeerLastTotalDifficulty = 0,
        pPeerLastMsg  = T.pack "msg",
        pPeerLastMsgTime = jamshidBirth,
        pPeerEnableTime = jamshidBirth,
        pPeerUdpEnableTime = jamshidBirth,
        pPeerLastBestBlockHash = SHA 0,
        pPeerBondState=0,
        pPeerActiveState = 0,
        pPeerVersion = T.pack "61", -- fix
        pPeerNextDisableWindowSeconds = 5,
        pPeerDisableExpiration = jamshidBirth,
        pPeerEnode = peerToEnode peer
        }
  in peer

parseEnode :: String -> Either String (Maybe String, String, Int)
parseEnode enode =
    case mUriAuth of
        Nothing        -> Left $ "Invalid enode: " ++ enode
        (Just uriAuth) -> Right (parsePublicKey uriAuth, parseHostname uriAuth, parsePort uriAuth)
    where
        mUriAuth = URI.parseURI enode >>= validateURIScheme >>= URI.uriAuthority

validateURIScheme :: URI -> Maybe URI
validateURIScheme uri = case URI.uriScheme uri == "enode:" of
    True  -> Just uri
    False -> Nothing

parsePublicKey :: URIAuth -> Maybe String
parsePublicKey uriAuth = case filter (/= '@') $ URI.uriUserInfo uriAuth of
    []        -> Nothing
    publicKey -> Just publicKey

parseHostname :: URIAuth -> String
parseHostname uriAuth = filter (\ch -> ch /= '[' && ch /= ']') (URI.uriRegName uriAuth)

parsePort :: URIAuth -> Int
parsePort uriAuth = read $ filter (/= ':') (URI.uriPort uriAuth)


getAvailablePeers::IO (Either SomeException [PPeer])
getAvailablePeers = try . withGlobalSQLPool $ \sqldb -> do
  currentTime <- getCurrentTime
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerEnableTime SQL.<. currentTime] []

setPeerActiveState::T.Text->Int->ActivityState->IO (Either SomeException ())
setPeerActiveState ip _ state = do
  recordStateChange state
  -- TODO(tim): Reenable port selection
  let port' = 30303
  try $ withGlobalSQLPool $ \sqldb -> do
    flip SQL.runSqlPool sqldb $
      SQL.updateWhere [PPeerIp SQL.==. ip, PPeerTcpPort SQL.==. port']
                      [PPeerActiveState SQL.=. fromEnum state]


getActivePeers::IO (Either SomeException [PPeer])
getActivePeers = try . withGlobalSQLPool $ \sqldb -> do
  currentTime <- getCurrentTime
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerActiveState SQL.==. fromEnum Active, PPeerEnableTime SQL.<. currentTime] []

setPeerBondingState::String->Int->Int->IO (Either SomeException ())
setPeerBondingState ip _ state = try . withGlobalSQLPool $ \sqldb -> do
  -- TODO(tim): Reenable port selection
  let port' = 30303
  flip SQL.runSqlPool sqldb $
    SQL.updateWhere [PPeerIp SQL.==. T.pack ip, PPeerUdpPort SQL.==. port'] [PPeerBondState SQL.=. state]
  return ()

getBondedPeers::IO (Either SomeException [PPeer])
getBondedPeers = try . withGlobalSQLPool $ \sqldb -> do
  currentTime <- getCurrentTime
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

getBondedPeersForUDP::IO (Either SomeException [PPeer])
getBondedPeersForUDP = try . withGlobalSQLPool $ \sqldb -> do
  currentTime <- getCurrentTime
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime] []

getUnbondedPeers::IO [PPeer]
getUnbondedPeers = withGlobalSQLPool $ \sqldb -> do
  currentTime <- getCurrentTime
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerBondState SQL.==. 0, PPeerEnableTime SQL.<. currentTime] []

thisPeer :: PPeer -> [SQL.Filter PPeer]
thisPeer peer = [PPeerIp SQL.==. pPeerIp peer, PPeerTcpPort SQL.==. pPeerTcpPort peer]

disableUDPPeerForSeconds::PPeer->Int->IO (Either SomeException ())
disableUDPPeerForSeconds peer' seconds = try . withGlobalSQLPool $ \sqldb -> do
  -- TODO(tim): Reenable port selection
  let peer = peer'{pPeerTcpPort=30303}
  currentTime <- getCurrentTime
  flip SQL.runSqlPool sqldb $
    SQL.updateWhere (thisPeer peer) [PPeerUdpEnableTime SQL.=. fromIntegral seconds `addUTCTime` currentTime]

resetPeers :: IO ()
resetPeers = withGlobalSQLPool $ SQL.runSqlPool (SQL.updateWhere [] [PPeerActiveState SQL.=. 0])

nonviolentDisable :: PPeer -> IO (Either SomeException ())
nonviolentDisable peer' = try . withGlobalSQLPool $ \sqldb -> do
  let peer = peer'{pPeerTcpPort=30303}
  currentTime <- getCurrentTime
  flip SQL.runSqlPool sqldb $
    SQL.updateWhere (thisPeer peer) [PPeerEnableTime SQL.=. 10 `addUTCTime` currentTime]

-- The first time a peer is disabled, the timeout is five seconds. Every subsequent failure that
-- window is doubled, but those windows are reset every day. This prevents a mostly healthy node
-- from building up longer and longer disables, e.g. if it caused an exception once a day
-- by the end of the month it would be disabled for years.
lengthenPeerDisable :: PPeer -> IO (Either SomeException ())
lengthenPeerDisable peer' = try . withGlobalSQLPool $ \sqldb -> do
  -- TODO(tim): Reenable port selection
  let peer = peer'{pPeerTcpPort=30303}
  currentTime <- getCurrentTime
  let selector = thisPeer peer
  flip SQL.runSqlPool sqldb $ do
    if (currentTime < pPeerDisableExpiration peer)
      then SQL.updateWhere selector [PPeerEnableTime SQL.=. fromIntegral (pPeerNextDisableWindowSeconds peer) `addUTCTime` currentTime
                                    , PPeerNextDisableWindowSeconds SQL.*=. 2
                                    ]
      else SQL.updateWhere selector [ PPeerEnableTime SQL.=. 5 `addUTCTime` currentTime
                                    , PPeerNextDisableWindowSeconds SQL.=. 5
                                    , PPeerDisableExpiration SQL.=. (24 * 60 * 60) `addUTCTime` currentTime
                                    ]

-- TODO: Allow an empty public key in the Enode type
peerToEnode :: PPeer -> Maybe Enode
peerToEnode peer = (\pk -> Enode (pointToBytes pk)
                                 (readIP . T.unpack $ pPeerIp peer)
                                 (pPeerTcpPort peer)
                                 (Just $ pPeerUdpPort peer)) <$> pPeerPubkey peer
