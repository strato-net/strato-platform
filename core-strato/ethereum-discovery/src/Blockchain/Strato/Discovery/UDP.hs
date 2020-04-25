{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.Strato.Discovery.UDP (
  dataToPacket,
  sendPacket,
  getServerPubKey,
  findNeighbors,
  ndPacketToRLP,
  NodeDiscoveryPacket(..),
  Endpoint(..),
  Neighbor(..),
  peerToNeighbor,
  NodeID(..),
  nodeIDToPoint,
  pointToNodeID,
  IAddr(..),
  stringToIAddr,
  getHostAddress
  ) where

import           Network.Socket
import qualified Network.Socket.ByteString             as NB

import           Control.Error                         (fmapL, note)
import           Control.Exception
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Crypto.Types.PubKey.ECC
import           Data.Binary
import           Data.Bits
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as BC
import           Data.List.Split
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Time.Clock.POSIX
import qualified Network.Haskoin.Internals             as H
import qualified Network.URI                           as URI
import           Numeric
import           System.Endian
import           System.Timeout

import           Blockchain.Data.RLP
import           Blockchain.ExtendedECDSA
import           Blockchain.ExtWord
import           Blockchain.Strato.Discovery.P2PUtil   (DiscoverException (..), hPubKeyToPubKey)
import           Blockchain.Strato.Model.SHA           
import           Blockchain.Util

import           Blockchain.Strato.Discovery.Data.Peer
import qualified Text.Colors                           as CL
import           Text.Format

encrypt :: H.PrvKey -> Word256 -> H.SecretT IO ExtendedSignature
encrypt = flip extSignMsg

data RawNodeDiscoveryPacket =
  RawNDPacket SHA ExtendedSignature Integer RLPObject deriving (Show)

data NodeDiscoveryPacket =
  Ping Integer Endpoint Endpoint Integer |
  Pong Endpoint Integer Integer |
  FindNeighbors NodeID Integer |
  Neighbors [Neighbor] Integer deriving (Show,Read,Eq)

instance Format NodeDiscoveryPacket where
  format (Ping _ from to _)       = CL.blue "Ping" ++ " " ++ format from ++ " to: " ++ format to
  format (Pong to _ _)            = CL.blue "Pong" ++ " to: " ++ format to
  format (FindNeighbors nodeID _) = CL.blue "FindNeighbors " ++ format nodeID
  format (Neighbors neighbors _)  = CL.blue "Neighbors" ++ ": \n" ++ unlines (map (("    " ++) . format) neighbors)

data IAddr = HostName String
           | IPV4Addr HostAddress
           | IPV6Addr HostAddress6
           deriving (Show, Read, Eq)

instance Format IAddr where
  format (HostName hostName) = hostName

  format (IPV4Addr x) =
    show (fromIntegral x::Word8) ++ "." ++
    show (fromIntegral $ x `shiftR` 8::Word8) ++ "." ++
    show (fromIntegral $ x `shiftR` 16::Word8) ++ "." ++
    show (fromIntegral $ x `shiftR` 24::Word8)

  format (IPV6Addr (v1, v2, v3, v4)) =
      showHex (fromIntegral $ v4 `shiftR` 16::Word16) "" ++ ":" ++
      showHex (fromIntegral v4::Word16) "" ++ ":" ++
      showHex (fromIntegral $ v3 `shiftR` 16::Word16) "" ++ ":" ++
      showHex (fromIntegral v3::Word16) "" ++ ":" ++
      showHex (fromIntegral $ v2 `shiftR` 16::Word16) "" ++ ":" ++
      showHex (fromIntegral v2::Word16) "" ++ ":" ++
      showHex (fromIntegral $ v1 `shiftR` 16::Word16) "" ++ ":" ++
      showHex (fromIntegral v1::Word16) ""

-- odd that this doesn't exist, but so says reddit- https://www.reddit.com/r/haskellquestions/comments/331lot/simple_preferably_pure_way_to_create_hostaddress/
stringToIAddr :: String -> IAddr
stringToIAddr x
    | URI.isIPv4address x = case map read $ splitOn "." x of
        [a,b,c,d] -> IPV4Addr $ a + (b `shift` 8) + (c `shift` 16) + (d `shift` 24)
        _         -> error $ "Invalid IPV4: " ++ x
    | URI.isIPv6address x = case map (read . ("0x" ++)) $ splitOn ":" x of
        [a,b,c,d,e,f,g,h] -> IPV6Addr $ tupleToHostAddress6 (a,b,c,d,e,f,g,h)
        _                 -> error $ "Invalid IPV6: " ++ x
    | otherwise = HostName x

instance RLPSerializable IAddr where
  rlpEncode (IPV4Addr x)   = rlpEncode $ fromBE32 x
  rlpEncode x@(IPV6Addr _) = error $ "case not yet covered for rlpEncode for IPV6: " ++ format x
  rlpEncode (HostName s)   = rlpEncode $ (B.pack [255, 255, 255, 255] `B.append` BC.pack s)
  rlpDecode o@(RLPString s)
      | B.length s == 4 = IPV4Addr $ fromBE32 $ rlpDecode o
      --TODO- verify the order of this
      | B.length s == 16 = IPV6Addr (fromIntegral word128, fromIntegral $ word128 `shiftR` 32, fromIntegral $ word128 `shiftR` 64, fromIntegral $ word128 `shiftR` 96)
      | B.pack [255, 255, 255, 255] `B.isPrefixOf` s = stringToIAddr . BC.unpack $ B.drop 4 s
      --what a mess!  Sometimes address is array of address bytes, sometimes a string representation of the address.  I need to figure this out someday
      | otherwise = stringToIAddr $ BC.unpack s
    where word128 = rlpDecode o::Word128
  rlpDecode x = error $ "bad type for rlpDecode for IAddr: " ++ show x

data Endpoint = Endpoint IAddr Word16 Word16 deriving (Show, Read, Eq)

instance Format Endpoint where
  format (Endpoint address udpPort tcpPort) = format address ++ ":" ++ show udpPort ++ "/" ++ show tcpPort

data Neighbor = Neighbor Endpoint NodeID deriving (Show, Read, Eq)

instance Format Neighbor where
  format (Neighbor endpoint nodeID) = format endpoint ++ ", " ++ format nodeID

instance RLPSerializable Endpoint where
    rlpEncode (Endpoint address udpPort tcpPort) = RLPArray [rlpEncode address, rlpEncode udpPort, rlpEncode tcpPort]
--    rlpDecode (RLPArray [address, udpPort, tcpPort]) = Endpoint (stringToIAddr $ rlpDecode address) (rlpDecode udpPort) (rlpDecode tcpPort)
    rlpDecode (RLPArray [address, udpPort, tcpPort]) = Endpoint (rlpDecode address) (rlpDecode udpPort) (rlpDecode tcpPort)
    rlpDecode x = error $ "unsupported rlp in rlpDecode for Endpoint: " ++ show x

instance RLPSerializable Neighbor where
  rlpEncode (Neighbor (Endpoint address udpPort tcpPort) nodeID) =
    RLPArray [rlpEncode address, rlpEncode udpPort, rlpEncode tcpPort, rlpEncode nodeID]
  rlpDecode (RLPArray [address, udpPort, tcpPort, nodeID]) =
    Neighbor (Endpoint (rlpDecode address) (rlpDecode udpPort) (rlpDecode tcpPort)) (rlpDecode nodeID)
  rlpDecode x = error $ "unsupported rlp in rlpDecode for Neighbor: " ++ show x

peerToNeighbor :: PPeer -> Either DiscoverException Neighbor
peerToNeighbor p' = do
  -- TODO(tim): Reenable port selection
  let p = p'{pPeerUdpPort=30303, pPeerTcpPort=30303}
  pubKey <- note NoPublicKeyException (pPeerPubkey p)
  let endpoint = Endpoint (stringToIAddr $ T.unpack $ pPeerIp p)
                          (fromIntegral $ pPeerUdpPort p)
                          (fromIntegral $ pPeerTcpPort p)
  return $ Neighbor endpoint $ pointToNodeID pubKey

getHostAddress :: SockAddr -> Either DiscoverException IAddr
getHostAddress (SockAddrInet _ x) = Right $ IPV4Addr x
getHostAddress x                  = Left $ IPFormatException $ "Unsupported case in sockAddrToHostAddr: " ++ show x

ndPacketToRLP :: NodeDiscoveryPacket -> (Word8, RLPObject)
ndPacketToRLP (Ping ver (Endpoint ipFrom udpPortFrom tcpPortFrom) (Endpoint ipTo udpPortTo tcpPortTo) expiration) =
  (1, RLPArray [rlpEncode ver,
                RLPArray [
                rlpEncode ipFrom,
                rlpEncode $ toInteger udpPortFrom,
                rlpEncode $ toInteger tcpPortFrom],
                RLPArray [
                rlpEncode ipTo,
                rlpEncode $ toInteger udpPortTo,
                rlpEncode $ toInteger tcpPortTo],
                rlpEncode expiration])
ndPacketToRLP (Pong (Endpoint ipFrom udpPortFrom tcpPortFrom) tok expiration) = (2, RLPArray [RLPArray [ rlpEncode ipFrom,
                                                                                                         rlpEncode $ toInteger udpPortFrom,
                                                                                                         rlpEncode $ toInteger tcpPortFrom],
                                                                                                         rlpEncode tok,
                                                                                                         rlpEncode expiration])
ndPacketToRLP (FindNeighbors target expiration) = (3, RLPArray [rlpEncode target, rlpEncode expiration])
ndPacketToRLP (Neighbors neighbors expiration) = (4, RLPArray [RLPArray $ map rlpEncode neighbors, rlpEncode expiration])


dataToPacket :: B.ByteString -> Either DiscoverException (NodeDiscoveryPacket, H.PubKey)
dataToPacket msg = do
    let r = bytesToWord256 $ B.take 32 $ B.drop 32 msg
        s = bytesToWord256 $ B.take 32 $ B.drop 64 msg
    v <- note (ByteStringLengthException $ show msg) $ listToMaybe . B.unpack $ B.take 1 $ B.drop 96 msg
    let yIsOdd = v == 1
        signature = ExtendedSignature (H.Signature (fromIntegral r) (fromIntegral s)) yIsOdd
        theRest = B.unpack $ B.drop 98 msg
        (rlp, _) = rlpSplit $ B.pack theRest
    theType <- note (ByteStringLengthException $ show msg) $ listToMaybe . B.unpack $ B.take 1 $ B.drop 97 msg
    let SHA messageHash = hash $ B.pack $ theType : B.unpack (rlpSerialize rlp)
    otherPubkey <- note (MalformedUDPException $ "malformed signature in udpHandshakeServer: " ++ show (signature, messageHash))
                        (getPubKeyFromSignature signature messageHash)
    packet <- typeToPacket theType rlp
    return (packet, otherPubkey)
  where
    typeToPacket:: Word8 -> RLPObject -> Either DiscoverException NodeDiscoveryPacket
    typeToPacket 1 (RLPArray [version, from, to, timestamp]) = Right $ Ping (rlpDecode version) (rlpDecode from) (rlpDecode to) (rlpDecode timestamp)
    typeToPacket 2 (RLPArray [to, echo, timestamp]) = Right $ Pong (rlpDecode to) (rlpDecode echo) (rlpDecode timestamp)
    typeToPacket 3 (RLPArray [target, timestamp]) = Right $ FindNeighbors (rlpDecode target) (rlpDecode timestamp)
    typeToPacket 4 (RLPArray [RLPArray neighbors, timestamp]) = Right $ Neighbors (map rlpDecode neighbors) (rlpDecode timestamp)
    typeToPacket x y = Left $ MalformedUDPException $ "Unsupported case called in typeToPacket: " ++ show x ++ ", " ++ show y

sendPacket :: (MonadIO m, MonadLogger m)
           => Socket
           -> H.PrvKey
           -> SockAddr
           -> NodeDiscoveryPacket
           -> m ()
sendPacket sock prv addr packet = do
  $logInfoS "sendPacket" $ T.pack $ CL.green "sending to" ++ " (" ++ show addr ++ ") " ++ format packet
  let (theType', theRLP) = ndPacketToRLP packet
      theData = rlpSerialize theRLP
      SHA theMsgHash = hash $ B.singleton theType' <> theData

  ExtendedSignature signature' yIsOdd' <- liftIO $ H.withSource H.devURandom $ extSignMsg theMsgHash prv

  let v' = if yIsOdd' then 1 else 0
      r' = H.sigR signature'
      s' = H.sigS signature'
      theSignature = word256ToBytes (fromIntegral r') <> word256ToBytes (fromIntegral s') <> B.singleton v'
      theHash = keccak256 $ theSignature <> B.singleton theType' <> theData

  _ <- liftIO $ NB.sendTo sock ( theHash <> theSignature <> B.singleton theType' <> theData) addr
  return ()

processDataStream'::B.ByteString-> H.PubKey
processDataStream' bs | B.length bs < 98 = error "processDataStream' called with too few bytes"
processDataStream' bs =
  let (hs, bs') = B.splitAt 32 bs
      (rs, bs'') = B.splitAt 32 bs'
      (ss, bs''') = B.splitAt 32 bs''
      (vtype, rest) = B.splitAt 2 bs'''
      v = B.index vtype 0
      theType = B.index vtype 1
      theHash = bytesToWord256 hs
      r = bytesToWord256 rs
      s = bytesToWord256 ss
      yIsOdd = v == 1 -- 0x1c
      signature = ExtendedSignature (H.Signature (fromIntegral r) (fromIntegral s)) yIsOdd

      (rlp, _) = rlpSplit rest

      SHA messageHash = hash $ B.singleton theType <> rlpSerialize rlp
      publicKey = getPubKeyFromSignature signature messageHash
      SHA theHash' = hash $ word256ToBytes (fromIntegral r) <> word256ToBytes (fromIntegral s)
                         <> B.singleton v <> B.singleton theType <> rlpSerialize rlp
  in if theHash /= theHash'
    then error "bad UDP data sent from peer, the hash isn't correct"
    else fromMaybe (error "malformed signature in call to processDataStream") publicKey

newtype NodeID = NodeID B.ByteString deriving (Show, Read, Eq)

nodeIDToPoint::NodeID->Point
nodeIDToPoint (NodeID nodeID) | B.length nodeID /= 64 = error "NodeID contains a bytestring that is not 64 bytes long"
nodeIDToPoint (NodeID nodeID) = Point x y
    where
      x = byteString2Integer $ B.take 32 nodeID
      y = byteString2Integer $ B.drop 32 nodeID

pointToNodeID::Point->NodeID
pointToNodeID PointO      = error "called pointToNodeID with PointO, we can't handle that yet"
pointToNodeID (Point x y) = NodeID $ word256ToBytes (fromInteger x) <> word256ToBytes (fromInteger y)

instance RLPSerializable NodeID where
  rlpEncode (NodeID x) = RLPString x
  rlpDecode (RLPString x) = NodeID x
  rlpDecode x             = error $ "unsupported rlp in rlpDecode for NodeID: " ++ show x

instance Format NodeID where
  format (NodeID x) = BC.unpack (B16.encode $ B.take 10 x) ++ "...."



data UDPException = UDPTimeout deriving (Show)

instance Exception UDPException where

getSocket :: HostName -> PortNumber -> IO Socket
getSocket domain _ = do
  -- TODO(tim): Reenable port selection
  let port = 30303 :: Int
  (serveraddr:_) <- getAddrInfo Nothing (Just domain) (Just $ show port)
  s <- socket (addrFamily serveraddr) Datagram defaultProtocol
  _ <- connect s (addrAddress serveraddr)
  return s

getServerPubKey :: H.PrvKey -> String -> PortNumber -> IO (Either SomeException Point)
getServerPubKey myPriv domain _ =
    withSocketsDo $ bracket (getSocket domain port) close (talk myPriv)
  where
    -- TODO(tim): Reenable port selection
    port = 30303
    talk :: H.PrvKey -> Socket -> IO (Either SomeException Point)
    talk prvKey' socket' = do
      timestamp <- fmap round getPOSIXTime
      let (theType, theRLP) =
            ndPacketToRLP $
            Ping 4 (Endpoint (stringToIAddr "127.0.0.1") (fromIntegral port) 30303) (Endpoint (stringToIAddr "127.0.0.1") (fromIntegral port) 30303) (timestamp + 50)
          theData = rlpSerialize theRLP
          SHA theMsgHash = hash $ B.singleton theType <> theData

      ExtendedSignature signature yIsOdd <- H.withSource H.devURandom $ encrypt prvKey' theMsgHash

      let v = if yIsOdd then 1 else 0 -- 0x1c else 0x1b
          r = H.sigR signature
          s = H.sigS signature
          theSignature =
            word256ToBytes (fromIntegral r) <> word256ToBytes (fromIntegral s) <> B.singleton v
          theHash = keccak256 $ theSignature <> B.singleton theType <> theData

      _ <- NB.send socket' $ theHash <> theSignature <> B.singleton theType <> theData

      --According to https://groups.google.com/forum/#!topic/haskell-cafe/aqaoEDt7auY, it looks like the only way we can time out UDP recv is to
      --use the Haskell timeout....  I did try setting socket options also, but that didn't work.
      pubKey <- try (timeout 5000000 . fmap processDataStream' $ NB.recv socket' 2000) :: IO (Either SomeException (Maybe H.PubKey))

      case pubKey of
        Right Nothing  -> return $ Left $ SomeException UDPTimeout
        Left x         -> return $ Left x
        Right (Just x) -> return $ fmapL SomeException $ hPubKeyToPubKey x

findNeighbors::H.PrvKey -> String -> PortNumber -> IO ()
findNeighbors myPriv domain _ =
    withSocketsDo $ bracket (getSocket domain port) close (talk myPriv)
  where
    -- TODO(tim): Reenable port selection
    port = 30303
    talk :: H.PrvKey -> Socket -> IO ()
    talk prvKey' socket' = do
      let (theType, theRLP) =
            ndPacketToRLP $
            FindNeighbors (NodeID $ fst $ B16.decode "eab4e595d178422cb8b31eddde2d6dda74ad16609693614a29a214d2b2f457a7c97a442e74e58afd1b16657c5c5908255a450d8a202e8d3b2b31c9b17e7221f3") 100000000000000000
          theData = rlpSerialize theRLP
          SHA theMsgHash = hash $ B.singleton theType <> theData

      ExtendedSignature signature yIsOdd <-
        H.withSource H.devURandom $ encrypt prvKey' theMsgHash

      let v = if yIsOdd then 1 else 0 -- 0x1c else 0x1b
          r = H.sigR signature
          s = H.sigS signature
          theSignature =
            word256ToBytes (fromIntegral r) <> word256ToBytes (fromIntegral s) <> B.singleton v
          theHash = keccak256 $ theSignature <> B.singleton theType <> theData

      _ <- NB.send socket' $ theHash <> theSignature <> B.singleton theType <> theData

      _ <- NB.recv socket' 10 >>= print -- processDataStream' . B.unpack
      return ()
