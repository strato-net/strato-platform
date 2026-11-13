-- | What the peers we are connected to say the chain's best block is.
--
-- Nothing a peer says about its height is authenticated, so a single number that
-- any peer can raise cannot be allowed to decide anything. Each connection's claim
-- is kept on its own: it is what that peer may be asked for, and a peer that lies
-- only wastes its own requests. What the node treats as the height of the chain is
-- the median across hosts, which a minority of them cannot move, and a claim lasts
-- only as long as its connection.
module Blockchain.PeerClaims
  ( PeerClaims,
    noClaims,
    claim,
    withdraw,
    claimOf,
    worldBest,
  )
where

import Blockchain.Model.SyncState (BestBlock (..))
import Blockchain.Strato.Model.Host
import Data.List (sortOn)
import qualified Data.Map.Strict as M
import Data.Maybe (listToMaybe)

-- | Claims by connection; @c@ identifies one.
newtype PeerClaims c = PeerClaims (M.Map c (Host, BestBlock))

noClaims :: PeerClaims c
noClaims = PeerClaims M.empty

-- | The peer on this connection now says this is its best block.
claim :: Ord c => c -> Host -> BestBlock -> PeerClaims c -> PeerClaims c
claim c host best (PeerClaims m) = PeerClaims $ M.insert c (host, best) m

-- | The connection is gone, and its claim with it.
withdraw :: Ord c => c -> PeerClaims c -> PeerClaims c
withdraw c (PeerClaims m) = PeerClaims $ M.delete c m

claimOf :: Ord c => c -> PeerClaims c -> Maybe BestBlock
claimOf c (PeerClaims m) = snd <$> M.lookup c m

-- | The best block the connected peers agree on. A host counts once, by its
-- highest claim, however many connections it holds. From three hosts up this is
-- the median claim (the lower of the middle two), so fewer than half of them
-- cannot raise it; with one or two there is nobody to outvote a liar and it is
-- the highest.
worldBest :: PeerClaims c -> Maybe BestBlock
worldBest (PeerClaims m) =
  let perHost = sortOn bestBlockNumber . M.elems . M.fromListWith higher $ M.elems m
      n = length perHost
      i = if n < 3 then n - 1 else (n - 1) `div` 2
   in listToMaybe $ drop i perHost
  where
    higher a b = if bestBlockNumber a >= bestBlockNumber b then a else b
