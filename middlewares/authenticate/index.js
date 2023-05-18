const jwt = require('jsonwebtoken');
const secret = 'my_secret_key';
const AuthModel = require("../../models/AuthModel");

// Authentication middleware
function authenticate(req, res, next) {
  // Get the JWT token from the request headers 
  const authHeader = req.headers['authorization'];
  // extract the actual token removing bearer
  const token = authHeader && authHeader.split(' ')[1];
  // if no token
  if (!token) {
    return res.sendStatus(401); // Unauthorized
  }
  // Verify the JWT using secret key and token
  jwt.verify(token, secret, async (err, user) => {
    if (err) {
      return res.sendStatus(403); // Forbidden
    }
      // Extract the payload of the token contains information/user that can be used
      // ..if required using const phone = req.user.phone in other routes handling
      // for get apis use querry instead of body
      let ph = req.query.phone;
      console.log("phone",ph);
      const auth = await AuthModel.findOne({phone : ph})
      console.log("auth.token",auth.token)
      if(auth.token == token){
        // req.user = user; // saving user to req.user can be excess anywhere      
        // if you have a route handler that needs to make a request to another API endpoint
        // JWT token can be passed in the headers
        //  const token = req.headers['Authorization'];
        req.headers['Authorization'] = `Bearer ${token}`;
        req.user = user;
        // req.payload = user;
        // next() is used to pass to the next middleware function or route
        next();
      }
      else{
        return res.sendStatus(403);
      }
  });
}

module.exports = authenticate;
