#!/bin/bash
project="blockapps-repo"
tag="latest"
#src_dtr="registry-aws.blockapps.net:5010"
target_dtr="registry-aws.blockapps.net:5000"
docker login -u $DOCKER_USER -p $DOCKER_PASSWD $target_dtr
basil targets | while read line ; do
    imageID=`docker images | grep "silo-$line " | grep $tag | awk '{ print $3 }' | head -n 1`
    docker tag $imageID $target_dtr/$project/silo-$line:latest
    docker push $target_dtr/$project/silo-$line:latest
done
