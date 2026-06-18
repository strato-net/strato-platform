-- | Fork gates for SolidVM audit fixes.
--
-- The 2026 Consensys Diligence audit identified a number of VM-level
-- correctness/security issues whose fixes would change on-chain state on
-- any existing network. Rather than bundling all of them into a single
-- hard-fork block, each network can schedule its activation
-- independently via 'auditForkBlock'.
--
-- This module is intentionally small and pure so it can be used from
-- both 'evm-solidity' (ABI decoder) and 'solid-vm' (VM itself).
module Blockchain.VM.ForkGate
  ( Network (..),
    heliumNetworkId,
    upquarkNetworkId,
    networkOf,
    auditForkBlock,
    isAuditForkActive,
  )
where

-- | Known networks that explicitly opt in to the audit-fix hard-fork.
-- Any network not listed here defaults to the pre-audit semantics; add a
-- new constructor + case in 'auditForkBlock' when another network is
-- ready to coordinate its upgrade.
data Network
  = Helium
  | Upquark
  | Other
  deriving (Show, Eq)

-- | 'bytes2Integer . map c2w' of the lowercase network name, as produced
-- by 'computeNetworkID' in 'Blockchain.Strato.Model.Options'.
heliumNetworkId :: Integer
heliumNetworkId = 114784819836269

upquarkNetworkId :: Integer
upquarkNetworkId = 33056204878082667

networkOf :: Integer -> Network
networkOf nid
  | nid == heliumNetworkId = Helium
  | nid == upquarkNetworkId = Upquark
  | otherwise = Other

-- | The block at (and after) which a network activates the post-audit
-- semantics. 'Nothing' means the gate is disabled on that network — all
-- fork-gated behaviours stay at the pre-audit defaults forever.
--
-- Both Helium and Upquark are tentatively set to block 100_000. The two
-- networks are listed as separate cases so each can be scheduled
-- independently in the future without a code change elsewhere.
auditForkBlock :: Network -> Maybe Integer
auditForkBlock Helium = Just 100000
auditForkBlock Upquark = Just 100000
auditForkBlock Other = Nothing

-- | Pure predicate: is the audit-fix fork active on this chain at this
-- block height? The caller supplies the network id (from
-- 'Blockchain.EthConf.Model.networkID') and the current block number
-- (from the VM's 'BlockHeader.number').
isAuditForkActive :: Integer -> Integer -> Bool
isAuditForkActive nid blockNum =
  maybe False (blockNum >=) (auditForkBlock (networkOf nid))
