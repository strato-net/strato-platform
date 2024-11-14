function setCookie(name, value, minutes) {
  // Check if the cookie already exists
  const existingCookie = getCookie(name);

  // If the cookie exists, clear it before setting a new one
  if (existingCookie) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }

  const expires = new Date();
  expires.setTime(expires.getTime() + minutes * 60 * 1000);
  const cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
  document.cookie = cookie;
}

// Function to get a cookie
function getCookie(name) {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

function delete_cookie(name) {
  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/';
}

export { setCookie, getCookie, delete_cookie };
