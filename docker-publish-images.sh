#!/bin/bash
project="blockapps-repo"
tag="latest"
src_dtr="registry-aws.blockapps.net:5010"
target_dtr="registry-aws.blockapps.net:5000"
sudo docker login -u blockapps -p blockAPPS123 $target_dtr
#imageID='sudo docker images | grep $line | grep $tag | awk '{ print $3 }''
while IFS='' read -r line || [[ -n "$line" ]]; do
    echo "image name: $line"
    #echo "docker pull $src_dtr/$line:$tag"
    imageID=`sudo docker images | grep "$line " | grep $tag | awk '{ print $3 }'`
    docker tag $imageID $target_dtr/$project/$line:latest
    docker push $target_dtr/$project/$line:latest
done < "$1"
