const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { fetchUsers, verifyUser, login, saveUser, updateUser, deleteUser, deleteAll, logout, searchUser, lookupUsers, pushNotificationTest, registerAppToken, registerPublicKey, getPublicKey, changePassword } = require("../controllers/UserController/index");
const {getMessage, getMessagedUsers, sendMessage, updateMessage, deleteMessage, deleteChat, getAllMessages, getNoOfMessage} = require("../controllers/MessagesController/index")
const {createGroup, getMyGroups, getGroup, addMembers, removeMember, promoteAdmin, demoteAdmin, leaveGroup} = require("../controllers/GroupController/index")
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
router.post('/users/lookup',authenticate, lookupUsers)
router.put(`/update/:phone`,authenticate, updateUser)
router.delete(`/delete/:phone`,authenticate, deleteUser)
router.post(`/logout`,authenticate, logout)
router.post(`/app-token`,authenticate, registerAppToken)
router.post(`/change-password`,authenticate, changePassword)

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
router.delete(`/message/chat/:recipient`, authenticate, deleteChat)

// group routes (membership fixed at creation for v1)
router.post('/group', authenticate, createGroup)
router.get('/group/getall', authenticate, getMyGroups)
// Membership & admin management (static-ish sub-paths; registered before the
// bare GET /:groupId is fine since methods/depths differ).
router.post('/group/:groupId/members', authenticate, addMembers)
router.delete('/group/:groupId/members/:member', authenticate, removeMember)
router.post('/group/:groupId/admins/:member', authenticate, promoteAdmin)
router.delete('/group/:groupId/admins/:member', authenticate, demoteAdmin)
router.post('/group/:groupId/leave', authenticate, leaveGroup)
router.get('/group/:groupId', authenticate, getGroup)

module.exports = router;