pipeline {
  agent {
    label "strato-integration"
  }
  options { disableConcurrentBuilds() }
  parameters { string(name: 'BUILD_TYPE', defaultValue: 'full', description: 'PLEASE USE RESPONSIBLY: Type "quick" if you want to make the quick build (not wiping the existing images, same as does the silo test job). DEFAULT: "full"') }

  stages {
    stage('Prepare') {
      steps {
        sh '''#!/bin/bash -le
          echo "Old flow merge test"
          set -x
          docker rm -f $(docker ps -aq) || true;
          if [ "$BUILD_TYPE" == "quick" ]; then
            docker system prune -f
            cd silo
            git pull
          else
            docker system prune -fa
            sudo rm -rf silo
          fi
          docker ps
        '''
       }
    }
    
    stage('Build') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {
          sh '''#!/bin/bash -le
            set -x
            docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
            git config --global credential.helper store
            if [ "$BUILD_TYPE" == "quick" ]; then
              cd silo
              basil clone
              # Checkout branches specified in Basilfile
              basil checkout
              # Git pull all the latest
              dirs=($(find ./repos -mindepth 1 -maxdepth 1 -type d))
              for dir in "${dirs[@]}"; do
                (cd "$dir" && git pull)
              done
            else
              git clone https://$GH_USER:$GH_PASSWD@github.com/blockapps/silo.git
              cd silo
              basil clone
            fi
            basil compose --release > docker-compose.release.yml
            basil snapshot > Basilfile.snapshot
            basil build
          '''
        }
      }
    }
    stage('Deploy') {
      steps {
        sh '''#!/bin/bash -le
          set -x
          cd silo
          basil compose > docker-compose.yml
          export NODE_HOST=${NODE_HOST:-strato-int.centralus.cloudapp.azure.com}
          NODE_NAME=${NODE_NAME:-$NODE_HOST} \
            BLOC_URL=${BLOC_URL:-http://$NODE_HOST/bloc/v2.2} \
            BLOC_DOC_URL=${BLOC_DOC_URL:-http://$NODE_HOST/docs/?url=/bloc/v2.2/swagger.json} \
            STRATO_URL=${STRATO_URL:-http://$NODE_HOST/strato-api/eth/v1.2} \
            STRATO_DOC_URL=${STRATO_DOC_URL:-http://$NODE_HOST/docs/?url=/strato-api/eth/v1.2/swagger.json} \
            CIRRUS_URL=${CIRRUS_URL:-http://$NODE_HOST/cirrus/search} \
            APEX_URL=${APEX_URL:-http://$NODE_HOST/apex-api} \
            STRATO_GS_MODE=1 \
            docker-compose up -d
          docker ps
          # Few quick tests
          until curl --silent --output /dev/null --fail --location ${NODE_HOST}/bloc/v2.2/users/
          do
            echo "waiting for bloc to be available through nginx"
            sleep 1
          done
          echo "bloc is available"
          until curl --silent --output /dev/null --fail --location ${NODE_HOST}/cirrus/contract/
          do
            echo "waiting for cirrus to be available through nginx"
            sleep 1
          done
          echo "cirrus is available"
        '''
      }
    }

    stage('unit-tests') {
      steps {
        sh '''#!/bin/bash -le
          set -x
          echo "Running apex unit tests"
          APEX_CONTAINER=$(docker ps --format '{{.Names}}' | grep apex_1)
          docker exec -t -e NODE_ENV=test "$APEX_CONTAINER" ./run-tests.sh
        '''
      }
    }

    stage('E2E-Test') {
      steps {
        sh '''#!/bin/bash -le
          set -x
          echo 'Running BlockApps BA deploy script and tests to verify the build to be healthy'
          rm -rf blockapps-ba
          git clone https://github.com/blockapps/blockapps-ba.git
          cd blockapps-ba
          npm i
          SERVER=localhost npm run deploy
          sleep 5
          SERVER=localhost npm run test
        '''
      }
    }

    stage('bloch-tests') {
      steps {
        sh '''#!/bin/bash -le
        set -x
        echo "SKIPPING BlockApps Haskell test (has to be changed to not build blockapps-haskell each time after we silo folder on full build"
#          echo 'Running BlockApps Haskell tests to verify the build to be healthy'
#          # Optimized flow to not rebuild stack each time from the scratch
#          if [ ! -d blockapps-haskell ]; then
#            git clone https://github.com/blockapps/blockapps-haskell.git
#          fi
#          cd blockapps-haskell
#          git remote update origin --prune
#          git checkout $(cd ../repos/blockapps-haskell && git rev-parse --abbrev-ref HEAD) # use same branch as Basilfile
#          git pull
#          stack test blockapps-bloc22-server
#          stack test blockapps-solidity --test-arguments="--match=Declarations"
#          stack test blockapps-bloc22-client
        '''
      }
    }

    stage('Release') {
      steps {
        withEnv(["TAG_NAME=build-${env.BUILD_NUMBER}", "PATH=$PATH:/usr/local/go/bin"]) {
          withCredentials([
            usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'),
            usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GITHUB_TOKEN', usernameVariable: 'USR')
          ]) {
            sh '''#!/bin/bash -le
              set -x
              cd silo
              docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
              basil build --release
              basil push
              ./docker-publish-images.sh
              SILO_RELEASE_DETAILS="--user blockapps --repo silo --tag $TAG_NAME"
              RELEASE_DATE=$(date +'%Y-%m-%d %H:%M:%S')
              github-release delete  $SILO_RELEASE_DETAILS || true
              github-release release $SILO_RELEASE_DETAILS --name "master @ $RELEASE_DATE"
              github-release upload $SILO_RELEASE_DETAILS --name "Basilfile" --file ./Basilfile.snapshot
              github-release upload $SILO_RELEASE_DETAILS --name "docker-compose.yml" --file ./docker-compose.release.yml
              github-release upload $SILO_RELEASE_DETAILS --name "docker-compose.STRATO-GS.release.yml" --file ./docker-compose.STRATO-GS.release.yml
              
              github-release delete --user blockapps --repo strato-getting-started --tag build-latest || true
              github-release release --pre-release --user blockapps --repo strato-getting-started --tag build-latest --name "master @ $RELEASE_DATE"
              github-release upload --user blockapps --repo strato-getting-started --tag build-latest --name "docker-compose.latest.yml" --file ./docker-compose.STRATO-GS.latest.yml
            '''
          }
        }
      }
    }
  }

  post {
    success {
        slackSend (
        color: 'good',
        message: "Build Successful: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
        )
      sh '''
        echo "Build Successful for Git branch: $BRANCH_NAME"
      '''
    }

    failure {
      slackSend (
        color: 'danger',
        message: "Build failed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
    }
  }
}
