#!/bin/bash

# Clean all section occurances in file | Params: 1 = file name, 2 = section header name (e.g. volumes:))
function cleanYamlSection {
  fileName=$1
  sectionHeader=$2
  # Clean section contents
  vi $fileName -c ":%s/$sectionHeader\(\n\s*-\s".*"\)*/$sectionHeader/g" -c ':wq!' # Better to use awk instead
  # Clean section header line
  sed -ni '/'"$sectionHeader"'/!p' $fileName
}

project="blockapps-repo"
target_dtr="registry-aws.blockapps.net:5000"
docker login -u $DOCKER_USER -p $DOCKER_PASSWD $target_dtr
basil targets | while read line ; do
    imageID=`docker images | grep "silo-$line " | grep "latest" | awk '{ print $3 }' | head -n 1` # result example: 'aaa476d83837'
    docker tag $imageID $target_dtr/$project/silo-$line:latest
    docker push $target_dtr/$project/silo-$line:latest

    if [ $1 == '--prepare-tagged-release' ]
    then
      # Push tagged image (add tag to image in registry)
      imageNameWithTag=`cat docker-compose.release.yml | grep -o "silo-$line:.*"` # result example: 'silo-$line:4a1bed5'
      docker tag $imageID $target_dtr/$project/$imageNameWithTag
      docker push $target_dtr/$project/$imageNameWithTag
    fi
done

if [ $1 == '--prepare-tagged-release' ]
then
  echo 'creating docker-compose.STRATO-GS.yml'
  cp docker-compose.release.yml docker-compose.STRATO-GS.yml
  sed -i 's|/silo-|/'"$project"'/silo-|g' docker-compose.STRATO-GS.yml
  cleanYamlSection docker-compose.STRATO-GS.yml volumes:
fi