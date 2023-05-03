{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE ViewPatterns #-}
{-# OPTIONS_GHC -Wno-unused-top-binds #-}

import Language.Dot

import GHC.Debug.Client
import GHC.Debug.Profile
import GHC.Debug.Snapshot
import GHC.Debug.TypePointsFrom hiding (detectLeaks)
import GHC.Debug.Types.Ptr
import Control.Monad.RWS
import Control.Monad.State
import Control.Concurrent
import Control.Monad.Identity
import qualified Data.Map.Internal as M
import Data.List (sortOn)
import qualified Data.Set as S

-- Functions that output files will ouput to the /tmp directory inside the strato_strato_1 container.
-- Note: It is also suggested to add your own debug functions if these do not fulfill your needs.
main :: IO ()
main = withDebuggeeConnect "/tmp/ghc-debug" (\d -> do 
  makeSnapshot d "/tmp/ghc-debug-snapshot" -- Creates a snapshot of the heap for offline (program does not have to be running) analysis

  -- detectLeaks 10 d -- Experimental leak detection algorithm

  -- analyseFragmentation 5_000_000 d -- Heap fragmentation analysis

  -- doThunkAnalysis d
  )

doThunkAnalysis e = do
  pause e
  res <- runTrace e $ do
    precacheBlocks
    rs <- gcRoots
    res <- thunkAnalysis rs
    return res
  printResult res
  resume e

-- -----------------------------------------------------------------------
-- Below are some prewritten debugging functions copied over from the ghc-debug debugger example program that I found to be useful.

-- Copyright (c) 2019, Ben Gamari

-- All rights reserved.

-- Redistribution and use in source and binary forms, with or without
-- modification, are permitted provided that the following conditions are met:

--     * Redistributions of source code must retain the above copyright
--       notice, this list of conditions and the following disclaimer.

--     * Redistributions in binary form must reproduce the above
--       copyright notice, this list of conditions and the following
--       disclaimer in the documentation and/or other materials provided
--       with the distribution.

--     * Neither the name of Ben Gamari nor the names of other
--       contributors may be used to endorse or promote products derived
--       from this software without specific prior written permission.

-- THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
-- "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
-- LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
-- A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
-- OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
-- SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
-- LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
-- DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
-- THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
-- (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
-- OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

thunkAnalysis :: [ClosurePtr] -> DebugM (Map.Map _ Count)
thunkAnalysis rroots = (\(_, r, _) -> r) <$> runRWST (traceFromM funcs rroots) () (Map.empty)
  where
    funcs = justClosures closAccum

    -- First time we have visited a closure
    closAccum  :: ClosurePtr
               -> SizedClosure
               -> (RWST () () (Map.Map _ Count) DebugM) ()
               -> (RWST () () (Map.Map _ Count) DebugM) ()
    closAccum cp sc k = do
          case (noSize sc) of
            ThunkClosure {} ->  do
              loc <- lift $ getSourceLoc sc
              modify' (Map.insertWith (<>) loc (Count 1))
              k
            _ -> k

analyseFragmentation :: Int -> Debuggee -> IO ()
analyseFragmentation interval e = loop
  where
    loop ::IO ()
    loop = do
      pause e
      putStrLn "PAUSED"
      (mb_census, mbb_census, mbb_census2, cen, bs, rs, rets) <- runTrace e $ do
        -- Get all known blocks
        bs <- precacheBlocks
        rs <- gcRoots
        traceWrite ("ROOTS", length rs)
        mb_census <- censusPinnedBlocks bs rs
        mbb_census <- censusByMBlock rs
        mbb_census2 <- censusByBlock rs
        let is_small (CS _ (Size s) _) = fromIntegral s < 4096 * 0.9
        let small_blocks = S.fromList (Map.keys (Map.filter is_small mbb_census2))
        let pred cp = applyBlockMask cp `S.member` small_blocks
        cen <- censusClosureTypeF (not . pred) rs
        rets <- findRetainers (Just 10) rs (\cp _ -> return $ pred cp)
        rets' <- traverse addLocationToStack rets
        let bads = findBadPtrs mb_census
        -- Print how many objects there are in the badly fragmented blocks
        traceWrite ("FRAG_OBJECTS", (foldl1 (<>) (map (fst . fst) bads)))
        -- Only take 5 bad results as otherwise can take a long time as
        -- each call to `doAnalysis` will perform a full heap traversal.
        as <- mapM (doAnalysis rs) ([(l, ptrs) | ((c, ptrs), l) <- bads])
        return (mb_census, mbb_census, mbb_census2, cen, bs, as, rets')
      resume e
      summariseBlocks bs
      let go (PinnedCensusStats (m, _)) = m
      printBlockCensus (Map.map go mb_census)
      printMBlockCensus mbb_census
      printBlockCensus mbb_census2
      printMBlockCensus cen
      displayRetainerStack (("one",) <$> rets)

      displayRetainerStack' (catMaybes rs)
      putStrLn "------------------------"
      -- loop -- Uncomment this if you want to loop

detectLeaks :: Int -> Debuggee -> IO ()
detectLeaks interval e = loop Nothing (M.empty, M.empty) 0
  where
    loop :: Maybe TypePointsFrom -> RankMaps -> Int -> IO ()
    loop prev_census rms i = do
      print i
      threadDelay (interval * 1_000_000)
      pause e
      (gs, r, new_rmaps) <- runTrace e $ do
        _ <- precacheBlocks
        rs <- gcRoots
        traceWrite (length rs)
        res <- typePointsFrom rs
        let !new_rmaps = case prev_census of
                           Nothing -> rms
                           Just pcensus -> updateRankMap rms pcensus res
        let cands = chooseCandidates (fst new_rmaps)
        traceWrite (length cands)
        gs <- mapM (findSlice (snd new_rmaps)) (take 10 cands)
        return (gs, res, new_rmaps)
      resume e
      zipWithM_ (\n g -> writeFile ("/tmp/slice"
                                      ++ show @Int i ++ "-"
                                      ++ show @Int n ++ ".dot")
                                   (renderDot g)) [0..] gs
      loop (Just r) new_rmaps (i + 1)

type Rank = Double
type Decay = Double

data RankInfo = RankInfo !Rank !Int deriving Show

getRank :: RankInfo -> Rank
getRank (RankInfo r _) = r

default_decay :: Decay
default_decay = 0.15

rank_threshold :: Double
rank_threshold = 100

min_iterations :: Int
min_iterations = 2

applyRankFilter :: RankInfo -> Bool
applyRankFilter (RankInfo r i) = r >= rank_threshold && i >= min_iterations

-- | Lookup suitable candidates from the RankMap
-- , Chooses values based on 'rank_threshold' and 'min_iterations'
lookupRM :: Key -> RankMap Edge -> [(Edge, RankInfo)]
lookupRM k m = M.assocs filtered_map
  where
    -- TODO, work out how to use these functions O(log n)
    --smaller =  traceShow (M.size m) (M.dropWhileAntitone ((/= k) . edgeSource) $ m)
    --res_map = traceShow (M.size smaller) (M.takeWhileAntitone ((== k) . edgeSource) smaller)
    (res_map, _) = M.partitionWithKey (\e _ -> (== k) . edgeSource $ e) m
    filtered_map = M.filter (\(RankInfo r _) -> r > 0) res_map

mkDotId :: InfoTablePtr -> Id
mkDotId (InfoTablePtr w) = IntegerId (fromIntegral w)

findSlice :: RankMap Edge -> Key -> DebugM Graph
findSlice rm k = Graph StrictGraph DirectedGraph (Just (mkDotId k)) <$> evalStateT (go 3 k) S.empty

  where

    go :: Int -> InfoTablePtr -> StateT (S.Set InfoTablePtr) DebugM [Statement]
    go n cur_k = do
      visited_set <- get
      -- But don't stop going deep until we've seen a decent number of
      -- nodes
      if S.member cur_k visited_set || (n <= 0 && S.size visited_set >= 20)
        then return []
        else do
          label <- lift $ getKey cur_k
          let next_edges = take 20 (lookupRM cur_k rm)
              -- Decoding very wide is bad
              edge_stmts = map mkEdge next_edges
              node_stmt = NodeStatement (NodeId (mkDotId cur_k) Nothing) [AttributeSetValue (StringId "label") (StringId label) ]
              mkEdge (Edge _ e, ri) = EdgeStatement [ENodeId NoEdge (NodeId (mkDotId cur_k) Nothing), ENodeId DirectedEdge (NodeId (mkDotId e) Nothing)] [AttributeSetValue (StringId "label") (StringId (show (getRank ri))) ]

          modify' (S.insert cur_k)
          ss <- concat <$> mapM (go (n-1) . edgeTarget . fst) next_edges
          return $ node_stmt : edge_stmts ++ ss

chooseCandidates :: RankMap Key -> [Key]
chooseCandidates = map fst . reverse . sortOn (getRank . snd) . M.assocs . M.filter applyRankFilter

type RankMap k = M.Map k RankInfo

type RankMaps = (RankMap Key, RankMap Edge)

type RankUpdateMap k = M.Map k RankUpdateInfo

type RankUpdateInfo = Int -> Double -> Double

-- | Update the current rank predictions based on the difference between
-- two censuses.
updateRankMap :: (RankMap Key, RankMap Edge)
              -> TypePointsFrom
              -> TypePointsFrom
              -> (RankMap Key, RankMap Edge)
updateRankMap (rm_n, rm_e) t1 t2 = (ns, es)
  where
    !(rnodes, redges) = ratioRank t1 t2
    missingL = M.dropMissing
    missingR = M.mapMissing (\_ f -> RankInfo (f 0 0) 1)
    matched = M.zipWithMatched (\_ (RankInfo r iters) f -> RankInfo (f iters r) (iters + 1))

    !ns = runIdentity $ M.mergeA missingL missingR matched rm_n rnodes
    !es = runIdentity $ M.mergeA missingL missingR matched rm_e redges


compareSize :: CensusStats -> CensusStats -> Maybe (Int -> Double -> Double)
compareSize (cssize -> Size s1) (cssize -> Size s2) =
  if fromIntegral s2 > (1 - default_decay) * fromIntegral s1
    -- Calculate "Q"
    then if s1 > s2
          -- Shrinking phase, penalise rank
          then Just (\phases rank ->
                      rank
                        - ((fromIntegral (phases + 1))
                            * ((fromIntegral s1 / fromIntegral s2) - 1)))
          else Just (\phases rank ->
                        rank +
                          ((fromIntegral (phases + 1))
                            * ((fromIntegral s2 / fromIntegral s1) - 1)))
    else Nothing

-- | Compute how to update the ranks based on the difference between two
-- censuses.
ratioRank :: TypePointsFrom -> TypePointsFrom -> (RankUpdateMap Key, RankUpdateMap Edge)
ratioRank t1 t2 = (candidates, redges)
  where
    ns1 = getNodes t1
    ns2 = getNodes t2

    es1 = getEdges t1
    es2 = getEdges t2
    missingL = M.dropMissing
    missingR = M.dropMissing
    matched = M.zipWithMaybeMatched (\_ cs1 cs2 -> compareSize cs1 cs2)
    !candidates = runIdentity $ M.mergeA missingL missingR matched ns1 ns2

    !redges = runIdentity $ M.mergeA missingL missingR matched es1 es2