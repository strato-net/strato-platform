#!/bin/bash
set -e
stack setup
stack build alex happy
