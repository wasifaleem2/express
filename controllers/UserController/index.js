const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const AuthModel = require("../../models/AuthModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserDto = require("../../dtos/userDto");
const sendNotification = require("../../utilis/sendNotification");
const { saveAppToken, removeAppToken } = require("../../utilis/appTokens");

const fetchUsers = (req, res) => {
  // Never expose the password hash to clients.
  UserModel.find({})
    .select("-password")
    .exec()
    .then((userData) => {
      res.status(200).send(userData);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ message: "Server error" });
    });
};

// Escape user input before building a RegExp to prevent regex injection / ReDoS.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const searchUser = (req, res) => {
  const search = (req.query.search || "").trim();
  console.log("search for ", search);

  // Empty query returns nothing rather than every user.
  if (!search) {
    return res.status(200).send([]);
  }

  const regex = new RegExp(escapeRegex(search), "i");
  UserModel.find({ $or: [{ phone: { $regex: regex } }, { name: regex }] })
    .select("-password")
    .exec()
    .then((userData) => {
      res.status(200).send(userData);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ message: "Server error" });
    });
};

const saveUser = async (req, res) => {
  let ph = req.body.phone;
  let name = req.body.name;
  let password = req.body.password;
  let time = new Date();

  // Validate BEFORE hashing (previously the check ran after, and
  // `password < 5` compared a string to a number so it never fired).
  if (!ph || !password || !name) {
    return res.status(406).json({ err: "need to enter all fields" });
  }

  if (password.length < 5) {
    return res
      .status(406)
      .json({ err: "Password must be at least 5 characters" });
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

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
    const secretKey = process.env.JWT_SECRET || "my_secret_key";
    const expiresIn = process.env.JWT_EXPIRES_IN || "30d";

    console.log("phone in verify users", phone);
    let userDetail;
    if (forRegister && phone && name && password) {
      if (password.length < 5) {
        return res
          .status(400)
          .json(new UserDto(400, "Password must be at least 5 characters"));
      }

      const existingUser = await UserModel.findOne({ phone });
      if (existingUser) {
        return res.status(400).json(new UserDto(400, "User already exists"));
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const date = new Date().toISOString();

      const newUser = new UserModel({ phone, name, password: hashedPassword, date, socketId: "" });
      userDetail = await newUser.save();

      const token = jwt.sign({ phone }, secretKey, { expiresIn });

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

      return res.status(200).json(new UserDto(200, "User created", { token, phone, name }));
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

    const token = jwt.sign({ phone }, secretKey, { expiresIn });
    console.log("User logged in ->", phone);

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

    return res.status(200).json(new UserDto(200, "Login successful", { token, phone, name: user.name }));
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

// ---- End-to-end encryption key exchange ----

// Store the caller's public key so peers can encrypt messages to them.
const registerPublicKey = async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) {
      return res.status(400).json(new UserDto(400, "publicKey is required"));
    }
    const updated = await UserModel.findOneAndUpdate(
      { phone: req.user.phone },
      { publicKey },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json(new UserDto(404, "User not found"));
    }
    return res.status(200).json(new UserDto(200, "Public key registered"));
  } catch (error) {
    console.error("Error in registerPublicKey:", error);
    return res.status(500).json(new UserDto(500, "Server error"));
  }
};

// Return a peer's public key so the caller can encrypt to them.
const getPublicKey = async (req, res) => {
  try {
    const phone = req.params.phone;
    const user = await UserModel.findOne({ phone }).select("phone publicKey");
    if (!user || !user.publicKey) {
      return res
        .status(404)
        .json(new UserDto(404, "Public key not found for user"));
    }
    return res
      .status(200)
      .json(new UserDto(200, "Public key", { phone: user.phone, publicKey: user.publicKey }));
  } catch (error) {
    console.error("Error in getPublicKey:", error);
    return res.status(500).json(new UserDto(500, "Server error"));
  }
};

// Change the logged-in user's password. Requires the current password to
// match before setting the new (hashed) one.
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json(new UserDto(400, "Current and new password are required"));
    }
    if (newPassword.length < 5) {
      return res
        .status(400)
        .json(new UserDto(400, "New password must be at least 5 characters"));
    }

    const user = await UserModel.findOne({ phone: req.user.phone });
    if (!user) {
      return res.status(404).json(new UserDto(404, "User not found"));
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      // 400 (not 401): a wrong *current password* is bad input, not an expired
      // session. Returning 401 here trips the client's auth interceptor, which
      // wipes the stored token and breaks every later request until re-login.
      return res
        .status(400)
        .json(new UserDto(400, "Current password is incorrect"));
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.status(200).json(new UserDto(200, "Password updated"));
  } catch (error) {
    console.error("Error in changePassword:", error);
    return res.status(500).json(new UserDto(500, "Server error"));
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

const updateUser = async (req, res) => {
  try {
    // Always act on the authenticated user's own record — ignore the :phone
    // param as a target so a logged-in user can't rename someone else.
    const ph = req.user?.phone;
    const name = (req.body.name || "").trim();

    if (!name) {
      return res.status(400).json(new UserDto(400, "Name cannot be empty"));
    }

    const updated = await UserModel.findOneAndUpdate(
      { phone: ph },
      { name },
      { new: true }
    ).select("-password");

    if (!updated) {
      return res.status(404).json(new UserDto(404, "User not found"));
    }

    return res
      .status(200)
      .json(new UserDto(200, "Name updated", { phone: ph, name: updated.name }));
  } catch (error) {
    console.error("Error in updateUser:", error);
    return res.status(500).json(new UserDto(500, "Server error"));
  }
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

const logout = async (req, res) => {
  try {
    // Real revocation: clear the stored token so the JWT can no longer pass the
    // authenticate middleware (which compares against AuthModel). The old
    // in-memory `revokedTokens` Set was never consulted and lost on restart.
    if (req.user?.phone) {
      await AuthModel.deleteOne({ phone: req.user.phone });
    }

    // release the device so the next user on it does not inherit the
    // previous user's notifications
    await removeAppToken(req.body?.appToken);
  } catch (error) {
    console.error("Error on logout:", error);
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
  registerPublicKey,
  getPublicKey,
  changePassword,
};
