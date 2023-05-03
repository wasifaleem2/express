const mongoose = require("mongoose");

const databaseConnect = () => {
    try{
        const url =
        "mongodb://localhost:27017/practice?appname=MongoDB%20Compass&ssl=false";
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