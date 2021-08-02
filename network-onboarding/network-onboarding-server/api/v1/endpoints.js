//
// The PUT endpoints are idempotent, they will NOT actually call the blockchain if the
// blockchain is already in the requested state
//

export const Authentication = {
  prefix: '/authentication',
  callback: '/callback',
  logout: '/logout',
}

// Users' membership of organizations is controlled by the Users endpoints
// The lists returned getUserInvites and getUserRequests endpoints in Organizations 
// are created by invite and request in Users
export const Users = {
  prefix: '/users',

  // Create -- NB this will update organization's lists! We get an address from this!
  create: '/',          // PUT

  invite: '/invite',    // PUT invite
  inviteAccept: '/invite/:address/accept',  // PUT invite acceptance
  inviteReject: '/invite/:address/reject',  // PUT invite rejection

  request: '/request',  // PUT request, accept, reject.
  requestAccept: '/request/:address/accept', // PUT request accept
  requestReject: '/request/:address/reject', // PUT request reject

  // Read
  me: '/me',            // GET all my information
  get: '/:address',     // GET role, certificate

  // Update
  update: '/:address',  // PUT role and certificate updates

  // Delete
  remove: '/:address'   // DELETE user
}


export const Organizations = {
  prefix: '/organizations',

  // Create
  create: '/',          // PUT

  invite: '/invite',    // PUT invite
  inviteAccept: '/invite/:address/accept',  // PUT invite acceptance
  inviteReject: '/invite/:address/reject',  // PUT invite rejection

  request: '/request',  // PUT request, accept, reject.
  requestAccept: '/request/:address/accept', // PUT request accept
  requestReject: '/request/:address/reject', // PUT request reject

  // Read
  me: '/me',                                    // GET my organization's information
  getAll: '/',                                  // GET all orgs
  get: '/:address',                             // GET an orgs info (cert etc)
  // User onboarding onto organizations is handled by User endpoints/certs
  getUsers: '/:address/users',                  // GET org's users
  getUserInvites: '/:address/users/invites',    // GET pending invites' statues (closely tied with user)
  getUserRequests: '/:address/users/requests',  // GET pending requests' requests (closely tied with user)

  // Update
  update: '/:address',  // PUT certificate updates

  // Delete
  remove: '/:address'   // DELETE
}


export const Applications = {
  prefix: '/applications',

  // Create
  create: '/',  // PUT new application

  // Read - Nothing for read?

  // Update
    // Update/CRUD to applications's organizations list -- address = app's address
    // Create for orgs
    addOrganization: '/:address/organizations',                  // PUT

    inviteOrganization: '/:address/organizations/invite',        // PUT invite, accept, reject.
    inviteOrganizationAccept: '/:appAddress/organizations/invite/:orgAddress/accept', // PUT invite, accept, reject.
    inviteOrganizationReject: '/:appAddress/organizations/invite/:orgAddress/reject', // PUT invite, accept, reject.

    requestOrganization: '/:address/organizations/request',      // PUT request, accept, reject.
    requestOrganizationAccept: '/:appAddress/organizations/invite/:orgAddress/accept', // PUT invite, accept, reject.
    requestOrganizationReject: '/:appAddress/organizations/invite/:orgAddress/reject', // PUT invite, accept, reject.

    // Read for organizations
    getOrganizations: '/:address/organizations',                 // GET an apps organizations
    getOrganizationInvites: '/:address/organizations/invites',   // GET current pending org invites
    getOrganizationRequests: '/:address/organizations/requests', // GET current pending org requests

    // Update for organizations - Nothing!

    // Delete for organizations
    removeOrgfromApp: '/:address/organizations/:orgAddress',   // DELETE

  // Delete
  remove: '/:address'   // DELETE
}
