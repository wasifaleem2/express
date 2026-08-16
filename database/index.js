const mongoose = require("mongoose");

const databaseConnect = () => {
    try{
        const url =
        process.env.DATABASE_URL;
        mongoose.set("strictQuery", false);
        mongoose.connect(url, {
            useNewUrlParser: true,
        });
        console.log("database connected...")
    }
    catch(error){
        console.log("error::",error)
    }
}

module.exports = databaseConnect;