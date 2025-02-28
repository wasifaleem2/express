const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const MessageModel = require("../../models/MessagesModel");
const { StatusCodes } = require("http-status-codes");
const { connectedSockets } = require("../../utilis/Socket");

const getNoOfMessage = async (req, res) => {
  const phone = req.query.phone;
  console.log("this is ", phone);
  await MessageModel.countDocuments({
    $or: [{ senderNumber: phone }, { receiverNumber: phone }],
  })
    .then((count) => {
      console.log(`Number of documents in the collection: ${count}`);
      res.status(200).send(count.toString());
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const getMessage = (req, res) => {
  // console.log("users@@", req.user)
  // const phone = req.user.phone
  const senderNumber = req.query.senderNumber;
  const receiverNumber = req.query.receiverNumber;
  const phone = "555";
  // console.log(phone)
  MessageModel.find({
    $or: [
      { senderNumber: senderNumber, receiverNumber: receiverNumber },
      { senderNumber: receiverNumber, receiverNumber: senderNumber },
    ],
  })
    .exec()
    .then((msgs) => {
      res.status(200).send(msgs);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
};

const getAllMessages = (req, res) => {
  // console.log("users@@", req.user)
  const phone = req.query.phone;
  // console.log(phone)
  MessageModel.find({
    $or: [{ senderNumber: phone }, { receiverNumber: phone }],
  })
    .exec()
    .then((msgs) => {
      res.status(200).send(msgs);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
};

const getMessagedUsers = async (req, res) => {
  try {
    const phone = req.user.phone;
    const messages = await MessageModel.find({
      $or: [{ senderNumber: phone }, { receiverNumber: phone }],
    });

    const uniqueContacts = [
      ...new Set(
        messages.map((m) =>
          m.senderNumber === phone ? m.receiverNumber : m.senderNumber
        )
      ),
    ];

    const messageCount = uniqueContacts.map((contact) => {
      const count = messages.filter(
        (m) =>
          m.senderNumber === contact &&
          m.receiverNumber === phone &&
          m.status === "send"
      ).length;
      return { phone: contact, count };
    });

    const users = await UserModel.find({
      phone: { $in: uniqueContacts },
    }).select("name phone socketId");

    const usersWithMessageCount = users.map((user) => ({
      ...user.toObject(),
      count: messageCount.find((m) => m.phone === user.phone)?.count || 0,
    }));

    res.status(200).send(usersWithMessageCount);
  } catch (err) {
    console.log(err);
    res.status(500).send(err);
  }
};

const sendMessage = async (req, res) => {
  let senderNumber = req.body.senderNumber;
  let receiverNumber = req.body.receiverNumber;
  let text = req.body.text;
  let messageType = req.body.messageType;
  let dateTime = req.body.dateTime;
  console.log("message data received", dateTime)
  // let time = new Date().toLocaleTimeString();
  // let messageType = "text";
  console.log("messageType", messageType);
  let msg = new MessageModel({
    senderNumber: senderNumber,
    receiverNumber: receiverNumber,
    text: text,
    dateTime: dateTime || "",
    messageType: messageType,
  });
  msg
    .save()
    .then(async () => {
      senderSocket = connectedSockets[senderNumber];
      let recipient = await UserModel.findOne({ phone: receiverNumber });
      let sender = await UserModel.findOne({ phone: senderNumber });
      console.log("message", msg.text);
      senderSocket.emit("receive-message", {
        senderNumber,
        receiverNumber,
        text,
        dateTime,
        messageType,
      });
      senderSocket.to(recipient.socketId).emit("receive-message", {
        senderNumber,
        receiverNumber,
        text,
        dateTime,
        messageType,
      });
      res.status(200).send("send");
    })
    .catch((error) => {
      res
        .status(500)
        .send({ error: error, message: "Error sending message.." });
    });
};

const updateMessage = (req, res) => {
  let _id = req.params.id;
  let text = req.body.text;
  UserModel.findOneAndUpdate({ _id: _id }, { text: text })
    .then(() => {
      res.status(200).send(`message updated with ${text}`);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const deleteMessage = (req, res) => {
  let _id = req.params.id;
  MessageModel.deleteOne({ _id: _id })
    .then(() => {
      res.status(200).send(`message Deleted `);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

const deleteChat = (req, res) => {
  MessageModel.deleteMany({})
    .then(() => {
      res.status(200).send(`All user Deleted `);
    })
    .catch((error) => {
      res.status(500).send(error);
    });
};

module.exports = {
  getNoOfMessage,
  getMessage,
  getAllMessages,
  getMessagedUsers,
  sendMessage,
  updateMessage,
  deleteMessage,
  deleteChat,
};
