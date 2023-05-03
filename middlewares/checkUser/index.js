const UserModel = require("../../models/UserModel");
// Authentication middleware
async function checkUser(req, res, next) {
    try{
        let receiverNumber = req.body.receiverNumber;
        const user = await UserModel.findOne({phone : receiverNumber})
        if(user)
        {
            // console.log("receiver",user)
            next();
        }
        else{
            return res.status(400).send(`no user found with number ${receiverNumber}`);
        }
    }
    catch(error){
        res.status(500).send(error);
    }
}

module.exports = checkUser;
