{-# LANGUAGE OverloadedStrings #-}

module Blockchain.UDP (
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

import Network.Socket
import qualified Network.Socket.ByteString as NB

import Control.Exception
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import qualified Crypto.Hash.SHA3 as SHA3
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List.Split
import Data.Maybe
import qualified Data.Text as T
import Data.Time.Clock.POSIX
import qualified Network.Haskoin.Internals as H
import Numeric
import System.Endian
import System.Timeout
    
import qualified Blockchain.Colors as CL
import Blockchain.Data.Peer
import Blockchain.Data.RLP
import Blockchain.ExtendedECDSA
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.SHA
import Blockchain.Util

--import Debug.Trace

--I need to use two definitions of PubKey (internally they represent the same thing)
--The one in the Haskoin package allows me to recover signatures.
--The one in the crypto packages let me do AES encryption.
--At some point I have to convert from one PubKey to the other, this function
--lets me to that.
hPubKeyToPubKey::H.PubKey->Point
hPubKeyToPubKey pubKey =
  Point (fromIntegral x) (fromIntegral y)
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
    y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
    hPoint = H.pubKeyPoint pubKey

encrypt::H.PrvKey->Word256->H.SecretT IO ExtendedSignature
encrypt prvKey' theHash = do
  extSignMsg theHash prvKey'

data RawNodeDiscoveryPacket =
  RawNDPacket SHA ExtendedSignature Integer RLPObject deriving (Show)

data NodeDiscoveryPacket =
  Ping Integer Endpoint Endpoint Integer |
  Pong Endpoint Integer Integer |
  FindNeighbors NodeID Integer |
  Neighbors [Neighbor] Integer deriving (Show,Read,Eq)

instance Format NodeDiscoveryPacket where
    format (Ping _ from to _) = CL.blue "Ping" ++ " " ++ format from ++ " to: " ++ format to
    format (Pong to _ _) = CL.blue "Pong" ++ " to: " ++ format to
    format (FindNeighbors nodeID _) = CL.blue "FindNeighbors " ++ format nodeID
    format (Neighbors neighbors _) = CL.blue ("Neighbors") ++ ": \n" ++ unlines (map (("    " ++) . format) neighbors)

data IAddr = IPV4Addr HostAddress | IPV6Addr HostAddress6 deriving (Show, Read, Eq)

instance Format IAddr where
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
stringToIAddr::String->IAddr
stringToIAddr x | '.' `elem` x =
                    IPV4Addr $ a + (b `shift` 8) + (c `shift` 16) + (d `shift` 24)
  where [a,b,c,d] = map read $ splitOn "." x
stringToIAddr x = error $ "bad format in stringToIAddr: " ++ show x

instance RLPSerializable IAddr where
    rlpEncode (IPV4Addr x) = rlpEncode $ fromBE32 x
    rlpEncode x = error $ "case not yet covered for rlpEncode for IAddr: " ++ show x
    rlpDecode o@(RLPString s) | B.length s == 4 = IPV4Addr $ fromBE32 $ rlpDecode o
    rlpDecode o@(RLPString s) | B.length s == 16 = IPV6Addr $ (fromIntegral word128, fromIntegral $ word128 `shiftR` 32, fromIntegral $ word128 `shiftR` 64, fromIntegral $ word128 `shiftR` 96) --TODO- verify the order of this
                                                               where word128 = rlpDecode o::Word128
    rlpDecode (RLPString s) = stringToIAddr $ BC.unpack s  --what a mess!  Sometimes address is array of address bytes, sometimes a string representation of the address.  I need to figure this out someday
    rlpDecode x = error $ "bad type for rlpDecode for IAddr: " ++ show x

data Endpoint = Endpoint IAddr Word16 Word16 deriving (Show,Read,Eq)

instance Format Endpoint where
    format (Endpoint address udpPort tcpPort) = format address ++ ":" ++ show udpPort ++ "/" ++ show tcpPort
              
data Neighbor = Neighbor Endpoint NodeID deriving (Show,Read,Eq)

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
    rlpDecode (RLPArray [address, udpPort, tcpPort, nodeID]) = Neighbor (Endpoint (rlpDecode address) (rlpDecode udpPort) (rlpDecode tcpPort)) (rlpDecode nodeID)
    rlpDecode x = error $ "unsupported rlp in rlpDecode for Neighbor: " ++ show x


peerToNeighbor::PPeer->Neighbor
peerToNeighbor p =
  case pPeerPubkey p of
   Nothing -> error "You can't call peerToNeigbor on a peer that doesn't have a pubkey"
   Just pubKey ->
     Neighbor (Endpoint (stringToIAddr $ T.unpack $ pPeerIp p) (fromIntegral $ pPeerUdpPort p) (fromIntegral $ pPeerTcpPort p)) $ pointToNodeID pubKey

{-
rlpToNDPacket::Word8->RLPObject->NodeDiscoveryPacket
rlpToNDPacket 0x1 (RLPArray [protocolVersion, RLPArray [ ipFrom, udpPortFrom, tcpPortFrom], RLPArray [ipTo, udpPortTo, tcpPortTo], expiration]) =
    Ping (rlpDecode protocolVersion) (Endpoint (rlpDecode ipFrom) (fromInteger $ rlpDecode udpPortFrom) (fromInteger $ rlpDecode tcpPortFrom))
                                     (Endpoint (rlpDecode ipTo) (fromInteger $ rlpDecode udpPortTo) (fromInteger $ rlpDecode tcpPortTo))
                                     (rlpDecode expiration)
rlpToNDPacket 0x2 (RLPArray [ RLPArray [ ipFrom, udpPortFrom, tcpPortFrom ], replyToken, expiration]) = Pong (Endpoint (rlpDecode ipFrom)
                                                                       (fromInteger $ rlpDecode udpPortFrom)
                                                                       (fromInteger $ rlpDecode tcpPortFrom))
                                                                       (rlpDecode replyToken)
                                                                       (rlpDecode expiration)
--rlpToNDPacket 0x3 (RLPArray [target, expiration]) = FindNode (rlpDecode target) (fromInteger $ rlpDecode expiration)
--rlpToNDPacket 0x4 (RLPArray [ip, port, id', expiration]) = Neighbors (rlpDecode ip) (fromInteger $ rlpDecode port) (rlpDecode id') (rlpDecode expiration)
rlpToNDPacket v x = error $ "Missing case in rlpToNDPacket: " ++ show v ++ ", " ++ show x
-}

getHostAddress::SockAddr->IAddr
getHostAddress (SockAddrInet _ x) = IPV4Addr x
getHostAddress x = error $ "Unsupported case in sockAddrToHostAddr: " ++ show x

ndPacketToRLP::NodeDiscoveryPacket->(Word8, RLPObject)
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

--ndPacketToRLP x = error $ "Unsupported case in call to ndPacketToRLP: " ++ show x






--showPoint::H.Point->String
--showPoint (H.Point x y) = "Point 0x" ++ showHex x "" ++ " 0x" ++ showHex y ""


{-
showPubKey::H.PubKey->String
showPubKey (H.PubKey point) =
  "Point 0x" ++ showHex x "" ++ " 0x" ++ showHex y ""
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX point
    y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY point
  
showPubKey (H.PubKeyU _) = error "Missing case in showPubKey: PubKeyU"
-}  

dataToPacket::B.ByteString->(NodeDiscoveryPacket, H.PubKey)
dataToPacket msg =
    let r = bytesToWord256 $ B.unpack $ B.take 32 $ B.drop 32 $ msg
        s = bytesToWord256 $ B.unpack $ B.take 32 $ B.drop 64 msg
        v = head . B.unpack $ B.take 1 $ B.drop 96 msg
        yIsOdd = v == 1
        signature = ExtendedSignature (H.Signature (fromIntegral r) (fromIntegral s)) yIsOdd

        SHA messageHash = hash $ B.pack $ [theType] ++ B.unpack (rlpSerialize rlp)
        otherPubkey = fromMaybe (error "malformed signature in udpHandshakeServer") $ getPubKeyFromSignature signature messageHash
                    
        theType = head . B.unpack $ B.take 1$ B.drop 97 msg
        theRest = B.unpack $ B.drop 98 msg
        (rlp, _) = rlpSplit $ B.pack theRest
                   

    in (typeToPacket theType rlp, otherPubkey)
    where
      typeToPacket::Word8->RLPObject->NodeDiscoveryPacket
      typeToPacket 1 (RLPArray [version, from, to, timestamp]) = Ping (rlpDecode version) (rlpDecode from) (rlpDecode to) (rlpDecode timestamp)
      typeToPacket 2 (RLPArray [to, echo, timestamp]) = Pong (rlpDecode to) (rlpDecode echo) (rlpDecode timestamp)
      typeToPacket 3 (RLPArray [target, timestamp]) = FindNeighbors (rlpDecode target) (rlpDecode timestamp)
      typeToPacket 4 (RLPArray [RLPArray neighbors, timestamp]) = Neighbors (map rlpDecode neighbors) (rlpDecode timestamp)
      typeToPacket x y = error $ "Unsupported case called in typeToPacket: " ++ show x ++ ", " ++ show y
                                                                  
sendPacket::(MonadIO m, MonadLogger m)=>
            Socket->H.PrvKey->SockAddr->NodeDiscoveryPacket->m ()
sendPacket sock prv addr packet = do
  logInfoN $ T.pack $ CL.green ">>>>" ++ " (" ++ show addr ++ ") " ++ format packet
  let (theType', theRLP) = ndPacketToRLP packet

      theData = B.unpack $ rlpSerialize theRLP
      SHA theMsgHash = hash $ B.pack $ (theType':theData)

  ExtendedSignature signature' yIsOdd' <- liftIO $ H.withSource H.devURandom $ extSignMsg theMsgHash prv

  let v' = if yIsOdd' then 1 else 0
      r' = H.sigR signature'
      s' = H.sigS signature'
      theSignature = word256ToBytes (fromIntegral r') ++ word256ToBytes (fromIntegral s') ++ [v']
      theHash = B.unpack $ SHA3.hash 256 $ B.pack $ theSignature ++ [theType'] ++ theData
                                                                                                                      
  _ <- liftIO $ NB.sendTo sock ( B.pack $ theHash ++ theSignature ++ [theType'] ++ theData) addr

  return ()
         
                                                                  

processDataStream'::[Word8]->IO H.PubKey
processDataStream'
  (h1:h2:h3:h4:h5:h6:h7:h8:h9:h10:h11:h12:h13:h14:h15:h16:
   h17:h18:h19:h20:h21:h22:h23:h24:h25:h26:h27:h28:h29:h30:h31:h32:
   r1:r2:r3:r4:r5:r6:r7:r8:r9:r10:r11:r12:r13:r14:r15:r16:
   r17:r18:r19:r20:r21:r22:r23:r24:r25:r26:r27:r28:r29:r30:r31:r32:
   s1:s2:s3:s4:s5:s6:s7:s8:s9:s10:s11:s12:s13:s14:s15:s16:
   s17:s18:s19:s20:s21:s22:s23:s24:s25:s26:s27:s28:s29:s30:s31:s32:
   v:
   theType:rest) = do
  let theHash = bytesToWord256 [h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12,h13,h14,h15,h16,
                                h17,h18,h19,h20,h21,h22,h23,h24,h25,h26,h27,h28,h29,h30,h31,h32]
      r = bytesToWord256 [r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13,r14,r15,r16,
                          r17,r18,r19,r20,r21,r22,r23,r24,r25,r26,r27,r28,r29,r30,r31,r32]
      s = bytesToWord256 [s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,
                          s17,s18,s19,s20,s21,s22,s23,s24,s25,s26,s27,s28,s29,s30,s31,s32]
      yIsOdd = v == 1 -- 0x1c
      signature = ExtendedSignature (H.Signature (fromIntegral r) (fromIntegral s)) yIsOdd
    
  let (rlp, _) = rlpSplit $ B.pack rest

  let SHA messageHash = hash $ B.pack $ [theType] ++ B.unpack (rlpSerialize rlp)
      publicKey = getPubKeyFromSignature signature messageHash  
      SHA theHash' = hash $ B.pack $ word256ToBytes (fromIntegral r) ++ word256ToBytes (fromIntegral s) ++ [v] ++ [theType] ++ B.unpack (rlpSerialize rlp)
                  
  when (theHash /= theHash') $ error "bad UDP data sent from peer, the hash isn't correct"

  return $ fromMaybe (error "malformed signature in call to processDataStream") $ publicKey

processDataStream' _ = error "processDataStream' called with too few bytes"

newtype NodeID = NodeID B.ByteString deriving (Show, Read, Eq)

nodeIDToPoint::NodeID->Point
nodeIDToPoint (NodeID nodeID) | B.length nodeID /= 64 = error "NodeID contains a bytestring that is not 64 bytes long"
nodeIDToPoint (NodeID nodeID) = Point x y
    where
      x = byteString2Integer $ B.take 32 nodeID
      y = byteString2Integer $ B.drop 32 nodeID

pointToNodeID::Point->NodeID
pointToNodeID PointO = error "called pointToNodeID with PointO, we can't handle that yet"
pointToNodeID (Point x y) = NodeID $ B.pack $ word256ToBytes (fromInteger x) ++ word256ToBytes (fromInteger y)
                                                        
instance RLPSerializable NodeID where
  rlpEncode (NodeID x) = RLPString x
  rlpDecode (RLPString x) = NodeID x
  rlpDecode x = error $ "unsupported rlp in rlpDecode for NodeID: " ++ show x

instance Format NodeID where
  format (NodeID x) = BC.unpack (B16.encode $ B.take 10 x) ++ "...."



data UDPException = UDPTimeout deriving (Show)

instance Exception UDPException where
          
  
getServerPubKey::H.PrvKey->String->PortNumber->IO (Either SomeException Point)
getServerPubKey myPriv domain port = do
  withSocketsDo $ bracket getSocket close (talk myPriv)
    where
      getSocket = do
        (serveraddr:_) <- getAddrInfo Nothing (Just domain) (Just $ show port)
        s <- socket (addrFamily serveraddr) Datagram defaultProtocol
        _ <- connect s (addrAddress serveraddr)
        return s

      talk::H.PrvKey->Socket->IO (Either SomeException Point)
      talk prvKey' socket' = do
        timestamp <- fmap round getPOSIXTime
        let (theType, theRLP) =
              ndPacketToRLP $
              Ping 4 (Endpoint (stringToIAddr "127.0.0.1") (fromIntegral $ port) 30303) (Endpoint (stringToIAddr "127.0.0.1") (fromIntegral $ port) 30303) (timestamp+50)
            theData = B.unpack $ rlpSerialize theRLP
            SHA theMsgHash = hash $ B.pack $ (theType:theData)

        ExtendedSignature signature yIsOdd <-
          H.withSource H.devURandom $ encrypt prvKey' theMsgHash

        let v = if yIsOdd then 1 else 0 -- 0x1c else 0x1b
            r = H.sigR signature
            s = H.sigS signature
            theSignature =
              word256ToBytes (fromIntegral r) ++ word256ToBytes (fromIntegral s) ++ [v]
            theHash = B.unpack $ SHA3.hash 256 $ B.pack $ theSignature ++ [theType] ++ theData

        _ <- NB.send socket' $ B.pack $ theHash ++ theSignature ++ [theType] ++ theData

        --According to https://groups.google.com/forum/#!topic/haskell-cafe/aqaoEDt7auY, it looks like the only way we can time out UDP recv is to 
        --use the Haskell timeout....  I did try setting socket options also, but that didn't work.
        pubKey <- try (timeout 5000000 (NB.recv socket' 2000 >>= processDataStream' . B.unpack)) :: IO (Either SomeException (Maybe H.PubKey))

        case pubKey of
          Right Nothing -> return $ Left $ SomeException UDPTimeout
          Left x -> return $ Left x
          Right (Just x) -> return $ Right $ hPubKeyToPubKey x

findNeighbors::H.PrvKey->String->PortNumber->IO ()
findNeighbors myPriv domain port = do
  withSocketsDo $ bracket getSocket close (talk myPriv)
    where
      getSocket = do
        (serveraddr:_) <- getAddrInfo Nothing (Just domain) (Just $ show port)
        s <- socket (addrFamily serveraddr) Datagram defaultProtocol
        _ <- connect s (addrAddress serveraddr)
        return s

      talk::H.PrvKey->Socket->IO ()
      talk prvKey' socket' = do
        let (theType, theRLP) =
              ndPacketToRLP $
              FindNeighbors (NodeID $ fst $ B16.decode "eab4e595d178422cb8b31eddde2d6dda74ad16609693614a29a214d2b2f457a7c97a442e74e58afd1b16657c5c5908255a450d8a202e8d3b2b31c9b17e7221f3") 100000000000000000
            theData = B.unpack $ rlpSerialize theRLP
            SHA theMsgHash = hash $ B.pack $ (theType:theData)

        ExtendedSignature signature yIsOdd <-
          H.withSource H.devURandom $ encrypt prvKey' theMsgHash

        let v = if yIsOdd then 1 else 0 -- 0x1c else 0x1b
            r = H.sigR signature
            s = H.sigS signature
            theSignature =
              word256ToBytes (fromIntegral r) ++ word256ToBytes (fromIntegral s) ++ [v]
            theHash = B.unpack $ SHA3.hash 256 $ B.pack $ theSignature ++ [theType] ++ theData

        _ <- NB.send socket' $ B.pack $ theHash ++ theSignature ++ [theType] ++ theData

        _ <- NB.recv socket' 10 >>= print -- processDataStream' . B.unpack

        --return $ hPubKeyToPubKey pubKey

        return ()




