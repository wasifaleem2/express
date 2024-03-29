const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const MessageModel = require("../../models/MessagesModel");
const { StatusCodes } = require("http-status-codes")
const { connectedSockets } = require("../../utilis/Socket");


const getNoOfMessage = async (req, res) => {
    const phone = req.query.phone
    console.log("this is ", phone);
    await MessageModel.countDocuments({ $or: [{ senderNumber: phone }, { receiverNumber: phone }] })
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
    const phone = "555"
    // console.log(phone)
    MessageModel.find({ $or: [{ senderNumber: senderNumber, receiverNumber: receiverNumber }, { senderNumber: receiverNumber, receiverNumber: senderNumber }] })
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
    MessageModel.find({ $or: [{ senderNumber: phone }, { receiverNumber: phone }] })
        .exec()
        .then((msgs) => {
            res.status(200).send(msgs);
        })
        .catch((err) => {
            console.log(err);
            res.status(500).send(err);
        });
};

const getMessagedUsers = (req, res) => {
    const phone = req.user.phone;
    MessageModel.find({ $or: [{ senderNumber: phone }, { receiverNumber: phone }] })
        .exec()
        .then((msgs) => {
            const numbers = [...new Set(msgs.map(m => m.senderNumber === phone ? m.receiverNumber : m.senderNumber))];
            UserModel.find({ phone: { $in: numbers } })
                .select('name phone socketId')
                .exec()
                .then((users) => {
                    for (let i = 0; i < users.length; i++) {
                        MessageModel.findOne({ $or: [{ senderNumber: phone }, { receiverNumber: phone }] })
                    }
                    res.status(200).send(users);
                })
                .catch((error) => {
                    console.log(error)
                    res.status(500).send(error);
                })
        })
        .catch((err) => {
            console.log(err);
            res.status(500).send(err);
        });
};
// const getMessagedUsers = (req, res) => {
//     // const phone = req.user.phone
//     // Get all unique sender and receiver phone numbers in the message collection that correspond to user with phone number '1234567890'
//     try{
//         MessageModel.distinct('senderNumber', { receiverNumber: "555" }, (err, senderNumbers) => {
//             if (err) {
//                 res.status(500).send(err);
//             } else {
//                 console.log("sendernumber s", senderNumbers)
//                 res.status(200).send(senderNumbers);
//                 // Add user phone numbers from receiverNumber field
//                 // MessageModel.distinct('receiverNumber', { senderNumber: phone }, (err, receiverNumbers) => {
//                 // if (err) {
//                 //     res.status(500).send(err);
//                 // } else {
//                 //     // const phoneNumbers = [...senderNumbers, ...receiverNumbers];
//                 //     // console.log("messaged", phoneNumbers);
//                 //     res.status(200).send(receiverNumbers);
//                 //     // Remove duplicates
//                 //     // const uniquePhoneNumbers = Array.from(new Set(phoneNumbers));
//                 //     // // Find all users with matching phone numbers
//                 //     // UserModel.find({ phone: { $in: uniquePhoneNumbers } }, (err, users) => {
//                 //     // if (err) {
//                 //     //     res.status(500).send(err);
//                 //     // } else {
//                 //     //     res.status(200).send(users);
//                 //     // }
//                 //     // });
//                 // }
//                 // });
//             }
//             });
//     }
//     catch(err){
//         console.log(err)
//     }
// };

const sendMessage = async (req, res) => {
    let senderNumber = req.body.senderNumber;
    let receiverNumber = req.body.receiverNumber;
    let text = req.body.text;
    let messageType = req.body.messageType;
    let date = new Date().toLocaleDateString();
    let time = new Date().toLocaleTimeString();
    // let messageType = "text";
    console.log("messageType",messageType);
    let msg = new MessageModel({ senderNumber: senderNumber, receiverNumber: receiverNumber, text: text, date: date, time: time, messageType: messageType })
    msg.save()
        .then(async() => {       
            senderSocket = connectedSockets[senderNumber];
            let recipient = await UserModel.findOne({ phone: receiverNumber });
            let sender = await UserModel.findOne({ phone: senderNumber });
            console.log("message", msg.text)
            senderSocket.emit("receive-message", { senderNumber, receiverNumber, text, date, time, messageType })
            senderSocket.to(recipient.socketId).emit('receive-message', msg.text);
            res.status(200).send("send")
        })
        .catch((error) => {
            res.status(500).send(error);
        })
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
        })
};

const deleteMessage = (req, res) => {
    let _id = req.params.id
    MessageModel.deleteOne({ _id: _id })
        .then(() => {
            res.status(200).send(`message Deleted `);
        })
        .catch((error) => {
            res.status(500).send(error);
        })
};

const deleteChat = (req, res) => {
    MessageModel.deleteMany({})
        .then(() => {
            res.status(200).send(`All user Deleted `);
        })
        .catch((error) => {
            res.status(500).send(error);
        })
};

module.exports = { getNoOfMessage, getMessage, getAllMessages, getMessagedUsers, sendMessage, updateMessage, deleteMessage, deleteChat }