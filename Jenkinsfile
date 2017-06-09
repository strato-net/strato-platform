pipeline {
  agent any
  stages {
    stage('Test') {
      steps {
        sh 'npm run test'
      }
    }
    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }
    stage('Dockerize') {
      steps {
        sh 'npm run start'
      }
    }
  }
}