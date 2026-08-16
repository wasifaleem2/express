const mongoose = require("mongoose");

const databaseConnect = () => {
    try {
        const url =
            process.env.DATABASE_URL;
        mongoose.set("strictQuery", false);
        mongoose.connect(url, {
            useNewUrlParser: true,
        });
        console.log("database connected...")



        // Fail loudly but don't crash the process if the URL is missing — otherwise
        // mongoose.connect(undefined) throws and takes the whole server down.
        if (!url) {
            console.error("LOCAL_DB_URL is not set — starting without a database.");
            return;
        }

        mongoose.set("strictQuery", false);
        mongoose
            .connect(url, { useNewUrlParser: true })
            .then(() => console.log("database connected..."))
            // Log instead of throwing an unhandled rejection on a bad/unreachable
            // URL, so the container doesn't crash-loop. Mongoose keeps retrying.
            .catch((error) =>
                console.error("Database connection error:", error.message)
            );
    }
    catch (error) {
        console.log("error::", error)
    }
};

module.exports = databaseConnect;
