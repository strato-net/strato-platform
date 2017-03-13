node ('cd9') {
   slackSend (color: 'good', message: "Build Started: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})") 
   stage('Code-Checkout') { // for display purposes
    
      withCredentials([[$class: 'UsernamePasswordMultiBinding', credentialsId: 'blockapps-cd-github', passwordVariable: 'p', usernameVariable: 'u']]) {
    // some block
    sh 'rm -rf blockapps-haskell'
    sh 'git clone https://$u:$p@github.com/blockapps/blockapps-haskell'
   }
 }
   stage('Build') {
    echo 'doing build'
    sh 'echo $pwd'
      sh 'ls -ltr'
      dir('blockapps-haskell') {
        sh 'echo before stack build'
        sh 'stack build'
      }
   slackSend (color: 'good', message: "Build Completed: Job '${env.JOB_NAME} [${env.BUILD_NUMBER}]' (${env.BUILD_URL})")
   }
   
   stage ('Test')
   {
      sh 'echo test'
    }
}

def cleanup() {
    sh "docker ps -q -a | xargs docker rm"
   // sh "docker rmi $(docker images -f "dangling=true" -q)"
//    sh "docker rmi $(docker images | grep '<none>' | awk '{print $3}')"
}
