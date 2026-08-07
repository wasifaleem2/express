const mongoose = require('mongoose')

const AppTokenListSchema = mongoose.Schema({
    token: { type: String, required: true, unique: true },
    platform: { type: String, required: true },
    isActive: { type: Boolean, default: true },
}, { timestamps: true } );

var AppTokens = mongoose.model('apptokens', AppTokenListSchema);


const UsersAppTokensSchema = mongoose.Schema({
    userID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
        required: true,
        unique: true,
    },
    tokens : [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'apptokens'
        }
    ]
})

var UsersAppTokens = mongoose.model('userAppTokens', UsersAppTokensSchema)

module.exports = {UsersAppTokens, AppTokens}
