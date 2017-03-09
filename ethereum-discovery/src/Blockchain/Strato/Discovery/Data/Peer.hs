{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Blockchain.Strato.Discovery.Data.Peer where

import Control.Monad.Logger
import Crypto.Types.PubKey.ECC
import qualified Data.Text as T
import Data.Time
import Data.Time.Clock.POSIX
import qualified Database.Persist.Postgresql as SQL
import Database.Persist.TH
import Network.URI (URI(..), URIAuth(..))
import qualified Network.URI as URI


import Blockchain.Data.PersistTypes ()
import Blockchain.Data.PubKey
import Blockchain.EthConf
import Blockchain.MiscJSON ()
import Blockchain.DB.SQLDB (createPostgresqlPool')
import Blockchain.SHA

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
    version T.Text
    deriving Show Read Eq
|]

jamshidBirth::UTCTime
jamshidBirth = posixSecondsToUTCTime 0

createPeer :: String -> Either String PPeer
createPeer peerString = buildPeer <$> parseEnode peerString

buildPeer :: (Maybe String, String, Int) -> PPeer
buildPeer (pubKeyMaybe, ip, port') =
    PPeer {
        pPeerPubkey = stringToPoint <$> pubKeyMaybe,
        pPeerIp = T.pack ip,
        pPeerUdpPort = port', --TODO think about this....  Should the UDP port be the same as the TCP port by default?
        pPeerTcpPort = port',
        pPeerNumSessions = 0,
        pPeerLastTotalDifficulty = 0,
        pPeerLastMsg  = T.pack "msg",
        pPeerLastMsgTime = jamshidBirth,
        pPeerEnableTime = jamshidBirth,
        pPeerUdpEnableTime = jamshidBirth,
        pPeerLastBestBlockHash = SHA 0,
        pPeerBondState=0,
        pPeerVersion = T.pack "61" -- fix
        }

parseEnode :: String -> Either String (Maybe String, String, Int)
parseEnode enode =
    case mUriAuth of
        Nothing -> Left $ "Invalid enode: " ++ enode
        (Just uriAuth) -> Right (parsePublicKey uriAuth, parseHostname uriAuth, parsePort uriAuth)
    where
        mUriAuth = URI.parseURI enode >>= validateURIScheme >>= URI.uriAuthority

validateURIScheme :: URI -> Maybe URI
validateURIScheme uri = case URI.uriScheme uri == "enode:" of
    True -> Just uri
    False -> Nothing

parsePublicKey :: URIAuth -> Maybe String
parsePublicKey uriAuth = case filter (/= '@') $ URI.uriUserInfo uriAuth of
    [] -> Nothing
    publicKey -> Just publicKey

parseHostname :: URIAuth -> String
parseHostname uriAuth = filter (\ch -> ch /= '[' && ch /= ']') (URI.uriRegName uriAuth)

parsePort :: URIAuth -> Int
parsePort uriAuth = read $ filter (/= ':') (URI.uriPort uriAuth)

getAvailablePeers::IO [PPeer]
getAvailablePeers = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerEnableTime SQL.<. currentTime] []

setPeerBondingState::String->Int->Int->IO ()
setPeerBondingState ip port' state = do
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  flip SQL.runSqlPool sqldb $
    SQL.updateWhere [PPeerIp SQL.==. T.pack ip, PPeerUdpPort SQL.==. port'] [PPeerBondState SQL.=. state]
  return ()

getBondedPeers::IO [PPeer]
getBondedPeers = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerBondState SQL.==. 2, PPeerEnableTime SQL.<. currentTime] []

getBondedPeersForUDP::IO [PPeer]
getBondedPeersForUDP = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerBondState SQL.==. 2, PPeerUdpEnableTime SQL.<. currentTime] []

getUnbondedPeers::IO [PPeer]
getUnbondedPeers = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  fmap (map SQL.entityVal) $ flip SQL.runSqlPool sqldb $
    SQL.selectList [PPeerBondState SQL.==. 0, PPeerEnableTime SQL.<. currentTime] []

defaultPeer::PPeer
defaultPeer = PPeer{
  pPeerPubkey=Nothing,
  pPeerIp="",
  pPeerUdpPort=30303,
  pPeerTcpPort=30303,
  pPeerNumSessions=0,
  pPeerLastMsg="",
  pPeerLastMsgTime=posixSecondsToUTCTime 0,
  pPeerEnableTime=posixSecondsToUTCTime 0,
  pPeerUdpEnableTime=posixSecondsToUTCTime 0,
  pPeerLastTotalDifficulty=0,
  pPeerLastBestBlockHash=SHA 0,
  pPeerBondState=0,
  pPeerVersion=""
  }

disablePeerForSeconds::PPeer->Int->IO ()
disablePeerForSeconds peer seconds = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  flip SQL.runSqlPool sqldb $
    SQL.updateWhere [PPeerIp SQL.==. pPeerIp peer, PPeerTcpPort SQL.==. pPeerTcpPort peer] [PPeerEnableTime SQL.=. fromIntegral seconds `addUTCTime` currentTime]
  return ()

disableUDPPeerForSeconds::PPeer->Int->IO ()
disableUDPPeerForSeconds peer seconds = do
  currentTime <- getCurrentTime
  sqldb <- runNoLoggingT $ createPostgresqlPool' connStr' 20
  flip SQL.runSqlPool sqldb $
    SQL.updateWhere [PPeerIp SQL.==. pPeerIp peer, PPeerTcpPort SQL.==. pPeerTcpPort peer] [PPeerUdpEnableTime SQL.=. fromIntegral seconds `addUTCTime` currentTime]
  return ()

