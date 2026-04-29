-- | Minimal hspec runner that executes only the audit-fix regression
-- tests for evm-solidity. The repo's older spec files
-- ('test/BlockApps/SoliditySpec.hs', etc.) were commented out of the
-- test suite for years; reviving them is out of scope for the audit
-- follow-up. This entry point keeps things scoped and reliable.
module Main where

import qualified BlockApps.Solidity.ABI.CodecAuditFixSpec as CodecAudit
import Test.Hspec

main :: IO ()
main = hspec $ do
  CodecAudit.spec
