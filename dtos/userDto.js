class UserDto {
    constructor(status, message, data = null){
        this.status = status,
        this.message = message,
        this.data = data
    }
}

module.exports = UserDto