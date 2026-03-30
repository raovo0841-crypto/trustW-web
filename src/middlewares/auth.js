/**
 * src/middlewares/auth.js
 * JWT authentication middleware for web app
 */
const { extractToken, verifyToken } = require('../utils/jwt');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);
    if (!token) throw new UnauthorizedError('No token provided');

    const payload = verifyToken(token);
    req.user = {
      id: payload.userId,
      email: payload.email,
      isAdmin: payload.isAdmin
    };
    next();
  } catch (error) {
    next(error);
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user) return next(new UnauthorizedError('Authentication required'));
  if (!req.user.isAdmin) return next(new ForbiddenError('Admin privileges required'));
  next();
}

module.exports = { authMiddleware, adminMiddleware };
