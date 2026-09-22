import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './errors.js';
import { getRoles } from './db.js';

function createAccessIdentityResolver({ teamDomain, audience, devAuthEmail, env = 'development' }) {
  let jwks;
  if (teamDomain) {
    const issuer = `https://${teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
    jwks = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)) };
  }
  return async function resolveAccessIdentity(req) {
    let email;
    const token = req.get('cf-access-jwt-assertion');
    if (token && jwks && audience) {
      try {
        const { payload } = await jwtVerify(token, jwks.keys, { issuer: jwks.issuer, audience });
        email = payload.email;
      } catch {
        throw new HttpError(401, 'invalid_access_token', 'The Cloudflare Access token is invalid.');
      }
    } else if (env !== 'production' && devAuthEmail) {
      email = devAuthEmail;
    } else {
      throw new HttpError(401, 'authentication_required', 'A valid Cloudflare Access session is required.');
    }
    if (!email) throw new HttpError(401, 'invalid_identity', 'The authenticated identity has no email address.');
    return { email: String(email).toLowerCase() };
  };
}

export function createAccessAuthenticator(options) {
  const resolveIdentity = createAccessIdentityResolver(options);
  return async function authenticateAccess(req, _res, next) {
    try {
      req.identity = await resolveIdentity(req);
      next();
    } catch (error) { next(error); }
  };
}

export function createAdminAuthenticator({ db, ...options }) {
  const resolveIdentity = createAccessIdentityResolver(options);
  return async function authenticateAdmin(req, _res, next) {
    try {
      const identity = await resolveIdentity(req);
      const email = identity.email;
      const roles = getRoles(db, email);
      if (!roles.length) throw new HttpError(403, 'not_authorized', 'This account has no Cornerstone Signatures management role.');
      req.identity = identity;
      req.admin = { email, roles };
      next();
    } catch (error) { next(error); }
  };
}

export function requireRole(role) {
  return (req, _res, next) => req.admin?.roles.includes(role)
    ? next()
    : next(new HttpError(403, 'insufficient_role', `The ${role} role is required.`));
}

export function requireAnyRole(...allowedRoles) {
  return (req, _res, next) => req.admin?.roles.some((role) => allowedRoles.includes(role))
    ? next()
    : next(new HttpError(403, 'insufficient_role', `One of these roles is required: ${allowedRoles.join(', ')}.`));
}

export function createMicrosoftUserResolver({ tenantId, audience }) {
  if (!tenantId || !audience) {
    return async function missingMicrosoftConfiguration() {
      throw new HttpError(503, 'microsoft_auth_not_configured', 'Microsoft API authentication is not configured.');
    };
  }
  const keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`));
  const issuers = [`https://login.microsoftonline.com/${tenantId}/v2.0`, `https://sts.windows.net/${tenantId}/`];
  const acceptedAudiences = [audience];
  const applicationIdMatch = /^api:\/\/([0-9a-f-]{36})$/i.exec(audience);
  if (applicationIdMatch) acceptedAudiences.push(applicationIdMatch[1]);
  return async function resolveMicrosoftUser(req) {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'authentication_required', 'A Microsoft API bearer token is required.');
    let payload;
    try {
      ({ payload } = await jwtVerify(authorization.slice(7), keys, { issuer: issuers, audience: acceptedAudiences }));
    } catch {
      throw new HttpError(401, 'invalid_microsoft_token', 'The Microsoft API token is invalid.');
    }
    const scopes = String(payload.scp || '').split(/\s+/);
    if (!scopes.includes('Signature.Read') && !scopes.includes('access_as_user')) {
      throw new HttpError(403, 'missing_scope', 'The Signature.Read or access_as_user delegated permission is required.');
    }
    const email = String(payload.preferred_username || payload.upn || payload.email || '').trim().toLowerCase();
    if (!email) throw new HttpError(403, 'missing_email', 'The Microsoft profile has no usable email address.');
    return { email, microsoftId: payload.oid || payload.sub };
  };
}
