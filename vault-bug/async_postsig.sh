#!/bin/bash

for x in {1..100}
do
  ./postsig_from_bloc.sh ${x} &  
done
