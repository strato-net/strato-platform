githubCredentials = [
  [
    $class: 'UsernamePasswordMultiBinding',
    usernameVariable: 'USR',
    passwordVariable: 'GITHUB_TOKEN',
    credentialsId: 'blockapps-cd-github'
  ]
]

pipeline {
  agent {
    label "cd9"
  }

  stages {
    stage('Build') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {    
          sh 'basil build'
        }
      }
    }

    stage ('HLint') {
      steps {
        sh 'stack install hlint'
        sh 'stack exec hlint -- .'
      }
    }

    stage('Test') {
      steps {
        echo "Running unit tests"
        sh 'eval "$(cat run_unit_tests.sh)"'
      }
    }
  }

  post {
    success {
      withCredentials([usernamePassword(credentialsId: 'docker-aws-registry-login', passwordVariable: 'DOCKER_PASSWD', usernameVariable: 'DOCKER_USER'), usernamePassword(credentialsId: 'blockapps-cd-github', passwordVariable: 'GH_PASSWD', usernameVariable: 'GH_USER')]) {    
      sh '''
        echo "Git branch: $BRANCH_NAME"
        basil build --release
        basil push
      '''
      }
        slackSend (
          color: 'good',
          message: "Build succeeded: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
        )
    }

    failure {
      slackSend (
        color: 'danger',
        message: "Build failed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})"
      )
    }
  }
}
