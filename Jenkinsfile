pipeline {
  agent {
    label "strato-integration"
  }
  options { disableConcurrentBuilds() }

  stages {
    stage('Prepare') {
      steps {
        sh '''#!/bin/bash -le
          docker rm -f $(docker ps -aq) || true; docker system prune -fa
          docker ps
          sudo rm -rf silo
        '''
       }
    }
    
    stage('Build') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {
          sh '''#!/bin/bash -le
            docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
            git config --global credential.helper store
            git clone https://$GH_USER:$GH_PASSWD@github.com/blockapps/silo.git
            cd silo
            basil clone
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
          cd silo
          basil compose > docker-compose.yml

          NODE_HOST=${NODE_HOST:-strato-int.centralus.cloudapp.azure.com} \
            NODE_NAME=${NODE_NAME:-$NODE_HOST} \
            BLOC_URL=${BLOC_URL:-http://$NODE_HOST/bloc/v2.2} \
            BLOC_DOC_URL=${BLOC_DOC_URL:-http://$NODE_HOST/docs/?url=/bloc/v2.2/swagger.json} \
            STRATO_URL=${STRATO_URL:-http://$NODE_HOST/strato-api/eth/v1.2} \
            STRATO_DOC_URL=${STRATO_DOC_URL:-http://$NODE_HOST/docs/?url=/strato-api/eth/v1.2/swagger.json} \
            CIRRUS_URL=${CIRRUS_URL:-http://$NODE_HOST/cirrus/search} \
            XAPI_URL=${XAPI_URL:-http://$NODE_HOST/x-api} \
            cirrusurl=nginx/cirrus \
            stratoHost=nginx \
            ssl=false \
            docker-compose up -d
          sleep 32 # wait for cirrus to restart (remove when container dependencies are fixed)
          docker ps
          # Few quick tests
          curl -f http://localhost/cirrus/search/
          curl -f http://localhost/strato-api/eth/v1.2/stats/difficulty
          curl -f http://localhost/bloc/v2.2/users
        '''
      }
    }

    stage('E2E-Test') {
      steps {
        sh '''#!/bin/bash -le
          echo 'Running BlockApps BA deploy script and tests to verify the build to be healthy'
          rm -rf blockapps-ba
          git clone https://github.com/blockapps/blockapps-ba.git
          cd blockapps-ba
          npm i
          SERVER=localhost npm run deploy
          SERVER=localhost npm run test
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
