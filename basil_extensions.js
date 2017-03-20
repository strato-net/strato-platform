util.RegisterCommand({
  Name: "multinode",
  Usage: "Make a multinode docker-compose",
  Flags: [
    util.MakeFlag({
      Name: "count,c",
      Usage: "how many extra stratos to make",
      Value: "1"
    }),
    util.MakeFlag({
      Name: "release,r",
      Usage: "Whether or not to use release-tagged images",
      Value: ""
    })
  ]
}, function(c) {
  var flagVal = parseInt(c.String("count"))
  var isRelease = c.String("release") != ""
  var stratoDeployment = _.first(_.filter(basilfile.Deployments, function(p) { return p.Name == "strato"; }))

  //var newStrato = api.CloneDeployment(stratoDeployment)
  //newStrato.ComposeArgs["environment"]["addBootnodes"] = 21123

  //console.log("Creating multinode docker-compose.yml with " + flagVal + " nodes.")

  _.map(_.range(1, flagVal), function (i){
    //  console.log("Configuring node " + i)
      var stratoPeer = api.CloneDeployment(stratoDeployment)
      stratoPeer.ComposeArgs["environment"]["bootnode"] = stratoDeployment.Name;
      stratoPeer.ComposeArgs["environment"]["useSyncMode"] = "true"
      
      var portIndex = stratoPeer.ComposeArgs["ports"].length;
      var oldPort = parseInt(stratoPeer.ComposeArgs["ports"][portIndex - 1].split(':')[0])
      stratoPeer.ComposeArgs["ports"][portIndex - 1] = (oldPort + i) + ":3000" 

      stratoPeer.Name = "strato-"+i;
      api.SetDeployment(stratoPeer)
  })

  //console.log("Creating multinode .tmuxinator with " + flagVal + " nodes.")
  
  console.log(api.DoCompose(isRelease))
})
