const UserModel = require("../../models/UserModel");
// Authentication middleware
async function checkUser(req, res, next) {
    try{
        // Group sends have no single receiverNumber — membership is validated
        // inside sendMessage against the GroupModel. Skip the 1:1 recipient check.
        if (req.body.groupId) {
            return next();
        }
        let receiverNumber = req.body.receiverNumber;
        // let receiverNumber = "555";
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
