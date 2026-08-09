const jwt = require('jsonwebtoken');
const AuthModel = require("../../models/AuthModel");

// Single source of truth for the signing secret (see also UserController login).
const secret = process.env.JWT_SECRET || 'my_secret_key';

// Authentication middleware
function authenticate(req, res, next) {
  // Get the JWT token from the request headers
  const authHeader = req.headers['authorization'];
  // extract the actual token, removing the "Bearer " prefix
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.sendStatus(401); // Unauthorized
  }

  // Verify the signature/expiry first.
  jwt.verify(token, secret, async (err, user) => {
    if (err) {
      return res.sendStatus(403); // Forbidden (bad signature or expired)
    }
    try {
      // Enforce server-side revocation: the presented token must match the one
      // stored for this user at login. logout clears it, so a logged-out (or
      // superseded) token can no longer authenticate — previously this check
      // was `if (token == token)`, which was always true and did nothing.
      const auth = await AuthModel.findOne({ phone: user.phone });
      if (!auth || auth.token !== token) {
        return res.sendStatus(403);
      }
      req.user = user;
      next();
    } catch (e) {
      console.error('authenticate error:', e);
      return res.sendStatus(500);
    }
  });
}

module.exports = authenticate;
