let cookies;

export function parseJwt(token) {
  var base64Url = token.split('.')[1];
  var base64 = base64Url.replace('-', '+').replace('_', '/');
  return JSON.parse(window.atob(base64));
};

export function readCookie(name, c, C, i) {
  if (cookies) { return cookies[name]; }

  c = document.cookie.split('; ');
  cookies = {};

  for (i = c.length - 1; i >= 0; i--) {
    C = c[i].split('=');
    cookies[C[0]] = C[1];
  }

  return cookies[name];
}

export function setCookie(cname, cvalue, exdays) {
  var d = new Date();
  d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
  var expires = "expires=" + d.toGMTString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}