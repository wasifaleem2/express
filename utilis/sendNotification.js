const { getMessaging } = require("firebase-admin/messaging");

const sendNotification = async function (message) {
    return new Promise((resolve, reject) => {
        getMessaging().send(message)
            .then(resp => {
                resolve(resp);
            })
            .catch(err => {
                reject(err);
            });
    });
}

module.exports = sendNotification;
