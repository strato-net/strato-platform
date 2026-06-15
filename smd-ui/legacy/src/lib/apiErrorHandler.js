export function handleApiError(response) {
  return new Promise(function(resolve,reject){
    if(response.error) {
      reject(response.error);
    }
    else {
      resolve(response);
    }
  })
}
