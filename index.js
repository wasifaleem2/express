const express = require('express')
const app = express();
app.use(express.json());
const UserModel = require("./models/UserModel");
// port where the server is running 
const port = 3002


const mongoose = require("mongoose");
// database connection
const url =
  "mongodb://localhost:27017/practice?appname=MongoDB%20Compass&ssl=false";
  mongoose.set("strictQuery", false);
  mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});
console.log("checking")

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// getting the list of users get method
app.get('/user', (req, res) => {
  UserModel.find({})
    .exec()
    .then((userData) => {
      // console.log("data", userData);
      res.status(200).send(userData); 
    })
    .catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
});

// saving user to db post method
app.post('/save', (req, res) => {
  let a = new UserModel({phone:"212", name:"ali"})
  a.save()
  .then(()=>{
    res.status(200).send("saved")
  })
  .catch((error)=>{
    res.status(500).send(error);
  })
})

// updating user in db using put method
app.put('/update/:phone', (req, res) => {
  UserModel.findOneAndUpdate({phone: "333"}, {name: "Arsalan"})
    .then(()=>{
      res.status(200).send("updated");
    })
    .catch((error)=>{
      res.status(500).send(error);
    })
})

// deleting user from db using delete method 
app.delete('/delete', (req, res) => {
  UserModel.deleteOne({ phone: "212" })
  .then(() => {
    res.status(200).send("Deleted");
  })
  .catch((error) => {
    res.status(500).send(error);
  })
});


// running the server 
app.listen(port, () => {
  console.log(`Server starts at ${port}`)
})