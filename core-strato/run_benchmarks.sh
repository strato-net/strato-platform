#!/usr/bin/env bash

set -ex

stack bench blockstanbul
stack bench strato-sequencer
stack bench ethereum-rlp
