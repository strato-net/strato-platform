{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -fno-warn-incomplete-uni-patterns #-}

module Blockchain.Data.Wire
  ( Message (..),
    TerminationReason (..),
    BlockHashOrNumber (..),
    Direction (..),
    Capability (..),
    TransactionRequest (..),
    obj2WireMessage,
    wireMessage2Obj,
  )
where

import qualified Blockchain.Blockstanbul as PBFT
import Blockchain.Data.Block (Block)
import Blockchain.Data.BlockHeader
import Blockchain.Data.ChainInfo
import Blockchain.Data.PubKey ()
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Database.MerklePatricia.NodeData (NodeData)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.StateRoot
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import Data.List
import Data.Word
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

data Capability
  = ETH Integer
  | -- | Base Ethereum P2P protocol
    IST Integer
  | -- | Istanbul/Blockstanbul/PBFT messages.
    UNKNOWNCAP String Integer -- ¯\_(ツ)_/¯
  deriving (Eq, Read, Show)

name2Cap :: Integer -> String -> Capability
name2Cap ver "eth" = ETH ver
-- TODO(tim): This deviates from the Am.is implementation, but they don't
-- follow the devp2p spec. Change to "istanbul" or convince them to change to
-- "ist" if we require interop.
name2Cap ver "ist" = IST ver
name2Cap ver name = UNKNOWNCAP name ver

instance RLPSerializable Capability where
  rlpEncode (ETH ver) = RLPArray [rlpEncode ("eth" :: B.ByteString), rlpEncode ver]
  rlpEncode (IST ver) = RLPArray [rlpEncode ("ist" :: B.ByteString), rlpEncode ver]
  rlpEncode (UNKNOWNCAP name ver) = RLPArray [rlpEncode name, rlpEncode ver]

  rlpDecode (RLPArray [name, ver]) = name2Cap (rlpDecode ver) $ rlpDecode name
  rlpDecode x = error $ "wrong format given to rlpDecode for Capability: " ++ format x

data TerminationReason
  = DisconnectRequested
  | TCPSubSystemError
  | BreachOfProtocol
  | UselessPeer
  | TooManyPeers
  | AlreadyConnected
  | IncompatibleP2PProtocolVersion
  | NullNodeIdentityReceived
  | ClientQuitting
  | UnexpectedIdentity
  | ConnectedToSelf
  | PingTimeout
  | OtherSubprotocolReason
  deriving (Eq, Read, Show)

numberToTerminationReason :: Integer -> TerminationReason
numberToTerminationReason 0x00 = DisconnectRequested
numberToTerminationReason 0x01 = TCPSubSystemError
numberToTerminationReason 0x02 = BreachOfProtocol
numberToTerminationReason 0x03 = UselessPeer
numberToTerminationReason 0x04 = TooManyPeers
numberToTerminationReason 0x05 = AlreadyConnected
numberToTerminationReason 0x06 = IncompatibleP2PProtocolVersion
numberToTerminationReason 0x07 = NullNodeIdentityReceived
numberToTerminationReason 0x08 = ClientQuitting
numberToTerminationReason 0x09 = UnexpectedIdentity
numberToTerminationReason 0x0a = ConnectedToSelf
numberToTerminationReason 0x0b = PingTimeout
numberToTerminationReason 0x10 = OtherSubprotocolReason
numberToTerminationReason x = error $ "numberToTerminationReasion called with unsupported number: " ++ show x

terminationReasonToNumber :: TerminationReason -> Integer
terminationReasonToNumber DisconnectRequested = 0x00
terminationReasonToNumber TCPSubSystemError = 0x01
terminationReasonToNumber BreachOfProtocol = 0x02
terminationReasonToNumber UselessPeer = 0x03
terminationReasonToNumber TooManyPeers = 0x04
terminationReasonToNumber AlreadyConnected = 0x05
terminationReasonToNumber IncompatibleP2PProtocolVersion = 0x06
terminationReasonToNumber NullNodeIdentityReceived = 0x07
terminationReasonToNumber ClientQuitting = 0x08
terminationReasonToNumber UnexpectedIdentity = 0x09
terminationReasonToNumber ConnectedToSelf = 0x0a
terminationReasonToNumber PingTimeout = 0x0b
terminationReasonToNumber OtherSubprotocolReason = 0x10

data BlockHashOrNumber = BlockHash Keccak256 | BlockNumber Integer deriving (Eq, Show)

instance Format BlockHashOrNumber where
  format (BlockHash x) = format x
  format (BlockNumber x) = "Number: " ++ show x

instance RLPSerializable BlockHashOrNumber where
  rlpEncode (BlockHash x) = rlpEncode x
  rlpEncode (BlockNumber x) = rlpEncode $ toInteger x
  rlpDecode val@(RLPString s) | B.length s == 32 = BlockHash $ rlpDecode val
  rlpDecode val = BlockNumber $ fromInteger $ rlpDecode val

data Direction = Forward | Reverse deriving (Eq, Show)

instance RLPSerializable Direction where
  rlpEncode Forward = rlpEncode (0 :: Integer)
  rlpEncode Reverse = rlpEncode (1 :: Integer)
  rlpDecode x | rlpDecode x == (0 :: Integer) = Forward
  rlpDecode _ = Reverse

data TransactionRequest
  = Explicit [Keccak256]
  | Implicit
      { trTransactionHash :: Keccak256,
        trMaxTransactions :: Int,
        trSkip :: Int,
        trDirection :: Direction
      }
  deriving (Eq, Show)

instance RLPSerializable TransactionRequest where
  rlpEncode (Explicit x) =
    RLPArray $ [(rlpEncode (0 :: Integer))] ++ (rlpEncode <$> x)
  rlpEncode (Implicit a b c d) =
    RLPArray $
      [(rlpEncode (1 :: Integer))]
        ++ [rlpEncode a, rlpEncode $ toInteger b, rlpEncode $ toInteger c, rlpEncode d]

  rlpDecode (RLPArray (x : xs))
    | (rlpDecode x) == (0 :: Integer) = Explicit $ rlpDecode <$> xs
    | (rlpDecode x) == (1 :: Integer) =
      Implicit
        { trTransactionHash = rlpDecode a,
          trMaxTransactions = fromInteger $ rlpDecode b,
          trSkip = fromInteger $ rlpDecode c,
          trDirection = rlpDecode d
        }
    where
      a = xs !! 0
      b = xs !! 1
      c = xs !! 2
      d = xs !! 3
  rlpDecode _ = error "Error in rlpDecode for TransactionRequest: bad RLPObject"

data Message
  = --p2p wire protocol
    Hello
      { version :: Int,
        clientId :: String,
        capability :: [Capability],
        port :: Int,
        nodeId :: Point
      }
  | Disconnect TerminationReason
  | Ping
  | Pong
  | --ethereum wire protocol
    Status
      { protocolVersion :: Int,
        networkID :: Integer,
        highestBlockNum :: Integer,
        latestHash :: Keccak256,
        genesisHash :: Keccak256
      }
  | NewBlockHashes [(Keccak256, Int)]
  | Transactions [Transaction]
  | GetBlockHeaders {block :: BlockHashOrNumber, maxHeaders :: Int, skip :: Int, direction :: Direction}
  | BlockHeaders [BlockHeader]
  | GetBlockBodies [Keccak256]
  | BlockBodies [([Transaction], [BlockHeader])]
  | NewBlock Block Integer
  | Blockstanbul PBFT.WireMessage
  | -- private chains
    GetChainDetails [Word256]
  | ChainDetails [(Word256, ChainInfo)]
  | GetTransactions [Keccak256]
  | GetMPNodes [StateRoot]
  | MPNodes [NodeData]
  deriving (Eq, Show)

instance Format Message where
  format Hello {version = ver, clientId = c, capability = cap, port = p, nodeId = n} =
    CL.blue "Hello"
      ++ "    version: "
      ++ show ver
      ++ "\n"
      ++ "    cliendId: "
      ++ show c
      ++ "\n"
      ++ "    capability: "
      ++ intercalate ", " (show <$> cap)
      ++ "\n"
      ++ "    port: "
      ++ show p
      ++ "\n"
      ++ "    nodeId: "
      ++ take 20 (format n)
      ++ "...."
  format (Disconnect reason) = CL.blue "Disconnect" ++ "(" ++ show reason ++ ")"
  format Ping = CL.blue "Ping"
  format Pong = CL.blue "Pong"
  --ethereum wire protocol
  format Status {..} =
    CL.blue "Status"
      ++ "    protocolVersion: "
      ++ show protocolVersion
      ++ "\n"
      ++ "    networkID: "
      ++ show networkID
      ++ "\n"
      ++ "    totalDifficulty: "
      ++ show highestBlockNum
      ++ "\n"
      ++ "    latestHash: "
      ++ format latestHash
      ++ "\n"
      ++ "    genesisHash: "
      ++ format genesisHash
  format (NewBlockHashes items) = CL.blue "NewBlockHashes" ++ tab ("\n" ++ intercalate "\n    " ((\(hash', number') -> "(" ++ format hash' ++ ", " ++ show number' ++ ")") <$> items))
  format (Transactions transactions) =
    CL.blue "Transactions:\n    " ++ tab' (intercalate "\n    " (format <$> transactions))
  format (GetBlockHeaders b max' skip' direction') =
    CL.blue "GetBlockHeaders" ++ " (max: " ++ show max' ++ ", " ++ show direction' ++ ", skip " ++ show skip' ++ "): "
      ++ format b
  format (BlockHeaders headers) =
    CL.blue "BlockHeaders:"
      ++ tab' ("\n" ++ unlines (format <$> headers))
  format (GetBlockBodies hashes) =
    CL.blue "GetBlockBodies" ++ " (" ++ show (length hashes) ++ " hashes):"
      ++ tab' ("\n" ++ unlines (format <$> hashes))
  format (BlockBodies bodies) =
    CL.blue "BlockBodies:"
      ++ tab' ("\n" ++ unlines (formatBody <$> bodies))
    where
      formatBody (transactions, uncles) = "BlockBody:" ++ tab' (formatTransactions transactions ++ formatUncles uncles)
      formatTransactions [] = "No transactions, "
      formatTransactions transactions = "\nTransactions:" ++ tab' ("\n" ++ unlines (map format transactions))
      formatUncles [] = "No uncles"
      formatUncles uncles = "\nUncles:" ++ tab' ("\n" ++ unlines (map format uncles))
  format (NewBlock b d) = CL.blue "NewBlock (" ++ show d ++ "):" ++ tab ("\n" ++ format b)
  format (Blockstanbul msg) = CL.blue "Blockstanbul\n" ++ "  msg: " ++ PBFT.shortFormat msg
  -- private chains
  format (GetChainDetails cids) = CL.blue "GetChainDetails\n" ++ "  for chainIDs: " ++ (intercalate "\n" (show <$> cids))
  format (ChainDetails chPairs) =
    CL.blue "Chain Details\n" ++ formatPairs chPairs
    where
      formatPairs :: [(Word256, ChainInfo)] -> String
      formatPairs [] = ""
      formatPairs ((chID, chInfo) : xs) =
        "\n  chainID: " ++ show chID
          ++ "\n  chainInfo: "
          ++ show chInfo
          ++ formatPairs xs
  format (GetTransactions txHashes) =
    CL.blue "GetTransactions\n" ++ "requested transaction hashes: " ++ (intercalate "\n" (show <$> txHashes))
  format (GetMPNodes mpNodes) =
    CL.blue "GetMPNodes\n" ++ "requested MP nodes: " ++ (intercalate "\n" (format <$> mpNodes))
  format (MPNodes mpNodes) =
    CL.blue "MPNodes\n" ++ "received MP nodes: " ++ (intercalate "\n" (format <$> mpNodes))

--format x = error $ "missing value in format for Wire Message: " ++ show x

-- Convert RLPObject and message code into corresponding Message
obj2WireMessage :: Word8 -> RLPObject -> Message
obj2WireMessage 0x0 (RLPArray [ver, cId, RLPArray cap, p, nId]) =
  Hello (fromInteger $ rlpDecode ver) (rlpDecode cId) (rlpDecode <$> cap) (fromInteger $ rlpDecode p) (rlpDecode nId)
obj2WireMessage 0x1 (RLPArray [reason]) =
  Disconnect (numberToTerminationReason $ rlpDecode reason)
obj2WireMessage 0x2 (RLPArray []) = Ping
obj2WireMessage 0x2 (RLPArray [RLPArray []]) = Ping
obj2WireMessage 0x3 (RLPArray []) = Pong
-- TODO remove distinction between new status messages and old ones once entire protocol is complete
obj2WireMessage 0x10 (RLPArray [ver, nID, hbn, lh, gh]) =
  Status
    { protocolVersion = fromInteger $ rlpDecode ver,
      networkID = fromInteger $ rlpDecode nID,
      highestBlockNum = rlpDecode hbn,
      latestHash = rlpDecode lh,
      genesisHash = rlpDecode gh
    }
obj2WireMessage 0x11 (RLPArray items) =
  NewBlockHashes $ (\(RLPArray [hash', number']) -> (rlpDecode hash', fromInteger $ rlpDecode number')) <$> items
obj2WireMessage 0x12 (RLPArray transactions) =
  Transactions $ rlpDecode <$> transactions
obj2WireMessage 0x13 (RLPArray [b, mh, s, d]) =
  GetBlockHeaders (rlpDecode b) (fromInteger $ rlpDecode mh) (fromInteger $ rlpDecode s) (rlpDecode d)
obj2WireMessage 0x14 (RLPArray items) =
  BlockHeaders $ rlpDecode <$> items
obj2WireMessage 0x15 (RLPArray hashes) =
  GetBlockBodies $ rlpDecode <$> hashes
obj2WireMessage 0x16 (RLPArray bodies) =
  BlockBodies $ (\(RLPArray [RLPArray transactions, RLPArray uncles]) -> (map rlpDecode transactions, map rlpDecode uncles)) <$> bodies
obj2WireMessage 0x17 (RLPArray [b, td]) =
  NewBlock (rlpDecode b) (rlpDecode td)
obj2WireMessage 0x18 a = Blockstanbul . rlpDecode $ a
obj2WireMessage 0x19 a = Blockstanbul . rlpDecode $ a
obj2WireMessage 0x1a a = Blockstanbul . rlpDecode $ a
obj2WireMessage 0x1b a = Blockstanbul . rlpDecode $ a
-- private chains
obj2WireMessage 0x1c (RLPArray cids) =
  GetChainDetails (rlpDecode <$> cids)
obj2WireMessage 0x1d (RLPArray chDetPairs) =
  ChainDetails $ rlpDecode <$> chDetPairs
obj2WireMessage 0x1e (RLPArray trHashes) =
  GetTransactions $ rlpDecode <$> trHashes
obj2WireMessage 0x1f (RLPArray (RLPScalar 0 : mpNodes)) =
  GetMPNodes $ rlpDecode <$> mpNodes
obj2WireMessage 0x1f (RLPArray (RLPScalar 1 : mpNodes)) =
  MPNodes $ rlpDecode <$> mpNodes
obj2WireMessage x y = error ("Missing case in obj2WireMessage: " ++ show x ++ ", " ++ format y)

-- Convert Message into RLPObject and corresponding message code
wireMessage2Obj :: Message -> (Word8, RLPObject)
wireMessage2Obj
  Hello
    { version = ver,
      clientId = cId,
      capability = cap,
      port = p,
      nodeId = nId
    } =
    ( 128,
      RLPArray
        [ rlpEncode $ toInteger ver,
          rlpEncode cId,
          RLPArray $ rlpEncode <$> cap,
          rlpEncode $ toInteger p,
          rlpEncode nId
        ]
    )
wireMessage2Obj (Disconnect reason) = (0x1, RLPArray [rlpEncode $ terminationReasonToNumber reason])
wireMessage2Obj Ping = (0x2, RLPArray [])
wireMessage2Obj Pong = (0x3, RLPArray [])
wireMessage2Obj (Status ver nID d lh gh) =
  (0x10, RLPArray [rlpEncode $ toInteger ver, rlpEncode $ toInteger nID, rlpEncode d, rlpEncode lh, rlpEncode gh])
-- TODO remove distinction between new status messages and old ones once entire protocol is complete
wireMessage2Obj (NewBlockHashes items) =
  (0x11, RLPArray $ map (\(b, n) -> RLPArray [rlpEncode b, rlpEncode $ toInteger n]) items)
wireMessage2Obj (GetBlockHeaders b max' skip' direction') =
  (0x13, RLPArray [rlpEncode b, rlpEncode $ toInteger max', rlpEncode $ toInteger skip', rlpEncode direction'])
wireMessage2Obj (BlockHeaders headers) =
  (0x14, RLPArray $ map rlpEncode headers)
wireMessage2Obj (Transactions transactions) = (0x12, RLPArray (rlpEncode <$> transactions))
wireMessage2Obj (GetBlockBodies shas) =
  (0x15, RLPArray (rlpEncode <$> shas))
wireMessage2Obj (BlockBodies bodies) =
  ( 0x16,
    RLPArray $
      map
        ( \(transactions, uncles) ->
            RLPArray [RLPArray $ map rlpEncode transactions, RLPArray $ map rlpEncode uncles]
        )
        bodies
  )
wireMessage2Obj (NewBlock b d) =
  (0x17, RLPArray [rlpEncode b, rlpEncode d])
wireMessage2Obj (Blockstanbul wm@PBFT.WireMessage {PBFT._message = msg}) =
  case msg of
    PBFT.Preprepare _ _ -> (0x18, rlpEncode wm)
    PBFT.Prepare _ _ -> (0x19, rlpEncode wm)
    PBFT.Commit _ _ _ -> (0x1a, rlpEncode wm)
    PBFT.RoundChange _ _ -> (0x1b, rlpEncode wm)
-- private chains
wireMessage2Obj (GetChainDetails cIds) =
  (0x1c, RLPArray $ rlpEncode <$> cIds)
wireMessage2Obj (ChainDetails chpairs) =
  (0x1d, RLPArray $ rlpEncode <$> chpairs)
wireMessage2Obj (GetTransactions trhashes) =
  (0x1e, RLPArray $ rlpEncode <$> trhashes)
wireMessage2Obj (GetMPNodes mpNodes) =
  (0x1f, RLPArray . (RLPScalar 0 :) $ rlpEncode <$> mpNodes)
wireMessage2Obj (MPNodes mpNodes) =
  (0x1f, RLPArray . (RLPScalar 1 :) $ rlpEncode <$> mpNodes)

--wireMessage2Obj x = error $ "Missing case in wireMessage2Obj: " ++ show x
