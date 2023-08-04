let connectedUsers = [];
const socketConnect = async (socket) => {
    // io.on("connection", async (socket) => {
        const userPhone = socket.handshake.query.userPhone;
        console.log("socket id for new conn ", socket.id)
        console.log("userPhone on connection ", userPhone)
        let user = await UserModel.findOneAndUpdate({ phone: userPhone }, { socketId: socket.id })
        .then((res)=>{
          // console.log(`socket id update for user phone ${userPhone}`)
          console.log("user", res)
        })
        .catch((err)=>{
          console.log("error")
        })
        console.log("A user is connected", userPhone);
        connectedUsers.push(socket.id);
        console.log("user list",connectedUsers);
        // sending user his socket id
        socket.emit("socket_id", socket.id);
        // io.emit("connected_users", { connectedUsers });
        socket.on("message", async (data) => {
          console.log(`message from ${socket.id} to ${data.recipient} : ${data.messageText} @date ${data.date} ${data.time}`);
          let recipient = await UserModel.findOne({ phone: data.recipient });
          console.log("recipient", recipient)
          io.to(data.senderSocket).emit('receive-message', data)
          io.to(recipient.socketId).emit('receive-message', data)
        });
      
        
        // when client disconnects
        socket.on("disconnect", () => {
          console.log(`socket ${socket.id} disconnected`);
          connectedUsers = connectedUsers.filter((user) => user !== socket.id);
          io.emit("connected_users", { connectedUsers });
        });
    //   });      
}

module.exports = socketConnect;