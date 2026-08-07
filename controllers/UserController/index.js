const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const AuthModel = require("../../models/AuthModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserDto = require("../../dtos/userDto");
const sendNotification = require("../../utilis/sendnotification");
const { AppTokens, UsersAppTokens } = require("../../models/TokenModel");

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
    if (appToken && platform) {
  try {
    const userID = userDetail._id;

    // Find or create the token in AppTokens collection
    let tokenDoc = await AppTokens.findOne({ token: appToken });

    if (!tokenDoc) {
      // Create new token if it doesn't exist
      tokenDoc = new AppTokens({
        token: appToken,
        platform: platform,
        isActive: true,
      });
      await tokenDoc.save();
    }

    // Check if token is already associated with another user
    const existingUserToken = await UsersAppTokens.findOne({
      tokens: tokenDoc._id,
    });

    if (existingUserToken) {
      // If token is already associated with a different user, remove it from that user
      if (existingUserToken.userID.toString() !== userID.toString()) {
        await UsersAppTokens.updateOne(
          { _id: existingUserToken._id },
          { $pull: { tokens: tokenDoc._id } },
        );
      } else {
        // Token already associated with this user, nothing to do
        console.log("Token already associated with this user");
        return;
      }
    }

    // Associate token with the current user
    let userTokenDoc = await UsersAppTokens.findOne({ userID: userID });

    if (!userTokenDoc) {
      // Create new user token document if doesn't exist
      userTokenDoc = new UsersAppTokens({
        userID: userID,
        tokens: [tokenDoc._id],
      });
      await userTokenDoc.save();
    } else {
      // Add token to existing user's token array if not already present
      if (!userTokenDoc.tokens.includes(tokenDoc._id)) {
        userTokenDoc.tokens.push(tokenDoc._id);
        await userTokenDoc.save();
      }
    }

    console.log("Token successfully associated with user");
  } catch (error) {
    console.error("Error managing tokens:", error);
  }
}

    return res.status(200).json(new UserDto(200, "Login successful", { token, phone }));
  } catch (error) {
    console.error("Error in login:", error);
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
const logout = (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  // Add the token to the blacklist
  revokedTokens.add(token);
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
};
