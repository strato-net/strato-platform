{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Discovery.UDP
  ( dataToPacket,
    sendPacket,
    processDataStream',
    getServerPubKey,
    ndPacketToRLP,
    NodeDiscoveryPacket (..),
    Endpoint (..),
    Neighbor (..),
    peerToNeighbor,
    NodeID (..),
    nodeIDToPoint,
    pointToNodeID,
    IAddr (..),
    stringToIAddr,
    getHostAddress,
  )
where

import BlockApps.Logging
import Blockchain.Data.RLP
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Discovery.P2PUtil (DiscoverException (..))
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Error (note)
import Control.Exception hiding (try)
import Control.Monad (forM_)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.List.Split
import Data.Maybe
import qualified Data.Text as T
import Data.Time.Clock.POSIX
import Network.Socket
import qualified Network.URI as URI
import Numeric
import System.Endian
import qualified Text.Colors as CL
import Text.Format
import UnliftIO

data NodeDiscoveryPacket
  = Ping Integer Endpoint Endpoint Integer
  | Pong Endpoint Integer Integer
  | FindNeighbors NodeID Integer
  | Neighbors [Neighbor] Integer
  deriving (Show, Read, Eq)

instance Format NodeDiscoveryPacket where
  format (Ping _ from to _) = CL.blue "Ping" ++ " " ++ format from ++ " to: " ++ format to
  format (Pong to _ _) = CL.blue "Pong" ++ " to: " ++ format to
  format (FindNeighbors nodeID _) = CL.blue "FindNeighbors " ++ format nodeID
  format (Neighbors neighbors _) = CL.blue "Neighbors" ++ ": \n" ++ unlines (map (("    " ++) . format) neighbors)

data IAddr
  = HostName String
  | IPV4Addr HostAddress
  | IPV6Addr HostAddress6
  deriving (Show, Read, Eq)

instance Format IAddr where
  format (HostName hostName) = hostName
  format (IPV4Addr x) =
    show (fromIntegral x :: Word8) ++ "."
      ++ show (fromIntegral $ x `shiftR` 8 :: Word8)
      ++ "."
      ++ show (fromIntegral $ x `shiftR` 16 :: Word8)
      ++ "."
      ++ show (fromIntegral $ x `shiftR` 24 :: Word8)
  format (IPV6Addr (v1, v2, v3, v4)) =
    showHex (fromIntegral $ v4 `shiftR` 16 :: Word16) "" ++ ":"
      ++ showHex (fromIntegral v4 :: Word16) ""
      ++ ":"
      ++ showHex (fromIntegral $ v3 `shiftR` 16 :: Word16) ""
      ++ ":"
      ++ showHex (fromIntegral v3 :: Word16) ""
      ++ ":"
      ++ showHex (fromIntegral $ v2 `shiftR` 16 :: Word16) ""
      ++ ":"
      ++ showHex (fromIntegral v2 :: Word16) ""
      ++ ":"
      ++ showHex (fromIntegral $ v1 `shiftR` 16 :: Word16) ""
      ++ ":"
      ++ showHex (fromIntegral v1 :: Word16) ""

-- odd that this doesn't exist, but so says reddit- https://www.reddit.com/r/haskellquestions/comments/331lot/simple_preferably_pure_way_to_create_hostaddress/
stringToIAddr :: String -> IAddr
stringToIAddr x
  | URI.isIPv4address x = case map read $ splitOn "." x of
    [a, b, c, d] -> IPV4Addr $ a + (b `shift` 8) + (c `shift` 16) + (d `shift` 24)
    _ -> error $ "Invalid IPV4: " ++ x
  | URI.isIPv6address x = case map (read . ("0x0" ++)) $ splitOn ":" x of
    [a, b, c, d, e, f, g, h] -> IPV6Addr $ tupleToHostAddress6 (a, b, c, d, e, f, g, h)
    _ -> error $ "Invalid IPV6: " ++ x --Note to future dev: we don't support shortened ipv6 notation
  | otherwise = HostName x

instance RLPSerializable IAddr where
  rlpEncode (IPV4Addr x) = rlpEncode $ fromBE32 x
  rlpEncode (IPV6Addr (x1, x2, x3, x4)) = rlpEncode $ B.toStrict $ encode x4 <> encode x3 <> encode x2 <> encode x1
  rlpEncode (HostName s) = rlpEncode $ (B.pack [255, 255, 255, 255] `B.append` BC.pack s)
  rlpDecode o@(RLPString s)
    | B.length s == 4 = IPV4Addr $ fromBE32 $ rlpDecode o
    --TODO- verify the order of this
    | B.length s == 16 = IPV6Addr (fromIntegral word128, fromIntegral $ word128 `shiftR` 32, fromIntegral $ word128 `shiftR` 64, fromIntegral $ word128 `shiftR` 96)
    | B.pack [255, 255, 255, 255] `B.isPrefixOf` s = stringToIAddr . BC.unpack $ B.drop 4 s
    --what a mess!  Sometimes address is array of address bytes, sometimes a string representation of the address.  I need to figure this out someday
    | otherwise = stringToIAddr $ BC.unpack s
    where
      word128 = rlpDecode o :: Word128
  rlpDecode x = error $ "bad type for rlpDecode for IAddr: " ++ show x

data Endpoint = Endpoint IAddr UDPPort TCPPort deriving (Show, Read, Eq)

instance Format Endpoint where
  format (Endpoint address (UDPPort udpPort) (TCPPort tcpPort)) = format address ++ ":" ++ show udpPort ++ "/" ++ show tcpPort

data Neighbor = Neighbor Endpoint NodeID deriving (Show, Read, Eq)

instance Format Neighbor where
  format (Neighbor endpoint nodeID) = format endpoint ++ ", " ++ format nodeID

instance RLPSerializable Endpoint where
  rlpEncode (Endpoint address (UDPPort udpPort) (TCPPort tcpPort)) = RLPArray [rlpEncode address, rlpEncode $ toInteger udpPort, rlpEncode $ toInteger tcpPort]

  --    rlpDecode (RLPArray [address, udpPort, tcpPort]) = Endpoint (stringToIAddr $ rlpDecode address) (rlpDecode udpPort) (rlpDecode tcpPort)
  rlpDecode (RLPArray [address, udpPort, tcpPort]) = Endpoint (rlpDecode address) (UDPPort . fromInteger $ rlpDecode udpPort) (TCPPort . fromInteger $ rlpDecode tcpPort)
  rlpDecode x = error $ "unsupported rlp in rlpDecode for Endpoint: " ++ show x

instance RLPSerializable Neighbor where
  rlpEncode (Neighbor (Endpoint address (UDPPort udpPort) (TCPPort tcpPort)) nodeID) =
    RLPArray [rlpEncode address, rlpEncode $ toInteger udpPort, rlpEncode $ toInteger tcpPort, rlpEncode nodeID]
  rlpDecode (RLPArray [address, udpPort, tcpPort, nodeID]) =
    Neighbor (Endpoint (rlpDecode address) (UDPPort . fromInteger $ rlpDecode udpPort) (TCPPort . fromInteger $ rlpDecode tcpPort)) (rlpDecode nodeID)
  rlpDecode x = error $ "unsupported rlp in rlpDecode for Neighbor: " ++ show x

peerToNeighbor :: PPeer -> Either DiscoverException Neighbor
peerToNeighbor p = do
  pubKey <- note NoPublicKeyException (pPeerPubkey p)
  let endpoint =
        Endpoint
          (stringToIAddr $ T.unpack $ pPeerIp p)
          (UDPPort . fromIntegral $ pPeerUdpPort p)
          (TCPPort . fromIntegral $ pPeerTcpPort p)
  return $ Neighbor endpoint $ pointToNodeID pubKey

getHostAddress :: SockAddr -> Either DiscoverException IAddr
getHostAddress (SockAddrInet _ x) = Right $ IPV4Addr x
getHostAddress x = Left $ IPFormatException $ "Unsupported case in sockAddrToHostAddr: " ++ show x

ndPacketToRLP :: NodeDiscoveryPacket -> (Word8, RLPObject)
ndPacketToRLP
  ( Ping
      ver
      (Endpoint ipFrom (UDPPort udpPortFrom) (TCPPort tcpPortFrom))
      (Endpoint ipTo (UDPPort udpPortTo) (TCPPort tcpPortTo))
      expiration
    ) =
    ( 1,
      RLPArray
        [ rlpEncode ver,
          RLPArray
            [ rlpEncode ipFrom,
              rlpEncode $ toInteger udpPortFrom,
              rlpEncode $ toInteger tcpPortFrom
            ],
          RLPArray
            [ rlpEncode ipTo,
              rlpEncode $ toInteger udpPortTo,
              rlpEncode $ toInteger tcpPortTo
            ],
          rlpEncode expiration
        ]
    )
ndPacketToRLP (Pong (Endpoint ipFrom (UDPPort udpPortFrom) (TCPPort tcpPortFrom)) tok expiration) =
  ( 2,
    RLPArray
      [ RLPArray
          [ rlpEncode ipFrom,
            rlpEncode $ toInteger udpPortFrom,
            rlpEncode $ toInteger tcpPortFrom
          ],
        rlpEncode tok,
        rlpEncode expiration
      ]
  )
ndPacketToRLP (FindNeighbors target expiration) = (3, RLPArray [rlpEncode target, rlpEncode expiration])
ndPacketToRLP (Neighbors neighbors expiration) = (4, RLPArray [RLPArray $ map rlpEncode neighbors, rlpEncode expiration])

dataToPacket :: B.ByteString -> Either DiscoverException (NodeDiscoveryPacket, PublicKey)
dataToPacket msg = do
  let eSignature = importSignature $ B.take 65 $ B.drop 32 msg
  case eSignature of
    Left err -> Left $ MalformedUDPException err
    Right sig -> do
      let theRest = B.unpack $ B.drop 98 msg
          (rlp, _) = rlpSplit $ B.pack theRest
      theType <- note (ByteStringLengthException $ show msg) $ listToMaybe . B.unpack $ B.take 1 $ B.drop 97 msg
      let messageHash = hash $ B.pack $ theType : B.unpack (rlpSerialize rlp)
      otherPubkey <-
        note
          (MalformedUDPException $ "malformed signature in udpHandshakeServer: " ++ show (sig, messageHash))
          (recoverPub sig $ keccak256ToByteString messageHash)
      packet <- typeToPacket theType rlp
      return (packet, otherPubkey)
  where
    typeToPacket :: Word8 -> RLPObject -> Either DiscoverException NodeDiscoveryPacket
    typeToPacket 1 (RLPArray [version, from, to, timestamp]) = Right $ Ping (rlpDecode version) (rlpDecode from) (rlpDecode to) (rlpDecode timestamp)
    typeToPacket 2 (RLPArray [to, echo, timestamp]) = Right $ Pong (rlpDecode to) (rlpDecode echo) (rlpDecode timestamp)
    typeToPacket 3 (RLPArray [target, timestamp]) = Right $ FindNeighbors (rlpDecode target) (rlpDecode timestamp)
    typeToPacket 4 (RLPArray [RLPArray neighbors, timestamp]) = Right $ Neighbors (map rlpDecode neighbors) (rlpDecode timestamp)
    typeToPacket x y = Left $ MalformedUDPException $ "Unsupported case called in typeToPacket: " ++ show x ++ ", " ++ show y

sendPacket ::
  ( HasVault m
  , MonadLogger m
  , A.Replaceable SockAddr B.ByteString m
  , A.Replaceable T.Text PPeer m
  , A.Selectable (Maybe IPAsText, UDPPort) SockAddr m ) =>
  PPeer ->
  NodeDiscoveryPacket ->
  m ()
sendPacket thePeer packet = do
  mPeerAddr <- A.select (A.Proxy @SockAddr) (Just $ IPAsText $ pPeerIp thePeer, UDPPort . fromIntegral $ pPeerUdpPort thePeer)
  forM_ mPeerAddr $ \addr -> do
    $logInfoS "sendPacket" $ T.pack $ CL.green "sending to" ++ " (" ++ show addr ++ ") " ++ format packet
    let (theType', theRLP) = ndPacketToRLP packet
        theData = rlpSerialize theRLP
        theMsgHash = keccak256ToByteString $ hash $ B.singleton theType' <> theData

    sig <- sign theMsgHash
    let sigBS = exportSignature sig
        theHash = keccak256ToByteString $ hash $ sigBS <> B.singleton theType' <> theData

    A.replace (A.Proxy @B.ByteString) addr $ theHash <> sigBS <> B.singleton theType' <> theData
  flip updateLastMessage thePeer (case packet of
    Ping{} -> "Ping"
    Pong{} -> "Pong"
    FindNeighbors{} -> "FindNeighbors"
    Neighbors{} -> "Neighbors"
    )

processDataStream' :: B.ByteString -> PublicKey
processDataStream' bs | B.length bs < 98 = error "processDataStream' called with too few bytes"
processDataStream' bs =
  let (hs, bs') = B.splitAt 32 bs
      (sigBS, bs'') = B.splitAt 65 bs'
      (vtype, rest) = B.splitAt 1 bs''
      theType = B.index vtype 0
      theHash = bytesToWord256 hs
      eSignature = importSignature sigBS
   in case eSignature of
        Left err -> error err
        Right signature ->
          let (rlp, _) = rlpSplit rest
              messageHash = hash $ B.singleton theType <> rlpSerialize rlp
              publicKey = recoverPub signature $ keccak256ToByteString messageHash
              theHash' = hash $ sigBS <> B.singleton theType <> rlpSerialize rlp
           in if theHash /= keccak256ToWord256 theHash'
                then error "bad UDP data sent from peer, the hash isn't correct"
                else fromMaybe (error "malformed signature in call to processDataStream") publicKey

data UDPException = UDPTimeout deriving (Show)

instance Exception UDPException

getServerPubKey ::
  ( HasVault m,
    MonadUnliftIO m,
    A.Selectable (IPAsText, UDPPort, B.ByteString) Point m
  ) =>
  PPeer ->
  m (Either SomeException Point)
getServerPubKey peer = do
  timestamp <- liftIO $ fmap round getPOSIXTime
  let domain = IPAsText $ pPeerIp peer
      udpPort = UDPPort $ pPeerUdpPort peer
      tcpPort = TCPPort $ pPeerTcpPort peer
      (theType, theRLP) =
        ndPacketToRLP $
          Ping 4 (Endpoint (stringToIAddr "127.0.0.1") udpPort tcpPort) (Endpoint (stringToIAddr . T.unpack $ pPeerIp peer) udpPort tcpPort) (timestamp + 50)
      theData = rlpSerialize theRLP
      theMsgHash = keccak256ToByteString $ hash $ B.singleton theType <> theData

  sig <- sign theMsgHash
  let sigBS = exportSignature sig
      theHash = keccak256ToByteString $ hash $ sigBS <> B.singleton theType <> theData
      theMsg = theHash <> sigBS <> B.singleton theType <> theData

  pubKey <- try $ A.select (A.Proxy @Point) (domain, udpPort, theMsg)
  case pubKey of
    Right Nothing -> return $ Left $ SomeException UDPTimeout
    Left x -> return $ Left x
    Right (Just x) -> return $ Right x
