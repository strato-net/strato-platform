
module Blockchain.Sequencer.DB.Witnessable where

import           Blockchain.Strato.Model.SHA

class Witnessable t where
    witnessableHash :: t -> SHA

