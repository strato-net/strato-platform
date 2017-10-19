export function handleApiError(response) {
  return new Promise(function(resolve,reject){
    if(!response.ok) {
      //reject(new Error(response.error));
    }
    else {
      resolve(response);
    }
  })
}
