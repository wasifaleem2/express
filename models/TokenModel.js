const mongoose = require('mongoose')

const UsersAppTokensSchema = mongoose.Schema({
    userID: {
        type: mongoose.Types.ObjectId,
        required: true,
    },
    tokens : [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'usertokens'
        }
    ]    
})

var UsersAppTokens = mongoose.model('userAppTokens', UsersAppTokensSchema)


const AppTokenListSchema = mongoose.Schema({
    token: { type: String, required: true },
    platform: { type: String, required: true },
    isActive: { type: Boolean, default: true },
}, { timestamps: true } );

var AppTokens = mongoose.model('apptokens', AppTokenListSchema);

module.exports = {UsersAppTokens, AppTokens}