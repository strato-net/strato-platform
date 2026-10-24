{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}

module Blockchain.Strato.Discovery.UDP
  ( dataToPacket,
    sendPacket,
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

import           BlockApps.Logging
import           Blockchain.Data.RLP
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Discovery.P2PUtil   (DiscoverException (..))
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Host
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Control.Error                         (note)
import           Control.Monad                         (forM_)
import qualified Control.Monad.Change.Alter            as A
import           Control.Monad.Composable.Vault
import           Data.Binary
import           Data.Bits
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import           Data.List.Split
import           Data.Maybe
import qualified Data.Text                             as T
import           Network.Socket
import qualified Network.URI                           as URI
import           Numeric
import           System.Endian
import qualified Text.Colors                           as CL
import           Text.Format

data NodeDiscoveryPacket
  = Ping Integer Endpoint Endpoint Integer
  | -- | The last field is the sender's TCP port, which nodes from before it
    -- was added neither send nor accept.
    Pong Endpoint Integer Integer (Maybe TCPPort)
  | FindNeighbors NodeID Integer
  | Neighbors [Neighbor] Integer
  deriving (Show, Read, Eq)

instance Format NodeDiscoveryPacket where
  format (Ping _ from to _) = CL.blue "Ping" ++ " " ++ format from ++ " to: " ++ format to
  format (Pong to _ _ senderTcpPort) = CL.blue "Pong" ++ " to: " ++ format to ++ maybe "" (\(TCPPort p) -> " tcp: " ++ show p) senderTcpPort
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
  rlpEncode (HostName s) = rlpEncode (B.pack [255, 255, 255, 255] `B.append` BC.pack s)
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
          (stringToIAddr $ hostToString $ pPeerHost p)
          (UDPPort . fromIntegral $ pPeerUdpPort p)
          (TCPPort . fromIntegral $ pPeerTcpPort p)
  return $ Neighbor endpoint $ pointToNodeID pubKey

getHostAddress :: SockAddr -> Either DiscoverException IAddr
getHostAddress (SockAddrInet _ x) = Right $ IPV4Addr x
getHostAddress (SockAddrInet6 _ _ x _) = Right $ IPV6Addr x
getHostAddress (SockAddrUnix x) = Left $ IPFormatException $ "Unix socket unsupported in sockAddrToHostAddr: " ++ show x

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
ndPacketToRLP (Pong (Endpoint ipFrom (UDPPort udpPortFrom) (TCPPort tcpPortFrom)) tok expiration senderTcpPort) =
  ( 2,
    RLPArray $
      [ RLPArray
          [ rlpEncode ipFrom,
            rlpEncode $ toInteger udpPortFrom,
            rlpEncode $ toInteger tcpPortFrom
          ],
        rlpEncode tok,
        rlpEncode expiration
      ]
        ++ [rlpEncode $ toInteger p | Just (TCPPort p) <- [senderTcpPort]]
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
    typeToPacket 2 (RLPArray (to : echo : timestamp : rest)) =
      Right $ Pong (rlpDecode to) (rlpDecode echo) (rlpDecode timestamp) (TCPPort . fromInteger . rlpDecode <$> listToMaybe rest)
    typeToPacket 3 (RLPArray [target, timestamp]) = Right $ FindNeighbors (rlpDecode target) (rlpDecode timestamp)
    typeToPacket 4 (RLPArray [RLPArray neighbors, timestamp]) = Right $ Neighbors (map rlpDecode neighbors) (rlpDecode timestamp)
    typeToPacket x y = Left $ MalformedUDPException $ "Unsupported case called in typeToPacket: " ++ show x ++ ", " ++ show y

sendPacket ::
  ( HasVault m
  , MonadLogger m
  , A.Replaceable SockAddr B.ByteString m
  , HasPeerDB m
  , A.Selectable (Maybe Host, UDPPort) SockAddr m ) =>
  PPeer ->
  NodeDiscoveryPacket ->
  m ()
sendPacket thePeer packet = do
  mPeerAddr <- A.select (A.Proxy @SockAddr) (Just $ pPeerHost thePeer, UDPPort . fromIntegral $ pPeerUdpPort thePeer)
  forM_ mPeerAddr $ \addr -> do
    let ip = addressIP addr
    updateIP thePeer ip
    $logInfoS "sendPacket" $ T.pack $ CL.green "sending to" ++ " (" ++ show addr ++ ") " ++ format packet
    let (theType', theRLP) = ndPacketToRLP packet
        theData = rlpSerialize theRLP
        theMsgHash = keccak256ToByteString $ hash $ B.singleton theType' <> theData

    sig <- sign theMsgHash
    let sigBS = exportSignature sig
        theHash = keccak256ToByteString $ hash $ sigBS <> B.singleton theType' <> theData

    A.replace (A.Proxy @B.ByteString) addr $ theHash <> sigBS <> B.singleton theType' <> theData
  updateLastMessage thePeer $
    case packet of
       Ping{}          -> "Ping"
       Pong{}          -> "Pong"
       FindNeighbors{} -> "FindNeighbors"
       Neighbors{}     -> "Neighbors"

