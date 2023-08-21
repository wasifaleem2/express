const mongoose = require("mongoose");
const UserModel = require("../../models/UserModel");
const AuthModel = require("../../models/AuthModel")
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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
    let search = req.query.search; // use querry of params in get request
    console.log("search for ",search)
    const regex = new RegExp(search, 'i');
    UserModel.find({phone: { $regex: regex }})
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
        return res.status(406).json({ err: "Password must be atleast 6 characters" });
    }

    let user = new UserModel({ phone: ph, name: name, password:hashedPassword, time: time })
    user.save()
        .then(() => {
            res.status(200).send("saved")
        })
        .catch((error) => {
            res.status(500).send(error);
        })
};

const verifyUser = async (req, res) => {
    try{
        let ph = req.body.phone;
        // let password = req.body.password;
        let password = "12345";
        console.log("phone in verify users", ph)
        // The payload is a JSON object that contains the data 
        // you want to include in the token. e.g user_id
        const payload = {
            phone:ph,
            password: password
        };
        // The secret key is a string that is used to digitally sign the payload &
        // verify its authenticity.
        const secretKey = `my_secret_key`;
        const user = await UserModel.findOne({phone : ph})
        if(user != null && user != undefined)
        {
            const token = jwt.sign(payload, secretKey, { expiresIn: '24h' });
            console.log(token)
            AuthModel.findOneAndUpdate(
                { phone: ph },  // condition to check for existing document
                { $set: {phone: ph, token: token} },  // update operation
                { upsert: true, new: true },)
            .then(() => {
                // req.user = payload;
                console.log("req.user",req.user);
                res.status(200).send({token, phone:ph});
            })
            .catch((error) => {
                res.status(500).send(error);
            })
            // res.status(200).send(token);
        }
        else{
            res.status(200).send("No User Found");
        }
    }
    catch(error){
        res.status(500).send(error);
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
        })
};

const deleteUser = (req, res) => {
    let ph = req.params.phone
    UserModel.deleteOne({ phone: ph })
        .then(() => {
            res.status(200).send(`(${ph}) user Deleted `);
        })
        .catch((error) => {
            res.status(500).send(error);
        })
};

const deleteAll = (req, res) => {
    UserModel.deleteMany({})
        .then(() => {
            res.status(200).send(`All user Deleted `);
        })
        .catch((error) => {
            res.status(500).send(error);
        })
};

const revokedTokens = new Set();
const logout = (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    // Add the token to the blacklist
    revokedTokens.add(token);
    res.sendStatus(200);
};

module.exports = {fetchUsers, searchUser, verifyUser, saveUser, updateUser, deleteUser, deleteAll, logout}