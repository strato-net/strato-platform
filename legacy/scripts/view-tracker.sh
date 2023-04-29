#!/usr/bin/env sh
stlog strato-sequencer | grep showctx/view | cut -d \| -f 3,4
