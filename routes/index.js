const router = require("express").Router();
const { fetchUsers, verifyUser, login, saveUser, updateUser, deleteUser, deleteAll, logout, searchUser, pushNotificationTest, registerAppToken } = require("../controllers/UserController/index");
const {getMessage, getMessagedUsers, sendMessage, updateMessage, deleteMessage, deleteChat, getAllMessages, getNoOfMessage} = require("../controllers/MessagesController/index")
//middlewares
const authenticate = require("../middlewares/authenticate/index")
const checkUser = require("../middlewares/checkUser/index")

router.post('/save', saveUser)
router.post(`/verify`, verifyUser)
router.post(`/login`, login)
// Removed: POST /notification/:token was unauthenticated and could push to any
// FCM token. Removed: DELETE /deleteAll let any logged-in user wipe every user.
router.get('/users',authenticate, fetchUsers)
router.get('/search',authenticate, searchUser)
router.put(`/update/:phone`,authenticate, updateUser)
router.delete(`/delete/:phone`,authenticate, deleteUser)
router.post(`/logout`,authenticate, logout)
router.post(`/app-token`,authenticate, registerAppToken)

//messages routes
router.get('/message/no-of-messages', authenticate, getNoOfMessage)
router.get('/message/get', authenticate, getMessage)
router.get('/message/getall', authenticate, getAllMessages)
router.get('/message/getusers', authenticate, getMessagedUsers)
router.post('/message/send', authenticate, checkUser, sendMessage)
router.put(`/message/update/:id`, authenticate, updateMessage)
router.delete(`/message/delete/:id`, authenticate, deleteMessage)

module.exports = router;