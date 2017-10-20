export function handleApiError(response) {
  return new Promise(function(resolve,reject){
    if(!response.ok) {
      reject(response.error);
    }
    else {
      resolve(response);
    }
  })
}
