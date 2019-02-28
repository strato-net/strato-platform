const factory = {
  getUserData: function(){
    return {
      userName: 'test02@test.com',
      hash: 'somehashstring',
      password: 'dontactuallyneedthisanymoreithink'
    }
  },
  getUploadData: function() {
    return {
      ETag: '"123b0b7aef8ba5d26ac7cab3438837f9"',
      Location: 'https://strato-external-storage.s3.amazonaws.com/1530596484075-Rie1vaW.png',
      key: '1530596484075-Rie1vaW.png',
      Key: '1530596484075-Rie1vaW.png',
      Bucket: 'strato-external-storage'
    };
  }
};

module.exports = factory;
