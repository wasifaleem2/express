const router = require("express").Router();
const { fetchUsers, verifyUser, saveUser, updateUser, deleteUser, deleteAll, logout } = require("../controllers/UserController/index");
const {getMessage, getMessagedUsers, sendMessage, updateMessage, deleteMessage, deleteChat} = require("../controllers/MessagesController/index")
//middlewares
const authenticate = require("../middlewares/authenticate/index")
const checkUser = require("../middlewares/checkUser/index")

router.post('/save', saveUser)
router.post(`/verify`, verifyUser)
// router.use(authenticate); // Middleware for authentication
router.get('/users',authenticate, fetchUsers)
router.put(`/update/:phone`,authenticate, updateUser)
router.delete(`/delete/:phone`,authenticate, deleteUser)
router.delete(`/deleteAll`,authenticate, deleteAll)
router.post(`/logout`,authenticate, logout)

//messages routes
router.get('/message/get', authenticate, checkUser, getMessage)
router.get('/message/getusers', authenticate, checkUser, getMessagedUsers)
router.post('/message/send', authenticate, checkUser, sendMessage)
router.put(`/message/update/:id`, authenticate, checkUser, updateMessage)
router.delete(`/message/delete/:id`, authenticate, checkUser, deleteMessage)

module.exports = router;