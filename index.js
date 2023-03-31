const express = require('express')
const app = express();
app.use(express.json());
const port = 3002

const mongoose = require("mongoose");
const url =
  "mongodb://localhost:27017/practice?appname=MongoDB%20Compass&ssl=false";
  mongoose.set("strictQuery", false);
  mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

app.get('/', (req, res) => {
  res.send('Hello World!')
})

const UserModel = require("./models/UserModel");
// app.post('http://localhost:3002/save', (req, res) => {
//   let user = new UserModel({
//   phone:"000",
//   name: "khan",
//   })
//   user.save();
//   res.send("user save")
// })

// app.put('/users', (req, res) => {
//   UserModel.find({}, (err, userData)=>{
//     if(err){
//         console.log(err)
//     }
//     else{
//         console.log("data",userData)
//         res.send("data",userData)
//     }
//   })
// })

app.put('http://localhost:3002/user', (req, res) => {
  res.send('Got a PUT request at /user')
})

app.listen(port, () => {
  console.log(`Server starts at ${port}`)
})