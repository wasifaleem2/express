const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const AuthModel = require("../../models/AuthModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserDto = require("../../dtos/userDto");
const sendNotification = require("../../utilis/sendNotification");
const { saveAppToken, removeAppToken } = require("../../utilis/appTokens");

const fetchUsers = (req, res) => {
  UserModel.find({})
    .exec()
    .then((userData) => {
      console.log("data", userData);
      res.status(200).send(userData);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
};

const searchUser = (req, res) => {
  let search = req.query.search;
  console.log("search for ", search);
  const regex = new RegExp(search, "i");
  UserModel.find({ $or:  [{phone: { $regex: regex }}, {name: regex}] })
    .exec()
    .then((userData) => {
      console.log("data", userData);
      res.status(200).send(userData);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
};

const saveUser = async (req, res) => {
  let ph = req.body.phone;
  let name = req.body.name;
  let password = req.body.password;
  let time = new Date();

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  if (!ph || !password || !name) {
    return res.status(406).json({ err: "need to enter all fields" });
  }

  if (password < 5) {
    return res
      .status(406)
      .json({ err: "Password must be atleast 6 characters" });
  }

  let user = new UserModel({
    phone: ph,
    name: name,
    password: hashedPassword,
    time: time,
  });
  user
    .save()
    .then(() => {
      res.status(200).send("saved");
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const verifyUser = async (req, res) => {
  try {
    let ph = req.body.phone;
    const user = await UserModel.findOne({ phone: ph });
    console.log("verified user", user)
    if (user != null && user != undefined) {
      res.status(200).json(new UserDto(200, "Login to Continue...", {phone: ph, userExist: true}));
    } else {
      res.status(200).json(new UserDto(404, "Creating a new account", {phone: ph, userExist: false}));
    }
  } catch (error) {
    res.status(500).json(new UserDto(500, "Server Error", error));
  }
};

const login = async (req, res) => {
  try {
    const { phone, password, name, forRegister, appToken, platform } = req.body;
    const secretKey = "my_secret_key";

    console.log("phone in verify users", phone);
    let userDetail;
    if (forRegister && phone && name && password) {
      const existingUser = await UserModel.findOne({ phone });
      if (existingUser) {
        return res.status(400).json(new UserDto(400, "User already exists"));
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const date = new Date().toISOString();
      
      const newUser = new UserModel({ phone, name, password: hashedPassword, date, socketId: "" });
      userDetail = await newUser.save();

      const token = jwt.sign({ phone }, secretKey);

      await AuthModel.findOneAndUpdate(
        { phone },
        { $set: { phone, token } },
        { upsert: true, new: true }
      );

      try {
        await saveAppToken(userDetail._id, appToken, platform);
      } catch (error) {
        // a failed token save must not block the account creation
        console.error("Error saving app token on register:", error);
      }

      return res.status(200).json(new UserDto(200, "User created", { token, phone }));
    }

    const user = await UserModel.findOne({ phone });
    if (!user) {
      return res.status(404).json(new UserDto(404, "User not found"));
    }
    userDetail = user;

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json(new UserDto(401, "Invalid credentials"));
    }

    const token = jwt.sign({ phone }, secretKey);
    console.log("User token to send ->", token);

    await AuthModel.findOneAndUpdate(
      { phone },
      { $set: { phone, token } },
      { upsert: true, new: true }
    );
    console.log("userDetail", userDetail?._id)

    try {
      await saveAppToken(userDetail._id, appToken, platform);
    } catch (error) {
      // a failed token save must not block the login
      console.error("Error saving app token on login:", error);
    }

    return res.status(200).json(new UserDto(200, "Login successful", { token, phone }));
  } catch (error) {
    console.error("Error in login:", error);
    return res.status(500).json(new UserDto(500, "Server error", error));
  }
};

/**
 * Saves the device token for an already logged-in user. FCM rotates tokens
 * (reinstall, app data cleared, restore), so the client calls this from its
 * onTokenRefresh handler — otherwise notifications silently stop working
 * until the next login.
 */
const registerAppToken = async (req, res) => {
  try {
    const { appToken, platform } = req.body;

    if (!appToken || !platform) {
      return res
        .status(400)
        .json(new UserDto(400, "appToken and platform are required"));
    }

    const user = await UserModel.findOne({ phone: req.user.phone });
    if (!user) {
      return res.status(404).json(new UserDto(404, "User not found"));
    }

    await saveAppToken(user._id, appToken, platform);

    return res.status(200).json(new UserDto(200, "App token saved"));
  } catch (error) {
    console.error("Error in registerAppToken:", error);
    return res.status(500).json(new UserDto(500, "Server error", error));
  }
};

const pushNotificationTest = async (req, res) => {
    try {
        const notificationToken = req.params.token;
        let title = req.body.title;
        let body = req.body.body;
        let image = req.body.imageUrl;

        if (!notificationToken) {
            return res.status(400).json({
                status: "Error",
                details: "FCM token is required"
            });
        }

        if (!title || !body ) {
            return res.status(400).json({
                status: "Error",
                details: "Please provide title and body"
            });
        }

        const message = {
            notification: {
                title: title,
                body: body,
                image: image
            },
            token: notificationToken,
        };

        const response = await sendNotification(message);

        return res.status(200).json({
            status: "success",
            firebaseResponse: response
        });
    } catch (error) {
        return res.status(500).json({
            status: "Error",
            details: error.message
        });
    }
};

const updateUser = (req, res) => {
  let ph = req.params.phone;
  let name = req.body.name;
  UserModel.findOneAndUpdate({ phone: ph }, { name: name })
    .then(() => {
      res.status(200).send(`User updatedwith phone ${ph}`);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const deleteUser = (req, res) => {
  let ph = req.params.phone;
  UserModel.deleteOne({ phone: ph })
    .then(() => {
      res.status(200).send(`(${ph}) user Deleted `);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const deleteAll = (req, res) => {
  UserModel.deleteMany({})
    .then(() => {
      res.status(200).send(`All user Deleted `);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const revokedTokens = new Set();
const logout = async (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  // Add the token to the blacklist
  revokedTokens.add(token);

  // release the device so the next user on it does not inherit the
  // previous user's notifications
  try {
    await removeAppToken(req.body?.appToken);
  } catch (error) {
    console.error("Error removing app token on logout:", error);
  }

  res.sendStatus(200);
};

module.exports = {
  fetchUsers,
  searchUser,
  verifyUser,
  login,
  saveUser,
  updateUser,
  deleteUser,
  deleteAll,
  logout,
  pushNotificationTest,
  registerAppToken,
};
