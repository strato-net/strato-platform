util.RegisterCommand({
  Name: "e2e",
  Usage: "Run e2e tests",
  Flags: [
    util.MakeFlag({
      Name: "the-val,t",
      Usage: "a val",
      Value: "asdf"
    })
  ]
}, function(c) {
  var flagVal = c.String("the-val")
  console.log(flagVal)
})
