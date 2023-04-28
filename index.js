const express = require('express')
const app = express();
app.use(express.json());
const mongoose = require("mongoose");
const databaseConnect = require("./database/index")

// call function to connect database
databaseConnect();
// api calling from routes
app.use("/api", require("./routes/index.js"));

// port where the server is running 
const port = 3002

// running the server 
app.listen(port, () => {
  console.log(`Server starts at http://localhost:${port}`)
})