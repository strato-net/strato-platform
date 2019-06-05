
pipeline {
  agent {
    label "test"
  }
  options { disableConcurrentBuilds() }
  stages {
   stage('Prepare') {
      steps {
        sh '''#!/bin/bash -le
          set -x
          docker rm -f $(docker ps -aq) || true; docker system prune -f --volumes
        '''
      }
    }
    stage('Copy Strato Build') {
      steps {
        copyArtifacts fingerprintArtifacts: true, flatten: true, parameters: 'PLATFORM_BRANCH_NAME=develop', projectName: 'STRATO_test', selector: lastSuccessful()
      }
    }
    stage('Run Strato') {
      steps {
        withCredentials([
          usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'),
        ]) {
          sh '''
            #!/bin/bash -le
            set -x
            docker login -u $DOCKER_USER -p $DOCKER_PASSWD registry-aws.blockapps.net:5000
            echo "Pulling strato"
            rm -rf strato-getting-started
            git clone https://github.com/blockapps/strato-getting-started.git
            cp docker-compose.yml ./strato-getting-started
            cd strato-getting-started
            chmod +x strato.sh
            NODE_HOST=cd10.eastus.cloudapp.azure.com ./strato.sh -m 1
            docker ps
            counter=0
            # Few quick tests
            until curl --silent --output /dev/null --fail --location localhost/bloc/v2.2/users/
            do
              if [ "$counter" -gt 300 ]; then
                echo "bloc took longer than 5 minutes to initialize! aborting."
                exit 73
              fi
              echo "waiting for bloc to be available through nginx"
              counter=$((counter+1))
              sleep 1
            done
            echo "bloc is available"
          '''
        }
      }
    }
    stage('Run platform load test, VictorHWong-patch-1 branch') {
      steps {
        withCredentials([
          usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'),
          usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GITHUB_TOKEN', usernameVariable: 'USR')
        ]) {
          sh '''#!/bin/bash -le
            set -x
            echo "Running strato-platform tests"
            rm -rf strato-platform
            git clone -b VictorHWong-patch-1 --single-branch https://${USR}:${GITHUB_TOKEN}@github.com/blockapps/strato-platform.git
            cd strato-platform/tests
            git pull origin VictorHWong-patch-1
            sleep 2
            git checkout VictorHWong-patch-1
            sleep 1
            npm install
            sleep 5
            echo "Running strato load performance tests"
            SERVER=localhost npm run test:load10k
            '''
        }
      }
  }
    stage('Plot .csv performance data') {
      steps {
        plot csvFileName: 'plot-76fdec7c-2312-49a5-8946-26090eeacf64.csv',
            csvSeries: [[
                               displayTableFlag: false, exclusionValues: '',
                               file: '/master/graph_PERFORMANCE_multinode_strato_load.csv',
                               inclusionFlag: 'OFF',
                               url: '']],
            group: 'PERFORMANCE_reports',
            style: 'line',
            title: 'PERFORMANCE_multinode_strato_load'
      }
    }

}
post {
    success {
      slackSend(
        color: 'good',
        message: "Build Successful: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
      sh '''
      echo "Build Successful for Git branch: $BRANCH_NAME"
    '''
    }

    failure {
      slackSend(
        color: 'danger',
        message: "Multinode plaform tests failed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
      slackSend(
        channel: '#testjenkins',
        color: 'danger',
        message: "Multinode plaform tests failed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
    }

    fixed {
      slackSend(
        channel: '#testjenkins',
        color: 'good',
        message: "Multinode plaform tests fixed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
    }

  }
}
