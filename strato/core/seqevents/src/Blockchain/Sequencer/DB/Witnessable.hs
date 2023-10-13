module Blockchain.Sequencer.DB.Witnessable where

import Blockchain.Strato.Model.Keccak256

class Witnessable t where
  witnessableHash :: t -> Keccak256
