const factory = {
  getUserData: function(){
    return {
      userName: 'test02@test.com',
      hash: 'somehashstring',
      password: 'dontactuallyneedthisanymoreithink',
    }
  },
  getUploadData: function() {
    return {
      ETag: '"123b0b7aef8ba5d26ac7cab3438837f9"',
      Location: 'https://strato-external-storage.s3.amazonaws.com/1530596484075-Rie1vaW.png',
      key: '1530596484075-Rie1vaW.png',
      Key: '1530596484075-Rie1vaW.png',
      Bucket: 'strato-external-storage',
    };
  },
  getTestContent: function() {
    return {
      image: './test/testdata/testImage.png',
      meta: 'Nature Pics',
      provider: 's3',
    }
  },
  getTestSigners: function() {
    return ['6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad', 'a51f27e78aef85a06631f0725f380001e0ae9fb6']
  },
  getTestVerifiable: function() {
    return {
      uri: 'https://strato-external-storage.s3.amazonaws.com/1530511399877-widescreen.jpeg',
      timestamp: 1530538131,
    }
  },
};

module.exports = factory;
