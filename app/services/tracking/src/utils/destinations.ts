// Destinations are free-form (only allowlisted dashboard admins can set them),
// but must still be safe to emit in a Location header: either a host-relative
// path (resolved against whichever node edge proxied /t/) or an absolute
// http(s) URL. Applied at link creation/edit AND re-applied at resolve time so
// a bad stored row can never turn into a header injection.
export const isValidDestination = (destination: string): boolean => {
  if (typeof destination !== "string") return false;
  if (destination.length === 0 || destination.length > 2048) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(destination)) return false;
  if (destination.startsWith("/")) {
    // "//host" is protocol-relative, i.e. an absolute URL in disguise
    return !destination.startsWith("//");
  }
  try {
    const url = new URL(destination);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
