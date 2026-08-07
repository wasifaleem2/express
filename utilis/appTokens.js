const { AppTokens, UsersAppTokens } = require("../models/TokenModel");

/**
 * Stores an FCM device token and links it to a user.
 *
 * - `AppTokens`      holds one document per physical device token.
 * - `UsersAppTokens` holds one document per user with the list of token ids.
 *
 * A device token belongs to exactly one user at a time, so logging in on a
 * device that was previously used by somebody else moves the token over
 * instead of leaving the old user subscribed to that device.
 */
const saveAppToken = async (userID, token, platform) => {
  if (!userID || !token || !platform) {
    return null;
  }

  let tokenDoc;
  try {
    tokenDoc = await AppTokens.findOneAndUpdate(
      { token },
      { $set: { token, platform, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // two logins with the same token can race on the unique index
    if (error.code !== 11000) throw error;
    tokenDoc = await AppTokens.findOne({ token });
  }

  if (!tokenDoc) return null;

  // detach the token from every other user
  await UsersAppTokens.updateMany(
    { userID: { $ne: userID }, tokens: tokenDoc._id },
    { $pull: { tokens: tokenDoc._id } }
  );

  // $addToSet compares ObjectIds by value, so re-logins never duplicate
  await UsersAppTokens.updateOne(
    { userID },
    { $addToSet: { tokens: tokenDoc._id } },
    { upsert: true }
  );

  return tokenDoc;
};

/**
 * Detaches a device token from its user (used on logout) and marks it
 * inactive so notifications are no longer sent to it.
 */
const removeAppToken = async (token) => {
  if (!token) return null;

  const tokenDoc = await AppTokens.findOneAndUpdate(
    { token },
    { $set: { isActive: false } },
    { new: true }
  );

  if (!tokenDoc) return null;

  await UsersAppTokens.updateMany(
    { tokens: tokenDoc._id },
    { $pull: { tokens: tokenDoc._id } }
  );

  return tokenDoc;
};

/**
 * Returns the active FCM token strings for a user, ready to be passed to
 * firebase-admin's sendEachForMulticast.
 */
const getUserTokens = async (userID) => {
  if (!userID) return [];

  const userTokenDoc = await UsersAppTokens.findOne({ userID }).populate(
    "tokens"
  );

  if (!userTokenDoc) return [];

  return userTokenDoc.tokens
    .filter((tokenDoc) => tokenDoc && tokenDoc.isActive)
    .map((tokenDoc) => tokenDoc.token);
};

module.exports = { saveAppToken, removeAppToken, getUserTokens };
