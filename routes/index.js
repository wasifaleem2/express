const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { fetchUsers, verifyUser, login, saveUser, updateUser, deleteUser, deleteAll, logout, searchUser, pushNotificationTest, registerAppToken, registerPublicKey, getPublicKey } = require("../controllers/UserController/index");
const {getMessage, getMessagedUsers, sendMessage, updateMessage, deleteMessage, deleteChat, getAllMessages, getNoOfMessage} = require("../controllers/MessagesController/index")
//middlewares
const authenticate = require("../middlewares/authenticate/index")
const checkUser = require("../middlewares/checkUser/index")

// Stricter limit on auth endpoints to slow brute-force / credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, message: "Too many attempts, try again later." },
});

router.post('/save', authLimiter, saveUser)
router.post(`/verify`, authLimiter, verifyUser)
router.post(`/login`, authLimiter, login)
// Removed: POST /notification/:token was unauthenticated and could push to any
// FCM token. Removed: DELETE /deleteAll let any logged-in user wipe every user.
router.get('/users',authenticate, fetchUsers)
router.get('/search',authenticate, searchUser)
router.put(`/update/:phone`,authenticate, updateUser)
router.delete(`/delete/:phone`,authenticate, deleteUser)
router.post(`/logout`,authenticate, logout)
router.post(`/app-token`,authenticate, registerAppToken)

// E2EE key exchange
router.post(`/keys`, authenticate, registerPublicKey)
router.get(`/keys/:phone`, authenticate, getPublicKey)

//messages routes
router.get('/message/no-of-messages', authenticate, getNoOfMessage)
router.get('/message/get', authenticate, getMessage)
router.get('/message/getall', authenticate, getAllMessages)
router.get('/message/getusers', authenticate, getMessagedUsers)
router.post('/message/send', authenticate, checkUser, sendMessage)
router.put(`/message/update/:id`, authenticate, updateMessage)
router.delete(`/message/delete/:id`, authenticate, deleteMessage)

module.exports = router;