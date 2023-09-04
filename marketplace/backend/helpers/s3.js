import aws from 'aws-sdk'
import axios from 'axios';

export const uploadFileToS3 = async ( endpoint, data, accessToken) => {

  return axios.post(endpoint, data, {

    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  })
  .then(response => {
    console.log('POST request successful:', response.data);
    return response.data;
  })
  .catch(error => {
    console.error('Error making POST request:', error);
    return error;
  });
}

export const getFileStreamFromS3 = function (fileKey, s3Options) {
  const s3 = new aws.S3(s3Options)
  const fileStream = s3
    .getObject({
      Bucket: s3Options.bucket.Bucket,
      Key: fileKey,
    })
    .createReadStream()
  return fileStream
}

export const getSignedUrlFromS3 = function (fileKey, s3Options) {
  const s3 = new aws.S3(s3Options)
  const signedUrl = s3.getSignedUrl('getObject', {
    Bucket: s3Options.bucket.Bucket,
    Key: fileKey,
  });
  return signedUrl
}

export const deleteFileFromS3 = async function (fileKey, s3Options) {
  const s3 = new aws.S3(s3Options)
  return new Promise((resolve, reject) => {
    s3.deleteObject(
      {
        Bucket: s3Options.bucket.Bucket,
        Key: fileKey,
      },
      (err, data) => {
        if (err) {
          return reject(false)
        }
        return resolve(true)
      },
    )
  })
}
