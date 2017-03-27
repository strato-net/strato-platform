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

  _.map(_.range(1, flagVal), function (i){
    //  console.log("Configuring node " + i)
      var stratoPeer = api.CloneDeployment(stratoDeployment)
      stratoPeer.ComposeArgs.Environment["bootnode"] = stratoDeployment.Name;
      stratoPeer.ComposeArgs.Environment["useSyncMode"] = "true";
      stratoPeer.ComposeArgs.Environment["redisBDBNumber"] = i;

      stratoPeer.Name = "strato-"+i;
      api.SetDeployment(stratoPeer)
  })
  
  console.log(api.DoCompose(isRelease))
})
